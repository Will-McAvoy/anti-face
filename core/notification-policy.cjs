const { appError } = require('./errors.cjs');
const { validateTaskNotificationEvent } = require('./task-event.cjs');

const TERMINAL = new Set(['completed', 'failed', 'waiting_user']);

function minutes(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
  if (!match) throw appError('INVALID_ARGUMENT', '静音时间无效');
  return Number(match[1]) * 60 + Number(match[2]);
}

function isQuiet(local, prefs) {
  if (!prefs.quietEnabled) return false;
  const now = local.hour * 60 + local.minute;
  const start = minutes(prefs.quietStart);
  const end = minutes(prefs.quietEnd);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function defaultNotificationPrefs() {
  return {
    onComplete: false,
    onFailed: false,
    onWaitingUser: false,
    desktop: false,
    sound: false,
    volume: 0.4,
    soundChoice: 'default',
    quietEnabled: false,
    quietStart: '22:00',
    quietEnd: '08:00',
    suppressInForeground: false,
    pausedUntil: null
  };
}

function validateNotificationPrefs(value = {}) {
  const base = defaultNotificationPrefs();
  const volume = value.volume == null ? base.volume : Number(value.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw appError('INVALID_ARGUMENT', '音量超出范围');
  minutes(value.quietStart || base.quietStart);minutes(value.quietEnd || base.quietEnd);
  if(value.soundChoice && !['default','completed','failed','waiting_user','preview'].includes(value.soundChoice)) throw appError('INVALID_ARGUMENT','提醒声音选择无效');
  return {
    onComplete: value.onComplete === true,
    onFailed: value.onFailed === true,
    onWaitingUser: value.onWaitingUser === true,
    desktop: value.desktop === true,
    sound: value.sound === true,
    volume: Math.round(volume * 100) / 100,
    soundChoice: typeof value.soundChoice === 'string' ? value.soundChoice : 'default',
    quietEnabled: value.quietEnabled === true,
    quietStart: value.quietStart || base.quietStart,
    quietEnd: value.quietEnd || base.quietEnd,
    suppressInForeground: value.suppressInForeground === true,
    pausedUntil: typeof value.pausedUntil === 'number' ? value.pausedUntil : null
  };
}

class NotificationPolicy {
  constructor(options = {}) {
    this.seen = new Map();
    this.maxSeen = options.maxSeen ?? 1000;
    this.lastAt = Number.NEGATIVE_INFINITY;
    this.cooldownMs = options.cooldownMs ?? 3000;
    this.now = options.now || (() => Date.now());
  }

  _recordSeen(key, timestamp) {
    if (this.seen.size >= this.maxSeen) {
      const firstKey = this.seen.keys().next().value;
      if (firstKey) this.seen.delete(firstKey);
    }
    this.seen.set(key, timestamp);
  }

  consider(rawEvent, prefs, local, context = {}) {
    const preferences = validateNotificationPrefs(prefs);
    if (!rawEvent) return { play: false, notify: false, reason: 'empty-event' };

    // 显式试听与测试通知：专用通道 test-preview，不产生虚假 TaskNotificationEvent，不污染去重缓存，不受静音抑制
    if (rawEvent.isTestPreview === true || rawEvent.channel === 'test-preview' || rawEvent.type === 'test-preview') {
      return {
        play: rawEvent.silent !== true,
        notify: preferences.desktop === true,
        reason: 'preview',
        volume: preferences.volume,
        soundChoice: preferences.soundChoice === 'default' ? 'preview' : preferences.soundChoice,
        title: '[测试] 任务提醒预览',
        body: '这是通知设置的测试音效与提醒。'
      };
    }

    if (rawEvent.channel === 'preview' || rawEvent.provenance === 'fixture' || rawEvent.simulated === true) {
      return { play: false, notify: false, reason: 'simulated' };
    }
    if (rawEvent.replay === true || rawEvent.midJoin === true) {
      return { play: false, notify: false, reason: 'replay' };
    }
    if (rawEvent.type === 'disconnected' || rawEvent.type === 'stale') {
      return { play: false, notify: false, reason: 'not-terminal' };
    }
    if (!TERMINAL.has(rawEvent.type)) {
      return { play: false, notify: false, reason: 'not-terminal' };
    }

    // 校验事件对象
    let event;
    try {
      event = validateTaskNotificationEvent(rawEvent);
    } catch {
      return { play: false, notify: false, reason: 'invalid-event' };
    }

    // 真实性硬约束：步骤级别完成绝不触发整任务完成提醒
    if (event.scope === 'step') {
      return { play: false, notify: false, reason: 'step-not-task' };
    }

    // 规则开关判定
    const enabled = event.type === 'completed'
      ? preferences.onComplete
      : event.type === 'failed'
      ? preferences.onFailed
      : preferences.onWaitingUser;

    if (!enabled) return { play: false, notify: false, reason: 'disabled' };

    // 手动暂停判定 (例如暂停 30 分钟)
    const instant = this.now();
    if (preferences.pausedUntil && instant < preferences.pausedUntil) {
      return { play: false, notify: false, reason: 'manually-paused' };
    }

    // 去重键：包含 sourceId, taskId/runId, transitionId
    const key = `${event.sourceId}|${event.runId}|${event.taskId}|${event.attemptId || ''}|${event.transitionId || event.type}`;
    if (this.seen.has(key)) return { play: false, notify: false, reason: 'duplicate' };

    // 免打扰静音时段
    if (isQuiet(local, preferences)) {
      this._recordSeen(key, instant);
      return { play: false, notify: false, reason: 'quiet', backlog: false };
    }

    // 冷却时间判定 (避免密集轰炸，但真实失败不应无声丢失)
    if (instant - this.lastAt < this.cooldownMs && event.type !== 'failed') {
      return { play: false, notify: false, reason: 'cooldown' };
    }

    this._recordSeen(key, instant);
    this.lastAt = instant;

    // 前台使用中抑制判定：处于前台聚焦时桌面横幅静默，保留声音设置
    const isForeground = preferences.suppressInForeground && (context.isForeground === true || context.windowFocused === true);
    const shouldNotify = isForeground ? false : preferences.desktop === true;
    const shouldPlay = preferences.sound === true;

    if (!shouldPlay && !shouldNotify) {
      return { play: false, notify: false, reason: isForeground ? 'foreground-suppressed' : 'disabled' };
    }

    return {
      play: shouldPlay,
      notify: shouldNotify,
      reason: 'accepted',
      volume: preferences.volume,
      soundChoice: preferences.soundChoice,
      title: event.type === 'failed' ? '任务失败' : event.type === 'waiting_user' ? '需要你处理' : '任务已完成',
      body: `任务 [${event.taskId.slice(0, 8)}] 状态已更新。`
    };
  }
}

module.exports = {
  TERMINAL,
  minutes,
  isQuiet,
  defaultNotificationPrefs,
  validateNotificationPrefs,
  NotificationPolicy
};
