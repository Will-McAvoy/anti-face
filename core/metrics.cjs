/**
 * Anti Face - Token 速度与用量指标计算纯函数模块
 * 对应验收用例：T01, T02, T03, T04, T05, T06, T07, T08
 */

/**
 * T01: 计算首段输出延迟
 * @param {number|null} requestStartMs - 请求/提交时间戳 (毫秒单调时间)
 * @param {number|null} firstOutputMs - 首个可见输出到达时间戳 (毫秒单调时间)
 * @returns {number|null} 延迟毫秒数，若缺少时间基准则返回 null
 */
function calculateOutputLatency(requestStartMs, firstOutputMs) {
  if (
    requestStartMs == null ||
    firstOutputMs == null ||
    !Number.isFinite(requestStartMs) ||
    !Number.isFinite(firstOutputMs)
  ) {
    return null;
  }
  const latency = firstOutputMs - requestStartMs;
  if (latency < 0) return null;
  return Math.round(latency);
}

/**
 * T02: 计算区间平均输出速度
 * @param {number} tokensDelta - 区间新增真实输出 Token
 * @param {number} durationSeconds - 有效区间秒数
 * @returns {number|null} tok/s 速度，保留一位小数；无效时返回 null
 */
function calculateAverageSpeed(tokensDelta, durationSeconds) {
  if (
    tokensDelta == null ||
    durationSeconds == null ||
    !Number.isFinite(tokensDelta) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    tokensDelta < 0
  ) {
    return null;
  }
  const speed = tokensDelta / durationSeconds;
  return Number(speed.toFixed(1));
}

/**
 * T03: 滚动速度窗口计算器 (默认 5 秒窗口)
 */
class RollingSpeedCalculator {
  constructor(windowSeconds = 5) {
    this.windowMs = windowSeconds * 1000;
    this.samples = []; // Array<{ monotonicMs: number, deltaTokens: number, eventId?: string }>
    this.seenEventIds = new Set();
    this.connected = true;
  }

  setConnected(connected) {
    this.connected = !!connected;
  }

  /**
   * 记录新增输出 Token
   * @param {number} monotonicMs - 当前单调时钟 (ms)
   * @param {number} deltaTokens - 增量 Token
   * @param {string} [eventId] - 事件唯一标识用于去重
   */
  addSample(monotonicMs, deltaTokens, eventId = null) {
    if (!Number.isFinite(monotonicMs) || !Number.isFinite(deltaTokens) || deltaTokens < 0) {
      return;
    }
    if (eventId) {
      if (this.seenEventIds.has(eventId)) return;
      this.seenEventIds.add(eventId);
    }
    this.samples.push({ monotonicMs, deltaTokens, eventId });
    this.prune(monotonicMs);
  }

  /**
   * 清理窗口外的过期样本
   */
  prune(nowMs) {
    const cutoff = nowMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].monotonicMs < cutoff) {
      const removed = this.samples.shift();
      if (removed.eventId) this.seenEventIds.delete(removed.eventId);
    }
  }

  /**
   * 计算当前滚动速度
   * @param {number} nowMs - 当前单调时钟
   * @returns {{ speed: number|null, status: 'valid' | 'warming_up' | 'stale' | 'unavailable' }}
   */
  getRollingSpeed(nowMs) {
    if (!this.connected) {
      return { speed: null, status: 'stale' };
    }
    this.prune(nowMs);
    if (this.samples.length === 0) {
      return { speed: 0, status: 'valid' };
    }

    const firstSample = this.samples[0];
    const durationMs = nowMs - firstSample.monotonicMs;
    const totalDelta = this.samples.reduce((acc, s) => acc + s.deltaTokens, 0);

    if (durationMs <= 0) {
      return { speed: null, status: 'warming_up' };
    }

    const durationSec = durationMs / 1000;
    const speed = Number((totalDelta / Math.max(durationSec, 0.1)).toFixed(1));
    const isWarmingUp = durationMs < this.windowMs;

    return {
      speed,
      status: isWarmingUp ? 'warming_up' : 'valid'
    };
  }

  reset() {
    this.samples = [];
    this.seenEventIds.clear();
    this.connected = true;
  }
}

/**
 * T04: 累计量与 Final 去重合并
 * @param {Array<{ scope: string, type: 'cumulative' | 'final', tokens: number, requestId?: string }>} records
 * @returns {number} 最终合规用量
 */
function deduplicateUsage(records) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  // Map per requestId or unified
  const requests = new Map();
  for (const r of records) {
    const key = r.requestId || 'default';
    if (!requests.has(key)) {
      requests.set(key, { finalVal: null, maxCumulative: 0 });
    }
    const state = requests.get(key);
    if (r.type === 'final') {
      state.finalVal = r.tokens; // final overrides and stays idempotent
    } else if (r.type === 'cumulative') {
      if (r.tokens > state.maxCumulative) {
        state.maxCumulative = r.tokens;
      }
    }
  }

  let total = 0;
  for (const state of requests.values()) {
    total += state.finalVal != null ? state.finalVal : state.maxCumulative;
  }
  return total;
}

