const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { TelemetryManager } = require('../desktop/telemetry-sources.cjs');
const { HistoryStorage } = require('../desktop/history-storage.cjs');

test('TelemetryManager - 模式切换、状态获取与空状态降级', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-telemetry-'));
  try {
    const historyStorage = new HistoryStorage(path.join(tempDir, 'history'), { enabled: true });
    await historyStorage.init();

    const mockThemeService = {
      status: { state: 'ready' },
      listTargets: async () => [
        { id: 'target-1', title: 'Target Window', url: 'https://127.0.0.1:1234/c/test-convo-id', isCurrent: true }
      ]
    };

    const manager = new TelemetryManager({
      themeService: mockThemeService,
      historyStorage,
      appDataDir: tempDir
    });

    // 1. 默认 Host 模式下空目录状态
    const hostState = await manager.tick();
    assert.equal(hostState.taskState.phase, 'unknown');
    assert.equal(hostState.taskState.unavailableReason, '无可用日志');
    assert.equal(hostState.metrics.totalTokens, null);
    assert.equal(hostState.metrics.provenance, 'real');
    assert.equal(hostState.metrics.connectionStatus, 'ready');
    assert.equal(hostState.capabilities.streamingSpeed, false);
    assert.ok(hostState.capabilities.streamingExplanation.includes('流式时间戳'));

    // 2. 切换至 Fixture 模拟数据模式
    manager.setMode('fixture');
    const fixtureState = await manager.tick();
    assert.equal(fixtureState.taskState.phase, 'generating');
    assert.equal(fixtureState.metrics.provenance, 'fixture');
    assert.equal(fixtureState.metrics.rollingSpeed, 14.5);
    assert.equal(fixtureState.metrics.averageSpeedToks, 16.2);
    assert.equal(fixtureState.metrics.totalTokens, 2200);

    // 3. 停止管理器
    manager.stop();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
