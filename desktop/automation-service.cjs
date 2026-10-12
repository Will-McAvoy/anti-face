const { decideAutomation, nextBoundary, localParts, validateAutomation } = require('../core/schedule.cjs');
const { arbitrateDecision } = require('../core/priority.cjs');
const { appError } = require('../core/errors.cjs');

class AutomationService {
  constructor(deps = {}) {
    this.clock = deps.clock || (() => new Date());
    this.timeZone = deps.timeZone || null;
    this.apply = deps.apply || (async () => ({ ok: true }));
    this.hostAvailable = deps.hostAvailable || (async () => true);
    this.previewing = deps.previewing || (() => false);
    this.intervalMs = deps.intervalMs || 30000;
    this.schedule = deps.schedule || ((fn, ms) => setInterval(fn, ms));
    this.clear = deps.clear || (id => clearInterval(id));
    this.onConfigChanged = deps.onConfigChanged || null;
    this.config = validateAutomation({});
    this.timer = null;
    this.starts = 0;
    this.generation = 0;
    this.lastAppliedKey = null;
    this.lastAppliedKeys = new Map();
    this.manualEventId = 0;
    this.eventSeq = 0;
    this.desired = null;
    this.systemScheme = null;
    this.status = { action: 'none', reason: 'off', message: '自动切换已关闭' };
  }

