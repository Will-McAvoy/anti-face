const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluatePerformanceState,
  MIN_ADJUST_INTERVAL_MS,
  CONSECUTIVE_POOR_REQUIRED,
  CONSECUTIVE_GOOD_REQUIRED
} = require('../core/performance-policy.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { validateThemeDocument, documentFromLegacy } = require('../core/theme-schema.cjs');

function makeDoc(patch = {}) {
  const base = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { ...DEFAULT_APPEARANCE }
  });
  return validateThemeDocument({ ...base, ...patch, schemaVersion: 1 });
}

test('F06: evaluatePerformanceState 纯函数迟滞、连续采样与冷却保护', () => {
  let now = 100000;
  let state = {
    tier: 'normal',
    consecutivePoor: 0,
    consecutiveGood: 0,
    lastAdjustedAt: now - MIN_ADJUST_INTERVAL_MS - 1000,
    reason: '初始正常'
  };

  const prefs = { mode: 'auto', batteryAware: true, maxTier: 'powersave' };

  // 1. 单次卡顿样本（例如 45ms 帧耗时），不应立即降级（防止抖动）
  const s1 = evaluatePerformanceState(state, { frameDurationMs: 45, valid: true }, { prefs, now });
  assert.equal(s1.tier, 'normal');
  assert.equal(s1.consecutivePoor, 1);
  assert.equal(s1.changed, false);
  state = s1;

  // 2. 第二次卡顿样本，仍保持 normal
  const s2 = evaluatePerformanceState(state, { frameDurationMs: 50, valid: true }, { prefs, now });
  assert.equal(s2.tier, 'normal');
  assert.equal(s2.consecutivePoor, 2);
  state = s2;

  // 3. 达到连续 3 次卡顿，降级为 lightweight
  const s3 = evaluatePerformanceState(state, { frameDurationMs: 40, valid: true }, { prefs, now });
  assert.equal(s3.tier, 'lightweight');
  assert.equal(s3.changed, true);
  assert.equal(s3.blurCap, 12);
  state = s3;

  // 4. 冷却期保护：在 10 秒冷却期内即使继续卡顿，也不得立刻连降两级
  now += 2000; // 只过了 2 秒
  const s4 = evaluatePerformanceState(state, { frameDurationMs: 60, valid: true }, { prefs, now });
  assert.equal(s4.tier, 'lightweight');
  assert.equal(s4.changed, false);
});

test('F06: 电源感知自动切入 powersave 档位', () => {
  const now = 200000;
  const state = {
    tier: 'normal',
    consecutivePoor: 0,
    consecutiveGood: 0,
    lastAdjustedAt: now - MIN_ADJUST_INTERVAL_MS - 1000,
    reason: '市电正常'
  };

  const res = evaluatePerformanceState(
    state,
    { powerSource: 'battery', frameDurationMs: 16, valid: true },
    { prefs: { mode: 'auto', batteryAware: true }, now }
  );

  assert.equal(res.tier, 'powersave');
  assert.equal(res.changed, true);
  assert.equal(res.blurCap, 8);
});

test('F06: resolveEffectiveAppearance 运行时模糊度上限夹持，不污染持久化文档', () => {
  const doc = makeDoc({
    wallpaper: { blur: 25 },
    regions: {
      sidebar: { blur: 20, opacity: 80, radius: 10 },
      chat: { blur: 18, opacity: 80, radius: 10 }
    }
  });

  const originalDocJson = JSON.stringify(doc);

  // 1. 正常模式：全保真度渲染
  const effNormal = resolveEffectiveAppearance(doc, { performanceTier: 'normal' }).resolved;
  assert.equal(effNormal.wallpaper.blur, 25);
  assert.equal(effNormal.regions.sidebar.blur, 20);

  // 2. 轻量模式：上限 12px
  const effLight = resolveEffectiveAppearance(doc, { performanceTier: 'lightweight' }).resolved;
  assert.equal(effLight.wallpaper.blur, 12);
  assert.equal(effLight.regions.sidebar.blur, 12);
  assert.equal(effLight.regions.chat.blur, 12);

  // 3. 省电模式：上限 8px
  const effPower = resolveEffectiveAppearance(doc, { performanceTier: 'powersave' }).resolved;
  assert.equal(effPower.wallpaper.blur, 8);
  assert.equal(effPower.regions.sidebar.blur, 8);
  assert.equal(effPower.regions.chat.blur, 8);

  // 4. 验证原始文档对象未被任何模式修改
  assert.equal(JSON.stringify(doc), originalDocJson, '持久化主题文档严禁被性能临时覆盖所篡改');
  assert.equal(doc.wallpaper.blur, 25);
  assert.equal(doc.regions.sidebar.blur, 20);
});
