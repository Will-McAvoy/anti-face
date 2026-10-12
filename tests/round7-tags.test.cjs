const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTag,
  normalizeTags,
  validateThemeMetadata,
  deriveColorScheme,
  matchesThemeFilters,
  getTagCounts,
  MAX_TAGS_PER_THEME,
  MAX_TAG_LENGTH
} = require('../core/theme-tags.cjs');

test('F01: normalizeTags 中英混合、大小写、组合 Unicode、空白和超限处理', () => {
  // 1. 去空白、去重（大小写不敏感但保留原显示形式）、Unicode 规范化
  const raw = [' 编程 ', '阅读', '编程', 'Code', 'code', '夜间模式', '  '];
  const normalized = normalizeTags(raw);
  assert.deepEqual(normalized, ['编程', '阅读', 'Code', '夜间模式']);

  // 2. 超限单个标签拒绝
  const longTag = '一二三四五六七八九十'.repeat(3); // 30 字符 > 24
  assert.throws(() => normalizeTag(longTag), /单个标签长度不能超过 24 个字符/);

  // 3. 最大 12 个标签限制截断
  const manyTags = Array.from({ length: 20 }, (_, i) => `标签${i + 1}`);
  const bounded = normalizeTags(manyTags);
  assert.equal(bounded.length, MAX_TAGS_PER_THEME);
  assert.equal(bounded[0], '标签1');
  assert.equal(bounded[11], '标签12');

  // 4. 空数组或非法输入
  assert.deepEqual(normalizeTags([]), []);
  assert.deepEqual(normalizeTags(null), []);
  assert.throws(() => normalizeTags('not-an-array'), /标签必须是数组/);
});

test('F01: deriveColorScheme 依据背景色相对亮度自动分类深浅色', () => {
  // 深色背景
  assert.equal(deriveColorScheme({ colors: { background: '#101511' } }), 'dark');
  assert.equal(deriveColorScheme({ colors: { background: '#1a1a2e' } }), 'dark');
  assert.equal(deriveColorScheme({ colors: { background: '#222222' } }), 'dark');

  // 浅色背景
  assert.equal(deriveColorScheme({ colors: { background: '#ffffff' } }), 'light');
  assert.equal(deriveColorScheme({ colors: { background: '#f5f7fa' } }), 'light');
  assert.equal(deriveColorScheme({ colors: { background: '#e0e0e0' } }), 'light');
});

test('F01: matchesThemeFilters 组合过滤：多选 AND / OR、深浅色、壁纸、无标签', () => {
  const e1 = {
    id: 'theme-1',
    name: '暗黑编程',
    favorite: true,
    tags: ['编程', '夜间'],
    document: {
      colors: { background: '#121212' },
      wallpaper: { assetId: 'wp-1' }
    }
  };

  const e2 = {
    id: 'theme-2',
    name: '极简明亮阅读',
    favorite: false,
    tags: ['阅读'],
    document: {
      colors: { background: '#ffffff' },
      wallpaper: { assetId: null }
    }
  };

  const e3 = {
    id: 'theme-3',
    name: '默认无标签主题',
    favorite: false,
    tags: [],
    document: {
      colors: { background: '#202020' },
      wallpaper: null
    }
  };

  // 1. AND 过滤：必须同时含有 '编程' 和 '夜间'
  assert.equal(matchesThemeFilters(e1, { tags: ['编程', '夜间'], tagMode: 'AND' }), true);
  assert.equal(matchesThemeFilters(e2, { tags: ['编程', '夜间'], tagMode: 'AND' }), false);

  // 2. OR 过滤：含有 '编程' 或 '阅读'
  assert.equal(matchesThemeFilters(e1, { tags: ['编程', '阅读'], tagMode: 'OR' }), true);
  assert.equal(matchesThemeFilters(e2, { tags: ['编程', '阅读'], tagMode: 'OR' }), true);
  assert.equal(matchesThemeFilters(e3, { tags: ['编程', '阅读'], tagMode: 'OR' }), false);

  // 3. 无标签过滤
  assert.equal(matchesThemeFilters(e3, { untaggedOnly: true }), true);
  assert.equal(matchesThemeFilters(e1, { untaggedOnly: true }), false);

  // 4. 深浅色过滤
  assert.equal(matchesThemeFilters(e1, { colorScheme: 'dark' }), true);
  assert.equal(matchesThemeFilters(e1, { colorScheme: 'light' }), false);
  assert.equal(matchesThemeFilters(e2, { colorScheme: 'light' }), true);

  // 5. 壁纸过滤
  assert.equal(matchesThemeFilters(e1, { hasWallpaper: true }), true);
  assert.equal(matchesThemeFilters(e2, { hasWallpaper: true }), false);
  assert.equal(matchesThemeFilters(e2, { hasWallpaper: false }), true);

  // 6. 搜索文本：匹配标签文本
  assert.equal(matchesThemeFilters(e1, { query: '夜间' }), true);
  assert.equal(matchesThemeFilters(e2, { query: 'theme-2' }), true);
});

