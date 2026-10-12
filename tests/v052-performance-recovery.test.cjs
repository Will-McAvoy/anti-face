const test = require('node:test');
const assert = require('node:assert/strict');
const { PerformanceService } = require('../desktop/performance-service.cjs');
const { documentFromLegacy, validateThemeDocument } = require('../core/theme-schema.cjs');
const { documentHash } = require('../core/theme-diff.cjs');

function createFixture(options = {}) {
  const doc = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { opacity: 80, blur: 28, radius: 8, wallpaper: null }
  });

  const state = {
    activeDocument: doc,
    instanceId: options.instanceId || 'inst-1',
    disposed: false,
    visible: true,
    performanceHold: false
  };

  let attempts = 0;
  let appliedTier = 'normal';
  let shouldFail = options.initialFail ?? false;
  let failureType = options.failureType || 'throw'; // 'throw' | 'return-failed' | 'return-stale'
  let writes = 0;

  const studio = {
    safeMode: options.safeMode ?? false,
    migrationActive: options.migrationActive ?? false,
    preview: { state: () => ({ phase: 'idle' }) },
    _assetUrl: async () => null,
    round5: {
      targetStates: new Map([['A', state]]),
      captureIntent: (id) => ({ instanceId: state.instanceId }),
      intentCurrent: (intent) => !state.disposed && state.instanceId === intent.instanceId,
      decorateApply: async (document, id, meta) => {
        if (options.decorateFails) throw new Error('decorate error');
        return {
          effective: { performanceTier: meta.context?.performanceTier || 'normal' },
          context: meta.context
        };
      }
    },
    theme: {
      applyDocument: async (document, id, prepared) => {
        attempts++;
        if (shouldFail) {
          if (failureType === 'throw') {
            throw new Error('synthetic host failure');
          } else if (failureType === 'return-failed') {
            return { state: 'failed', code: 'HOST_BUSY', message: 'Host busy' };
          } else if (failureType === 'return-stale') {
            return { state: 'stale', code: 'STALE', message: 'Stale generation' };
          }
        }
        writes++;
        appliedTier = prepared?.context?.performanceTier || 'normal';
        return { state: 'applied', ok: true };
      }
    },
    onStudioChanged: () => {}
  };

  let battery = options.battery ?? true;
  const powerMonitor = {
    isOnBatteryPower: () => battery
  };

  const service = new PerformanceService(studio, {
    powerMonitor,
    prefs: { mode: 'auto', batteryAware: true, maxTier: 'powersave' }
  });

  return {
    doc,
    state,
    studio,
    service,
    powerMonitor,
    setBattery: (v) => { battery = v; },
    setFail: (v, type = 'throw') => { shouldFail = v; failureType = type; },
    getAttempts: () => attempts,
    getWrites: () => writes,
    getAppliedTier: () => appliedTier
  };
}

test('A. 首次失败后恢复：第一次 apply 失败，下一次允许重试时宿主恢复正常并补写确认 powersave', async () => {
  const f = createFixture({ battery: true, initialFail: true });
  
  // 第一次刷新抛出异常
  await assert.rejects(async () => {
    await f.service.refresh();
  }, /synthetic host failure/);

  assert.equal(f.getAttempts(), 1);
  assert.equal(f.getAppliedTier(), 'normal');
  
  // 故障期间 summary 不能宣称已确认 powersave
  const summaryDuringError = f.service.summary('A');
  assert.equal(summaryDuringError.tier, 'normal');
  assert.equal(summaryDuringError.desiredTier, 'powersave');
  assert.equal(summaryDuringError.pending, true);
  assert.ok(summaryDuringError.lastError);

  // 宿主恢复
  f.setFail(false);

  // 第二次刷新：必须再次 apply 并确认 powersave
  await f.service.refresh();
  assert.equal(f.getAttempts(), 2);
  assert.equal(f.getAppliedTier(), 'powersave');

  const summaryAfterRecovery = f.service.summary('A');
  assert.equal(summaryAfterRecovery.tier, 'powersave');
  assert.equal(summaryAfterRecovery.confirmedTier, 'powersave');
  assert.equal(summaryAfterRecovery.pending, false);
  assert.equal(summaryAfterRecovery.lastError, null);

  // 第三次刷新：已确认且 key 相同，不再重复写入
  await f.service.refresh();
  assert.equal(f.getAttempts(), 2, '确认后再次 refresh 不应重复写');
});

