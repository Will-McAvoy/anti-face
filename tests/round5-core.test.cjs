const test = require('node:test');
const assert = require('node:assert/strict');
const { contrastRgb, hexToRgb, compositeStraight, linearizeChannel, protect, buildModel } = require('../core/readability.cjs');
const { solveComposition, layoutFor } = require('../core/wallpaper-layout.cjs');
const { classifyScene, createSceneState, stepScene } = require('../core/scene-policy.cjs');
const { arbitrateDecision } = require('../core/priority.cjs');
const { normalizeProjectPath, identifyProject } = require('../core/project-identity.cjs');
const { diffDocuments, partialRestore } = require('../core/theme-diff.cjs');
const { validateThemeDocument, documentFromLegacy, migrateThemeDocumentV1ToV2 } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { buildVerificationPlan, compareObservation } = require('../core/apply-verification.cjs');
const { generatePaletteThemes } = require('../core/palette-generator.cjs');
const { validateCatalogManifest } = require('../core/catalog-schema.cjs');
const { authorize } = require('../core/ipc-policy.cjs');

function solid(width, height, rgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

test('阅读对比使用独立的黑白 21:1 和同色 1:1', () => {
  const black = hexToRgb('#000000');
  const white = hexToRgb('#ffffff');
  assert.equal(Math.round(contrastRgb(black, white) * 100) / 100, 21);
  assert.equal(Math.round(contrastRgb(white, white) * 100) / 100, 1);
  assert.equal(Math.round(linearizeChannel(0) * 1000) / 1000, 0);
  assert.ok(Math.abs(linearizeChannel(1) - 1) < 1e-9);
});

test('半透明白叠在黑上的合成不是满分，也不是纯白', () => {
  const mixed = compositeStraight({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 0.5 });
  assert.equal(mixed.r, 127.5);
  assert.ok(contrastRgb(hexToRgb('#000000'), mixed) > 1);
  assert.ok(contrastRgb(hexToRgb('#000000'), mixed) < 21);
});

test('亮点图不能靠平均亮度蒙混，锁定后不得假装达标', () => {
  const image = solid(8, 8, [255, 255, 255, 255]);
  for (let y = 3; y <= 4; y += 1) {
    for (let x = 3; x <= 4; x += 1) {
      const at = (y * 8 + x) * 4;
      image.data[at] = 0; image.data[at + 1] = 0; image.data[at + 2] = 0;
    }
  }
  const model = buildModel({
    resolved: {
      colors: { background: '#ffffff', panel: '#ffffff', foreground: '#f4f4f4' },
      regions: { chat: { opacity: 0 } },
      wallpaper: { assetId: 'x', maskColor: '#000000', maskStrength: 0, blur: 0, brightness: 100, saturate: 100 },
      layout: {
        viewToImage(x, y) { return { x: (x / 80) * 8, y: (y / 80) * 8 }; }
      }
    },
    viewport: { width: 80, height: 80 },
    image,
    textRect: { x: 0, y: 0, width: 80, height: 80 },
    regionId: 'chat'
  });
  const initial = protect(model, { mode: 'off', targetContrast: 4.5, locks: [] });
  assert.ok(initial.measurement.worst < initial.measurement.mean);
  const open = protect(model, { mode: 'auto', targetContrast: 4.5, locks: [] });
  const locked = protect(model, {
    mode: 'auto',
    targetContrast: 4.5,
    locks: ['wallpaper.maskStrength', 'regions.chat.opacity', 'colors.foreground']
  });
  assert.equal(open.reached, true);
  assert.ok(open.adjustments.length > 0);
  assert.equal(locked.reached, false);
  assert.ok(locked.warnings.some(item => item.code === 'LOCKED_LIMIT'));
  const again = protect(open.model, { mode: 'auto', targetContrast: 4.5, locks: [] });
  assert.equal(again.model.wallpaper.maskStrength, open.model.wallpaper.maskStrength);
});

test('没有图片采样时不给满分', () => {
  const model = buildModel({
    resolved: {
      colors: { background: '#111111', panel: '#222222', foreground: '#eeeeee' },
      regions: { chat: { opacity: 80 } },
      wallpaper: { assetId: 'missing', maskColor: '#000000', maskStrength: 0, blur: 0, brightness: 100, saturate: 100 },
      layout: null
    },
    viewport: { width: 100, height: 100 },
    image: null,
    textRect: null,
    regionId: 'chat'
  });
  const result = protect(model, { mode: 'suggest', targetContrast: 4.5, locks: [] });
  assert.equal(result.measurement.status, 'unknown');
  assert.notEqual(result.measurement.worst, 21);
});

test('构图按手算的 cover 裁切，冲突会告警', () => {
  const layout = layoutFor({
    imageWidth: 200, imageHeight: 100, viewWidth: 100, viewHeight: 100, fit: 'cover', scale: 100
  }, 50, 50);
  assert.equal(layout.offset.x, -50);
  assert.equal(layout.offset.y, 0);
  assert.equal(layout.visible.x, 0.25);
  assert.equal(layout.visible.width, 0.5);
  assert.equal(layout.visible.height, 1);
  const solved = solveComposition({
    imageWidth: 200, imageHeight: 100, viewWidth: 100, viewHeight: 100, fit: 'cover', scale: 100,
    focusX: 50, focusY: 50,
    subjectRect: { x: 0, y: 0, width: 0.4, height: 0.4 },
    textSafeRect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
    policy: 'protect-text'
  });
  assert.ok(solved.warnings.some(item => item.code === 'COMPOSITION_CONFLICT'));
  assert.ok(Number.isFinite(solved.focusX) && Number.isFinite(solved.focusY));
});

test('场景迟滞不会因为一次抖动切换', () => {
  let state = createSceneState();
  let step = stepScene(state, { scene: 'chat', now: 0 });
  state = step.state;
  step = stepScene(state, { scene: 'chat', now: 400 });
  assert.equal(step.scene, 'unknown');
  step = stepScene(step.state, { scene: 'chat', now: 500 });
  assert.equal(step.scene, 'chat');
  assert.equal(classifyScene({ routeHint: 'home', hasTranscript: false, hasConversation: true }).scene, 'home');
  assert.equal(classifyScene({ title: '秘密聊天' }).scene, 'unknown');
});

test('优先级：试穿和手动优先，悬空绑定不换主题', () => {
  assert.equal(arbitrateDecision({ previewing: true, project: { reliable: true, themeId: 'ink' } }).action, 'defer');
  assert.equal(arbitrateDecision({ manualHold: true, project: { reliable: true, themeId: 'ink' } }).reason, 'manual-hold');
  assert.equal(arbitrateDecision({ project: { dangling: true, reliable: true, themeId: 'gone' } }).code, 'BINDING_DANGLING');
  const project = arbitrateDecision({
    project: { reliable: true, enabled: true, themeId: 'ink' },
    scheduleDecision: { action: 'none', reason: 'off', themeId: null }
  });
  assert.equal(project.themeId, 'ink');
  assert.equal(project.source, 'project');
});

test('项目路径规范化，标题不能当项目', () => {
  assert.equal(normalizeProjectPath('C:/Foo/../Bar'), 'C:\\bar');
  assert.equal(identifyProject({ title: '同名', projectPath: '' }).reliable, false);
  const left = identifyProject({ projectPath: 'D:/work/a' });
  const right = identifyProject({ projectPath: 'D:/work/b' });
  assert.notEqual(left.projectKey, right.projectKey);
  assert.equal(left.displayHint, 'a');
  assert.equal(left.normalizedPath.includes('work'), true);
});

test('迁移不改变可见颜色，局部恢复只动侧栏', () => {
  const legacy = { schemaVersion: 1, id: 'draft', name: '石墨', baseThemeId: 'graphite', colors: { accent: '#112233' }, regions: { global: { opacity: 70 } }, wallpaper: { focusX: 40, focusY: 60 }, preset: 'custom' };
  const migrated = validateThemeDocument(migrateThemeDocumentV1ToV2(legacy));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.readability.mode, 'off');
  assert.equal(migrated.colors.accent, '#112233');
  assert.equal(migrated.wallpaper.focusX, 40);
  const cssBefore = buildDocumentCSS(documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } })).css;
  const again = buildDocumentCSS(documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } })).css;
  assert.equal(cssBefore, again);
  const current = validateThemeDocument({ ...migrated, regions: { ...migrated.regions, sidebar: { opacity: 40 }, chat: { opacity: 90 } } });
  const source = validateThemeDocument({ ...current, regions: { ...current.regions, sidebar: { opacity: 55 }, chat: { opacity: 55 } }, colors: { accent: '#abcdef' } });
  const restored = validateThemeDocument(partialRestore(current, source, { regions: ['sidebar'] }));
  assert.equal(restored.regions.sidebar.opacity, 55);
  assert.equal(restored.regions.chat.opacity, 90);
  assert.equal(restored.colors.accent, '#112233');
  assert.equal(diffDocuments(current, current).length, 0);
});