  start() {
    this.stop();
    this.starts += 1;
    this.timer = this.schedule(() => {
      this.tick(this.eventSeq).catch(error => {
        this.status = { action: 'error', reason: 'tick-exception', message: error?.message || '自动切换执行异常' };
      });
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  stop() {
    this.generation+=1;
    if (this.timer) this.clear(this.timer);
    this.timer = null;
  }

  get activeTimers() {
    return this.timer ? 1 : 0;
  }

  setConfig(config) {
    this.generation += 1;
    this.config = validateAutomation(config);
    if (this.config.mode === 'off') this.stop();
    else if (!this.timer) this.start();
    return this.config;
  }

  noteManual(themeId) {
    this.generation += 1;
    this.eventSeq += 1;
    this.manualEventId = this.eventSeq;
    const now = this.clock();
    const local = localParts(now, this.timeZone);
    if (this.config.mode === 'schedule') {
      const boundary = nextBoundary(this.config.rules, local);
      const until = boundary ? this._boundaryIso(now, boundary) : null;
      this.config = validateAutomation({ ...this.config, pausedUntil: until, pauseReason: 'manual-boundary', manualThemeId: themeId });
    } else if (this.config.mode === 'system') {
      this.config = validateAutomation({ ...this.config, pauseReason: 'manual-until-resume', manualThemeId: themeId, pausedUntil: null });
    }
    this.status = { action: 'none', reason: 'manual', message: this._pauseText() };
    if (this.onConfigChanged) this.onConfigChanged(this.config);
    return this.config;
  }

  pause(kind) {
    this.generation += 1;
    const now = this.clock();
    if (kind === 'resume') {
      this.config = validateAutomation({ ...this.config, pausedUntil: null, pauseReason: null });
      this.status = { action: 'none', reason: 'resumed', message: '已恢复自动切换' };
      if (this.onConfigChanged) this.onConfigChanged(this.config);
      return this.config;
    }
    if (kind === 'hour') {
      const until = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      this.config = validateAutomation({ ...this.config, pausedUntil: until, pauseReason: 'pause-hour' });
    } else if (kind === 'tomorrow') {
      const local = localParts(now, this.timeZone);
      const until = this._boundaryIso(now, { dayOffset: 1, time: '00:00' });
      this.config = validateAutomation({ ...this.config, pausedUntil: until, pauseReason: 'pause-tomorrow' });
      void local;
    } else if (kind === 'restore') {
      this.config = validateAutomation({ ...this.config, pauseReason: 'restored-original', pausedUntil: null });
      this.lastAppliedKey = null;
      this.lastAppliedKeys.clear();
    } else {
      throw appError('INVALID_ARGUMENT', '未知的暂停方式');
    }
    this.status = { action: 'none', reason: this.config.pauseReason, message: this._pauseText() };
    if (this.onConfigChanged) this.onConfigChanged(this.config);
    return this.config;
  }

  _boundaryIso(now, boundary) {
    const local = localParts(now, this.timeZone);
    const [hour, minute] = boundary.time.split(':').map(Number);
    const deltaDays = boundary.dayOffset;
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + deltaDays);
    target.setHours(hour, minute, 0, 0);
    if (deltaDays === 0 && (local.hour > hour || (local.hour === hour && local.minute >= minute))) {
      target.setDate(target.getDate() + 1);
    }
    return target.toISOString();
  }

  _pauseText() {
    if (this.config.pauseReason === 'restored-original') return '已恢复宿主原样，自动切换已暂停，直到你手动恢复。';
    if (this.config.pauseReason === 'manual-until-resume') return '已暂停自动切换，直到你点击恢复。';
    if (this.config.pausedUntil) return `自动切换暂停到 ${this.config.pausedUntil}`;
    return '自动切换已暂停';
  }

  nextText() {
    if (this.config.mode !== 'schedule') return this.config.mode === 'off' ? '无计划' : '跟随系统';
    const boundary = nextBoundary(this.config.rules, localParts(this.clock(), this.timeZone));
    return boundary ? `${boundary.dayOffset ? '明天 ' : '今天 '}${boundary.time}` : '无计划';
  }

  async requestSwitch(themeId, source, targetId = null) {
    if (this.previewing(targetId)) {
      return { ok: false, code: 'PREVIEW_CONFLICT', message: '实时试穿还没结束。请先保存或取消。' };
    }
    this.noteManual(themeId);
    const generation = this.generation;
    let available = false;
    try {
      available = await this.hostAvailable(targetId);
    } catch {
      available = false;
    }
    if (this.generation !== generation) {
      return { ok: false, code: 'CANCELLED', message: '操作已取消' };
    }
    if (!available) {
      this.desired = { themeId, source, targetId };
      this.status = { action: 'defer', reason: 'host', message: '已记下要切换的主题，当前没有可验证的宿主。' };
      return { ok: false, code: 'HOST_UNAVAILABLE', message: this.status.message, desired: this.desired };
    }
    const key = `${targetId || 'default'}|${source}|${themeId}`;
    if (this.lastAppliedKeys.get(targetId || 'default') === key) return { ok: true, skipped: true, themeId };
    let result;
    try {
      result = await this.apply({
        themeId,
        source,
        targetId,
        generation,
        isCurrent: () => this.generation === generation && !this.previewing(targetId)
      });
    } catch (error) {
      result = { ok: false, message: error?.message || '切换失败' };
    }
    if (this.generation !== generation) {
      return { ok: false, code: 'CANCELLED', message: '操作已取消' };
    }
    if (result?.ok) {
      this.lastAppliedKey = key;
      this.lastAppliedKeys.set(targetId || 'default', key);
    }
    return result;
  }

  async setScheme(scheme) {
    if (scheme !== 'light' && scheme !== 'dark') return { action: 'none', reason: 'system-unknown' };
    if (this.systemScheme === scheme) return { action: 'none', reason: 'same-scheme', applied: false };
    this.systemScheme = scheme;
    if (this.config.mode !== 'system') return { action: 'none', reason: 'mode', applied: false };
    return this.tick();
  }

  _cancelled(generation, targetId, decision) {
    if (this.generation !== generation || this.previewing(targetId)) return true;
    if (this.config.mode === 'off' && decision?.source !== 'project') return true;
    return false;
  }

  async tick(eventId = this.eventSeq, targetId = null) {
    const generation = this.generation;
    const now = this.clock();
    let decision = decideAutomation(this.config, {
      local: localParts(now, this.timeZone),
      nowIso: now.toISOString(),
      systemScheme: this.systemScheme || null,
      previewing: this.previewing(targetId),
      staleEventId: eventId,
      manualEventId: this.manualEventId,
      desiredThemeId: this.desired?.themeId || null
    });
    if (this.contextDecision && decision.action !== 'ignore' && decision.action !== 'defer' && decision.reason !== 'paused-restore' && decision.reason !== 'paused' && decision.reason !== 'paused-manual' && decision.reason !== 'stale-event') {
      const extra = this.contextDecision(targetId) || {};
      decision = arbitrateDecision({
        previewing: extra.previewing === true,
        manualHold: extra.manualHold === true,
        project: extra.project || null,
        scheduleDecision: decision
      });
    }
    if (decision.action !== 'apply') {
      this.status = { ...decision, message: decision.reason === 'preview' ? '试穿期间已暂停这个窗口的自动切换' : this.status.message };
      return { ...decision, applied: false };
    }
    const key = `${targetId || 'default'}|${decision.source}|${decision.themeId}`;
    if (this.lastAppliedKeys.get(targetId || 'default') === key || (key === this.lastAppliedKey && !targetId)) {
      return { ...decision, applied: false, skipped: true };
    }
    let available = false;
    try {
      available = await this.hostAvailable(targetId);
    } catch {
      available = false;
    }
    if (this._cancelled(generation, targetId, decision)) {
      return { ...decision, applied: false, stale: true, reason: 'cancelled-by-manual' };
    }
    if (!available) {
      this.desired = { themeId: decision.themeId, source: decision.source, targetId };
      this.status = { action: 'defer', reason: 'host', message: '没有可验证的宿主，只记录了期望主题。' };
      return { ...decision, applied: false, ok: false, code: 'HOST_UNAVAILABLE' };
    }
    let result;
    try {
      result = await this.apply({
        themeId: decision.themeId,
        source: decision.source,
        ruleId: decision.ruleId,
        targetId,
        generation,
        isCurrent: () => !this._cancelled(generation, targetId, decision)
      });
    } catch (error) {
      result = { ok: false, message: error?.message || '自动应用失败' };
    }
    if (this._cancelled(generation, targetId, decision)) {
      return { ...decision, applied: false, stale: true, reason: 'cancelled-by-manual' };
    }
    if (result?.ok) {
      this.lastAppliedKey = key;
      this.lastAppliedKeys.set(targetId || 'default', key);
      this.desired = null;
      this.status = { action: 'apply', reason: decision.reason, message: '已按自动规则应用', themeId: decision.themeId };
    } else {
      this.status = { action: 'error', reason: 'apply-failed', message: result?.message || '自动应用失败', code: result?.code };
    }
    return { ...decision, applied: !!result?.ok, result };
  }
}

module.exports = { AutomationService };