/**
 * T05: 重试用量与尝试统计
 * @param {Array<{ attemptId: string, outputTokens: number, status: 'failed' | 'success' }>} attempts
 * @returns {{ totalOutput: number, attemptCount: number, retryOutput: number, retryRatio: number|null }}
 */
function calculateRetryUsage(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return { totalOutput: 0, attemptCount: 0, retryOutput: 0, retryRatio: null };
  }
  let totalOutput = 0;
  let retryOutput = 0;
  let attemptsCount = attempts.length;

  for (let i = 0; i < attempts.length; i++) {
    const att = attempts[i];
    const tokens = Number.isFinite(att.outputTokens) ? att.outputTokens : 0;
    totalOutput += tokens;
    if (i > 0) {
      retryOutput += tokens;
    }
  }

  const retryRatio = totalOutput > 0 ? Number(((retryOutput / totalOutput) * 100).toFixed(1)) : 0;
  return {
    totalOutput,
    attemptCount: attemptsCount,
    retryOutput,
    retryRatio
  };
}

/**
 * T06: 输入与缓存计算
 * @param {number|null} inputTokens - 来源输入 Token
 * @param {number|null} cachedTokens - 来源缓存 Token
 * @param {boolean|'unknown'} inputIncludesCached - inputTokens 是否已经包含 cachedTokens
 * @returns {{ totalInput: number|null, cacheRate: number|null, isApplicable: boolean, error: string|null }}
 */
function calculateInputAndCache(inputTokens, cachedTokens, inputIncludesCached) {
  if (inputTokens == null || cachedTokens == null) {
    return { totalInput: inputTokens, cacheRate: null, isApplicable: false, error: null };
  }
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cachedTokens)) {
    return { totalInput: null, cacheRate: null, isApplicable: false, error: '非数值 Token' };
  }
  if (inputIncludesCached === 'unknown' || inputIncludesCached == null) {
    return { totalInput: null, cacheRate: null, isApplicable: false, error: '统计口径未知' };
  }

  let totalInput;
  if (inputIncludesCached === true) {
    totalInput = inputTokens;
    if (cachedTokens > totalInput) {
      return { totalInput, cacheRate: null, isApplicable: false, error: '缓存计数异常 (大于总输入)' };
    }
  } else {
    // 互斥模式: total = input + cached
    totalInput = inputTokens + cachedTokens;
  }

  if (totalInput === 0) {
    return { totalInput: 0, cacheRate: null, isApplicable: false, error: null }; // 0 分母显示不适用
  }

  const cacheRate = Number(((cachedTokens / totalInput) * 100).toFixed(1));
  return { totalInput, cacheRate, isApplicable: true, error: null };
}

/**
 * T07: 推理与输出计算
 * @param {number|null} outputTokens - 输出 Token
 * @param {number|null} reasoningTokens - 推理/思考 Token
 * @param {boolean|'unknown'} outputIncludesReasoning - outputTokens 是否已经包含 reasoningTokens
 * @returns {{ totalOutput: number|null, visibleOutput: number|null, error: string|null }}
 */
function calculateOutputAndReasoning(outputTokens, reasoningTokens, outputIncludesReasoning) {
  if (outputTokens == null) {
    return { totalOutput: null, visibleOutput: null, error: null };
  }
  if (!Number.isFinite(outputTokens)) {
    return { totalOutput: null, visibleOutput: null, error: '非数值 Token' };
  }

  if (reasoningTokens == null) {
    return { totalOutput: outputTokens, visibleOutput: outputTokens, error: null };
  }

  if (outputIncludesReasoning === 'unknown' || outputIncludesReasoning == null) {
    // 包含关系未知，不做合并总计
    return { totalOutput: null, visibleOutput: null, error: '包含关系未知' };
  }

  if (outputIncludesReasoning === true) {
    // 包含在输出中
    const visible = Math.max(0, outputTokens - reasoningTokens);
    return { totalOutput: outputTokens, visibleOutput: visible, error: null };
  } else {
    // 互斥独立
    return { totalOutput: outputTokens + reasoningTokens, visibleOutput: outputTokens, error: null };
  }
}

/**
 * T08 & 效率指标聚合
 * @param {Array<{ outputTokens: number|null, isFinalOnly?: boolean }>} tasks
 */
function aggregateEfficiency(tasks) {
  let knownOutput = 0;
  let missingCount = 0;
  let validCount = 0;

  for (const t of tasks) {
    if (t.outputTokens != null && Number.isFinite(t.outputTokens)) {
      knownOutput += t.outputTokens;
      validCount++;
    } else {
      missingCount++;
    }
  }

  return {
    knownOutputLowerBound: knownOutput,
    validSampleCount: validCount,
    missingSampleCount: missingCount,
    averageKnownOutputPerTask: validCount > 0 ? Number((knownOutput / validCount).toFixed(1)) : null,
    isComplete: missingCount === 0
  };
}

module.exports = {
  calculateOutputLatency,
  calculateAverageSpeed,
  RollingSpeedCalculator,
  deduplicateUsage,
  calculateRetryUsage,
  calculateInputAndCache,
  calculateOutputAndReasoning,
  aggregateEfficiency
};
