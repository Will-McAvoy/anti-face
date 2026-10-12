const { app, BrowserWindow, ipcMain, dialog, session, globalShortcut, Tray, Menu, screen, powerMonitor, Notification, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { inspectHost } = require('./host.cjs');
const { SettingsStore } = require('./settings.cjs');
const { ThemeService } = require('./theme-service.cjs');
const { HistoryStorage } = require('./history-storage.cjs');
const { TelemetryManager } = require('./telemetry-sources.cjs');
const { StudioService } = require('./studio-service.cjs');
const { MiniWindowController } = require('./mini-window.cjs');
const { imageData, exportableTheme, buildCSS } = require('../core/theme.cjs');
const { decodeImage } = require('../core/image-decode.cjs');
const { copyThemeParts } = require('../core/theme-copy-parts.cjs');
const { authorize } = require('../core/ipc-policy.cjs');

let window, service, historyStorage, telemetryManager, studio, monitor, closing = false;
const devURL = !app.isPackaged ? process.env.ANTI_FACE_DEV_URL : null;
const entry = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
if (process.env.ANTI_FACE_TEST_USER_DATA) {app.setPath('userData', process.env.ANTI_FACE_TEST_USER_DATA);app.setPath('sessionData',process.env.ANTI_FACE_TEST_USER_DATA);}

const miniEntry = pathToFileURL(path.join(__dirname, 'mini.html')).href;
const switcherEntry = pathToFileURL(path.join(__dirname, 'switcher.html')).href;

function roleFor(event) {
  try {
    if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) {
      const matches = devURL
        ? new URL(event.senderFrame.url).origin === new URL(devURL).origin
        : event.senderFrame.url.toLowerCase() === entry.toLowerCase();
      if (matches) return 'main';
    }
    const miniWindow = studio?.mini?.window;
    if (miniWindow && !miniWindow.isDestroyed?.() && event.sender === miniWindow.webContents && event.senderFrame === miniWindow.webContents.mainFrame) {
      if (event.senderFrame.url.toLowerCase() === miniEntry.toLowerCase()) return 'mini';
    }
    const switcherWindow = studio?.quickSwitcher?.window;
    if (switcherWindow && !switcherWindow.isDestroyed?.() && event.sender === switcherWindow.webContents && event.senderFrame === switcherWindow.webContents.mainFrame) {
      if (event.senderFrame.url.toLowerCase() === switcherEntry.toLowerCase()) return 'switcher';
    }
  } catch {
    return null;
  }
  return null;
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, value) => {
    if (!authorize(roleFor(event), channel) || closing) throw new Error('请求来源无效或程序正在退出');
    if(studio?.migrationActive && !new Set(['studio:state','theme:status','theme:targets','library:list','library:get','preferences:get','safeMode:status','performance:summary','display:bounds','backup:cancel']).has(channel)){const error=new Error('[RESTORE_BUSY] 正在恢复数据，请稍后重试');error.code='RESTORE_BUSY';throw error;}
    return fn(value);
  });
}

async function chooseWallpaper() {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Background image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  const buffer = await fs.readFile(file);
  if (buffer.length > 5 * 1024 * 1024) throw new Error('请选择小于 5 MB 的图片');
  await decodeImage(buffer);
  if (studio) await studio.importWallpaper(buffer).catch(() => null);
  return imageData(buffer);
}

async function exportSettings(value) {
  const settings = exportableTheme(value);
  const result = await dialog.showSaveDialog(window, { defaultPath: `anti-face-${settings.themeId}.json`, filters: [{ name: '主题配置', extensions: ['json'] }, { name: 'CSS 样式', extensions: ['css'] }] });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, result.filePath.toLowerCase().endsWith('.css') ? buildCSS(settings) : JSON.stringify(settings, null, 2), 'utf8');
  return result.filePath;
}

async function importSettings() {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: '主题配置', extensions: ['json'] }] });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('配置文件不能超过 8 MB');
  return exportableTheme(JSON.parse(await fs.readFile(file, 'utf8')));
}