test('B. 非异常失败返回：apply 返回 failed / stale 时不提交 confirmed 并保留重试', async () => {
  const f = createFixture({ battery: true, initialFail: true, failureType: 'return-failed' });

  // 第一次刷新：返回 failed 状态对象
  await f.service.refresh();
  assert.equal(f.getAttempts(), 1);
  assert.equal(f.getAppliedTier(), 'normal');

  const summary1 = f.service.summary('A');
  assert.equal(summary1.tier, 'normal');
  assert.equal(summary1.pending, true);
  assert.equal(summary1.lastError?.code, 'HOST_BUSY');

  // 宿主恢复后下一次刷新
  f.setFail(false);
  await f.service.refresh();
  assert.equal(f.getAttempts(), 2);
  assert.equal(f.getAppliedTier(), 'powersave');
  assert.equal(f.service.summary('A').tier, 'powersave');
});

test('C. 恢复正常效果失败与重试：切 AC 后恢复 normal 第一次失败，后续恢复成功', async () => {
  const f = createFixture({ battery: true, initialFail: false });

  // 先确认 powersave
  await f.service.refresh();
  assert.equal(f.getAppliedTier(), 'powersave');
  assert.equal(f.service.summary('A').tier, 'powersave');
  const attemptsAfterPowersave = f.getAttempts();

  // 切至交流电 (AC)，重置调整时间冷却
  f.setBattery(false);
  f.service.getTargetState('A').lastAdjustedAt = 0;

  // 恢复 normal 第一次失败
  f.setFail(true, 'throw');
  await assert.rejects(async () => {
    await f.service.refresh({ powerEvent: true });
  }, /synthetic host failure/);

  // 此时未确认 normal，依然保留当前 powersave 效果状态并等待重试
  assert.equal(f.service.summary('A').tier, 'powersave');
  assert.equal(f.service.summary('A').desiredTier, 'normal');
  assert.equal(f.service.summary('A').pending, true);

  // 宿主恢复，后续重试恢复 normal 成功
  f.setFail(false);
  await f.service.refresh({ powerEvent: true });
  assert.equal(f.getAppliedTier(), 'normal');
  assert.equal(f.service.summary('A').tier, 'normal');
  assert.equal(f.service.summary('A').pending, false);
});

test('D. 安全与并发：安全模式或目标销毁使旧 pending 重试失效', async () => {
  const f = createFixture({ battery: true, initialFail: true });

  // 触发一次失败，进入 pending 重试
  await assert.rejects(async () => {
    await f.service.refresh();
  });
  assert.equal(f.service.summary('A').pending, true);
  const attemptsBeforeSafe = f.getAttempts();

  // 进入安全模式
  f.studio.safeMode = true;
  f.setFail(false);

  // 安全模式下刷新，不能写入宿主
  await f.service.refresh();
  assert.equal(f.getAttempts(), attemptsBeforeSafe, '安全模式下不得写入');
  assert.equal(f.service.summary('A').pending, false, '安全模式下待重试状态被清除');

  // 退出安全模式并重建目标实例 (instanceId 变更)
  f.studio.safeMode = false;
  f.state.instanceId = 'inst-2';
  // 模拟旧意图已被新实例取代
  await f.service.refresh();
  // 新实例在电池下成功应用 powersave
  assert.equal(f.getAppliedTier(), 'powersave');
  assert.equal(f.service.summary('A').confirmedTier, 'powersave');
});
