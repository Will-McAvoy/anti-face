/**
 * Anti Face - 遥测数据源
 * 指标按数据源、窗口、会话和请求隔离。没有证据时返回 unknown/null，不用 idle 或 0 充当事实。
 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const {
  createInitialTaskState,
  taskStateReducer,
  markStateStale,
  TERMINAL_PHASES
} = require('../core/state-machine.cjs');
const {
  calculateOutputLatency,
  calculateAverageSpeed,
  RollingSpeedCalculator,
  calculateInputAndCache,
  calculateOutputAndReasoning
} = require('../core/metrics.cjs');

function blankMetrics(provenance = 'real') {
  return {
    latencyMs: null,
    rollingSpeed: null,
    rollingSpeedStatus: 'unavailable',
    averageSpeedToks: null,
    inputTokens: null,
    cachedInputTokens: null,
    totalInput: null,
    cacheRate: null,
    outputTokens: null,
    reasoningTokens: null,
    totalOutput: null,
    visibleOutput: null,
    totalTokens: null,
    model: null,
    project: null,
    targetId: null,
    targetTitle: null,
    connectionStatus: 'detached',
    provenance,
    isStale: false,
    lastUpdated: null,
    unavailableReason: null,
    usageScope: null
  };
}

class TelemetryManager {
  constructor(deps = {}) {
    this.themeService = deps.themeService;
    this.historyStorage = deps.historyStorage;
    this.appDataDir = deps.appDataDir || (
      process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity')
        : null
    );
    this.staleAfterMs = deps.staleAfterMs ?? 30000;
    this.statsObservedMs = null;
    this.monotonicNow = deps.monotonicNow || (() => performance.now());
    this.mode = 'host';
    this.selectedTargetId = null;
    this.speedCalculator = new RollingSpeedCalculator(5);
    this.currentState = createInitialTaskState();
    this.currentState.phase = 'unknown';
    this.currentState.unavailableReason = '尚未观测';
    this.currentMetrics = blankMetrics('real');
    this.currentMetrics.unavailableReason = '尚未观测';
    this.savedRequestIds = new Set();
    this.pendingArchive = new Map();
    this.statsCacheKey = null;
    this.statsObservedMs = null;
    this.transcriptKey = null;
    this.sawFinalTokens = false;
    this._generation = 0;
    this._inTick = false;
    this._stopped = false;
    this.activeTimer = null;
    this._readFile = deps.readFile || (file => fs.readFile(file, 'utf8'));
  }

  _now() {
    return this.monotonicNow();
  }

  _resetObservation(provenance) {
    this.speedCalculator.reset();
    this.currentState = createInitialTaskState();
    this.currentState.phase = provenance === 'fixture' ? 'idle' : 'unknown';
    this.currentState.unavailableReason = provenance === 'fixture' ? null : '尚未观测';
    this.currentMetrics = blankMetrics(provenance);
    this.currentMetrics.unavailableReason = provenance === 'fixture' ? null : '尚未观测';
    this.statsCacheKey = null;
    this.statsObservedMs = null;
    this.transcriptKey = null;
    this.sawFinalTokens = false;
    this.pendingArchive.clear();
  }

  setMode(mode) {
    if (!['host', 'fixture'].includes(mode)) return;
    if (mode === this.mode) return;
    this._generation += 1;
    this.mode = mode;
    this._resetObservation(mode === 'fixture' ? 'fixture' : 'real');
    if (mode === 'fixture') this._setupFixture();
  }

  setTarget(targetId) {
    const next = targetId || null;
    if (next === this.selectedTargetId) return;
    this.selectedTargetId = next;
    this._generation += 1;
    if (this.mode !== 'fixture') this._resetObservation('real');
  }

  _setupFixture() {
    this.currentMetrics = {
      ...blankMetrics('fixture'),
      latencyMs: 800,
      rollingSpeed: 14.5,
      rollingSpeedStatus: 'valid',
      averageSpeedToks: 16.2,
      inputTokens: 1200,
      cachedInputTokens: 480,
      totalInput: 1680,
      cacheRate: 28.6,
      outputTokens: 520,
      reasoningTokens: 150,
      totalOutput: 520,
      visibleOutput: 370,
      totalTokens: 2200,
      model: 'Gemini 3.8 Flash (High) [模拟数据]',
      project: 'anti_face [演示]',
      targetId: 'fixture-target',
      targetTitle: 'Anti Face Studio (Fixture)',
      connectionStatus: 'ready',
      provenance: 'fixture',
      isStale: false,
      lastUpdated: new Date().toISOString(),
      unavailableReason: null
    };
    this.currentState.phase = 'generating';
    this.currentState.taskId = 'fixture-task-001';
    this.currentState.unavailableReason = null;
    this.currentState.observedStartMs = this._now();
    this.sawFinalTokens = true;
  }

  start(intervalMs = 2000) {
    this.stop();
    this._stopped = false;
    this.activeTimer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  stop() {
    this._generation += 1;
    this._stopped = true;
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    this.speedCalculator.reset();
  }

  _markDisconnected(reason) {
    this.statsCacheKey = null;
    this.transcriptKey = null;
    this.currentMetrics.connectionStatus = 'detached';
    this.currentMetrics.isStale = true;
    this.currentMetrics.unavailableReason = reason;
    this.currentMetrics.rollingSpeedStatus = 'stale';
    this.currentState = markStateStale(this.currentState);
    this.currentState.unavailableReason = reason;
  }

  _clearStale() {
    this.currentMetrics.isStale = false;
    if (this.currentState.isStale) {
      this.currentState = { ...this.currentState, isStale: false, activeTools: this.currentState.activeTools };
    }
  }

  async tick() {
    if (this._inTick || this._stopped) return this.getState();
    this._inTick = true;
    const generation = this._generation;
    const mode = this.mode;
    const selected = this.selectedTargetId;
    const stale = () => generation !== this._generation || mode !== this.mode || selected !== this.selectedTargetId || this._stopped;
    try {
      if (mode === 'fixture') return this.getState();
      const hostStatus = this.themeService?.status || { state: 'detached' };
      let targets = [];
      try {
        targets = await this.themeService?.listTargets().catch(() => []) || [];
      } catch {
        targets = [];
      }
      if (stale()) return this.getState();
      if (!this.themeService) {
        this.currentMetrics.unavailableReason = this.currentMetrics.unavailableReason || '未连接遥测数据源';
        return this.getState();
      }
      const chosen = selected
        ? targets.find(target => target.id === selected) || null
        : (targets.find(target => target.isCurrent) || targets[0] || null);
      if (selected && !chosen) {
        this._resetObservation('real');
        this._markDisconnected('所选窗口已消失');
        this.currentState.phase = 'unknown';
        return this.getState();
      }
      if (!chosen || hostStatus.state === 'detached') {
        this._markDisconnected(chosen ? '宿主连接已断开' : '没有可观测的窗口');
        this.currentState.phase = this.currentState.phase === 'idle' ? 'unknown' : this.currentState.phase;
        if (!this.currentState.taskId) this.currentState.phase = 'unknown';
        return this.getState();
      }
      this.currentMetrics.connectionStatus = hostStatus.state;
      this.currentMetrics.targetId = chosen.id;
      this.currentMetrics.targetTitle = chosen.title;
      let activeConvoId = null;
      if (chosen.url) {
        const match = /\/c\/([a-zA-Z0-9-]+)/.exec(chosen.url);
        if (match) activeConvoId = match[1];
      }
      if (!activeConvoId || !this.appDataDir) {
        this._resetObservation('real');
        this.currentMetrics.targetId = chosen.id;
        this.currentMetrics.targetTitle = chosen.title;
        this.currentMetrics.connectionStatus = hostStatus.state;
        this.currentMetrics.unavailableReason = !activeConvoId ? '无法识别会话' : '没有日志目录';
        this.currentState = createInitialTaskState();
        this.currentState.phase = 'unknown';
        this.currentState.unavailableReason = this.currentMetrics.unavailableReason;
        this.sawFinalTokens = false;
        return this.getState();
      }
      if (this.currentState.conversationId && this.currentState.conversationId !== activeConvoId) {
        this._resetObservation('real');
        this.currentMetrics.connectionStatus = hostStatus.state;
        this.currentMetrics.targetId = chosen.id;
        this.currentMetrics.targetTitle = chosen.title;
      }
      if (stale()) return this.getState();
      const transcriptEvidence = await this._pollTranscript(activeConvoId, chosen.id, generation);
      if (stale()) return this.getState();
      const statsEvidence = await this._pollStatsCache(activeConvoId, chosen.id, generation);
      if (stale()) return this.getState();
      if (statsEvidence) {
        this.currentMetrics.isStale = false;
        this.statsObservedMs = this._now();
        this.currentMetrics.lastUpdated = new Date().toISOString();
      } else if (this.statsObservedMs != null && this._now() - this.statsObservedMs >= this.staleAfterMs) {
        this.currentMetrics.isStale = true;
      }
      if (!transcriptEvidence && this.currentState.lastUpdateMonotonicMs != null && this._now() - this.currentState.lastUpdateMonotonicMs >= this.staleAfterMs) {
        this.currentState = markStateStale(this.currentState);
      }
    } catch {
      if (!stale()) this._markDisconnected('读取遥测失败');
    } finally {
      this._inTick = false;
    }
    return this.getState();
  }

  _splitTurns(convoId, events) {
    const turns = [];
    let current = null;
    let index = 0;
    for (const event of events) {
      if (event.type === 'USER_INPUT' || !current) {
        if (current) turns.push(current);
        current = { id: `${convoId}:turn:${index}`, events: [event] };
        index += 1;
      } else {
        current.events.push(event);
      }
    }
    if (current) turns.push(current);
    return turns;
  }

  _phaseForTurn(turn) {
    const last = turn.events[turn.events.length - 1];
    if (!last || !last.type) {
      return { phase: 'unknown', reason: '日志事件无法识别' };
    }
    if (last.type === 'USER_INPUT') {
      return { phase: 'running', reason: null };
    }
    if (last.status === 'FAILED' || last.status === 'ERROR') {
      return { phase: 'failed', reason: null };
    }
    if (last.status === 'CANCELLED' || last.status === 'CANCELED') {
      return { phase: 'cancelled', reason: null };
    }
    if (last.type === 'PLANNER_RESPONSE') {
      const tools = Array.isArray(last.tool_calls) ? last.tool_calls : [];
      if (tools.length > 0 && last.status !== 'DONE') {
        return { phase: 'tool_running', reason: null };
      }
      if (last.status === 'DONE') {
        return { phase: 'unknown', reason: '单个模型步骤已结束，不能据此判断整个任务已完成' };
      }
      return { phase: 'generating', reason: null };
    }
    return { phase: 'unknown', reason: '无法从日志判断任务阶段' };
  }

  _cancelled(generation) {
    return generation != null && generation !== this._generation;
  }

  async _pollTranscript(convoId, targetId, generation) {
    if (this.currentState.conversationId && this.currentState.conversationId !== convoId) {
      this._resetObservation('real');
    }
    const transcriptPath = path.join(this.appDataDir, 'brain', convoId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fsSync.existsSync(transcriptPath)) {
      this.currentState = createInitialTaskState(null, convoId);
      this.currentState.phase = 'unknown';
      this.currentState.unavailableReason = '无可用日志';
      this.currentMetrics.unavailableReason = '无可用日志';
      this.currentMetrics.latencyMs = null;
      return false;
    }
    let content;
    try {
      content = await this._readFile(transcriptPath);
    } catch {
      if (this._cancelled(generation)) return false;
      this.currentMetrics.latencyMs = null;
      this.currentState = markStateStale(this.currentState);
      this.currentState.unavailableReason = '日志读取失败';
      this.currentMetrics.unavailableReason = '日志读取失败';
      return false;
    }
    if (this._cancelled(generation)) return false;
    const lines = content.split('\n');
    const events = [];
    let corrupt = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new Error('Invalid event');
        events.push(event);
      } catch {
        corrupt += 1;
      }
    }
    if (events.length === 0) {
      this.currentMetrics.latencyMs = null;
      this.currentState = createInitialTaskState(null, convoId);
      this.currentState.phase = 'unknown';
      this.currentState.unavailableReason = corrupt ? '日志损坏' : '无可用日志';
      this.currentMetrics.unavailableReason = this.currentState.unavailableReason;
      return false;
    }
    const key = `transcript|${targetId}|${convoId}|${events.length}|${corrupt}|${JSON.stringify(events[events.length - 1])}`;
    const changed = key !== this.transcriptKey;
    this.transcriptKey = key;
    const turns = this._splitTurns(convoId, events);
    const latest = turns[turns.length - 1];
    const interpreted = this._phaseForTurn(latest);
    const now = this._now();
    const step = latest.events[latest.events.length - 1]?.step_index ?? events.length;
    let state = this.currentState;
    if (state.taskId !== latest.id) {
      state = taskStateReducer(state, {
        type: 'task_started',
        taskId: latest.id,
        conversationId: convoId,
        sequence: step,
        monotonicMs: now,
        isIntermediateObservation: true
      }, now);
    }
    if (changed) state = taskStateReducer(state, {
      phase: interpreted.phase,
      taskId: latest.id,
      conversationId: convoId,
      sequence: step
    }, now);
    state.unavailableReason = interpreted.reason;
    this.currentState = state;
    this.currentMetrics.latencyMs = this._turnLatency(latest);
    if (corrupt > 0) this.currentMetrics.unavailableReason = '日志含损坏行，阶段仅基于完整行';
    else if (interpreted.reason) this.currentMetrics.unavailableReason = interpreted.reason;
    else this.currentMetrics.unavailableReason = null;
    for (const turn of turns.slice(0, -1)) {
      await this._archiveTurn(turn, convoId, generation);
      if (this._cancelled(generation)) return changed;
    }
    if (TERMINAL_PHASES.has(interpreted.phase)) {
      await this._archiveTurn(latest, convoId, generation);
    }
    return changed;
  }

  // This is a log observation interval, not token-level time to first output.
  _turnLatency(turn) {
    const input = turn.events.find(event => event.type === 'USER_INPUT');
    const response = turn.events.find(event => event.type === 'PLANNER_RESPONSE');
    const start = Date.parse(input?.created_at);
    const end = Date.parse(response?.created_at);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? calculateOutputLatency(start, end) : null;
  }

  _clearUsage(reason = null) {
    const blank = blankMetrics('real');
    for (const key of ['model', 'project', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'totalInput', 'totalOutput', 'visibleOutput', 'cacheRate', 'averageSpeedToks', 'lastUpdated', 'usageScope']) {
      this.currentMetrics[key] = blank[key];
    }
    this.currentMetrics.unavailableReason = reason;
    this.currentMetrics.isStale = !!reason;
    this.sawFinalTokens = false;
    this.statsObservedMs = null;
  }

  async _archiveTurn(turn, convoId, generation) {
    if (!this.historyStorage?.enabled || this.savedRequestIds.has(turn.id) || this.pendingArchive.has(turn.id)) return;
    if (this._cancelled(generation)) return;
    const interpreted = this._phaseForTurn(turn);
    const record = {
      taskId: turn.id,
      requestId: turn.id,
      occurredAt: turn.events.find(event => event.type === 'USER_INPUT')?.created_at || null,
      model: 'unknown',
      project: '未知项目',
      status: interpreted.phase === 'unknown' ? 'unknown' : interpreted.phase,
      durationSeconds: null,
      latencyMs: this._turnLatency(turn),
      averageSpeedToks: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      attempts: null, // Transcript planner steps do not identify request attempts.
      isComplete: false,
      provenance: 'real'
    };
    try {
      const saved = await this.historyStorage.appendRecord(record, { ifAbsent: true });
      if (this._cancelled(generation)) return;
      if (saved) this.savedRequestIds.add(turn.id);
    } catch {
      // 写入失败不打标，下一轮还可以重试
    }
  }

  async _pollStatsCache(convoId, targetId, generation) {
    const statsPath = path.join(this.appDataDir, 'antigravity_stats_cache.json');
    if (!fsSync.existsSync(statsPath)) {
      this.statsCacheKey = null;
      this._clearUsage('没有统计缓存');
      return false;
    }
    let stat;
    try {
      stat = await fs.stat(statsPath);
    } catch {
      this.statsCacheKey = null;
      this._clearUsage('统计缓存无法读取');
      return false;
    }
    const version = `${stat.mtimeMs}:${stat.size}`;
    const key = `stats|${targetId}|${convoId}|${version}`;
    if (key === this.statsCacheKey && this.currentMetrics.model) return false;
    let data;
    try {
      data = JSON.parse(await this._readFile(statsPath));
    } catch {
      if (this._cancelled(generation)) return false;
      this.statsCacheKey = null;
      this._clearUsage('统计缓存损坏');
      return false;
    }
    if (this._cancelled(generation)) return false;
    this.statsCacheKey = key;
    const session = data?.sessions?.[convoId];
    this._clearUsage();
    if (!session || typeof session !== 'object') {
      this._clearUsage('该会话没有统计');
      return false;
    }
    this.currentMetrics.model = session.model || null;
    this.currentMetrics.project = session.project || null;
    this.currentMetrics.inputTokens = session.input_tokens != null ? session.input_tokens : null;
    this.currentMetrics.cachedInputTokens = session.cached_tokens != null ? session.cached_tokens : null;
    this.currentMetrics.outputTokens = session.output_tokens != null ? session.output_tokens : null;
    this.currentMetrics.reasoningTokens = session.thinking_tokens != null ? session.thinking_tokens : null;
    this.currentMetrics.totalTokens = session.total_tokens != null ? session.total_tokens : null;
    const hasTokens = ['input_tokens', 'cached_tokens', 'output_tokens', 'thinking_tokens', 'total_tokens']
      .some(field => session[field] != null);
    this.sawFinalTokens = hasTokens;
    if (session.input_tokens != null || session.cached_tokens != null) {
      const input = calculateInputAndCache(session.input_tokens, session.cached_tokens, false);
      this.currentMetrics.totalInput = input.totalInput;
      this.currentMetrics.cacheRate = input.cacheRate;
    }
    if (session.output_tokens != null || session.thinking_tokens != null) {
      const output = calculateOutputAndReasoning(session.output_tokens, session.thinking_tokens, true);
      this.currentMetrics.totalOutput = output.totalOutput;
      this.currentMetrics.visibleOutput = output.visibleOutput;
    }
    if (session.output_tokens != null && session.duration_sec != null && session.duration_sec > 0) {
      this.currentMetrics.averageSpeedToks = calculateAverageSpeed(session.output_tokens, session.duration_sec);
    } else {
      this.currentMetrics.averageSpeedToks = null;
    }
    this.currentMetrics.usageScope = 'conversation';
    this.currentMetrics.rollingSpeed = null;
    this.currentMetrics.rollingSpeedStatus = 'unavailable';
    return true;
  }

  getState() {
    let observedSeconds = null;
    let durationKind = 'unavailable';
    if (this.currentState.frozenElapsedMs != null) {
      observedSeconds = Math.floor(this.currentState.frozenElapsedMs / 1000);
      durationKind = 'frozen';
    } else if (this.currentState.observedStartMs != null) {
      observedSeconds = Math.max(0, Math.floor((this._now() - this.currentState.observedStartMs) / 1000));
      durationKind = 'observed';
    }
    const reason = this.currentState.unavailableReason || this.currentMetrics.unavailableReason;
    return {
      taskState: {
        phase: this.currentState.phase,
        taskId: this.currentState.taskId,
        conversationId: this.currentState.conversationId,
        activeToolsCount: this.currentState.activeTools?.size || 0,
        isStale: !!this.currentState.isStale,
        observedSeconds,
        durationKind,
        unavailableReason: this.currentState.unavailableReason || null,
        lastUpdateIso: this.currentState.lastUpdateIso
      },
      metrics: { ...this.currentMetrics },
      capabilities: {
        streamingSpeed: false,
        streamingExplanation: this.mode === 'fixture'
          ? '当前是测试模拟数据，不代表真实宿主。'
          : '宿主当前版本未提供逐 Token 流式时间戳；没有完整起点时只标注已观测耗时。',
        finalTokens: this.mode === 'fixture' ? false : this.sawFinalTokens === true,
        cacheRate: this.currentMetrics.cacheRate != null,
        provenance: this.currentMetrics.provenance,
        unavailableReason: reason || null
      }
    };
  }
}

module.exports = { TelemetryManager };
