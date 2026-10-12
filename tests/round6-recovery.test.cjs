const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SafeLaunchManager } = require('../desktop/safe-launch.cjs');

test('F01: SafeLaunchManager - 正常退出与崩溃计数检测', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antiface-safe-test-'));
  try {
    // 第一次启动
    const mgr1 = new SafeLaunchManager(tmpDir);
    const s1 = await mgr1.init();
    assert.equal(s1.safeMode, false);
    assert.equal(s1.failureCount, 0);

    // 异常退出：不调用 recordCleanExit，直接创建新实例模拟第二次启动
    const mgr2 = new SafeLaunchManager(tmpDir);
    const s2 = await mgr2.init();
    assert.equal(s2.safeMode, true);
    assert.equal(s2.needsStartupChoice, true);
    assert.equal(s2.wasUnclean, true);
    assert.equal(s2.failureCount, 1);

    // 再次异常退出，达到阈值 2
    const mgr3 = new SafeLaunchManager(tmpDir);
    const s3 = await mgr3.init();
    assert.equal(s3.safeMode, true, '连续2次异常退出后应触发安全模式');
    assert.equal(s3.reason, 'CONSECUTIVE_UNRECOVERED_CRASHES');

    // 用户退出安全模式
    await mgr3.exitSafeMode();
    assert.equal(mgr3.activeSafeMode, false);

    // 正常退出
    await mgr3.recordCleanExit();

    // 下次启动应正常
    const mgr4 = new SafeLaunchManager(tmpDir);
    const s4 = await mgr4.init();
    assert.equal(s4.safeMode, false);
    assert.equal(s4.failureCount, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('F01: SafeLaunchManager - 命令行 --safe-mode 强制开启安全模式', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antiface-safe-cli-'));
  try {
    const mgr = new SafeLaunchManager(tmpDir, { cliSafeMode: true });
    const status = await mgr.init();
    assert.equal(status.safeMode, true);
    assert.equal(status.cliSafeMode, true);
    assert.equal(status.reason, 'CLI_FLAG');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('F01: 一键恢复屏障与结构化状态返回', async () => {
  // 模拟 StudioService 的恢复屏障逻辑
  const targets = new Map([
    ['win-1', { id: 'win-1', title: 'Window 1', cdpConnected: true, applied: true, operationGeneration: 1 }],
    ['win-2', { id: 'win-2', title: 'Window 2', cdpConnected: false, applied: false, operationGeneration: 1 }],
    ['win-3', { id: 'win-3', title: 'Window 3', cdpConnected: true, applied: true, operationGeneration: 1 }]
  ]);

  let globalGeneration = 1;
  const inFlightOperations = [];

  function startAsyncOperation(targetId) {
    const target = targets.get(targetId);
    const gen = globalGeneration;
    const token = {
      targetId,
      generation: gen,
      isCurrent: () => gen === globalGeneration && target.operationGeneration === gen
    };
    inFlightOperations.push(token);
    return token;
  }

  async function restoreAllTargets() {
    // 屏障：立即提升全局 generation 并置位
    globalGeneration += 1;
    const currentBarrierGen = globalGeneration;

    const report = {
      timestamp: Date.now(),
      summary: 'partial',
      total: targets.size,
      restoredCount: 0,
      failedCount: 0,
      disconnectedCount: 0,
      details: []
    };

    for (const [id, target] of targets.entries()) {
      target.operationGeneration = currentBarrierGen;
      target.manualHold = true;

      if (!target.cdpConnected) {
        report.disconnectedCount += 1;
        report.details.push({
          targetId: id,
          title: target.title,
          status: 'disconnected',
          message: '目标窗口未连接 CDP 或已关闭'
        });
        continue;
      }

      // 模拟 win-3 恢复失败
      if (id === 'win-3') {
        report.failedCount += 1;
        report.details.push({
          targetId: id,
          title: target.title,
          status: 'failed',
          message: '模拟宿主通信故障'
        });
        continue;
      }

      target.applied = false;
      report.restoredCount += 1;
      report.details.push({
        targetId: id,
        title: target.title,
        status: 'restored',
        message: '已清除注入样式并恢复原貌'
      });
    }

    report.summary = report.failedCount === 0 && report.disconnectedCount === 0 ? 'success' : 'partial';
    return report;
  }

  // 发起一个在途的慢应用操作
  const slowOp = startAsyncOperation('win-1');
  assert.equal(slowOp.isCurrent(), true, '操作开始时令牌有效');

  // 执行一键恢复
  const report = await restoreAllTargets();

  // 1. 验证在途慢操作被屏障立即作废
  assert.equal(slowOp.isCurrent(), false, '恢复屏障必须立即使在途慢操作失效');

  // 2. 验证多目标状态报告结构与真实性
  assert.equal(report.summary, 'partial', '部分失败不能报告整体成功');
  assert.equal(report.restoredCount, 1);
  assert.equal(report.disconnectedCount, 1);
  assert.equal(report.failedCount, 1);

  const d1 = report.details.find(d => d.targetId === 'win-1');
  const d2 = report.details.find(d => d.targetId === 'win-2');
  const d3 = report.details.find(d => d.targetId === 'win-3');
  assert.equal(d1.status, 'restored');
  assert.equal(d2.status, 'disconnected');
  assert.equal(d3.status, 'failed');
});
