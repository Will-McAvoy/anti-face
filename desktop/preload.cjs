const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('antiFace', {
  // 原有基础功能
  inspectHost: () => ipcRenderer.invoke('host:inspect'),
  chooseWallpaper: () => ipcRenderer.invoke('wallpaper:choose'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  exportSettings: value => ipcRenderer.invoke('settings:export', value),
  inspect: targetId => ipcRenderer.invoke('theme:inspect', targetId ?? null),
  status: targetId => ipcRenderer.invoke('theme:status', targetId ?? null),
  apply: (value, targetId) => ipcRenderer.invoke('theme:apply', value && typeof value === 'object' && value.settings ? value : { settings: value, targetId: targetId ?? null }),
  restore: targetId => ipcRenderer.invoke('theme:restore', targetId ?? null),
  restoreAll: () => ipcRenderer.invoke('theme:restoreAll'),

  // F5 多窗口与自动恢复
  listTargets: () => ipcRenderer.invoke('theme:targets'),
  setAutoRestore: enabled => ipcRenderer.invoke('theme:setAutoRestore', enabled),

  // F1, F2, F3 实时遥测与指标
  getTelemetryState: () => ipcRenderer.invoke('telemetry:state'),
  setTelemetryMode: mode => ipcRenderer.invoke('telemetry:setMode', mode),
  setTelemetryTarget: targetId => ipcRenderer.invoke('telemetry:setTarget', targetId ?? null),

  // F4 历史存储与导出
  getHistorySettings: () => ipcRenderer.invoke('history:getSettings'),
  setHistorySettings: value => ipcRenderer.invoke('history:setSettings', value),
  queryHistory: filter => ipcRenderer.invoke('history:query', filter),
  exportHistory: options => ipcRenderer.invoke('history:export', options),
  cleanupHistory: scope => ipcRenderer.invoke('history:cleanup', scope),

  version: () => ipcRenderer.invoke('app:version'),
  studioState: () => ipcRenderer.invoke('studio:state'),
  updateEditorSession: value => ipcRenderer.invoke('editor:session',value),
  beginPreview: targetId => ipcRenderer.invoke('preview:begin', { targetId: targetId ?? null }),
  updatePreview: (document, targetId) => ipcRenderer.invoke('preview:update', { document, targetId: targetId ?? null }),
  commitPreview: targetId => ipcRenderer.invoke('preview:commit', { targetId: targetId ?? null }),
  cancelPreview: targetId => ipcRenderer.invoke('preview:cancel', { targetId: targetId ?? null }),
  comparePreview: (holding, targetId) => ipcRenderer.invoke('preview:compare', { holding, targetId: targetId ?? null }),
  listLibrary: query => ipcRenderer.invoke('library:list', query || {}),
  getLibraryTheme: id => ipcRenderer.invoke('library:get', { id }),
  saveLibraryTheme: (document, name, tags) => ipcRenderer.invoke('library:save', { document, name, tags }),
  updateLibraryTheme: document => ipcRenderer.invoke('library:update', { document }),
  renameLibraryTheme: (id, name) => ipcRenderer.invoke('library:rename', { id, name }),
  copyLibraryTheme: id => ipcRenderer.invoke('library:copy', { id }),
  favoriteLibraryTheme: (id, favorite) => ipcRenderer.invoke('library:favorite', { id, favorite }),
  reorderLibrary: ids => ipcRenderer.invoke('library:reorder', { ids }),
  deleteLibraryTheme: id => ipcRenderer.invoke('library:delete', { id }),
  importLibrary: () => ipcRenderer.invoke('library:import'),
  exportLibrary: id => ipcRenderer.invoke('library:export', { id }),
  saveDocument: document => ipcRenderer.invoke('wallpaper:update', { document }),
  wallpaperPalette: assetId => ipcRenderer.invoke('wallpaper:palette', { assetId }),
  recentWallpaper: () => ipcRenderer.invoke('wallpaper:recent'),
  applyDocument: (document, targetId) => ipcRenderer.invoke('theme:applyDocument', { document, targetId: targetId ?? null }),
  getAutomation: () => ipcRenderer.invoke('automation:get'),
  setAutomation: value => ipcRenderer.invoke('automation:set', value),
  pauseAutomation: kind => ipcRenderer.invoke('automation:pause', { kind }),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: value => ipcRenderer.invoke('preferences:set', value),
  shortcutStatus: () => ipcRenderer.invoke('shortcuts:status'),
  openMini: () => ipcRenderer.invoke('mini:open'),
  closeMini: () => ipcRenderer.invoke('mini:close'),
  notificationCapability: () => ipcRenderer.invoke('notify:capability'),
  previewSound: name => ipcRenderer.invoke('notify:preview', { name }),
  onStudioChanged: callback => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('studio:changed', listener);
    return () => ipcRenderer.removeListener('studio:changed', listener);
  },
  onSystemScheme: callback => {
    const listener = (_event, scheme) => callback(scheme);
    ipcRenderer.on('automation:scheme', listener);
    return () => ipcRenderer.removeListener('automation:scheme', listener);
  },
  onPreviewCloseRequested: callback => {
    const listener = () => callback();
    ipcRenderer.on('preview:close-requested', listener);
    return () => ipcRenderer.removeListener('preview:close-requested', listener);
  },
  resolvePreviewClose: choice => ipcRenderer.invoke('preview:resolveClose', { choice }),
  analyzeReadability: (document, targetId, viewport, previewScene, contextKind) => ipcRenderer.invoke('readability:analyze', { document, targetId: targetId ?? null, viewport, previewScene, contextKind }),
  adoptReadability: (document, fields, targetId, suggestionId) => ipcRenderer.invoke('readability:adopt', { document, fields, targetId: targetId ?? null, suggestionId: suggestionId || null }),
  inspectDiagnostics: targetId => ipcRenderer.invoke('diagnostics:inspect', { targetId: targetId ?? null }),
  exportDiagnostics: targetId => ipcRenderer.invoke('diagnostics:export', { targetId: targetId ?? null }),
  watchScene: targetId => ipcRenderer.invoke('scene:watch', { targetId: targetId ?? null }),
  unwatchScene: targetId => ipcRenderer.invoke('scene:unwatch', { targetId: targetId ?? null }),
  pollScene: targetId => ipcRenderer.invoke('scene:poll', { targetId: targetId ?? null }),
  explainScene: (document, targetId, scene) => ipcRenderer.invoke('scene:explain', { document, targetId: targetId ?? null, scene }),
  takeCapture: value => ipcRenderer.invoke('capture:take', value),
  listCaptures: targetId => ipcRenderer.invoke('capture:list', { targetId: targetId ?? null }),
  captureImage: (groupId, phase) => ipcRenderer.invoke('capture:image', { groupId, phase }),
  clearCaptures: targetId => ipcRenderer.invoke('capture:clear', { targetId: targetId ?? null }),
  invalidateCaptures: targetId => ipcRenderer.invoke('capture:invalidate', { targetId: targetId ?? null }),
  exportCapture: (groupId, phase) => ipcRenderer.invoke('capture:export', { groupId, phase }),
  generateThemes: (assetId, locks, requestId) => ipcRenderer.invoke('generator:create', { assetId, locks, requestId }),
  cancelGenerate: requestId => ipcRenderer.invoke('generator:cancel', { requestId }),
  adoptColors: (document, colors) => ipcRenderer.invoke('generator:adopt', { document, colors }),
  identifyProject: targetId => ipcRenderer.invoke('bindings:identify', { targetId: targetId ?? null }),
  identifyWorkspace: (workspaceId, targetId) => ipcRenderer.invoke('bindings:identify', { workspaceId, targetId: targetId ?? null }),
  listBindings: targetId => ipcRenderer.invoke('bindings:list', { targetId: targetId ?? null }),
  saveBinding: value => ipcRenderer.invoke('bindings:save', value),
  removeBinding: projectKey => ipcRenderer.invoke('bindings:remove', { projectKey }),
  bindSession: (themeId, targetId, label) => ipcRenderer.invoke('bindings:session', { themeId, targetId: targetId ?? null, label }),
  resumeAutomationTarget: targetId => ipcRenderer.invoke('bindings:resume', { targetId: targetId ?? null }),
  listRevisions: themeId => ipcRenderer.invoke('revisions:list', { themeId }),
  diffRevisions: (leftId, rightId) => ipcRenderer.invoke('revisions:diff', { leftId, rightId }),
  restoreRevision: (revisionId, selection, confirm) => ipcRenderer.invoke('revisions:restore', { revisionId, selection, confirm: confirm === true }),
  retryRevision: operationId => ipcRenderer.invoke('revisions:retry', { operationId }),
  pinRevision: (themeId, revisionId, pinned) => ipcRenderer.invoke('revisions:pin', { themeId, revisionId, pinned }),
  listRecoveryCandidates: themeId => ipcRenderer.invoke('revisions:candidates', { themeId }),
  adoptRecoveryCandidate: revisionId => ipcRenderer.invoke('revisions:adopt', { revisionId }),
  catalogPage: query => ipcRenderer.invoke('catalog:page', query || {}),
  catalogGet: itemId => ipcRenderer.invoke('catalog:get', { itemId }),
  catalogPreview: itemId => ipcRenderer.invoke('catalog:preview', { itemId }),
  catalogInstall: (itemId, mode) => ipcRenderer.invoke('catalog:install', { itemId, mode }),

  // Round 6: 七项功能 API
  restoreAllTargets: () => ipcRenderer.invoke('recovery:restoreAll'),
  safeModeStatus: () => ipcRenderer.invoke('safeMode:status'),
  enterSafeMode: reason => ipcRenderer.invoke('safeMode:enter', { reason }),
  exitSafeMode: () => ipcRenderer.invoke('safeMode:exit'),

  openQuickSwitcher: () => ipcRenderer.invoke('switcher:open'),
  toggleQuickSwitcher: () => ipcRenderer.invoke('switcher:toggle'),

  getDisplayContext: targetId => ipcRenderer.invoke('display:context', { targetId: targetId ?? null }),
  getDisplays: () => ipcRenderer.invoke('display:bounds'),

  exportBackup: (filePath, options) => ipcRenderer.invoke('backup:export', { filePath, options }),
  inspectBackup: filePath => ipcRenderer.invoke('backup:inspect', { filePath }),
  cancelBackupInspection: inspectionId => ipcRenderer.invoke('backup:cancel',{inspectionId}),
  previewRestore: inspection => ipcRenderer.invoke('backup:preview', { inspection }),
  commitRestore: (filePath, options) => ipcRenderer.invoke('backup:commit', { filePath, options }),

  getPerformanceSummary: targetId => ipcRenderer.invoke('performance:summary', { targetId: targetId ?? null }),
  setPerformancePrefs: prefs => ipcRenderer.invoke('performance:set', prefs),

  testNotification: prefs => ipcRenderer.invoke('notify:test', prefs),

  // Round 7: 五项功能 API
  updateThemeTags: (id, tags) => ipcRenderer.invoke('library:updateTags', { id, tags }),
  copyThemeParts: (targetDoc, sourceDoc, selectedGroups, options) => ipcRenderer.invoke('theme:copyParts', { targetDoc, sourceDoc, selectedGroups, options }),

  rotationChooseFolder: () => ipcRenderer.invoke('rotation:chooseFolder'),
  getRotationStatus: targetId => ipcRenderer.invoke('rotation:status', { targetId: targetId ?? null }),
  setRotationConfig: (config, targetId) => ipcRenderer.invoke('rotation:set', { config, targetId: targetId ?? null }),
  rotationNext: targetId => ipcRenderer.invoke('rotation:next', { targetId: targetId ?? null }),
  rotationPause: targetId => ipcRenderer.invoke('rotation:pause', { targetId: targetId ?? null }),
  rotationResume: targetId => ipcRenderer.invoke('rotation:resume', { targetId: targetId ?? null }),
  rotationSaveToTheme: targetId => ipcRenderer.invoke('rotation:saveToTheme', { targetId: targetId ?? null }),

  previewApply: (document, targetId) => ipcRenderer.invoke('apply:preview', { document, targetId: targetId ?? null }),
  confirmApply: (previewId, options) => ipcRenderer.invoke('apply:confirm', { previewId, options }),

  getAutoBackupStatus: () => ipcRenderer.invoke('autoBackup:status'),
  setAutoBackupConfig: config => ipcRenderer.invoke('autoBackup:set', config),
  runAutoBackupNow: () => ipcRenderer.invoke('autoBackup:runNow'),
  chooseAutoBackupFolder: () => ipcRenderer.invoke('autoBackup:chooseFolder'),
  openAutoBackupFolder: () => ipcRenderer.invoke('autoBackup:openFolder')
});
