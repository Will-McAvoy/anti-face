const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('[Smoke Round 6] Starting comprehensive smoke check for F01 - F07...');

const results = {
  timestamp: new Date().toISOString(),
  features: {},
  passed: 0,
  failed: 0
};

function record(name, pass, details = {}) {
  results.features[name] = { pass, ...details };
  if (pass) {
    results.passed += 1;
    console.log(`  ✓ ${name}: PASSED`);
  } else {
    results.failed += 1;
    console.error(`  ✗ ${name}: FAILED`, details);
  }
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antiface-smoke-r6-'));
  try {
    // 1. F01 一键恢复与安全启动
    const { SafeLaunchManager } = require('../desktop/safe-launch.cjs');
    const safeMgr = new SafeLaunchManager(tmpDir, { cliSafeMode: true });
    const s1 = await safeMgr.init();
    record('F01_SafeLaunch', s1.safeMode === true && s1.reason === 'CLI_FLAG');

    // 2. F02 编辑历史完善与基线
    const { AppearanceHistory } = require('../core/appearance-history.cjs');
    const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
    const { validateThemeDocument, documentFromLegacy } = require('../core/theme-schema.cjs');
    function draft(patch = {}) {
      const base = documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { ...DEFAULT_APPEARANCE } });
      return validateThemeDocument({ ...base, ...patch, schemaVersion: 1 });
    }
    const baseDoc = draft({ id: '11111111-1111-4111-8111-111111111111', regions: { global: { blur: 5, opacity: 80, radius: 10 } } });
    const history = new AppearanceHistory(baseDoc);
    history.beginGesture('test-gesture');
    history.push(draft({ id: '11111111-1111-4111-8111-111111111111', regions: { global: { blur: 15, opacity: 80, radius: 10 } } }));
    history.endGesture();
    const canUndo = history.canUndo;
    const reverted = history.revertToBaseline();
    record('F02_EditHistoryBaseline', canUndo && reverted.regions.global.blur === baseDoc.regions.global.blur);

    // 3. F03 主题快速切换器
    const { authorize } = require('../core/ipc-policy.cjs');
    const switcherAllowed = authorize('switcher', 'switcher:init') && !authorize('switcher', 'backup:export');
    record('F03_QuickSwitcherIPC', switcherAllowed);

    // 4. F04 多显示器与 DPI 适配
    const { dipToPhysical, clampBoundsToWorkAreas } = require('../core/display-context.cjs');
    const physical = dipToPhysical({ x: -100, y: 50, width: 800, height: 600 }, 1.5);
    const clamped = clampBoundsToWorkAreas({ x: 5000, y: 5000, width: 800, height: 600 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
    record('F04_DisplayAndDPI', physical.x === -150 && clamped.x < 1920);

    // 5. F05 完整备份与迁移
    const { writeZip, readZip } = require('../desktop/zip-util.cjs');
    const testZip = writeZip([{ path: 'test.txt', data: Buffer.from('round6') }]);
    const unzipped = readZip(testZip);
    record('F05_ZipUtil', unzipped[0].data.toString('utf8') === 'round6');

    // 6. F06 性能自适应
    const { evaluatePerformanceState } = require('../core/performance-policy.cjs');
    const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');
    const pState = evaluatePerformanceState(
      { tier: 'normal', consecutivePoor: 0 },
      { powerSource: 'battery', valid: true },
      { prefs: { mode: 'auto', batteryAware: true } }
    );
    const resolvedEff = resolveEffectiveAppearance(baseDoc, { performanceTier: 'powersave' });
    record('F06_PerformancePolicy', pState.tier === 'powersave' && resolvedEff.resolved.wallpaper.blur <= 8);

    // 7. F07 任务完成提醒规则与真实性约束
    const { NotificationPolicy } = require('../core/notification-policy.cjs');
    const { NotificationService } = require('../desktop/notification-service.cjs');
    const notifService = new NotificationService({
      player: { play: async () => true },
      notifier: { show: () => {} },
      policy: new NotificationPolicy(),
      sourceCapabilities: { sourceId: 'test-log', supportsTaskCompleted: false }
    });
    const fakeStepEvent = { type: 'completed', provenance: 'real', taskId: 'step-only' };
    const fakeDecision = notifService.handle(fakeStepEvent, { onComplete: true });
    record('F07_NotificationHonesty', fakeDecision.reason === 'source-unsupported-completed');

  } catch (err) {
    console.error('Smoke check error:', err);
    results.failed += 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n[Smoke Round 6] Finished: ${results.passed} passed, ${results.failed} failed.`);
  const artifactsDir = path.join(__dirname, '..', 'artifacts', 'round6');
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');

  if (results.failed > 0) {
    process.exit(1);
  }
}

void run();
