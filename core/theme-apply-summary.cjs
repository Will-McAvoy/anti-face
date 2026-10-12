const { diffDocuments, documentHash, COLOR_ROLES, REGION_IDS } = require('./theme-diff.cjs');

const FIELD_LABELS = {
  'colors.accent': '强调色',
  'colors.background': '背景色',
  'colors.panel': '面板色',
  'colors.foreground': '前景色',
  'colors.muted': '次要文字色',
  'colors.border': '边框色',
  'colors.selection': '选区高亮色',
  'typography.chatFontSize': '聊天字号',
  'typography.lineHeight': '行高倍率',
  'typography.contentWidth': '正文宽度',
  'wallpaper.assetId': '壁纸图片',
  'wallpaper.fit': '壁纸填充',
  'wallpaper.blur': '壁纸模糊',
  'wallpaper.brightness': '壁纸亮度',
  'wallpaper.saturate': '壁纸饱和度',
  'wallpaper.maskColor': '遮罩颜色',
  'wallpaper.maskStrength': '遮罩强度',
  'wallpaper.scale': '壁纸缩放',
  'wallpaper.focusX': '水平焦点',
  'wallpaper.focusY': '垂直焦点'
};

const REGION_NAMES = {
  global: '全局',
  sidebar: '侧边栏',
  chat: '聊天区',
  composer: '输入框',
  card: '卡片'
};

function formatValue(path, value) {
  if (value === null || value === undefined) return '默认/继承';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '无';
  if (path.startsWith('colors.') || path === 'wallpaper.maskColor') {
    return String(value);
  }
  if (path === 'typography.chatFontSize') return `${value}px`;
  if (path === 'typography.lineHeight') return `${value}x`;
  if (path === 'typography.contentWidth') return `${value}px`;
  if (path.endsWith('.opacity') || path === 'wallpaper.maskStrength' || path === 'wallpaper.scale') {
    return `${value}%`;
  }
  if (path.endsWith('.blur') || path === 'wallpaper.blur' || path.endsWith('.radius') || path.endsWith('.borderWidth')) {
    return `${value}px`;
  }
  if (path === 'wallpaper.assetId') {
    return value ? '自定义图片' : '无图片';
  }
  if (path === 'wallpaper.legacyDataUrl') {
    return value ? '自定义图片 (内联)' : '无图片';
  }
  return String(value);
}

function classifyPath(path) {
  if (path.startsWith('colors.')) return 'colors';
  if (path.startsWith('typography.')) return 'typography';
  if (path.startsWith('wallpaper.')) return 'wallpaper';
  if (path.startsWith('regions.')) return 'regions';
  return 'other';
}

const GROUP_NAMES = {
  colors: '配色',
  typography: '排版',
  wallpaper: '壁纸',
  regions: '区域',
  other: '其他'
};

function normalizeSummaryArgs(arg1, arg2, arg3, arg4) {
  if (arg1 && typeof arg1 === 'object' && ('requestedDoc' in arg1 || 'targetInfo' in arg1)) {
    return {
      requestedDoc: arg1.requestedDoc,
      baselineDoc: arg1.baselineDoc ?? null,
      effectiveDoc: arg1.effectiveDoc ?? null,
      targetInfo: arg1.targetInfo ?? {},
      runtimeContext: arg1.runtimeContext ?? {}
    };
  }
  return {
    requestedDoc: arg1,
    baselineDoc: arg2 ?? null,
    effectiveDoc: null,
    runtimeContext: arg3 ?? {},
    targetInfo: (arg4 && typeof arg4 === 'object') ? arg4 : {}
  };
}

/**
 * 生成应用前摘要 (纯函数)
 * 同时兼容单对象传参与四个位置参数调用
 */
