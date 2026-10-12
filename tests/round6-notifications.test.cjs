const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationPolicy, isQuiet } = require('../core/notification-policy.cjs');
const { NotificationService } = require('../desktop/notification-service.cjs');
const { createTaskNotificationEvent } = require('../core/task-event.cjs');

test('F07: 来源真实性与步骤≠任务约束 - 未声明支持整任务完成的源拒绝触发', () => {
  const dummyPlayer = { play: async () => true };
  const dummyNotifier = { show: () => {} };

  // 1. 模拟不具备任务完成识别能力的数据源（例如普通日志监听器）
  const uncapableService = new NotificationService({
    player: dummyPlayer,
    notifier: dummyNotifier,
    policy: new NotificationPolicy({ cooldownMs: 0, now: () => 1000 }),
    sourceCapabilities: {
      sourceId: 'antigravity-live-log',
      supportsTaskCompleted: false, // 严格声明不支持整任务完成
      supportsTaskFailed: true
    },
    localTime: () => ({ hour: 14, minute: 0 })
  });

  const prefs = { onComplete: true, onFailed: true, sound: true, desktop: true };

  // 尝试投递一个伪称完成的真实任务事件
  const event = createTaskNotificationEvent({
    type: 'completed',
    taskId: 'task-step-1',
    provenance: 'real',
    title: '某步骤完成'
  });

  const decision = uncapableService.handle(event, prefs);
  assert.equal(decision.play, false);
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, 'source-unsupported-completed', '未声明具备整任务识别能力的数据源严禁触发完成提醒');

  // 2. 模拟具备整任务判定能力的适配器（例如显式扩展的终态判定源）
  const capableService = new NotificationService({
    player: dummyPlayer,
    notifier: dummyNotifier,
    policy: new NotificationPolicy({ cooldownMs: 0, now: () => 1000 }),
    sourceCapabilities: {
      sourceId: 'antigravity-task-agent',
      supportsTaskCompleted: true,
      supportsTaskFailed: true
    },
    localTime: () => ({ hour: 14, minute: 0 })
  });

  const validDecision = capableService.handle(event, prefs);
  assert.equal(validDecision.play, true);
  assert.equal(validDecision.reason, 'accepted');
});

test('F07: 勿扰与静音时段跨午夜判定', () => {
  const prefs = {
    quietEnabled: true,
    quietStart: '22:30',
    quietEnd: '07:30',
    onComplete: true,
    sound: true
  };

  // 跨午夜三个测试点：夜间 23:00、凌晨 03:00、日间 12:00
  assert.equal(isQuiet({ hour: 23, minute: 0 }, prefs), true);
  assert.equal(isQuiet({ hour: 3, minute: 0 }, prefs), true);
  assert.equal(isQuiet({ hour: 12, minute: 0 }, prefs), false);

  const policy = new NotificationPolicy({ cooldownMs: 0, now: () => 1000 });
  const decisionNight = policy.consider(
    { type: 'completed', taskId: 'night-task', provenance: 'real' },
    prefs,
    { hour: 23, minute: 15 }
  );
  assert.equal(decisionNight.play, false);
  assert.equal(decisionNight.reason, 'quiet');
});

test('F07: 暂停 30 分钟临时抑制机制', () => {
  const now = 500000;
  const policy = new NotificationPolicy({ cooldownMs: 0, now: () => now });

  // 暂停至 now + 30分钟
  const prefsPaused = {
    onComplete: true,
    sound: true,
    pausedUntil: now + 30 * 60 * 1000
  };

  const decision1 = policy.consider(
    { type: 'completed', taskId: 'task-1', provenance: 'real' },
    prefsPaused,
    { hour: 15, minute: 0 }
  );
  assert.equal(decision1.play, false);
  assert.equal(decision1.reason, 'manually-paused');

  // 暂停过期后，恢复提醒
  const policyAfter = new NotificationPolicy({ cooldownMs: 0, now: () => now + 31 * 60 * 1000 });
  const decision2 = policyAfter.consider(
    { type: 'completed', taskId: 'task-2', provenance: 'real' },
    prefsPaused,
    { hour: 15, minute: 31 }
  );
  assert.equal(decision2.play, true);
  assert.equal(decision2.reason, 'accepted');
});

test('F07: 前台窗口激活时抑制桌面横幅通知 (保留声音)', () => {
  const policy = new NotificationPolicy({ cooldownMs: 0, now: () => 1000 });
  const prefs = {
    onComplete: true,
    sound: true,
    desktop: true,
    suppressInForeground: true
  };

  // 当前宿主窗口处于前台聚焦
  const decision = policy.consider(
    { type: 'completed', taskId: 'focus-task', provenance: 'real' },
    prefs,
    { hour: 14, minute: 0 },
    { windowFocused: true }
  );

  assert.equal(decision.play, true, '声音仍正常播放');
  assert.equal(decision.notify, false, '前台聚焦时桌面通知被抑制');
});

test('F07: 测试音效与测试通知专用通道不污染去重缓存，忽略静音时段', () => {
  const policy = new NotificationPolicy({ cooldownMs: 0, now: () => 1000 });
  const prefsQuiet = {
    quietEnabled: true,
    quietStart: '00:00',
    quietEnd: '23:59', // 全天静音
    sound: true,
    desktop: true,
    volume: 0.75
  };

  // 测试通道事件
  const testEvent = {
    isTestPreview: true,
    channel: 'test-preview',
    type: 'test-preview',
    taskId: 'test-123'
  };

  const decision = policy.consider(testEvent, prefsQuiet, { hour: 12, minute: 0 });
  assert.equal(decision.play, true, '测试通道不受静音时段抑制');
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, 'preview');
  assert.equal(decision.volume, 0.75);

  // 验证不占用去重缓存
  assert.equal(policy.seen.has('test-123'), false, '测试事件严禁写入生产去重缓存');
});
