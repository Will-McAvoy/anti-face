const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { generateApplySummary, formatValue } = require('../core/theme-apply-summary.cjs');
const { documentFromLegacy, validateThemeDocument } = require('../core/theme-schema.cjs');

function makeDoc(patch = {}) {
  const base = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { opacity: 80, blur: 20, radius: 10 }
  });
  return validateThemeDocument({
    ...base,
    id: randomUUID(),
    name: '测试主题',
    ...patch
  });
}

test('F03: 首次应用原生窗口：明确 baselineKind 为 native，不虚构原生旧值', () => {
  const requested = makeDoc({
    colors: { accent: '#3d6b55', background: '#101511' },
    typography: { chatFontSize: 16, lineHeight: 1.5 }
  });

  const summary = generateApplySummary({
    baselineDoc: null,
    requestedDoc: requested,
    targetInfo: { targetId: 'target-1', instanceId: 'inst-1', baselineKind: 'native' }
  });

  assert.equal(summary.baselineKind, 'native');
  assert.equal(summary.targetId, 'target-1');
  assert.equal(summary.instanceId, 'inst-1');
  assert.ok(summary.previewId);
  assert.ok(summary.documentHash);

  // 每一项的 beforeDisplay 都是 '原生默认'，而不是假数据
  for (const group of summary.requestedChanges) {
    for (const item of group.items) {
      assert.equal(item.before, null);
      assert.equal(item.beforeDisplay, '原生默认');
      assert.ok(item.afterDisplay);
    }
  }
});

test('F03: 已换肤窗口：严格对比 lastVerified 基线，分组清晰且格式化友好', () => {
  const baseline = makeDoc({
    colors: { accent: '#112233', background: '#223344' },
    typography: { chatFontSize: 14, lineHeight: 1.4 },
    regions: {
      global: { opacity: 80, blur: 20 },
      sidebar: { opacity: 70, blur: 15 }
    }
  });

  const requested = makeDoc({
    colors: { accent: '#445566', background: '#223344' }, // 仅 accent 变化
    typography: { chatFontSize: 18, lineHeight: 1.4 },     // 仅 chatFontSize 变化
    regions: {
      global: { opacity: 80, blur: 20 },
      sidebar: { opacity: 90, blur: 15 }                  // 仅 sidebar opacity 变化
    }
  });

  const summary = generateApplySummary({
    baselineDoc: baseline,
    requestedDoc: requested,
    targetInfo: { targetId: 'target-2', instanceId: 'inst-2', baselineKind: 'verified-theme' },
    runtimeContext: { performanceTier: 'powersave', scene: 'chat' }
  });

  assert.equal(summary.baselineKind, 'verified-theme');

  // 检查分组
  const groupKeys = summary.requestedChanges.map(g => g.group);
  assert.ok(groupKeys.includes('colors'));
  assert.ok(groupKeys.includes('typography'));
  assert.ok(groupKeys.includes('regions'));

  // 检查格式化
  const colorsGroup = summary.requestedChanges.find(g => g.group === 'colors');
  const accentItem = colorsGroup.items.find(i => i.path === 'colors.accent');
  assert.ok(accentItem);
  assert.equal(accentItem.beforeDisplay, '#112233');
  assert.equal(accentItem.afterDisplay, '#445566');

  const typoGroup = summary.requestedChanges.find(g => g.group === 'typography');
  const fontItem = typoGroup.items.find(i => i.path === 'typography.chatFontSize');
  assert.ok(fontItem);
  assert.equal(fontItem.beforeDisplay, '14px');
  assert.equal(fontItem.afterDisplay, '18px');

  // 检查自动覆盖说明
  assert.equal(summary.automaticOverrides.length, 2);
  assert.ok(summary.automaticOverrides.find(o => o.type === 'performance'));
  assert.ok(summary.automaticOverrides.find(o => o.type === 'scene'));
});
