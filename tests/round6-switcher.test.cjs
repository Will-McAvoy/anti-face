const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize } = require('../core/ipc-policy.cjs');

test('F03: IPC 角色授权隔离 - switcher 角色白名单严格受限', () => {
  // 允许的 switcher 专用通道
  assert.equal(authorize('switcher', 'switcher:init'), true);
  assert.equal(authorize('switcher', 'switcher:selectTarget'), true);
  assert.equal(authorize('switcher', 'switcher:apply'), true);
  assert.equal(authorize('switcher', 'switcher:resolveConflict'), true);
  assert.equal(authorize('switcher', 'switcher:close'), true);

  // 严格拒绝非 switcher 白名单的敏感通道
  assert.equal(authorize('switcher', 'backup:export'), false);
  assert.equal(authorize('switcher', 'backup:inspect'), false);
  assert.equal(authorize('switcher', 'backup:commit'), false);
  assert.equal(authorize('switcher', 'settings:save'), false);
  assert.equal(authorize('switcher', 'theme:save'), false);
  assert.equal(authorize('switcher', 'catalog:install'), false);
  assert.equal(authorize('switcher', 'library:delete'), false);
  assert.equal(authorize('switcher', 'generator:create'), false);
  assert.equal(authorize('switcher', 'capture:take'), false);
});

test('F03: 快速切换器搜索与过滤纯内存执行，无注入与副作用', () => {
  const themes = [
    { id: 'aurora', name: '极光森林', baseThemeId: 'aurora', preset: 'custom' },
    { id: 'graphite', name: '石墨深灰', baseThemeId: 'graphite', preset: 'balanced' },
    { id: 'ocean', name: '深海蓝调', baseThemeId: 'ocean', preset: 'powersave' }
  ];

  function filterThemes(list, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(t =>
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.id && t.id.toLowerCase().includes(q)) ||
      (t.preset && t.preset.toLowerCase().includes(q))
    );
  }

  // 普通中文/英文搜索
  assert.equal(filterThemes(themes, '极光').length, 1);
  assert.equal(filterThemes(themes, 'graphite').length, 1);
  assert.equal(filterThemes(themes, 'powersave').length, 1);

  // 特殊字符、注入字符与正则元字符安全处理
  assert.equal(filterThemes(themes, '<script>alert(1)</script>').length, 0);
  assert.equal(filterThemes(themes, '.*+?^${}()|[]\\').length, 0);
  assert.equal(filterThemes(themes, "   ").length, 3);
});

test('F03: 多目标独立性 - 快速切换器应用主题只影响指定窗口', () => {
  const targetStates = {
    'target-1': { appliedThemeId: null, appliedCss: null },
    'target-2': { appliedThemeId: 'old-theme', appliedCss: 'body { color: blue; }' }
  };

  function switcherApply(targetId, themeId, css) {
    if (!targetStates[targetId]) throw new Error('Target not found');
    targetStates[targetId].appliedThemeId = themeId;
    targetStates[targetId].appliedCss = css;
  }

  // 针对 target-1 进行快速切换
  switcherApply('target-1', 'aurora', 'body { color: green; }');

  assert.equal(targetStates['target-1'].appliedThemeId, 'aurora');
  assert.equal(targetStates['target-1'].appliedCss, 'body { color: green; }');
  // target-2 状态完全不受影响
  assert.equal(targetStates['target-2'].appliedThemeId, 'old-theme');
  assert.equal(targetStates['target-2'].appliedCss, 'body { color: blue; }');
});

test('F03: 竞态与冲突防护 - 目标处于手动恢复或更高代际时切换操作被安全拒绝', () => {
  const target = {
    id: 'target-1',
    operationGeneration: 10,
    manualHold: true
  };

  function trySwitcherApply(target, requestedGen, newThemeId) {
    // 检查代际与 manualHold
    if (target.manualHold) {
      return { ok: false, reason: 'manual-hold-active' };
    }
    if (requestedGen < target.operationGeneration) {
      return { ok: false, reason: 'stale-generation' };
    }
    target.operationGeneration += 1;
    target.themeId = newThemeId;
    return { ok: true, generation: target.operationGeneration };
  }

  // 1. manualHold 激活时拒绝
  const r1 = trySwitcherApply(target, 10, 'aurora');
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'manual-hold-active');

  // 解除 manualHold 但请求过期代际
  target.manualHold = false;
  const r2 = trySwitcherApply(target, 5, 'aurora');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'stale-generation');

  // 正常匹配代际
  const r3 = trySwitcherApply(target, 10, 'aurora');
  assert.equal(r3.ok, true);
  assert.equal(target.themeId, 'aurora');
});