async function chooseBackupExportPath() {
  const result = await dialog.showSaveDialog(window, {
    defaultPath: `anti-face-backup-${new Date().toISOString().slice(0, 10)}.antiface-backup`,
    filters: [{ name: 'Anti Face 备份包', extensions: ['antiface-backup', 'zip'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

async function chooseBackupImportPath() {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Anti Face 备份包', extensions: ['antiface-backup', 'zip'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.show(); if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    const store = new SettingsStore(app.getPath('userData'));
    const loaded = await store.load();
    const historyPref = loaded.settings.history;
    service = new ThemeService({ autoRestoreOnReload: false });
    historyStorage = new HistoryStorage(path.join(app.getPath('userData'), 'history'), {
      enabled: historyPref?.enabled === true,
      retentionDays: [7, 30, 90].includes(historyPref?.retentionDays) ? historyPref.retentionDays : 30
    });
    await historyStorage.init();
    telemetryManager = new TelemetryManager({
      themeService: service,
      historyStorage,
      // Test profiles must not import the real host's transcripts into fixture history.
      appDataDir: process.env.ANTI_FACE_TEST_USER_DATA
        ? path.join(app.getPath('userData'), 'telemetry-fixture') : undefined
    });
    telemetryManager.start(2000);
    const { documentFromLegacy } = require('../core/theme-schema.cjs');
    studio = new StudioService({
      userData: app.getPath('userData'),
      themeService: service,
      settings: store,
      telemetry: telemetryManager,
      globalShortcut,
      Tray,
      Menu,
      BrowserWindow,
      screen,
      powerMonitor,
      cliSafeMode: process.argv.includes('--safe-mode'),
      icon: path.join(__dirname, '../assets/tray.png'),
      notifier: {
        show(title, body) {
          if (Notification.isSupported()) {new Notification({ title, body, silent: true }).show();return {supported:true,requested:true,delivery:'unknown'};}
          return {supported:false,requested:false,delivery:'unavailable'};
        }
      },
      mini: new MiniWindowController({
        BrowserWindow,
        screen,
        getSnapshot: () => telemetryManager.getState(),
        onBoundsPersist: async bounds => {
          if (studio?.preferences) {
            await studio.setPreferences({ ...studio.preferences, mini: { ...studio.preferences.mini, bounds } });
          }
        }
      }),
      onShowWindow() { if (window && !window.isDestroyed()) { window.show(); if (window.isMinimized()) window.restore(); window.focus(); } }
    });
    await studio.start();
    studio.autoRestoreBeforeSafe=loaded.settings.autoRestoreOnReload === true;
    service.setAutoRestore(loaded.settings.autoRestoreOnReload === true);
    studio.onStudioChanged = () => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('studio:changed', studio.snapshot());
      }
    };
    if (!studio.document) studio.document = documentFromLegacy(loaded.settings);
    studio.automation.systemScheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    nativeTheme.on('updated', () => {
      const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      void studio.automation.setScheme(scheme).catch(error => console.error('System theme:', error.message));
      if (window && !window.isDestroyed()) window.webContents.send('automation:scheme', scheme);
    });

    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({
      width: 1440, height: 940, minWidth: 1000, minHeight: 720, show: false,
      title: 'Anti Face', backgroundColor: '#101511', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    studio.display.onDisplaysChanged = () => {
      for(const w of [window,studio.mini?.window,studio.quickSwitcher?.window]) if(w&&!w.isDestroyed()){const b=w.getBounds(),next=studio.display.clampBounds(b);if(JSON.stringify(b)!==JSON.stringify(next)) w.setBounds(next);}
      void studio.observeHostContexts().then(()=>studio.performance.refresh()).catch(error=>console.error('Display context:',error.message));
    };
    for(const event of ['move','resize']) window.on(event,()=>studio.display.onDisplaysChanged());
    window.once('ready-to-show', () => { if (!process.env.ANTI_FACE_TEST_USER_DATA) window.show(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => {
      const decision = studio?.decideClose() || 'quit';
      if (decision === 'quit') return;
      event.preventDefault();
      if (decision === 'hide') {
        window.hide();
        return;
      }
      window.show();
      window.webContents.send('preview:close-requested');
    });

    // 核心外观与设置
    handle('host:inspect', inspectHost);
    handle('wallpaper:choose', chooseWallpaper);
    handle('settings:load', () => store.load());
    handle('settings:save', async value => {
      const saved = await store.save(value);
      service.setAutoRestore(saved.autoRestoreOnReload === true);
      if (saved.history) {
        historyStorage.setEnabled(saved.history.enabled === true);
        historyStorage.setRetentionDays(saved.history.retentionDays);
      }
      return saved;
    });
    handle('settings:import', importSettings);
    handle('settings:export', exportSettings);

    // 主题与多窗口
    handle('theme:inspect', targetId => service.inspect(targetId || null));
    handle('theme:status', targetId => service.statusFor(targetId || null));
    handle('theme:apply', value => {
      if (value && typeof value === 'object' && value.settings) {
        return service.apply(value.settings, value.targetId);
      }
      return service.apply(value);
    });
    handle('theme:restore', targetId => studio.restoreSelected(targetId || null));
    handle('theme:restoreAll', () => studio.restoreAll());
    handle('theme:targets', () => service.listTargets());
    handle('theme:setAutoRestore', enabled => store.update(current => {
      service.setAutoRestore(!!enabled);
      return { ...current, autoRestoreOnReload: !!enabled };
    }).then(() => undefined));

    // 实时遥测 F1, F2, F3
    handle('telemetry:state', () => telemetryManager.getState());
    handle('telemetry:setMode', mode => {
      telemetryManager.setMode(mode);
      return telemetryManager.getState();
    });
    handle('telemetry:setTarget', targetId => {
      telemetryManager.setTarget(typeof targetId === 'string' ? targetId : null);
      return telemetryManager.getState();
    });

    // 历史存储 F4
    handle('history:getSettings', () => ({
      enabled: historyStorage.enabled,
      retentionDays: historyStorage.retentionDays
    }));
    handle('history:setSettings', async ({ enabled, retentionDays } = {}) => {
      const saved = await store.update(current => {
        const history = {
          enabled: enabled != null ? !!enabled : current.history?.enabled === true,
          retentionDays: [7, 30, 90].includes(retentionDays) ? retentionDays : (current.history?.retentionDays || historyStorage.retentionDays)
        };
        historyStorage.setEnabled(history.enabled);
        historyStorage.setRetentionDays(history.retentionDays);
        return { ...current, history };
      });
      return saved.history;
    });
    handle('history:query', filter => historyStorage.queryRecords(filter || {}));
    handle('history:export', async ({ format, filter }) => {
      const isJson = format === 'json';
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `anti-face-history-${new Date().toISOString().slice(0, 10)}.${isJson ? 'json' : 'csv'}`,
        filters: isJson
          ? [{ name: 'JSON 数据', extensions: ['json'] }]
          : [{ name: 'CSV 表格', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) return null;
      const content = isJson ? await historyStorage.exportJson(filter) : await historyStorage.exportCsv(filter);
      await fs.writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    });
    handle('history:cleanup', scope => historyStorage.cleanupRecords(scope));
    handle('app:version', () => app.getVersion());
    handle('studio:state', () => studio.snapshot());
    handle('editor:session', value=>studio.updateEditorSession(value));
    window.webContents.on('destroyed',()=>{void studio.releaseEditorSession();});
    handle('preview:begin', value => studio.beginPreview(value?.targetId || null));
    handle('preview:update', value => studio.updateDraft(value?.document, value?.targetId || null));
    handle('preview:commit', value => studio.commitPreview(value?.targetId || null, { allowDegraded: value?.allowDegraded === true }));
    handle('preview:cancel', value => studio.cancelPreview(value?.targetId || null));
    handle('preview:compare', value => studio.compare(value?.targetId || null, value?.holding === true));
    handle('preview:flush', value => studio.preview.flush(value?.targetId || studio.selectedTargetId));
    handle('preview:resolveClose', async value => {
      const choice = value?.choice;
      let error = null;
      let res = null;
      try {
        if (choice === 'save') res = await studio.commitPreview(studio.selectedTargetId);
        if (choice === 'cancel') {
          res = await studio.cancelPreview(studio.selectedTargetId);
          if (res?.phase === 'suspended') {
            error = res.message || '恢复待完成，无法确认';
          }
        }
      } catch (caught) {
        error = caught.message;
      }
      const success = !error && (choice !== 'cancel' || res?.phase === 'idle');
      if (success) {
        if (choice === 'save' || choice === 'cancel') {
          const decision = studio.decideClose();
          if (decision === 'hide' && window && !window.isDestroyed()) {
            window.hide();
          } else if (decision === 'quit') {
            app.quit();
          }
        }
      }
      return { ok: success, error, visible: window?.isVisible?.() ?? null, phase: res?.phase };
    });
    handle('library:list', value => studio.library.query(value || {}));
    handle('library:get', value => studio.library.get(value?.id || value));
    handle('library:save', async value => {
      const entry = await studio.library.saveNew(value.document, value.name, value.tags || []);
      const history = await studio.round5?.remember(entry.document, { source: 'save', themeId: entry.id, documentSaved: true });
      return history && history.ok === false
        ? { ...entry, revisionSaved: false, operationId: history.operationId, code: history.code, message: `主题已收入个人库，但版本历史没有写完：${history.message}` }
        : { ...entry, revisionSaved: history ? true : undefined, operationId: history?.operationId };
    });
    handle('library:update', async value => {
      const updated = await studio.library.updateDocument(value.document?.id, value.document);
      const history = await studio.round5?.remember(updated.document, { source: 'save', themeId: updated.id, documentSaved: true });
      return history && history.ok === false
        ? { ...updated, revisionSaved: false, operationId: history.operationId, code: history.code, message: `主题已更新，但版本历史没有写完：${history.message}` }
        : { ...updated, revisionSaved: history ? true : undefined, operationId: history?.operationId };
    });
    handle('library:updateTags', value => studio.library.updateTags(value.id, value.tags || []));
    handle('theme:copyParts', async value => {
      const res = copyThemeParts(value.targetDoc, value.sourceDoc, value.selectedGroups, value.options);
      if (res.document?.wallpaper?.assetId && studio.assets) {
        const readable = await studio.assets.read(res.document.wallpaper.assetId).catch(() => null);
        if (!readable) {
          throw new Error('复制的壁纸资源不存在或已损坏');
        }
      }
      return res;
    });
    handle('library:rename', value => studio.library.rename(value.id, value.name));
    handle('library:copy', value => studio.library.copy(value.id));
    handle('library:favorite', value => studio.library.favorite(value.id, value.favorite));
    handle('library:reorder', value => studio.library.reorder(value.ids || []));
    handle('library:delete', async value => {
      const result = await studio.library.remove(value.id, { appliedId: studio.document?.id, rules: studio.preferences.automation.rules });
      if (result.rulesChanged) await studio.setAutomation({ ...studio.preferences.automation, rules: result.rules });
      if (value?.releaseHistory === true) await studio.round5?.revisions.removeTheme(value.id, { release: true });
      return result;
    });
    handle('library:import', async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: '主题包', extensions: ['json'] }] });
      if (result.canceled) return null;
      const file = result.filePaths[0];
      const stat = await fs.stat(file);
      if (stat.size > 12 * 1024 * 1024) throw new Error('导入文件不能超过 12 MB');
      return studio.library.importPack(await fs.readFile(file));
    });
    handle('library:export', async value => {
      const pack = await studio.library.exportPack(value.id);
      const result = await dialog.showSaveDialog(window, { defaultPath: `anti-face-${pack.themes[0].name}.json`, filters: [{ name: '主题包', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return null;
      await fs.writeFile(result.filePath, JSON.stringify(pack, null, 2), 'utf8');
      return result.filePath;
    });
    handle('wallpaper:update', async value => {
      const document = await studio.saveDocument(value.document);
      return { ok: true, document };
    });
    handle('wallpaper:palette', value => studio.palette(value.assetId));
    handle('wallpaper:recent', () => studio.recentWallpaper);
    handle('theme:applyDocument', value => studio.applyEditorDocument(value?.document, value?.targetId || null, { allowDegraded: value?.allowDegraded === true }));
    handle('readability:analyze', value => studio.round5.explain(value?.document || studio.document, value?.targetId || studio.selectedTargetId, {
      viewport: value?.viewport, previewScene: value?.previewScene, scene: value?.scene, contextKind: value?.contextKind
    }));
    handle('readability:adopt', value => studio.round5.adoptReadability(value?.document || studio.document, value?.fields, value?.targetId || studio.selectedTargetId, value?.suggestionId || null));
    handle('scene:explain', value => studio.round5.explain(value?.document || studio.document, value?.targetId || studio.selectedTargetId, {
      viewport: value?.viewport, previewScene: value?.previewScene, scene: value?.scene, contextKind: value?.contextKind
    }));
    handle('scene:watch', value => studio.round5.watchScene(value?.targetId || studio.selectedTargetId));
    handle('scene:unwatch', value => studio.round5.unwatchScene(value?.targetId || studio.selectedTargetId));
    handle('scene:poll', value => studio.round5.pollScene(value?.targetId || studio.selectedTargetId));
    handle('diagnostics:inspect', value => studio.round5.inspect(value?.targetId || studio.selectedTargetId));
    handle('diagnostics:export', async value => {
      const exported = studio.round5.exportDiagnostics(value?.targetId || studio.selectedTargetId);
      if (!exported.ok) return exported;
      const result = await dialog.showSaveDialog(window, { defaultPath: 'anti-face-diagnostics.json', filters: [{ name: '诊断', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ...exported, saved: null };
      await fs.writeFile(result.filePath, JSON.stringify(exported.report, null, 2), 'utf8');
      return { ...exported, saved: result.filePath };
    });
    handle('capture:take', value => studio.round5.capture(value || {}));
    handle('capture:list', value => studio.round5.captureList(value?.targetId || studio.selectedTargetId));
    handle('capture:image', value => studio.round5.captureImage(value?.groupId, value?.phase));
    handle('capture:clear', value => studio.round5.clearCapture(value?.targetId || null));
    handle('capture:invalidate', value => studio.round5.invalidateCapture(value?.targetId || null));
    handle('capture:export', async value => {
      const image = studio.round5.captureImage(value?.groupId, value?.phase);
      if (!image) return null;
      const result = await dialog.showSaveDialog(window, { defaultPath: 'anti-face-capture.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (result.canceled || !result.filePath) return null;
      await fs.writeFile(result.filePath, Buffer.from(image.dataUrl.split(',')[1], 'base64'));
      return result.filePath;
    });
    handle('generator:create', value => studio.round5.generate(value?.assetId, value?.locks, value?.requestId));
    handle('generator:cancel', value => studio.round5.cancelGenerate(value?.requestId));
    handle('generator:adopt', value => studio.round5.adoptColors(value?.document || studio.document, value?.colors));
    handle('bindings:identify', async value => {
      const targetId = value?.targetId || studio.selectedTargetId;
      if (typeof value?.workspaceId === 'string') return studio.round5.rememberProject(targetId, { workspaceId: value.workspaceId });
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return { reliable: false, confidence: 'none' };
      return studio.round5.rememberProject(targetId, { projectPath: result.filePaths[0] });
    });
    handle('bindings:list', value => studio.round5.listBindings(value?.targetId || studio.selectedTargetId));
    handle('bindings:save', value => studio.round5.saveBinding({ ...value, targetId: value?.targetId || studio.selectedTargetId }));
    handle('bindings:remove', value => studio.round5.removeBinding(value?.projectKey));
    handle('bindings:session', value => studio.round5.bindSession(value?.targetId || studio.selectedTargetId, value?.themeId, value?.label));
    handle('bindings:resume', value => studio.round5.resume(value?.targetId || studio.selectedTargetId));
    handle('revisions:list', value => studio.round5.revisionsFor(value?.themeId || studio.document?.id));
    handle('revisions:diff', value => studio.round5.diffRevisions(value?.leftId, value?.rightId));
    handle('revisions:pin', value => studio.round5.pinRevision(value?.themeId, value?.revisionId, value?.pinned === true));
    handle('revisions:restore', value => studio.round5.restoreRevision(value?.revisionId, value?.selection || null, value?.confirm === true));
    handle('revisions:retry', value => studio.round5.retryRemember(value?.operationId));
    handle('revisions:candidates', value => studio.round5.candidatesFor(value?.themeId || null));
    handle('revisions:adopt', value => studio.round5.adoptRecoveryCandidate(value?.revisionId));
    handle('catalog:page', value => studio.round5.catalogPage(value || {}));
    handle('catalog:get', value => studio.round5.catalogGet(value?.itemId));
    handle('catalog:preview', value => studio.round5.catalogPreview(value?.itemId));
    handle('catalog:install', value => studio.round5.catalogInstall(value?.itemId, value?.mode || 'install'));
    handle('automation:get', () => studio.automation.config);
    handle('automation:set', value => studio.setAutomation(value));
    handle('automation:pause', value => studio.setAutomation(studio.automation.pause(value?.kind || 'hour')));
    handle('automation:resume', () => studio.setAutomation(studio.automation.pause('resume')));
    handle('preferences:get', () => studio.preferences);
    handle('preferences:set', value => studio.setPreferences(value));
    handle('shortcuts:set', value => studio.setPreferences({ ...studio.preferences, shortcuts: value }));
    handle('shortcuts:status', () => studio.shortcuts.status(studio.preferences.shortcuts));
    handle('mini:open', () => studio.openMini());
    handle('mini:close', () => studio.mini?.close());
    handle('mini:status', () => ({ open: !!studio.mini?.open }));
    handle('notify:preview', value => studio.notifications.preview(value?.name || 'preview', value?.volume));
    handle('notify:capability', () => studio.notifications.capability(studio.preferences.notifications, studio.externalSound));
    handle('notify:set', value => studio.setPreferences({ ...studio.preferences, notifications: value }));
    handle('mini:snapshot', () => telemetryManager.getState());
    handle('mini:open-main', () => { window.show(); window.focus(); return true; });
    handle('mini:dismiss', () => studio.mini?.close());
    handle('mini:bounds', async value => {
      const bounds = studio.mini.move(value);
      await studio.setPreferences({ ...studio.preferences, mini: { ...studio.preferences.mini, bounds } });
      return bounds;
    });

    // Round 6: 七项功能 IPC 注册
    handle('recovery:restoreAll', () => studio.restoreAll());
    handle('safeMode:status', () => studio.safeLaunch ? studio.safeLaunch.status() : { safeMode: studio.safeMode });
    handle('safeMode:enter', value => studio.enterSafeMode(value?.reason));
    handle('safeMode:exit', () => studio.exitSafeMode());

    handle('switcher:open', () => { studio.quickSwitcher?.show(); return true; });
    handle('switcher:toggle', () => { studio.quickSwitcher?.toggle(); return true; });
    handle('switcher:init', () => studio.quickSwitcher ? studio.quickSwitcher.initData() : null);
    handle('switcher:selectTarget', value => studio.quickSwitcher?.selectTarget(value?.targetId));
    handle('switcher:apply', value => studio.quickSwitcher?.applyTheme(value?.themeId, value?.targetId));
    handle('switcher:resolveConflict', value => studio.quickSwitcher?.resolveConflict(value?.choice,value?.targetId));
    handle('switcher:close', () => { studio.quickSwitcher?.close(); return true; });

    handle('display:context', async value => {await studio.observeHostContexts();return studio.display?.getTargetContext(value?.targetId);});
    handle('display:bounds', () => studio.display?.getDisplays());

    handle('backup:export', async value => {
      const dest = await chooseBackupExportPath();
      if (!dest) return { ok: false, cancelled: true };
      return studio.backup.exportBackup(dest, value?.options);
    });
    handle('backup:inspect', async value => {
      const src = await chooseBackupImportPath();
      if (!src) return { ok: false, cancelled: true };
      const res = await studio.backup.inspectBackup(src);
      return res;
    });
    handle('backup:preview', value => {studio.backup.session(value?.inspection);return studio.backup.previewRestore(value?.inspection);});
    handle('backup:commit', value => {studio.backup.session(value?.filePath);return studio.backup.commitRestore(value?.filePath,value?.options);});
    handle('backup:cancel', value => studio.backup.cancelInspection(value?.inspectionId));

    handle('performance:summary', value => studio.performance.summary(value?.targetId));
    handle('performance:set', async value => {await studio.setPreferences({performance: {...studio.performance.prefs,...value}});return studio.performance.prefs;});

    handle('notify:test', value => studio.notifications.sendTestNotification(value));

    // Round 7: 五项功能 IPC 注册
    handle('apply:preview', value => studio.previewApply(value?.document, value?.targetId));
    handle('apply:confirm', value => studio.confirmApply(value?.previewId, value?.options));

    handle('rotation:chooseFolder', async () => {
      const result = await dialog.showOpenDialog(window, {
        title: '选择本地壁纸文件夹',
        properties: ['openDirectory']
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const folderPath = result.filePaths[0];
      await studio.setPreferences({
        wallpaperRotation: {
          ...studio.preferences.wallpaperRotation,
          folderRef: folderPath
        }
      });
      return { canceled: false, folderPath, status: studio.wallpaperRotation?.getStatus() };
    });
    handle('rotation:status', value => studio.wallpaperRotation?.getStatus(value?.targetId));
    handle('rotation:set', async value => {
      await studio.setPreferences({
        wallpaperRotation: { ...studio.preferences.wallpaperRotation, ...value?.config }
      });
      return studio.wallpaperRotation?.getStatus(value?.targetId);
    });
    handle('rotation:next', value => studio.wallpaperRotation?.rotate(value?.targetId || studio.selectedTargetId));
    handle('rotation:pause', () => studio.wallpaperRotation?.pause());
    handle('rotation:resume', () => studio.wallpaperRotation?.resume());
    handle('rotation:saveToTheme', value => studio.wallpaperRotation?.saveCurrentToTheme(value?.targetId || studio.selectedTargetId));

    handle('autoBackup:status', () => studio.autoBackup?.getStatus());
    handle('autoBackup:set', async value => {
      await studio.setPreferences({
        autoBackup: { ...studio.preferences.autoBackup, ...value?.config }
      });
      return studio.autoBackup?.getStatus();
    });
    handle('autoBackup:runNow', () => studio.autoBackup?.runAutoBackup('force'));
    handle('autoBackup:chooseFolder', async () => {
      const result = await dialog.showOpenDialog(window, {
        title: '选择自动备份保存文件夹',
        properties: ['openDirectory']
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const folderPath = result.filePaths[0];
      await studio.setPreferences({
        autoBackup: {
          ...studio.preferences.autoBackup,
          directoryRef: folderPath
        }
      });
      return { canceled: false, folderPath, status: studio.autoBackup?.getStatus() };
    });
    handle('autoBackup:openFolder', async () => {
      const dir = studio.autoBackup?.config?.directoryRef;
      if (dir) {
        const { shell } = require('electron');
        await shell.openPath(dir);
        return { ok: true };
      }
      return { ok: false, message: '未配置自动备份目录' };
    });

    let ticking = false;
    monitor = setInterval(async () => {
      if (ticking || closing) return;
      ticking = true;
      try {
        await service.tick();
        await studio.observeHostContexts();
        await studio.performance.refresh();
        studio.observeTelemetry(telemetryManager.getState());
        if (studio?.preview) {
          for (const [targetId, entry] of studio.preview.targets) {
            if (entry.phase !== 'idle') {
              const targetStatus = service.statusFor(targetId);
              if (targetStatus.state === 'suspended' || targetStatus.state === 'detached') {
                studio.preview.suspend(targetId, targetStatus.message || '宿主连接中断或已刷新，试穿已挂起');
              }
            }
          }
        }
      } catch (error) { console.error('Theme monitor:', error.message); }
      finally { ticking = false; }
    }, 8000);

    window.webContents.on('render-process-gone', () => { void studio.rollbackPreviewOnly();void studio.releaseEditorSession(); });
    if (devURL) window.loadURL(devURL); else window.loadFile(path.join(__dirname, '../dist/index.html'));
  }).catch(error => { dialog.showErrorBox('Anti Face 无法启动', error.message); app.quit(); });

  app.on('before-quit', event => {
    if (closing || !service) return;
    event.preventDefault();
    closing = true;
    if (studio) studio.quitting = true;
    clearInterval(monitor);
    telemetryManager?.stop();
    const deadline = new Promise(resolve => setTimeout(resolve, 6500));
    Promise.race([
      (async () => {
        if (studio) await studio.stop().catch(error => console.error('Studio stop:', error.message));
        await service.dispose();
        if (historyStorage) await historyStorage.flush();
      })(),
      deadline
    ]).finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (studio?.preferences?.tray?.closeToTray && !studio.quitting && !closing) return;
    app.quit();
  });
}
