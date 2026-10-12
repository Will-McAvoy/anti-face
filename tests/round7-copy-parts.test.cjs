const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { copyThemeParts, ALLOWED_GROUPS } = require('../core/theme-copy-parts.cjs');
const { documentFromLegacy, validateThemeDocument } = require('../core/theme-schema.cjs');
const { resolveDocument } = require('../core/theme-resolver.cjs');

function sampleDoc(id, name, baseThemeId, patch = {}) {
  const base = documentFromLegacy({
    schemaVersion: 1,
    themeId: baseThemeId || 'graphite',
    appearance: {
      opacity: 80,
      blur: 20,
      radius: 10
    }
  });
  const doc = {
    ...base,
    id: id || randomUUID(),
    name: name || '测试主题',
    baseThemeId: baseThemeId || 'graphite',
    ...patch
  };
  return validateThemeDocument(doc);
}

test('F04: 仅复制 sidebar：其他区域、颜色、字体、壁纸、ID/name 全部保持原样', () => {
  const targetId = randomUUID();
  const sourceId = randomUUID();
  const targetWp = randomUUID();
  const sourceWp = randomUUID();

  const target = sampleDoc(targetId, '我的目标主题', 'graphite', {
    colors: { accent: '#112233', background: '#223344' },
    typography: { chatFontSize: 14, lineHeight: 1.4 },
    wallpaper: { assetId: targetWp, fit: 'cover' },
    regions: {
      global: { opacity: 80, blur: 20 },
      sidebar: { opacity: 70, blur: 15 },
      chat: { opacity: 90, blur: 25 }
    }
  });

  const source = sampleDoc(sourceId, '源主题', 'midnight', {
    colors: { accent: '#998877', background: '#665544' },
    typography: { chatFontSize: 18, lineHeight: 1.8 },
    wallpaper: { assetId: sourceWp, fit: 'contain' },
    regions: {
      global: { opacity: 50, blur: 10 },
      sidebar: { opacity: 95, blur: 5 },
      chat: { opacity: 40, blur: 30 }
    }
  });

  const res = copyThemeParts(target, source, ['regions.sidebar']);
  assert.equal(res.changed, true);
  assert.deepEqual(res.modifiedGroups, ['regions.sidebar']);

  const doc = res.document;
  // 目标身份未变
  assert.equal(doc.id, targetId);
  assert.equal(doc.name, '我的目标主题');

  // sidebar 被复制
  assert.equal(doc.regions.sidebar.opacity, 95);
  assert.equal(doc.regions.sidebar.blur, 5);

  // 其他保持目标值不变
  assert.equal(doc.regions.chat.opacity, 90);
  assert.equal(doc.colors.accent, '#112233');
  assert.equal(doc.typography.chatFontSize, 14);
  assert.equal(doc.wallpaper.assetId, targetWp);
});

test('F04: 复制颜色：源 baseThemeId 不同且源 colors 为空对象，目标可见调色板正确获取源解析值', () => {
  // 源主题基底为 midnight，未手动覆盖任何颜色
  const source = sampleDoc(randomUUID(), '源', 'midnight', { colors: {} });
  // 目标基底为 pearl (浅色)
  const target = sampleDoc(randomUUID(), '目标', 'pearl', { colors: { accent: '#123456' } });

  const resolvedSource = resolveDocument(source);

  const res = copyThemeParts(target, source, ['colors'], { copyVisiblePalette: true });
  assert.equal(res.changed, true);
  // 目标 colors 获得了源解析出的 midnight 视觉颜色
  assert.equal(res.document.colors.background, resolvedSource.colors.background);
  assert.equal(res.document.colors.accent, resolvedSource.colors.accent);
  assert.equal(res.document.colors.panel, resolvedSource.colors.panel);
  // 目标基底不被篡改
  assert.equal(res.document.baseThemeId, 'pearl');
});

test('F04: 复制壁纸：带完整构图与参数', () => {
  const target = sampleDoc(randomUUID(), '目标', 'graphite', { wallpaper: null });
  const wpId = randomUUID();
  const source = sampleDoc(randomUUID(), '源', 'graphite', {
    wallpaper: {
      assetId: wpId,
      fit: 'contain',
      focusX: 40,
      focusY: 60,
      scale: 120,
      maskStrength: 45,
      maskColor: '#000000',
      composition: {
        policy: 'protect-subject',
        subjectRect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        textSafeRect: null
      }
    }
  });

  const res = copyThemeParts(target, source, ['wallpaper']);
  assert.equal(res.changed, true);
  assert.equal(res.document.wallpaper.assetId, wpId);
  assert.equal(res.document.wallpaper.fit, 'contain');
  assert.equal(res.document.wallpaper.focusX, 40);
  assert.equal(res.document.wallpaper.focusY, 60);
  assert.equal(res.document.wallpaper.scale, 120);
  assert.equal(res.document.wallpaper.maskStrength, 45);
  assert.equal(res.document.wallpaper.composition.policy, 'protect-subject');
});

test('F04: 未选择任何组或非法路径时明确抛出异常，不修改草稿', () => {
  const target = sampleDoc(randomUUID(), '目标', 'graphite');
  const source = sampleDoc(randomUUID(), '源', 'graphite');

  assert.throws(() => copyThemeParts(target, source, []), /请选择至少一个要复制的内容组/);
  assert.throws(() => copyThemeParts(target, source, ['malicious_field']), /不允许复制的内容组/);
  assert.throws(() => copyThemeParts(target, source, ['id']), /不允许复制的内容组/);
});

test('F04: 相同内容复制返回 changed: false', () => {
  const doc = sampleDoc(randomUUID(), '同一主题', 'graphite');
  const res = copyThemeParts(doc, doc, ['typography']);
  assert.equal(res.changed, false);
});