test('F01: 500 主题规模夹具：组合过滤与完整库标签计数一致性', () => {
  const themes = [];
  const tagPool = ['编程', '阅读', '办公', '二次元', '复古', '极简', '高对比'];

  for (let i = 0; i < 500; i++) {
    const isLight = i % 3 === 0;
    const hasWp = i % 2 === 0;
    const isFav = i % 5 === 0;
    const themeTags = (i % 7 === 0) ? [] : [tagPool[i % tagPool.length], tagPool[(i + 2) % tagPool.length]];

    themes.push({
      id: `theme-scale-${i}`,
      name: `主题 ${i}`,
      favorite: isFav,
      tags: normalizeTags(themeTags),
      document: {
        colors: { background: isLight ? '#f0f0f0' : '#181818' },
        wallpaper: hasWp ? { assetId: `asset-${i}` } : null
      }
    });
  }

  // 统计完整库的标签分布
  const counts = getTagCounts(themes);
  assert.ok(counts.length > 0);
  assert.ok(counts.find(c => c.tag === '编程'));

  // 组合过滤：深色 + 收藏 + 含有'编程'
  const filtered = themes.filter(t => matchesThemeFilters(t, {
    colorScheme: 'dark',
    favoritesOnly: true,
    tags: ['编程'],
    tagMode: 'AND'
  }));

  for (const item of filtered) {
    assert.equal(item.favorite, true);
    assert.equal(deriveColorScheme(item.document), 'dark');
    assert.ok(item.tags.includes('编程'));
  }
});

test('F01: ThemeLibrary 真实落盘、重启保留、复制/更新标签、导入导出包不丢标签', async t => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { ThemeLibrary } = require('../desktop/theme-library.cjs');
  const { documentFromLegacy } = require('../core/theme-schema.cjs');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-tags-test-'));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  const libFile = path.join(tmpDir, 'theme-library.json');
  const lib1 = new ThemeLibrary(libFile);
  await lib1.load();

  const doc = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { opacity: 80, blur: 20, radius: 8 }
  });

  // 1. 保存带标签的新主题
  const created = await lib1.saveNew(doc, '代码夜间', ['编程', '夜间', '深色']);
  assert.deepEqual(created.tags, ['编程', '夜间', '深色']);

  // 2. 复制主题保留标签
  const copied = await lib1.copy(created.id);
  assert.deepEqual(copied.tags, ['编程', '夜间', '深色']);
  assert.equal(copied.name, '代码夜间 副本');

  // 3. 更新标签
  const updated = await lib1.updateTags(created.id, ['编程', '极客']);
  assert.deepEqual(updated.tags, ['编程', '极客']);

  // 4. 重启加载新实例，验证标签持久化
  const lib2 = new ThemeLibrary(libFile);
  await lib2.load();

  const reloaded = lib2.get(created.id);
  assert.deepEqual(reloaded.tags, ['编程', '极客']);

  const reloadedCopy = lib2.get(copied.id);
  assert.deepEqual(reloadedCopy.tags, ['编程', '夜间', '深色']);

  // 5. query 复合过滤
  const q1 = lib2.query({ tags: ['极客'], tagMode: 'AND' });
  assert.equal(q1.total, 1);
  assert.equal(q1.items[0].id, created.id);

  // 6. 导出和导入包保留标签
  const pack = await lib2.exportPack(created.id);
  assert.deepEqual(pack.themes[0].tags, ['编程', '极客']);

  const imported = await lib2.importPack(JSON.stringify(pack));
  assert.equal(imported.created.length, 1);
  assert.deepEqual(imported.created[0].tags, ['编程', '极客']);
});

test('F01: 完整备份导出与恢复：在新数据目录重启后 tags 依然完整保留', async t => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { stores } = require('./fixtures/round6-stores.cjs');

  const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-bk-src-'));
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-bk-dst-'));
  t.after(async () => {
    await fs.rm(dir1, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dir2, { recursive: true, force: true }).catch(() => {});
  });

  const s1 = await stores(dir1);
  const doc = require('./fixtures/round6-stores.cjs').doc();
  const created = await s1.library.saveNew(doc, '带有标签的备份主题', ['备份测试', '生产标签']);
  assert.deepEqual(created.tags, ['备份测试', '生产标签']);

  const backupPath = path.join(dir1, 'backup.antiface-backup');
  await s1.backup.exportBackup(backupPath);

  // 恢复到另一个空 Store 目录
  const s2 = await stores(dir2);
  const inspected = await s2.backup.inspectBackup(backupPath);
  await s2.backup.previewRestore(inspected);
  await s2.backup.commitRestore(inspected.inspectionId);

  // 重启 s2 验证落盘数据
  const s2Restart = await stores(dir2);
  const restored = s2Restart.library.get(created.id);
  assert.ok(restored, '恢复后主题应存在');
  assert.deepEqual(restored.tags, ['备份测试', '生产标签'], '恢复后主题标签必须完整保留');
});


