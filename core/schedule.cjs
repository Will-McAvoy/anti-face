const { appError } = require('./errors.cjs');
const { plainObject } = require('./theme-schema.cjs');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(time) {
  const match = TIME_RE.exec(time || '');
  if (!match) throw appError('INVALID_ARGUMENT', '时间需要是 HH:mm');
  return Number(match[1]) * 60 + Number(match[2]);
}

function localParts(date, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = Object.fromEntries(format.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function validateRules(rules) {
  if (!Array.isArray(rules)) throw appError('INVALID_ARGUMENT', '定时规则无效');
  const seen = new Set();
  return rules.map(rule => {
    if (!plainObject(rule)) throw appError('INVALID_ARGUMENT', '定时规则无效');
    if (typeof rule.id !== 'string' || !rule.id || rule.id.length > 80) throw appError('INVALID_ARGUMENT', '规则标识无效');
    const time = typeof rule.time === 'string' ? rule.time : '';
    minutesOf(time);
    if (typeof rule.themeId !== 'string' || !rule.themeId) throw appError('INVALID_ARGUMENT', '规则主题无效');
    const enabled = rule.enabled !== false;
    if (enabled && seen.has(time)) throw appError('INVALID_ARGUMENT', '同一时刻不能有两条启用的规则');
    if (enabled) seen.add(time);
    const scope = rule.scope == null ? 'selected' : rule.scope;
    if (scope !== 'selected') throw appError('INVALID_ARGUMENT', '定时规则只作用于已选择的窗口');
    return { id: rule.id, time, themeId: rule.themeId, scope, enabled };
  });
}

function enabledRules(rules) {
  return validateRules(rules).filter(rule => rule.enabled).sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || a.id.localeCompare(b.id));
}

function activeRule(rules, local) {
  const list = enabledRules(rules);
  if (!list.length) return null;
  const now = local.hour * 60 + local.minute;
  let chosen = null;
  for (const rule of list) {
    if (minutesOf(rule.time) <= now) chosen = rule;
  }
  return chosen || list[list.length - 1];
}

function nextBoundary(rules, local) {
  const list = enabledRules(rules);
  if (!list.length) return null;
  const now = local.hour * 60 + local.minute;
  const upcoming = list.find(rule => minutesOf(rule.time) > now);
  if (upcoming) return { dayOffset: 0, time: upcoming.time, themeId: upcoming.themeId };
  return { dayOffset: 1, time: list[0].time, themeId: list[0].themeId };
}

function validateAutomation(value) {
  const source = plainObject(value) ? value : {};
  const mode = source.mode == null ? 'off' : source.mode;
  if (!['off', 'system', 'schedule'].includes(mode)) throw appError('INVALID_ARGUMENT', '自动切换模式无效');
  return {
    schemaVersion: 1,
    mode,
    lightThemeId: typeof source.lightThemeId === 'string' ? source.lightThemeId : null,
    darkThemeId: typeof source.darkThemeId === 'string' ? source.darkThemeId : null,
    rules: validateRules(source.rules || []),
    pausedUntil: typeof source.pausedUntil === 'string' ? source.pausedUntil : null,
    pauseReason: typeof source.pauseReason === 'string' ? source.pauseReason : null,
    manualThemeId: typeof source.manualThemeId === 'string' ? source.manualThemeId : null
  };
}

function decideAutomation(config, context) {
  const automation = validateAutomation(config);
  if (automation.mode === 'off') return { action: 'none', reason: 'off', themeId: null };
  if (context.staleEventId != null && context.manualEventId && context.staleEventId < context.manualEventId) {
    return { action: 'ignore', reason: 'stale-event', themeId: automation.manualThemeId };
  }
  if (context.previewing) return { action: 'defer', reason: 'preview', themeId: null, keepLatest: context.desiredThemeId || null };
  if (automation.pauseReason === 'restored-original') return { action: 'none', reason: 'paused-restore', themeId: null };
  if (automation.pausedUntil && context.nowIso && automation.pausedUntil > context.nowIso) {
    return { action: 'none', reason: 'paused', until: automation.pausedUntil, themeId: null };
  }
  if (automation.mode === 'system' && automation.pauseReason === 'manual-until-resume') {
    return { action: 'none', reason: 'paused-manual', themeId: null };
  }
  if (automation.mode === 'system') {
    if (context.systemScheme !== 'light' && context.systemScheme !== 'dark') {
      return { action: 'none', reason: 'system-unknown', themeId: null };
    }
    const themeId = context.systemScheme === 'light' ? automation.lightThemeId : automation.darkThemeId;
    if (!themeId) return { action: 'none', reason: 'theme-missing', themeId: null };
    return { action: 'apply', reason: 'system', themeId, source: 'system' };
  }
  const rule = activeRule(automation.rules, context.local);
  if (!rule) return { action: 'none', reason: 'no-rule', themeId: null };
  return { action: 'apply', reason: 'schedule', themeId: rule.themeId, ruleId: rule.id, source: 'schedule' };
}

module.exports = {
  localParts,
  minutesOf,
  validateRules,
  validateAutomation,
  activeRule,
  nextBoundary,
  decideAutomation
};