function generateApplySummary(arg1, arg2, arg3, arg4) {
  const {
    baselineDoc = null,
    requestedDoc,
    effectiveDoc = null,
    targetInfo = {},
    runtimeContext = {}
  } = normalizeSummaryArgs(arg1, arg2, arg3, arg4);

  if (!requestedDoc || typeof requestedDoc !== 'object') {
    throw new TypeError('generateApplySummary: requestedDoc 必须为有效主题对象');
  }

  const isNative = targetInfo.baselineKind === 'native' || (!baselineDoc && targetInfo.baselineKind !== 'session' && targetInfo.baselineKind !== 'verified-theme');
  const baselineKind = targetInfo.baselineKind || (isNative ? 'native' : 'verified-theme');

  const baselineLabels = {
    native: '系统原生默认外观',
    lastVerified: '已确认主题基线',
    'verified-theme': '已确认主题基线',
    session: '当前会话主题基线',
    unknown: '未知基线'
  };
  const baselineLabel = baselineLabels[baselineKind] || (isNative ? '系统原生默认外观' : '已确认主题基线');

  const groups = { colors: [], typography: [], wallpaper: [], regions: [], other: [], auto: [] };
  const warnings = [];

  const rawDiffs = isNative ? diffDocuments({}, requestedDoc) : diffDocuments(baselineDoc, requestedDoc);

  for (const change of rawDiffs) {
    if (['id', 'name', 'schemaVersion', 'tags'].includes(change.path)) continue;
    if (change.path === 'wallpaper.legacyDataUrl') continue;

    const groupKey = classifyPath(change.path);
    const label = FIELD_LABELS[change.path] || change.path;
    const item = {
      path: change.path,
      label,
      field: label,
      category: groupKey,
      before: isNative ? null : formatValue(change.path, change.before),
      after: formatValue(change.path, change.after),
      beforeDisplay: isNative ? '原生默认' : formatValue(change.path, change.before),
      afterDisplay: formatValue(change.path, change.after),
      source: 'requested'
    };
    if (groups[groupKey]) groups[groupKey].push(item);
  }

  // 运行期覆盖说明 (effectiveChanges / automatic overrides)
  const automaticOverrides = [];

  // 1. 性能覆盖
  if (runtimeContext.performanceTier && runtimeContext.performanceTier !== 'normal') {
    const tier = runtimeContext.performanceTier;
    const maxBlur = tier === 'powersave' ? 8 : 12;
    automaticOverrides.push({
      type: 'performance',
      name: '性能策略覆盖',
      description: tier === 'powersave'
        ? '省电模式：已限制壁纸与背景模糊上限为 8px'
        : '轻量模式：已限制壁纸与背景模糊上限为 12px'
    });

    if (requestedDoc.wallpaper && (requestedDoc.wallpaper.blur ?? 0) > maxBlur) {
      groups.auto.push({
        path: 'wallpaper.blur',
        label: `壁纸模糊 (性能${tier === 'powersave' ? '省电' : '轻量'}限制)`,
        field: `壁纸模糊 (性能${tier === 'powersave' ? '省电' : '轻量'}限制)`,
        category: 'auto',
        before: `${requestedDoc.wallpaper.blur}px`,
        after: `${maxBlur}px`,
        beforeDisplay: `${requestedDoc.wallpaper.blur}px`,
        afterDisplay: `${maxBlur}px`,
        source: 'performance'
      });
    }

    if (requestedDoc.regions) {
      for (const [regId, regVal] of Object.entries(requestedDoc.regions)) {
        if (regVal && (regVal.blur ?? 0) > maxBlur) {
          const regName = REGION_NAMES[regId] || regId;
          groups.auto.push({
            path: `regions.${regId}.blur`,
            label: `${regName}模糊 (性能${tier === 'powersave' ? '省电' : '轻量'}限制)`,
            field: `${regName}模糊 (性能${tier === 'powersave' ? '省电' : '轻量'}限制)`,
            category: 'auto',
            before: `${regVal.blur}px`,
            after: `${maxBlur}px`,
            beforeDisplay: `${regVal.blur}px`,
            afterDisplay: `${maxBlur}px`,
            source: 'performance'
          });
        }
      }
    }
  }

  // 2. 场景覆盖
  if (runtimeContext.scene && runtimeContext.scene !== 'off' && runtimeContext.scene !== 'unknown') {
    const sceneName = runtimeContext.scene === 'chat' ? '对话聊天' : '主页浏览';
    automaticOverrides.push({
      type: 'scene',
      name: '场景感知覆盖',
      description: `当前检测到 ${sceneName} 场景，已应用对应对比度优化`
    });
    groups.auto.push({
      path: 'sceneAppearance.mode',
      label: `场景感知模式 (${sceneName})`,
      field: `场景感知模式 (${sceneName})`,
      category: 'auto',
      before: '常规外观',
      after: `${sceneName}对比度调整`,
      beforeDisplay: '常规外观',
      afterDisplay: `${sceneName}对比度调整`,
      source: 'scene'
    });
  }

  // 3. 轮换覆盖
  if (runtimeContext.rotationActive || runtimeContext.wallpaperOverride) {
    const override = runtimeContext.wallpaperOverride;
    automaticOverrides.push({
      type: 'rotation',
      name: '壁纸轮换覆盖',
      description: '运行期壁纸轮换处于启用状态，当前显示轮换覆盖图'
    });
    groups.auto.push({
      path: 'wallpaper.assetId',
      label: '壁纸图片 (运行时轮换覆盖)',
      field: '壁纸图片 (运行时轮换覆盖)',
      category: 'auto',
      before: requestedDoc.wallpaper?.assetId ? '用户主题壁纸' : '无壁纸',
      after: override?.filename || (override?.assetId ? '轮换候选壁纸' : '轮换图片'),
      beforeDisplay: requestedDoc.wallpaper?.assetId ? '用户主题壁纸' : '无壁纸',
      afterDisplay: override?.filename || (override?.assetId ? '轮换候选壁纸' : '轮换图片'),
      source: 'rotation'
    });
  }

  // 构建向后兼容的 requestedChanges 分组数组（给测试与老调用者）
  const requestedChanges = [];
  for (const [key, items] of Object.entries(groups)) {
    if (key !== 'auto' && items.length > 0) {
      requestedChanges.push({
        group: key,
        name: GROUP_NAMES[key] || key,
        items
      });
    }
  }

  const allRequestedFlat = [
    ...groups.colors,
    ...groups.typography,
    ...groups.wallpaper,
    ...groups.regions,
    ...groups.other
  ];

  const effectiveChanges = [
    ...allRequestedFlat,
    ...groups.auto
  ];

  const totalChanges = allRequestedFlat.length + groups.auto.length;

  const requestedHash = documentHash(requestedDoc);
  const contextHash = documentHash({
    instanceId: targetInfo.instanceId || '',
    runtimeContext
  });

  return {
    previewId: `prev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    targetId: targetInfo.targetId || 'unknown',
    instanceId: targetInfo.instanceId || 'unknown',
    documentHash: requestedHash,
    contextHash,
    baselineKind,
    baseline: {
      kind: baselineKind === 'verified-theme' ? 'lastVerified' : baselineKind,
      label: baselineLabel
    },
    groups: {
      colors: groups.colors,
      typography: groups.typography,
      wallpaper: groups.wallpaper,
      regions: groups.regions,
      auto: groups.auto
    },
    requestedChanges,
    effectiveChanges,
    autoChanges: groups.auto,
    automaticOverrides,
    totalChanges,
    totalChangeCount: requestedChanges.reduce((sum, g) => sum + g.items.length, 0),
    warnings
  };
}

module.exports = {
  FIELD_LABELS,
  GROUP_NAMES,
  REGION_NAMES,
  formatValue,
  generateApplySummary
};
