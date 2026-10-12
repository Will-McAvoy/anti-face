const test = require('node:test');
const assert = require('node:assert/strict');
const { AppearanceHistory } = require('../core/appearance-history.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { validateThemeDocument, documentFromLegacy } = require('../core/theme-schema.cjs');

const ASSET_0 = '00000000-0000-4000-8000-000000000000';
const ASSET_1 = '11111111-1111-4111-8111-111111111111';
const ASSET_2 = '22222222-2222-4222-8222-222222222222';
const ASSET_3 = '33333333-3333-4333-8333-333333333333';
const THEME_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THEME_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function draft(patch = {}) {
  const base = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { ...DEFAULT_APPEARANCE }
  });
  return validateThemeDocument({ ...base, ...patch, schemaVersion: 1 });
}

test('F02: 手势聚合（滑块与焦点拖拽）在 endGesture 时只产生一条撤销记录', () => {
  const initial = draft({ id: THEME_A, regions: { global: { blur: 0, opacity: 80, radius: 10 } } });
  const history = new AppearanceHistory(initial);

  history.beginGesture('调整背景模糊');
  // 模拟滑块连续拖拽产生的多次中间事件
  history.push(draft({ id: THEME_A, regions: { global: { blur: 5, opacity: 80, radius: 10 } } }), '调整背景模糊');
  history.push(draft({ id: THEME_A, regions: { global: { blur: 10, opacity: 80, radius: 10 } } }), '调整背景模糊');
  history.push(draft({ id: THEME_A, regions: { global: { blur: 15, opacity: 80, radius: 10 } } }), '调整背景模糊');
  history.push(draft({ id: THEME_A, regions: { global: { blur: 20, opacity: 80, radius: 10 } } }), '调整背景模糊');

  // 在手势过程中，canUndo 为 true
  assert.equal(history.canUndo, true);

  // 结束手势
  history.endGesture();

  assert.equal(history.current.regions.global.blur, 20);
  assert.equal(history.undoStack.length, 1, '多次中间拖动事件应聚合为一条记录');
  assert.equal(history.undoStack[0].label, '调整背景模糊');
  assert.equal(history.nextUndoLabel, '撤销：调整背景模糊');

  // 撤销手势
  const rolledBack = history.undo();
  assert.equal(rolledBack.regions.global.blur, 0);
  assert.equal(history.nextRedoLabel, '重做：调整背景模糊');

  // 重做手势
  const redone = history.redo();
  assert.equal(redone.regions.global.blur, 20);
});

test('F02: 取消手势 cancelGesture 恢复手势前状态且不入栈', () => {
  const initial = draft({ id: THEME_A, regions: { global: { blur: 10, opacity: 80, radius: 10 } } });
  const history = new AppearanceHistory(initial);

  history.beginGesture('调整临时效果');
  history.push(draft({ id: THEME_A, regions: { global: { blur: 25, opacity: 80, radius: 10 } } }));
  assert.equal(history.current.regions.global.blur, 25);

  history.cancelGesture();
  assert.equal(history.current.regions.global.blur, 10, '应当恢复手势前状态');
  assert.equal(history.undoStack.length, 0, '取消手势不增加撤销记录');
});

test('F02: 键盘微调 500ms 内对同字段修改自动合并', () => {
  const initial = draft({ id: THEME_A, regions: { global: { blur: 0, opacity: 80, radius: 10 } } });
  const history = new AppearanceHistory(initial);

  // 模拟键盘连按微调
  history.push(draft({ id: THEME_A, regions: { global: { blur: 1, opacity: 80, radius: 10 } } }), '微调模糊', { keyAdjustField: 'blur' });
  history.push(draft({ id: THEME_A, regions: { global: { blur: 2, opacity: 80, radius: 10 } } }), '微调模糊', { keyAdjustField: 'blur' });
  history.push(draft({ id: THEME_A, regions: { global: { blur: 3, opacity: 80, radius: 10 } } }), '微调模糊', { keyAdjustField: 'blur' });

  assert.equal(history.undoStack.length, 1, '500ms 内同一字段的连续微调合并为一条');
  assert.equal(history.current.regions.global.blur, 3);

  // 微调不同字段，则不合并
  history.push(draft({ id: THEME_A, regions: { global: { blur: 3, opacity: 90, radius: 10 } } }), '修改透明度', { keyAdjustField: 'opacity' });
  assert.equal(history.undoStack.length, 2);
});

