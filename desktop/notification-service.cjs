const fs = require('node:fs');
const path = require('node:path');
const { NotificationPolicy } = require('../core/notification-policy.cjs');
const { declareSourceCapabilities } = require('../core/task-event.cjs');

const SOUND_KEYS = ['completionSound', 'playSoundOnComplete', 'notificationSound', 'enableCompletionSound'];

function detectExternalCompletionSound(readers) {
  for (const reader of readers) {
    let parsed = null;
    try {
      parsed = reader();
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const found = SOUND_KEYS.some(key => parsed[key] === true || parsed[key] === 'true');
    if (found) return { present: true, source: '已有完成提示音设置' };
  }
  return { present: false, source: null };
}

function defaultReaders() {
  const home = process.env.USERPROFILE || '';
  const candidates = [
    path.join(home, '.gemini', 'antigravity', 'settings.json'),
    path.join(process.env.APPDATA || '', 'Antigravity', 'User', 'settings.json')
  ];
  return candidates.map(file => () => {
    if (!file || !fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const picked = {};
    for (const key of SOUND_KEYS) if (key in parsed) picked[key] = parsed[key];
    return picked;
  });
}

class NotificationService {
  constructor(deps = {}) {
    this.player = deps.player || { async play() { return { ok: true }; } };
    this.notifier = deps.notifier || { show() {} };
    this.policy = deps.policy || new NotificationPolicy({ now: deps.now });
    this.local = deps.local || (() => {
      const now = new Date();
      return { hour: now.getHours(), minute: now.getMinutes() };
    });
    this.played = [];
    this.suppressed = deps.suppressed || (()=>false);
    this.sourceCapabilities = deps.sourceCapabilities || declareSourceCapabilities('antigravity-transcript', {
      supportsTaskCompleted: false, // 明确声明：当前 transcript 日志不支持可靠整任务完成
      supportsTaskFailed: true,
      supportsWaitingUser: false,
      evidenceDescription: '宿主日志仅记录逐步交互，不支持端到端任务完成定界',
      restrictions: ['整任务完成提醒受来源能力限制保持关闭', '单步结束不升级为任务完成']
    });
  }

  capability(prefs, external) {
    return {
      code: this.sourceCapabilities.supportsTaskCompleted ? 'SOURCE_SUPPORTED' : 'SOURCE_UNSUPPORTED',
      supportsComplete: this.sourceCapabilities.supportsTaskCompleted,
      supportsFailed: this.sourceCapabilities.supportsTaskFailed,
      supportsWaiting: this.sourceCapabilities.supportsWaitingUser,
      complete: this.sourceCapabilities.supportsTaskCompleted
        ? '已连接支持端到端完成的真实数据源。'
        : '当前日志来源不能把单个步骤结束当成任务完成，完成提醒不会自动触发（受来源能力限制）。',
      failed: '日志明确标为 FAILED 或 ERROR 时触发失败提醒。',
      waiting: this.sourceCapabilities.supportsWaitingUser ? '支持等待用户处理提醒。' : '当前来源没有可靠的“等待用户”信号。',
      external: external?.present ? '检测到已有完成提示音，Anti Face 的完成音保持关闭，避免重复。' : null,
      prefs
    };
  }

  handle(event, prefs, context = {}) {
    if(this.suppressed() && !event?.isTestPreview) return {play:false,notify:false,reason:'safe-mode'};
    // 来源真实性检查：若来源不具备完成能力且为真实任务完成事件，拒绝触发
    if (event && event.type === 'completed' && event.provenance === 'real' && !this.sourceCapabilities.supportsTaskCompleted) {
      return { play: false, notify: false, reason: 'source-unsupported-completed' };
    }

    if(event?.type==='completed' && !event?.isTestPreview && !this.sourceCapabilities.supportsTaskCompleted) return {play:false,notify:false,reason:'source-unsupported-completed'};
    const decision = this.policy.consider(event, prefs, this.local(), context);
    if (decision.play) {
      void this.player.play(decision.soundChoice === 'default' ? event.type : decision.soundChoice, decision.volume).catch(error => {
        decision.playError = error.message;
      });
    }
    if (decision.notify) {
      try {
        decision.notificationStatus=this.notifier.show(decision.title, decision.body) || {supported:null,requested:true,delivery:'unknown'};
      } catch (err) {
        decision.notifyError = err.message;
      }
    }
    return decision;
  }

  async preview(name, volume) {
    return this.player.play(name || 'preview', volume == null ? 0.4 : volume);
  }

  async sendTestNotification(prefs) {
    const testEvent = {
      isTestPreview: true,
      silent:true,
      channel: 'test-preview',
      provenance: 'test-preview',
      type: 'test-preview',
      taskId: 'test-preview'
    };
    return this.handle(testEvent, {...prefs,desktop:true});
  }
}

module.exports = {
  NotificationService,
  detectExternalCompletionSound,
  defaultReaders,
  SOUND_KEYS
};
