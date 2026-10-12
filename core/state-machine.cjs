/**
 * Anti Face - 任务状态机
 * 对应验收用例：T09, F1.1 - F1.5
 */

const PHASES = [
  'idle',
  'queued',
  'running',
  'generating',
  'tool_running',
  'waiting_user',
  'completed',
  'failed',
  'cancelled',
  'unknown'
];

const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled']);

/**
 * 初始任务状态
 */
function createInitialTaskState(taskId = null, conversationId = null) {
  return {
    taskId,
    conversationId,
    phase: 'idle',
    lastSequence: -1,
    activeTools: new Set(),
    startMonotonicMs: null,
    observedStartMs: null,
    frozenElapsedMs: null,
    lastUpdateMonotonicMs: null,
    lastUpdateIso: null,
    isStale: false,
    errorMessage: null,
    isIntermediateObservation: false
  };
}

/**
 * 状态转移 Reducer
 * @param {ReturnType<typeof createInitialTaskState>} state
 * @param {object} event - 规范化事件
 * @param {number} currentMonotonicMs - 当前单调时钟时间
 * @returns {ReturnType<typeof createInitialTaskState>}
 */
function taskStateReducer(state, event, currentMonotonicMs = Date.now()) {
  const next = {
    ...state,
    activeTools: new Set(state.activeTools)
  };

  // 1. 如果新任务开始，重置状态
  if (event.type === 'task_started' || (event.taskId && state.taskId && event.taskId !== state.taskId)) {
    next.taskId = event.taskId || null;
    next.conversationId = event.conversationId || state.conversationId;
    next.phase = 'running';
    next.lastSequence = event.sequence != null ? event.sequence : 0;
    next.activeTools.clear();
    next.startMonotonicMs = event.monotonicMs || currentMonotonicMs;
    next.observedStartMs = currentMonotonicMs;
    next.frozenElapsedMs = null;
    next.lastUpdateMonotonicMs = currentMonotonicMs;
    next.lastUpdateIso = new Date().toISOString();
    next.isStale = false;
    next.isIntermediateObservation = !!event.isIntermediateObservation;
    return next;
  }

  // 2. 乱序/序号检查：如果事件带 sequence 且小于等于已处理的 sequence，且不是显式完成/重连，则忽略
  if (
    event.sequence != null &&
    state.lastSequence >= 0 &&
    event.sequence < state.lastSequence
  ) {
    // 旧事件到达，若当前已是终态，坚决不能倒退
    if (TERMINAL_PHASES.has(state.phase)) {
      return state;
    }
  }

  // 3. 终态不可逆法则 (T09)：
  // 处于 completed/failed/cancelled 的任务，不能被 generating/running/tool_running 等回退
  if (TERMINAL_PHASES.has(state.phase)) {
    if (!TERMINAL_PHASES.has(event.phase) && event.type !== 'reset') {
      return state;
    }
  }

  // 更新 sequence
  if (event.sequence != null && event.sequence > next.lastSequence) {
    next.lastSequence = event.sequence;
  }

  // 4. 处理工具并发逻辑
  if (event.type === 'tool_call_start' || event.toolStarted) {
    const toolId = event.toolId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    next.activeTools.add(toolId);
    next.phase = 'tool_running';
  } else if (event.type === 'tool_call_end' || event.toolEnded) {
    if (event.toolId) {
      next.activeTools.delete(event.toolId);
    } else if (next.activeTools.size > 0) {
      // 移除一个活动工具
      const first = next.activeTools.values().next().value;
      next.activeTools.delete(first);
    }
    // 工具全部结束后，若没有其他状态指示，回到 running 或 generating
    if (next.activeTools.size === 0) {
      if (next.phase === 'tool_running') {
        next.phase = event.nextPhase || 'running';
      }
    }
  }

  // 5. 处理显式阶段更新
  if (event.phase && PHASES.includes(event.phase)) {
    // 如果工具还在执行中，且新事件不是终态或 waiting_user，则保持 tool_running
    if (next.activeTools.size > 0 && !TERMINAL_PHASES.has(event.phase) && event.phase !== 'waiting_user') {
      next.phase = 'tool_running';
    } else {
      next.phase = event.phase;
    }
  }

  // 6. 错误信息处理
  if (event.errorMessage) {
    next.errorMessage = event.errorMessage;
  }

  // 7. 更新时间与活跃标记。耗时只使用调用方传入的单调时钟。
  next.lastUpdateMonotonicMs = currentMonotonicMs;
  next.lastUpdateIso = new Date().toISOString();
  next.isStale = false;
  if (TERMINAL_PHASES.has(next.phase) && next.observedStartMs != null && next.frozenElapsedMs == null) {
    next.frozenElapsedMs = Math.max(0, currentMonotonicMs - next.observedStartMs);
  }

  return next;
}

/**
 * 标记状态为断开/过期
 */
function markStateStale(state) {
  return {
    ...state,
    isStale: true
  };
}

module.exports = {
  PHASES,
  TERMINAL_PHASES,
  createInitialTaskState,
  taskStateReducer,
  markStateStale
};