test('没有壁纸时核对计划不因伪元素失败', () => {
  const resolved = buildDocumentCSS(documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } })).resolved;
  const plan = buildVerificationPlan(resolved, { wallpaper: false });
  assert.equal(plan.checks.some(item => item.id === 'wallpaper-pointer'), false);
  const withWallpaper = buildVerificationPlan(resolved, { wallpaper: true });
  const failed = compareObservation(withWallpaper, {
    kind: 'anti-face-verify',
    checks: withWallpaper.checks.map(item => ({ id: item.id, state: 'present', actual: item.id === 'wallpaper-pointer' ? 'auto' : item.expected, rules: 3, ownerMatch: true, reachable: true }))
  });
  assert.equal(failed.status, 'failed');
  const partial = compareObservation(plan, {
    kind: 'anti-face-verify',
    checks: plan.checks.map(item => item.kind === 'region' ? { id: item.id, state: 'missing' } : { id: item.id, state: 'present', actual: item.expected, rules: 2, ownerMatch: true, reachable: true })
  });
  assert.equal(partial.status, 'partial');
});

test('三套配色角色不同，锁定强调色会被保留', () => {
  const image = solid(12, 12, [20, 40, 180, 255]);
  for (let i = 0; i < 4; i += 1) {
    const at = i * 4;
    image.data[at] = 220; image.data[at + 1] = 30; image.data[at + 2] = 40;
  }
  const first = generatePaletteThemes(image, { locks: { accent: '#123456' } });
  const second = generatePaletteThemes(image, { locks: { accent: '#123456' } });
  assert.equal(first.ok, true);
  assert.equal(JSON.stringify(first.schemes), JSON.stringify(second.schemes));
  assert.equal(new Set(first.schemes.map(item => item.colors.background)).size, 3);
  for (const scheme of first.schemes) assert.equal(scheme.colors.accent, '#123456');
  const transparent = generatePaletteThemes(solid(4, 4, [0, 0, 0, 0]));
  assert.equal(transparent.ok, true);
  assert.equal(transparent.schemes.length, 3);
});

test('迷你窗不能调用截图、安装或主题修改', () => {
  for (const channel of ['capture:take', 'catalog:install', 'theme:applyDocument', 'generator:create', 'library:get']) {
    assert.equal(authorize('mini', channel), false);
    assert.equal(authorize('main', channel), true);
  }
});

test('未来精选目录版本被拒绝', () => {
  assert.throws(() => validateCatalogManifest({ schemaVersion: 9, kind: 'anti-face-catalog', items: [] }), /版本/);
});
