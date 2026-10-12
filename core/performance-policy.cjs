const { appError } = require('./errors.cjs');

/**
 * 性能策略分档：
 * - normal: 用户原始效果 (不修改任何参数)
 * - lightweight: 轻量模式 (壁纸模糊上限 12px，区域模糊上限 12px)
 * - powersave: 省电模式 (壁纸模糊上限 8px，区域模糊上限 8px)
 *
 * 模式：
 * - 'off': 完全关闭
 * - 'advisory': 仅建议 (默认)
 * - 'auto': 自动调整
 */

const PERFORMANCE_TIERS = ['normal', 'lightweight', 'powersave'];
const PERFORMANCE_MODES = ['off', 'advisory', 'auto'];

const BLUR_CAPS = {
  normal: 100,
  lightweight: 12,
  powersave: 8
};

// 迟滞与冷却参数
const POOR_SAMPLE_THRESHOLD_MS = 33.3; // 相当于低于 30fps 的帧间隔
const CONSECUTIVE_POOR_REQUIRED = 3;  // 需连续 3 个采样窗口表现差才降级
const CONSECUTIVE_GOOD_REQUIRED = 15; // 需连续 15 个采样窗口 (约 30 秒) 表现好才升级
const MIN_ADJUST_INTERVAL_MS = 10000; // 最短调整间隔 10 秒冷却

function defaultPerformancePrefs() {
  return {
    mode: 'advisory', // 默认仅建议
    batteryAware: true,
    maxTier: 'powersave' // 允许降级的最大范围
  };
}

function validatePerformancePrefs(value = {}) {
  const mode = PERFORMANCE_MODES.includes(value.mode) ? value.mode : 'advisory';
  const batteryAware = value.batteryAware !== false;
  const maxTier = PERFORMANCE_TIERS.includes(value.maxTier) ? value.maxTier : 'powersave';
  return { mode, batteryAware, maxTier };
}

/**
 * 纯函数：根据当前状态与新采样计算下一步档位与原因
 */
function evaluatePerformanceState(currentState, sample, options = {}) {
  const prefs = validatePerformancePrefs(options.prefs);
  const now = options.now || Date.now();

  const state = {
    tier: currentState?.tier || 'normal',
    consecutivePoor: currentState?.consecutivePoor || 0,
    consecutiveGood: currentState?.consecutiveGood || 0,
    lastAdjustedAt: currentState?.lastAdjustedAt || 0,
    reason: currentState?.reason || '初始正常'
  };

  if (prefs.mode === 'off') {
    return {
      tier: 'normal',
      consecutivePoor: 0,
      consecutiveGood: 0,
      lastAdjustedAt: state.lastAdjustedAt,
      reason: '性能策略已关闭',
      changed: state.tier !== 'normal',
      blurCap: BLUR_CAPS.normal,
      overrides: {}
    };
  }

  // 检查样本有效性：窗口隐藏、后台节流或未知数据不作判定
  if (!sample || sample.isBackground === true || sample.valid === false) {
    return {
      ...state,
      changed: false,
      blurCap: BLUR_CAPS[state.tier],
      overrides: state.tier === 'normal' ? {} : { maxBlur: BLUR_CAPS[state.tier] }
    };
  }

  // 电源感知检查
  const isBattery = prefs.batteryAware && sample.powerSource === 'battery';
  if (prefs.maxTier !== 'normal' && isBattery && state.tier === 'normal') {
    if (now - state.lastAdjustedAt >= MIN_ADJUST_INTERVAL_MS) {
      return {
        tier: prefs.maxTier === 'lightweight' ? 'lightweight' : 'powersave',
        consecutivePoor: 0,
        consecutiveGood: 0,
        lastAdjustedAt: now,
        reason: '检测到电池供电，已切换为省电模式',
        changed: true,
        blurCap: BLUR_CAPS.powersave,
        overrides: { maxBlur: BLUR_CAPS.powersave }
      };
    }
  }

  if(sample.powerEvent && sample.powerSource==='ac' && state.tier!=='normal' && now-state.lastAdjustedAt>=MIN_ADJUST_INTERVAL_MS) return {tier:'normal',consecutivePoor:0,consecutiveGood:0,lastAdjustedAt:now,reason:'已恢复市电供电',changed:true,blurCap:BLUR_CAPS.normal,overrides:{}};

  // 帧时间判定
  const isPoor = typeof sample.frameDurationMs === 'number' && sample.frameDurationMs > POOR_SAMPLE_THRESHOLD_MS;
  const isGood = typeof sample.frameDurationMs === 'number' && sample.frameDurationMs <= POOR_SAMPLE_THRESHOLD_MS;

  let consecutivePoor = isPoor ? state.consecutivePoor + 1 : 0;
  let consecutiveGood = isGood ? state.consecutiveGood + 1 : 0;
  let nextTier = state.tier;
  let reason = state.reason;
  let changed = false;

  const inCooldown = (now - state.lastAdjustedAt) < MIN_ADJUST_INTERVAL_MS;

  if (!inCooldown) {
    if (consecutivePoor >= CONSECUTIVE_POOR_REQUIRED) {
      if (state.tier === 'normal') {
        nextTier = 'lightweight';
        reason = '检测到界面渲染卡顿，降级为轻量模式 (限制模糊)';
        changed = true;
      } else if (state.tier === 'lightweight' && prefs.maxTier === 'powersave') {
        nextTier = 'powersave';
        reason = '持续卡顿，降级为省电模式';
        changed = true;
      }
      consecutivePoor = 0;
      consecutiveGood = 0;
    } else if (consecutiveGood >= CONSECUTIVE_GOOD_REQUIRED && !isBattery) {
      if (state.tier === 'powersave') {
        nextTier = 'lightweight';
        reason = '渲染表现持续稳定，提升为轻量模式';
        changed = true;
      } else if (state.tier === 'lightweight') {
        nextTier = 'normal';
        reason = '渲染完全恢复稳定，恢复正常效果';
        changed = true;
      }
      consecutivePoor = 0;
      consecutiveGood = 0;
    }
  }

  const adjustedAt = changed ? now : state.lastAdjustedAt;

  return {
    tier: nextTier,
    consecutivePoor,
    consecutiveGood,
    lastAdjustedAt: adjustedAt,
    reason,
    changed,
    blurCap: BLUR_CAPS[nextTier],
    overrides: nextTier === 'normal' ? {} : { maxBlur: BLUR_CAPS[nextTier] }
  };
}

module.exports = {
  PERFORMANCE_TIERS,
  PERFORMANCE_MODES,
  BLUR_CAPS,
  POOR_SAMPLE_THRESHOLD_MS,
  CONSECUTIVE_POOR_REQUIRED,
  CONSECUTIVE_GOOD_REQUIRED,
  MIN_ADJUST_INTERVAL_MS,
  defaultPerformancePrefs,
  validatePerformancePrefs,
  evaluatePerformanceState
};