test('F02: revertToBaseline 恢复初始基线并支持通过 Undo 找回', () => {
  const baselineDoc = draft({ id: THEME_A, regions: { global: { blur: 5, opacity: 80, radius: 10 } }, wallpaper: { assetId: ASSET_0 } });
  const history = new AppearanceHistory(baselineDoc);

  // 做两次修改
  history.push(draft({ id: THEME_A, regions: { global: { blur: 15, opacity: 80, radius: 10 } }, wallpaper: { assetId: ASSET_0 } }), '步进1');
  history.push(draft({ id: THEME_A, regions: { global: { blur: 25, opacity: 80, radius: 10 } }, wallpaper: { assetId: ASSET_1 } }), '步进2');
  assert.equal(history.current.regions.global.blur, 25);
  assert.equal(history.undoStack.length, 2);

  // 执行恢复基线
  const restored = history.revertToBaseline();
  assert.equal(restored.regions.global.blur, 5);
  assert.equal(restored.wallpaper.assetId, ASSET_0);
  assert.equal(history.undoStack.length, 3);
  assert.equal(history.nextUndoLabel, '撤销：恢复初始基线');

  // 误点恢复基线后，立即 Undo 能找回最后修改
  const undone = history.undo();
  assert.equal(undone.regions.global.blur, 25);
  assert.equal(undone.wallpaper.assetId, ASSET_1);
});

test('F02: referencedAssetIds 全面保护被撤销栈和重做栈持有的图片资产', () => {
  const doc0 = draft({ id: THEME_A, wallpaper: { assetId: ASSET_0 } });
  const history = new AppearanceHistory(doc0);

  history.push(draft({ id: THEME_A, wallpaper: { assetId: ASSET_1 } }), '改图1');
  history.push(draft({ id: THEME_A, wallpaper: { assetId: ASSET_2 } }), '改图2');
  history.push(draft({ id: THEME_A, wallpaper: { assetId: ASSET_3 } }), '改图3');

  // 撤销一步，使 ASSET_3 处于 redoStack 中
  history.undo();

  const protectedAssets = history.referencedAssetIds();
  assert.ok(protectedAssets.has(ASSET_0), '基线中的资产受保护');
  assert.ok(protectedAssets.has(ASSET_1), '撤销栈中的资产受保护');
  assert.ok(protectedAssets.has(ASSET_2), '当前文档中的资产受保护');
  assert.ok(protectedAssets.has(ASSET_3), '重做栈中的资产受保护');
  assert.equal(protectedAssets.has('99999999-9999-4999-8999-999999999999'), false);
});

test('F02: 切换不同主题 ID 时隔离撤销栈，不串用旧主题历史', () => {
  const themeA = draft({ id: THEME_A, regions: { global: { blur: 10, opacity: 80, radius: 10 } } });
  const history = new AppearanceHistory(themeA);
  history.push(draft({ id: THEME_A, regions: { global: { blur: 20, opacity: 80, radius: 10 } } }), '调整A');
  assert.equal(history.undoStack.length, 1);

  // 载入主题 B
  const themeB = draft({ id: THEME_B, regions: { global: { blur: 30, opacity: 80, radius: 10 } } });
  history.push(themeB, '加载主题B');

  assert.equal(history.undoStack.length, 0, '主题 ID 变更时应清空旧栈');
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.baseline.id, THEME_B);
  assert.equal(history.current.regions.global.blur, 30);
});
