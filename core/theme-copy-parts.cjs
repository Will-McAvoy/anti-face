const { appError } = require('./errors.cjs');
const { validateThemeDocument } = require('./theme-schema.cjs');
const { resolveDocument } = require('./theme-resolver.cjs');
const { REGION_IDS } = require('./regions.cjs');

const ALLOWED_GROUPS = new Set([
  'colors',
  'typography',
  'wallpaper',
  'regions',
  ...REGION_IDS.map(r => `regions.${r}`)
]);

/**
 * 从源主题局部复制指定部分到目标主题
 * @param {object} targetDoc - 当前目标主题草稿
 * @param {object} sourceDoc - 源主题文档
 * @param {string[]} selectedGroups - 要复制的组列表，如 ['colors', 'wallpaper']
 * @param {object} options - 选项 { copyVisiblePalette: true }
 * @returns {{ changed: boolean, document: object, modifiedGroups: string[] }}
 */
function copyThemeParts(targetDoc, sourceDoc, selectedGroups = [], options = {}) {
  if (!targetDoc || typeof targetDoc !== 'object') throw appError('INVALID_ARGUMENT', '目标主题无效');
  if (!sourceDoc || typeof sourceDoc !== 'object') throw appError('INVALID_ARGUMENT', '源主题无效');

  const validatedTarget = validateThemeDocument(targetDoc);
  const validatedSource = validateThemeDocument(sourceDoc);

  if (!Array.isArray(selectedGroups) || selectedGroups.length === 0) {
    throw appError('INVALID_ARGUMENT', '请选择至少一个要复制的内容组');
  }

  // 白名单校验
  for (const group of selectedGroups) {
    if (!ALLOWED_GROUPS.has(group)) {
      throw appError('INVALID_ARGUMENT', `不允许复制的内容组: ${group}`);
    }
  }

  const resultDoc = structuredClone(validatedTarget);
  const modifiedGroups = [];

  // 1. 配色复制
  if (selectedGroups.includes('colors')) {
    if (options.copyVisiblePalette !== false) {
      // 推荐：复制可见调色板（解析不同 baseThemeId 后的实际视觉颜色）
      const resolvedSource = resolveDocument(validatedSource);
      resultDoc.colors = {
        accent: resolvedSource.colors.accent,
        background: resolvedSource.colors.background,
        panel: resolvedSource.colors.panel,
        foreground: resolvedSource.colors.foreground,
        muted: resolvedSource.colors.muted,
        border: resolvedSource.colors.border || null,
        selection: resolvedSource.colors.selection || null
      };
    } else {
      // 原始复制
      resultDoc.colors = structuredClone(validatedSource.colors);
    }
    modifiedGroups.push('colors');
  }

  // 2. 排版复制
  if (selectedGroups.includes('typography')) {
    resultDoc.typography = structuredClone(validatedSource.typography);
    modifiedGroups.push('typography');
  }

  // 3. 壁纸复制（带完整配置与构图，不只复制 assetId）
  if (selectedGroups.includes('wallpaper')) {
    resultDoc.wallpaper = structuredClone(validatedSource.wallpaper);
    modifiedGroups.push('wallpaper');
  }

  // 4. 区域复制
  if (selectedGroups.includes('regions')) {
    resultDoc.regions = structuredClone(validatedSource.regions);
    modifiedGroups.push('regions');
  } else {
    // 检查是否有单个区域的复制
    for (const r of REGION_IDS) {
      const key = `regions.${r}`;
      if (selectedGroups.includes(key)) {
        if (!resultDoc.regions) resultDoc.regions = {};
        if (validatedSource.regions && validatedSource.regions[r]) {
          resultDoc.regions[r] = structuredClone(validatedSource.regions[r]);
        } else {
          // 源主题继承 global 或未设置
          resultDoc.regions[r] = null;
        }
        modifiedGroups.push(key);
      }
    }
  }

  // 严格保持目标 ID、名称、版本、基底主题 (若未明确指定)
  resultDoc.id = validatedTarget.id;
  resultDoc.name = validatedTarget.name;
  resultDoc.schemaVersion = validatedTarget.schemaVersion;

  // 校验最终合并后的文档格式
  const finalValidated = validateThemeDocument(resultDoc);
  const isChanged = JSON.stringify(finalValidated) !== JSON.stringify(validatedTarget);

  return {
    changed: isChanged,
    document: finalValidated,
    modifiedGroups
  };
}

const ALLOWED_COPY_GROUPS = Array.from(ALLOWED_GROUPS);

module.exports = {
  ALLOWED_GROUPS,
  ALLOWED_COPY_GROUPS,
  copyThemeParts
};
