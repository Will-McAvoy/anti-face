const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PreviewSession } = require('../core/preview-session.cjs');
const { AssetStore } = require('./asset-store.cjs');
const { ThemeLibrary } = require('./theme-library.cjs');
const { PreferencesStore, validatePreferences } = require('./preferences-store.cjs');
const { AutomationService } = require('./automation-service.cjs');
const { ShortcutService } = require('./shortcut-service.cjs');
const { TrayService, decideWindowClose } = require('./tray-service.cjs');
const { NotificationService, detectExternalCompletionSound, defaultReaders } = require('./notification-service.cjs');
const { AudioPlayer } = require('./audio-player.cjs');
const { MiniWindowController } = require('./mini-window.cjs');
const { documentFromLegacy, validateThemeDocument, legacyAppearanceFromDocument, migrateV1Settings } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { extractPalette, contrastHint } = require('../core/wallpaper.cjs');
const { decodeImage } = require('../core/image-decode.cjs');
const { appError } = require('../core/errors.cjs');
const { Round5Service } = require('./round5-service.cjs');
const { SafeLaunchManager } = require('./safe-launch.cjs');
const { BackupService, recoverBackup } = require('./backup-service.cjs');
const { PerformanceService } = require('./performance-service.cjs');
const { QuickSwitcherController } = require('./quick-switcher.cjs');
const { DisplayService } = require('./display-service.cjs');
const { WallpaperRotationService } = require('./wallpaper-rotation-service.cjs');
const { AutoBackupService } = require('./auto-backup-service.cjs');
const { generateApplySummary } = require('../core/theme-apply-summary.cjs');
const themes = require('../shared/themes.json');

function staleResult(message = '应用已取消') {
  return { ok: false, state: 'cancelled', stale: true, code: 'STALE', applied: false, message };
}

function intentGate(studio, targetId, mode) {
  const round5 = studio && studio.round5;
  if (!round5 || typeof round5.beginIntent !== 'function' || typeof round5.intentCurrent !== 'function') {
    const generation=studio.applicationGeneration || 0;
    return { isCurrent: () => !studio.safeMode && !studio.migrationActive && (studio.applicationGeneration || 0)===generation, intent: null };
  }
  const intent = mode === 'capture' ? round5.captureIntent(targetId) : round5.beginIntent(targetId);
  return { intent, isCurrent: () => !studio.safeMode && !studio.migrationActive && round5.intentCurrent(intent) };
}

class StudioService {
  constructor(deps) {
    this.userData = deps.userData;
    this.theme = deps.themeService;
    this.settings = deps.settings;
    this.telemetry = deps.telemetry || null;
    this.assets = deps.assets || new AssetStore(path.join(this.userData, 'assets'));
    this.library = deps.library || new ThemeLibrary(path.join(this.userData, 'theme-library.json'), { assets: this.assets });
    this.preferenceStore = deps.preferenceStore || new PreferencesStore(path.join(this.userData, 'preferences.json'));
    this.preferences = deps.preferences || null;
    this.player = deps.player || new AudioPlayer();
    this.notifications = new NotificationService({
      player: this.player,
      suppressed: () => this.safeMode === true || this.migrationActive === true,
      notifier: deps.notifier || { show() {} },
      local: () => {
        const now = new Date();
        return { hour: now.getHours(), minute: now.getMinutes() };
      }
    });
    this.preview = new PreviewSession({
      apply: job => this._applyJob(job),
      restore: job => this._restoreJob(job),
      show: job => this._showJob(job)
    });
    this.automation = new AutomationService({
      previewing: () => this.previewActive(),
      hostAvailable: async () => {
        const targets = await this.theme.listTargets().catch(() => []);
        return targets.length > 0;
      },
      apply: job => this.applyLibraryTheme(job.themeId, job.source || 'schedule', job.targetId || this.selectedTargetId, job.isCurrent)
    });
    this.shortcuts = new ShortcutService({
      globalShortcut: deps.globalShortcut || { register() { return false; }, unregister() {} },
      onAction: action => { void this.onShortcut(action); }
    });
    this.tray = new TrayService({
      Tray: deps.Tray,
      Menu: deps.Menu,
      icon: deps.icon,
      onAction: action => { void this.onTray(action); }
    });
    this.mini = deps.mini || null;
    this.documentFile = path.join(this.userData, 'appearance.json');
    this.document = null;
    this.documentFrozen = false;
    this._saveQueue = Promise.resolve();
    this.selectedTargetId = null;
    this.quitting = false;
    this.lastPhase = null;
    this.lastTask = null;
    this.externalSound = { present: false, source: null };
    this.onOpenLibrary = deps.onOpenLibrary || (() => {});
    this.onShowWindow = deps.onShowWindow || (() => {});
    this.favoriteCursor = 0;
    this.recentWallpaper = null;
    this.shortcutNotice = null;
    this.round5 = deps.round5 || new Round5Service(this);
    if (this.theme) this.theme.round5 = this.round5;

    // Round 6 组件初始化
    this.safeLaunch = deps.safeLaunch || new SafeLaunchManager(this.userData, { cliSafeMode: deps.cliSafeMode });
    this.safeMode = deps.safeMode === true;
    this.lastRecoveryReport = null;
    this.backup = deps.backup || new BackupService({ userData: this.userData, studioService: this });
    this.performance = deps.performance || new PerformanceService(this, { prefs: this.preferences?.performance, powerMonitor: deps.powerMonitor });
    this.display = deps.displayService || new DisplayService({ screen: deps.screen });
    this.quickSwitcher = deps.quickSwitcher || (deps.BrowserWindow ? new QuickSwitcherController({ BrowserWindow: deps.BrowserWindow, studioService: this, displayService: this.display }) : null);
    this.wallpaperRotation = deps.wallpaperRotation || new WallpaperRotationService(this, { config: this.preferences?.wallpaperRotation });
    this.autoBackup = deps.autoBackup || new AutoBackupService(this, { config: this.preferences?.autoBackup });
    this.applyPreviewCache = new Map();
    if (this.library) {
      this.library.onMajorChange = reason => this.autoBackup?.noteMajorChange(reason);
    }

    if (this.automation) {
      this.automation.onConfigChanged = cfg => {
        if (this.preferences) {
          this.preferences = { ...this.preferences, automation: cfg };
          void this.preferenceStore?.save(this.preferences).catch(() => {});
        }
      };
    }
  }

  async start() {
    await recoverBackup(this.userData);
    if (this.safeLaunch && typeof this.safeLaunch.init === 'function') {
      const safeStatus = await this.safeLaunch.init().catch(() => ({ safeMode: true }));
      if (safeStatus?.safeMode) this.safeMode = true;
    }
    await this.assets.init();
    for(const record of this.assets.records.values()) record.refs=record.refs.filter(ref=>ref!=='editor-session');
    if(!this.assets.frozen) await this.assets._writeIndex();
    await this.library.load();
    const loaded = await this.preferenceStore.load();
    this.preferences = loaded.preferences;
    if (this.preferences?.performance) {
      this.performance.setPrefs(this.preferences.performance);
    }
    this.externalSound = detectExternalCompletionSound(defaultReaders());
    if (this.externalSound.present) this.preferences.externalSoundWarning = true;
    this.document = await this._loadDocument();
    if (!this.document && !this.documentFrozen) {
      const loaded = await this.settings.load();
      const migrated = migrateV1Settings(loaded.settings);
      this.document = await this.saveDocument(migrated.document);
    }
    const repaired = this.library.repairRules(this.preferences.automation.rules);
    if (repaired.changed) {
      this.preferences = { ...this.preferences, automation: { ...this.preferences.automation, rules: repaired.rules } };
      await this.preferenceStore.save(this.preferences).catch(error => {
        this.library.diagnostics.push(error.message);
      });
    }
    await this.round5.start();
    this.display.start();
    this.performance.start();

    if (this.safeMode) {
      // 安全模式：不自动换肤，停止自动规则，通知抑制
      this.invalidateApplications('safe-start');
    } else {
      this.automation.setConfig(this.preferences.automation);
    if(this.safeMode || this.migrationActive) this.automation.stop();
      if (this.preferences.shortcuts.enabled) this.shortcuts.apply(this.preferences);
      if (this.preferences.tray.closeToTray && this.tray.Tray) this.tray.start(this.trayState());
    }
    if (this.preferences?.wallpaperRotation) {
      await this.wallpaperRotation.init(this.preferences.wallpaperRotation).catch(() => {});
    }
    if (this.preferences?.autoBackup) {
      await this.autoBackup.init(this.preferences.autoBackup).catch(() => {});
    }
    return this.snapshot();
  }

  async stop() {
    this.quitting = true;
    if (this.safeLaunch && typeof this.safeLaunch.recordCleanExit === 'function') {
      await this.safeLaunch.recordCleanExit().catch(() => {});
    }
    this.display.stop();
    this.performance.stop();
    this.quickSwitcher?.close();
    this.round5?.stop();
    this.shortcuts.stop();
    this.automation.stop();
    this.wallpaperRotation?.stop?.();
    this.autoBackup?.stop?.();
    this.tray.stop();
    await this.releaseEditorSession();
    if(this.mini?.dispose)this.mini.dispose();else this.mini?.close();
    for (const targetId of [...this.preview.targets.keys()]) {
      await this.preview.cancel(targetId).catch(() => {});
    }
  }

  previewActive() {
    for (const entry of this.preview.targets.values()) {
      if (entry.phase !== 'idle') return true;
    }
    return false;
  }

  decideClose() {
    return decideWindowClose({
      closeToTray: this.preferences?.tray.closeToTray === true,
      quitting: this.quitting,
      previewActive: this.previewActive()
    });
  }

  trayState() {
    const favorites = this.library.data.themes.filter(theme => theme.favorite).map(theme => ({ id: theme.id, name: theme.name }));
    const current = themes.find(theme => theme.id === this.document?.baseThemeId);
    return {
      themeName: this.document?.name || current?.name || '未应用',
      hostLabel: this.theme.status?.state || '未连接',
      favorites,
      automationPaused: !!this.preferences?.automation.pauseReason || !!this.preferences?.automation.pausedUntil,
      safeMode: this.safeMode,
      editorResolved: this.editorResolved || null
    };
  }

  snapshot() {
    const targetId = this.selectedTargetId;
    return {
      document: this.document,
      editorResolved:this.editorResolved || null,
      library: this.library.query({ pageSize: 1000 }),
      favorites: this.library.data.themes.filter(theme => theme.favorite).map(theme => ({ id: theme.id, name: theme.name, updatedAt: theme.updatedAt })),
      preferences: this.preferences,
      preview: this.preview.state(targetId),
      automation: {
        ...this.automation.config,
        systemScheme: this.automation.systemScheme,
        status: this.automation.status,
        next: this.automation.nextText()
      },
      shortcuts: this.shortcuts.status(this.preferences?.shortcuts),
      shortcutNotice: this.shortcutNotice,
      notifications: this.notifications.capability(this.preferences?.notifications, this.externalSound),
      diagnostics: this.library.diagnostics,
      round5: this.round5?.summary?.(targetId) || null,
      round6: {
        safeMode: this.safeMode,
        safeStatus: this.safeLaunch?.status?.() || null,
        recoveryReport: this.lastRecoveryReport,
        performance: this.performance?.summary?.(targetId) || null,
        displays: this.display?.getDisplays?.() || []
      },
      round7: {
        wallpaperRotation: this.wallpaperRotation?.getStatus?.(targetId) || null,
        autoBackup: this.autoBackup?.getStatus?.() || null
      }
    };
  }

  _saveExclusive(fn) {
    const run = this._saveQueue.catch(() => {}).then(fn);
    this._saveQueue = run;
    return run;
  }

  async _loadDocument() {
    let raw = null;
    try {
      raw = await fs.readFile(this.documentFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      this.library?.diagnostics?.push(`无法读取外观配置文件: ${error.message}`);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.documentFrozen = true;
      this.library?.diagnostics?.push('外观配置文件损坏，已保留原文件并停止覆盖');
      return null;
    }
    if (parsed && typeof parsed === 'object') {
      if (parsed.schemaVersion > 1) {
        this.documentFrozen = true;
        this.library?.diagnostics?.push(`未知的未来外观版本 (schemaVersion=${parsed.schemaVersion})，已停止写入`);
        return null;
      }
      try {
        return validateThemeDocument(parsed.document || parsed);
      } catch (error) {
        if (error.code === 'UNSUPPORTED_SCHEMA') {
          this.documentFrozen = true;
          this.library?.diagnostics?.push(error.message);
          return null;
        }
        throw error;
      }
    }
    return null;
  }

  async saveDocument(document) {
    if (this.documentFrozen) {
      throw appError('UNSUPPORTED_SCHEMA', '[UNSUPPORTED_SCHEMA] 外观配置版本过新或已损坏，已停止写入以保留原文件');
    }
    return this._saveExclusive(async () => {
      const validated = validateThemeDocument(document);
      const temp = `${this.documentFile}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(this.documentFile), { recursive: true });
      await fs.writeFile(temp, JSON.stringify({ schemaVersion: 1, document: validated }, null, 2), 'utf8');
      await fs.rename(temp, this.documentFile);
      const previousAsset=this.document?.wallpaper?.assetId;
      if(validated.wallpaper.assetId) await this.assets.addRef(validated.wallpaper.assetId,'appearance');
      if(previousAsset && previousAsset!==validated.wallpaper.assetId) await this.assets.release(previousAsset,'appearance');
      this.document = validated;
      this.autoBackup?.noteMajorChange?.('document-save');
      return validated;
    });
  }

  selectTarget(targetId) {
    this.preview.focus(targetId);
    this.selectedTargetId = targetId;
    if (targetId && this.round5) {
      this.round5.getTargetState(targetId, true);
    }
    return this.preview.state(targetId);
  }

  async _assetUrl(document) {
    if (document.wallpaper?.assetId) {
      try { return await this.assets.dataUrl(document.wallpaper.assetId); } catch { return null; }
    }
    return document.wallpaper?.legacyDataUrl || null;
  }

  async _applyJob(job) {
    if(this.safeMode || this.migrationActive) return {ok:false,code:'SAFE_MODE',applied:false};
    const targetIntent=this.round5?.captureIntent(job.targetId);if(targetIntent)targetIntent.automated=false;
    const previous=job.isCurrent;const generation=this.applicationGeneration || 0;
    job={...job,isCurrent:()=>!this.safeMode&&!this.migrationActive&&(this.applicationGeneration||0)===generation&&(!targetIntent || this.round5.intentCurrent(targetIntent))&&(!previous||previous())};
    if (job.isCurrent && !job.isCurrent()) return { ok: false, stale: true };
    const assetUrl = await this._assetUrl(job.document);
    try {
      const prepared = this.round5
        ? await this.round5.decorateApply(job.document, job.targetId, { assetUrl, source: job.source || 'editor', isCurrent: job.isCurrent, verify: true })
        : { assetUrl, source: job.source || 'editor', isCurrent: job.isCurrent };
      if(!job.isCurrent()) return staleResult();
      const status = await this.theme.applyDocument(job.document, job.targetId, prepared);
      const skipped = status.regions?.skipped || [];
      return { ok: status.state === 'applied', status, code: skipped.length ? 'REGION_UNSUPPORTED' : undefined, message: skipped.length ? `这些区域当前窗口没有：${skipped.join('、')}` : status.message };
    } catch (error) {
      return { ok: false, code: error.code || 'HOST_UNAVAILABLE', message: error.message };
    }
  }

  async _restoreJob(job) {
    try {
      if (!job.baseline || job.baseline.kind === 'original') {
        const status = await this.theme.restore(job.targetId);
        const confirmed = status.state === 'ready' || status.message?.includes('恢复');
        return { ok: status.state !== 'suspended', status, message: status.message };
      }
      if(this.safeMode || this.migrationActive) return {ok:false,code:'SAFE_MODE',message:'安全模式中请使用恢复原貌'};
      const gate=intentGate(this,job.targetId,'capture');
      if(gate.intent)gate.intent.automated=false;
    if(gate.intent) gate.intent.automated=false;
      const assetUrl = await this._assetUrl(job.baseline.document);
      if(!gate.isCurrent()) return staleResult();
      const status = await this.theme.applyDocument(job.baseline.document, job.targetId, { assetUrl, source: 'recovery', isCurrent: () => gate.isCurrent() && (!job.isCurrent || job.isCurrent()) });
      return { ok: status.state === 'applied', status };
    } catch (error) {
      return { ok: false, code: 'HOST_UNAVAILABLE', message: error.message || '恢复待完成，无法确认' };
    }
  }

  async _showJob(job) {
    if(this.safeMode || this.migrationActive) return {ok:false,code:'SAFE_MODE'};
    const gate=intentGate(this,job.targetId,'capture');
    if(gate.intent) gate.intent.automated=false;
    const entry = [...this.theme.targets.values()].find(item => item.id === job.targetId) || null;
    if (!entry?.session) return { ok: false, code: 'HOST_UNAVAILABLE', message: '没有可对比的样式' };
    const document = job.mode === 'baseline' ? job.baseline?.document : job.document;
    if (!document) {
      const cleared = await this.theme.setOwnedCss('', job.targetId, {});
      return cleared.ok ? { ok: true } : { ok: false, message: '无法暂时隐藏试穿' };
    }
    const assetUrl = await this._assetUrl(document);
    const prepared = this.round5
      ? await this.round5.decorateApply(document, job.targetId, { assetUrl, verify: false, isCurrent: job.isCurrent })
      : { assetUrl, resolved: null };
    const built = buildDocumentCSS(document, { assetUrl: prepared.assetUrl, resolved: prepared.resolved });
    return this.theme.setOwnedCss(built.css, job.targetId, {isCurrent:gate.isCurrent});
  }

  async beginPreview(targetId) {
    if(this.safeMode || this.migrationActive) throw appError('SAFE_MODE','安全模式或恢复期间不能试穿');
    const id = targetId || this.selectedTargetId;
    if (!id) throw appError('INVALID_ARGUMENT', '先选择一个窗口');
    const entry = this.theme.targets.get(id);
    const baseline = entry?.session
      ? { kind: 'theme', document: entry.desiredSettings?.schemaVersion ? entry.desiredSettings : (this.document || documentFromLegacy({ schemaVersion: 1, themeId: entry.session.themeId, appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } })) }
      : { kind: 'original', document: null };
    await this._editorQueue;
    if(this.safeMode || this.migrationActive) throw appError('SAFE_MODE','安全模式或恢复期间不能试穿');
    const editorDraft = this.editorSession?.targetId === id ? this.editorSession.document : null;
    const draft = editorDraft || this.document || baseline.document || documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } });
    this.selectedTargetId = id;
    this.round5?.notePreview(id);
    return this.preview.begin(id, baseline, draft);
  }

  updateDraft(document, targetId) {
    const id = targetId || this.selectedTargetId;
    const validated = validateThemeDocument(document);
    this.document = validated;
    return this.preview.updateDraft(id, validated, { source: 'editor' });
  }

  async commitPreview(targetId, options = {}) {
    const id = targetId || this.selectedTargetId;
    const verification = id && this.theme.statusFor ? this.theme.statusFor(id)?.verification : null;
    if (verification?.status === 'partial' && options.allowDegraded !== true) {
      throw appError('VERIFY_PARTIAL', '主题只在部分区域生效。确认接受降级后才能保存。');
    }
    if (verification?.status === 'failed' || verification?.status === 'restore-unconfirmed') {
      throw appError(verification.code || 'VERIFY_FAILED', '主题没有核对通过，没有保存。');
    }
    const state = await this.preview.commit(id, async document => {
      await this.saveDocument(document);
      const appearance = legacyAppearanceFromDocument(document);
      await this.settings.save({
        schemaVersion: 1,
        themeId: document.baseThemeId,
        appearance,
        preset: document.preset === 'custom' ? undefined : document.preset
      });
    });
    this.automation.noteManual(this.document?.baseThemeId);
    this.round5?.hold(id);
    if (id && this.document) {
      this.round5?.setActiveDocument(id, this.document);
    }
    let history = null;
    if (state?.phase === 'idle' && this.document) {
      history = await this.round5?.remember(this.document, { source: 'save', themeId: this.document.id, documentSaved: true, applied: true });
    }
    if (history && history.ok === false) {
      return {
        ...state,
        ok: false,
        applied: true,
        documentSaved: true,
        revisionSaved: false,
        operationId: history.operationId,
        code: history.code || 'SAVE_FAILED',
        message: `试穿已经保存，但版本历史没有写完：${history.message || '写入失败'}`,
        retryable: history.retryable !== false,
        history
      };
    }
    return history ? { ...state, revisionSaved: true, operationId: history.operationId, documentSaved: true } : state;
  }

  compare(targetId, holding) {
    return this.preview.compare(targetId || this.selectedTargetId, !!holding);
  }

  async importWallpaper(buffer) {
    const generation = this.assets.beginImport();
    const result = await this.assets.importImage(buffer, generation);
    if (result.stale || !result.record) return { ok: false, stale: true, code: 'ASSET_INVALID', message: '这张图片已经过期' };
    const dataUrl = await this.assets.dataUrl(result.record.id);
    this.recentWallpaper = { assetId: result.record.id, dataUrl };
    return { ok: true, asset: result.record, dataUrl };
  }

  async palette(assetId) {
    const record = this.assets.get(assetId);
    if (!record) throw appError('ASSET_INVALID', '没有这张壁纸');
    const buffer = await this.assets.read(assetId);
    const decoded = await decodeImage(buffer);
    const colors = extractPalette(decoded);
    return {
      colors,
      hint: colors[0] ? contrastHint('#edf0ea', colors[0].hex, { photographic: true }) : null
    };
  }

  resolveTheme(themeId) {
    const custom = this.library.data.themes.find(theme => theme.id === themeId);
    if (custom) return validateThemeDocument(custom.document);
    if (!themes.some(theme => theme.id === themeId)) throw appError('INVALID_ARGUMENT', '主题不存在');
    const base = themes.find(theme => theme.id === themeId);
    return documentFromLegacy({ schemaVersion: 1, themeId, appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null }, preset: undefined, name: base.name });
  }



  async applyLibraryTheme(themeId, source, targetId, externalCurrent) {
    if(this.safeMode || this.migrationActive) return {ok:false,state:'blocked',code:'SAFE_MODE',applied:false,message:'安全模式或恢复期间不能应用主题'};
    const id = targetId || this.selectedTargetId;
    if (id && this.preview.state(id).phase !== 'idle') {
      return { ok: false, code: 'PREVIEW_CONFLICT', message: '实时试穿还没结束。请先保存或取消。' };
    }
    const automated = source === 'schedule' || source === 'project' || source === 'scene';
    const gate = intentGate(this, id, automated ? 'capture' : 'begin');
    if (!automated && id) this.round5?.hold?.(id);
    const isCurrent = () => gate.isCurrent() && (typeof externalCurrent !== 'function' || externalCurrent());
    if (!isCurrent()) return staleResult();
    let document;
    try { document = this.resolveTheme(themeId); }
    catch (error) { return { ok: false, code: error.code || 'INVALID_ARGUMENT', message: error.message }; }
    try {
      if (!isCurrent()) return staleResult();
      await this.saveDocument(document);
      if (!isCurrent()) return staleResult();
      const assetUrl = await this._assetUrl(document);
      if (!isCurrent()) return staleResult();
      const prepared = this.round5
        ? await this.round5.decorateApply(document, id, { assetUrl, source: source || 'library', isCurrent, verify: true })
        : { assetUrl, source: source || 'library', isCurrent };
      if (!isCurrent() || prepared?.stale) return staleResult();
      const status = await this.theme.applyDocument(document, id, prepared);
      if (!isCurrent() || status?.stale) return { ...staleResult(), status };
      if (status.state !== 'applied') return { ok: false, status, document };
      if (id) this.round5?.setActiveDocument?.(id, document, { keepGeneration: true });
      if (!isCurrent()) return staleResult();
      if (!automated && this.automation?.noteManual) this.automation.noteManual(themeId);
      this.tray?.render?.(this.trayState());
      return { ok: true, status, document };
    } catch (error) {
      if (!isCurrent()) return staleResult();
      return { ok: false, code: error.code || 'HOST_UNAVAILABLE', message: error.message };
    }
  }

  async onShortcut(action) {
    if (action === 'toggleWindow') return this.onShowWindow();
    if (action === 'restoreHost') return this.restoreSelected();
    if (action === 'restoreAll') return this.restoreAll();
    if (action === 'quickSwitcher') return this.quickSwitcher?.toggle();
    const favorites = this.library.data.themes.filter(theme => theme.favorite);
    if (!favorites.length) return { ok: false, message: '没有收藏主题' };
    if (action === 'nextFavorite' || action === 'previousFavorite') {
      const delta = action === 'nextFavorite' ? 1 : -1;
      this.favoriteCursor = (this.favoriteCursor + delta + favorites.length) % favorites.length;
      return this.applyLibraryTheme(favorites[this.favoriteCursor].id, 'shortcut', this.selectedTargetId);
    }
    return { ok: false };
  }

  async onTray(action) {
    if (action === 'show' || action === 'open-library') {
      this.onShowWindow();
      if (action === 'open-library') this.onOpenLibrary();
      return;
    }
    if (action === 'quit') {
      this.quitting = true;
      this.onShowWindow.quit?.();
      return;
    }
    if (action === 'pause') {
      const paused = this.preferences.automation.pauseReason || this.preferences.automation.pausedUntil;
      await this.setAutomation(this.automation.pause(paused ? 'resume' : 'hour'));
      this.tray.render(this.trayState());
      return;
    }
    if (action === 'restore') return this.restoreSelected();
    if (action === 'restore-all') return this.restoreAll();
    if (action === 'switcher') return this.quickSwitcher?.toggle();
    if (action === 'mini') return this.openMini();
    if (action.startsWith('favorite:')) return this.applyLibraryTheme(action.slice('favorite:'.length), 'tray', this.selectedTargetId);
  }

  async restoreSelected(targetId = this.selectedTargetId) {
    const id = targetId || null;
    if (!id) return this.restoreAll();
    if (this.round5) {
      this.round5.hold(id);
      this.round5.bumpGeneration(id);
    }
    const intent=this.round5?.beginIntent(id);
    const gate={isCurrent:()=>!intent||this.round5.intentCurrent(intent,{recovery:true})};
    await this.preview.cancel(id).catch(() => {});
    if (!gate.isCurrent()) return staleResult('恢复已取消');
    const status = await this.theme.restore(id);
    const ok = status.state === 'ready' || status.state === 'detached' || status.message?.includes('恢复');
    if (gate.isCurrent() && ok) this.round5?.clearActiveDocument?.(id, { keepGeneration: true });
    const automation = this.automation.pause('restore');
    await this.setAutomation(automation);

    this.lastRecoveryReport = {
      timestamp: new Date().toISOString(),
      ok,
      allRestored: ok,
      partial: false,
      targets: { [id]: { targetId: id, ok, state: status.state, message: status.message || (ok ? '已恢复' : '恢复失败') } },
      summary: ok ? '当前窗口原貌已恢复' : '当前窗口恢复失败'
    };

    this.onStudioChanged?.();
    return Object.assign(status || {}, {
      recoveryReport: this.lastRecoveryReport,
      ok,
      summary: this.lastRecoveryReport.summary
    });
  }

  _restoreTargetIds() {
    const ids = new Set();
    for (const id of this.preview?.targets?.keys?.() || []) if (id) ids.add(id);
    for (const id of this.theme?.targets?.keys?.() || []) if (id) ids.add(id);
    for (const id of this.round5?.targetStates?.keys?.() || []) if (id) ids.add(id);
    return [...ids];
  }

  async restoreAll() {
    const ids = this._restoreTargetIds();
    this.applicationGeneration=(this.applicationGeneration||0)+1;
    this.performance?.resetAll();
    this.wallpaperRotation?.stopTimer();
    this.theme?.setAutoRestore?.(false);
    // 恢复屏障：使旧在途任务立即作废
    if (this.round5) {
      for (const id of ids) {
        this.round5.hold(id);
        this.round5.bumpGeneration(id);
      }
    }
    const gates = new Map(ids.map(id => {const intent=this.round5?.beginIntent(id);return [id,{isCurrent:()=>!intent||this.round5.intentCurrent(intent,{recovery:true})}];}));
    for (const id of [...(this.preview?.targets?.keys?.() || [])]) await this.preview.cancel(id).catch(() => {});

    const automation = this.automation.pause('restore');
    await this.setAutomation(automation);

    const targetResults = {};
    let status = this.theme?.status || null;

    for (const id of ids) {
      if (!gates.get(id).isCurrent()) {
        targetResults[id] = { targetId: id, ok: false, state: 'cancelled', message: '操作已取消' };
        continue;
      }
      try {
        status = await this.theme.restore(id);
        const ok = status.state === 'ready' || status.state === 'detached' || status.message?.includes('恢复');
        targetResults[id] = {
          targetId: id,
          ok,
          state: status.state,
          message: status.message || (ok ? '已恢复' : '恢复失败')
        };
        if (gates.get(id).isCurrent() && ok) {
          this.round5?.clearActiveDocument?.(id, { keepGeneration: true });
        }
      } catch (err) {
        targetResults[id] = {
          targetId: id,
          ok: false,
          state: 'failed',
          message: err.message || '恢复异常'
        };
      }
    }

    const targetList = Object.values(targetResults);
    const allSuccess = targetList.length > 0 && targetList.every(t => t.ok);
    const partial = !allSuccess && targetList.some(t => t.ok);

    this.lastRecoveryReport = {
      timestamp: new Date().toISOString(),
      ok: allSuccess,
      allRestored: allSuccess,
      partial,
      targets: targetResults,
      summary: allSuccess
        ? '全部窗口原貌已恢复'
        : (partial ? '部分窗口恢复成功，部分失败或已断开' : (targetList.length === 0 ? '当前无受管窗口' : '窗口恢复失败'))
    };

    this.onStudioChanged?.();
    return Object.assign(status || {}, {
      recoveryReport: this.lastRecoveryReport,
      ok: allSuccess,
      summary: this.lastRecoveryReport.summary,
      targets: targetResults
    });
  }

  invalidateApplications(reason = 'barrier') {
    this.applicationGeneration=(this.applicationGeneration || 0)+1;
    this.automation?.stop();
    this.performance?.resetAll();
    for(const id of this._restoreTargetIds()) {this.round5?.hold(id);this.round5?.bumpGeneration(id);this.preview?.suspend(id,reason);}
    this.theme?.setAutoRestore?.(false);
  }

  async enterSafeMode(reason = 'USER_REQUESTED') {
    const alreadySafe=this.safeMode;
    this.safeMode = true;
    if(!alreadySafe)this.autoRestoreBeforeSafe = this.theme?.autoRestoreOnReload === true;
    this.invalidateApplications('safe-mode');
    this.shortcuts.stop();
    if (this.safeLaunch) await this.safeLaunch.enterSafeMode(reason);
    this.onStudioChanged?.();
    return { ok: true, safeMode: true };
  }

  async exitSafeMode() {
    this.safeMode = false;
    if (this.safeLaunch) await this.safeLaunch.exitSafeMode();
    if (this.preferences?.automation && !this.preferences.automation.pauseReason) {
      this.automation.setConfig(this.preferences.automation);
    if(this.safeMode || this.migrationActive) this.automation.stop();
    }
    if(this.preferences?.shortcuts.enabled) this.shortcuts.apply(this.preferences);
    this.theme?.setAutoRestore?.(this.autoRestoreBeforeSafe === true);
    this.onStudioChanged?.();
    return { ok: true, safeMode: false };
  }

  async applyEditorDocument(document, targetId, options = {}) {
    if(this.safeMode || this.migrationActive) return {ok:false,state:'blocked',code:'SAFE_MODE',applied:false,message:'安全模式或恢复期间不能应用主题'};
    const id = targetId || this.selectedTargetId;
    if (id && this.preview.state(id).phase !== 'idle') {
      throw appError('PREVIEW_CONFLICT', '实时试穿还没结束。请先保存或取消。');
    }
    const gate = intentGate(this, id, 'begin');
    if (id) this.round5?.hold?.(id);
    const isCurrent = () => !this.safeMode && !this.migrationActive && gate.isCurrent();
    if (!isCurrent()) return staleResult();
    try {
      const validated = await this.saveDocument(document);
      if (!isCurrent()) return staleResult();
      const assetUrl = await this._assetUrl(validated);
      if (!isCurrent()) return staleResult();
      if (this.automation?.noteManual) this.automation.noteManual(validated.baseThemeId);
      if (!isCurrent()) return staleResult();
      const prepared = this.round5
        ? await this.round5.decorateApply(validated, id, { assetUrl, source: 'editor', isCurrent, verify: true })
        : { assetUrl, source: 'editor', isCurrent };
      if (!isCurrent() || prepared?.stale) return staleResult();
      const result = await this.theme.applyDocument(validated, id, prepared);
      if (!isCurrent() || result?.stale) return { ...staleResult(), status: result };
      if (result.state === 'applied' && id) {
        this.round5?.setActiveDocument?.(id, validated, { keepGeneration: true });
      }
      if (!isCurrent()) return staleResult();
      let history = null;
      if (result.state === 'applied' && (result.verification?.status === 'verified' || (options.allowDegraded === true && result.verification?.status === 'partial'))) {
        history = await this.round5?.remember(validated, {
          source: 'apply',
          themeId: validated.id,
          applied: true,
          documentSaved: true,
          operationId: options.operationId
        });
      }
      this.onStudioChanged?.();
      if (history && history.ok === false) {
        return {
          ...result,
          ok: false,
          applied: result.state === 'applied',
          documentSaved: true,
          revisionSaved: false,
          operationId: history.operationId,
          code: history.code || 'SAVE_FAILED',
          message: `主题已经应用到窗口，但版本历史没有写完：${history.message || '写入失败'}`,
          retryable: history.retryable !== false,
          history
        };
      }
      return history ? { ...result, revisionSaved: true, operationId: history.operationId, documentSaved: true, applied: result.state === 'applied' } : result;
    } catch (error) {
      if (!isCurrent()) return staleResult();
      throw error;
    }
  }

  async cancelPreview(targetId) {
    const id = targetId || this.selectedTargetId;
    const res = await this.preview.cancel(id);
    if (res?.restoredDocument) {
      this.document = validateThemeDocument(res.restoredDocument);
    }
    this.onStudioChanged?.();
    return res;
  }

  async setPreferences(patch) {
    const currentAutomation = (this.safeMode || this.migrationActive) ? (this.preferences?.automation || {}) : (this.automation?.config || this.preferences?.automation || {});
    const automation = patch.automation
      ? { ...currentAutomation, ...patch.automation }
      : currentAutomation;
    const previous=this.preferences;
    let next = validatePreferences({ ...this.preferences, ...patch, automation, schemaVersion: 1 });
    const registered = this.safeMode ? (this.shortcuts.stop(), {ok:true}) : this.shortcuts.apply(next);
    if(!registered.ok) next={...next,shortcuts:previous.shortcuts};
    try{this.preferences=await this.preferenceStore.save(next);}catch(error){if(!this.safeMode)this.shortcuts.apply(previous);throw error;}
    this.performance.setPrefs(this.preferences.performance);
    await this.performance.refresh({explicit:!!patch.performance});
    this.shortcutNotice = registered.ok ? null : `快捷键 ${registered.failed} 没有注册成功，原来的可用绑定仍保留。`;
    if (this.preferences.tray.closeToTray) this.tray.start(this.trayState());
    else this.tray.stop();
    this.automation.setConfig(this.preferences.automation);
    if(this.safeMode || this.migrationActive) this.automation.stop();
    this.tray.render(this.trayState());
    this.onStudioChanged?.();
    if (patch.wallpaperRotation && this.wallpaperRotation) {
      this.wallpaperRotation.setConfig(this.preferences.wallpaperRotation);
    }
    if (patch.autoBackup && this.autoBackup) {
      this.autoBackup.setConfig(this.preferences.autoBackup);
    }
    this.autoBackup?.noteMajorChange?.('preferences-save');
    return this.preferences;
  }

  async setAutomation(automation) {
    this.preferences = await this.preferenceStore.save({ ...this.preferences, automation });
    this.automation.setConfig(this.preferences.automation);
    if(this.safeMode || this.migrationActive) this.automation.stop();
    this.onStudioChanged?.();
    return this.automation.config;
  }

  updateEditorSession(value={}) {
    const run=(this._editorQueue||Promise.resolve()).catch(()=>{}).then(()=>this._updateEditorSession(value));this._editorQueue=run;return run;
  }

  async _updateEditorSession(value={}) {
    this.editorResolved=null;
    const ids=Array.isArray(value.assetIds)?[...new Set(value.assetIds)]:[];
    if(ids.length>300 || ids.some(id=>typeof id!=='string'||!this.assets.get(id))) throw appError('ASSET_INVALID','编辑会话资产无效');
    const previous=this.editorSession?.assetIds || [];
    for(const id of ids) await this.assets.addRef(id,'editor-session');
    for(const id of previous) if(!ids.includes(id)) await this.assets.release(id,'editor-session');
    this.editorSession={assetIds:ids,dirty:value.dirty===true,document:value.document?validateThemeDocument(value.document):null,targetId:value.targetId||this.selectedTargetId};
    return {ok:true};
  }

  async releaseEditorSession() {
    await this._editorQueue?.catch(()=>{});
    for(const id of this.editorSession?.assetIds || []) await this.assets.release(id,'editor-session');
    this.editorSession=null;
  }

  async observeHostContexts() {
    for(const [id,entry] of this.theme?.targets || []) {
      if(!entry.client || !['ready','applied'].includes(entry.state)) continue;
      const generation=entry.generation;
      const observed=await entry.client.evaluate('(() => ({antiFaceHostContext:true,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,focused:document.hasFocus(),visible:document.visibilityState === "visible"}))()').catch(()=>null);
      if(this.theme.targets.get(id)!==entry || entry.generation!==generation || !(observed?.width>0) || !(observed?.height>0)) continue;
      const context=this.display.updateTargetViewport(id,observed,observed.dpr);
      const state=this.round5.getTargetState(id);
      state.isForeground=observed.focused===true;state.visible=observed.visible===true;
      if(context.changed){this.round5.bumpGeneration(id);this.round5.invalidateCapture(id);this.performance.resetTarget(id);for(const [key,s]of this.round5.suggestions || []) if(s.targetId===id) this.round5.suggestions.delete(key);}
      state.viewport={width:observed.width,height:observed.height,dpr:observed.dpr,source:'host',instanceId:state.instanceId};
      this.round5.viewports.set(id,state.viewport);
    }
  }

  observeTelemetry(state) {
    if (!state?.taskState) return;
    const context={isForeground:this.round5?.getTargetState(this.selectedTargetId,false)?.isForeground === true};
    const phase = state.taskState.phase;
    const taskId = state.taskState.taskId;
    const provenance = state.metrics?.provenance;
    if (provenance === 'fixture') return;
    if (state.metrics?.connectionStatus === 'detached' || state.taskState.isStale) {
      this.notifications.handle({ type: 'disconnected', taskId: taskId || 'disconnected' }, this.preferences.notifications);
      return;
    }
    const transitionIdentity=`${state.taskState.runId || taskId}|${state.taskState.transitionId || phase}`;
    if (phase === this.lastPhase && taskId === this.lastTask && transitionIdentity===this.lastTransition) return;
    this.lastTransition=transitionIdentity;
    const previous = this.lastPhase;
    this.lastPhase = phase;
    this.lastTask = taskId;
    if (!taskId || (!previous && !state.taskState.transitionId)) return;
    if (phase === 'failed') {
      this.notifications.handle({ type: 'failed', taskId, runId:state.taskState.runId || taskId, sourceId:'antigravity-transcript', transitionId:state.taskState.transitionId || 'failed', provenance: 'real', confidence:state.taskState.confidence==='verified'?'verified':'unknown' }, this.preferences.notifications, context);
    }
  }

  async openMini() {
    if (!this.mini) return { ok: false, message: '迷你窗不可用' };
    const bounds = await this.mini.show({ bounds: this.preferences.mini.bounds, alwaysOnTop: this.preferences.mini.alwaysOnTop === true });
    return { ok: true, bounds };
  }

  async rollbackPreviewOnly() {
    for (const [targetId, entry] of this.preview.targets) {
      if (entry.phase !== 'idle') await this.preview.cancel(targetId).catch(() => {});
    }
  }

  async previewApply(document, targetId) {
    const id = targetId || this.selectedTargetId;
    const validated = validateThemeDocument(document);
    const targetState = id ? this.round5?.getTargetState(id, false) : null;
    const targetSession = id ? this.theme.targets?.get(id) : null;

    let baselineDoc = null;
    let baselineKind = 'native';

    if (targetState?.lastVerifiedDocument) {
      baselineDoc = targetState.lastVerifiedDocument;
      baselineKind = 'lastVerified';
    } else if (targetState?.activeDocument) {
      baselineDoc = targetState.activeDocument;
      baselineKind = 'session';
    } else if (targetSession?.desiredSettings?.schemaVersion) {
      baselineDoc = targetSession.desiredSettings;
      baselineKind = 'session';
    }

    const context = id && this.round5 ? this.round5.contextFor(id) : {};
    const summary = generateApplySummary({
      requestedDoc: validated,
      baselineDoc,
      targetInfo: {
        targetId: id || 'unknown',
        instanceId: targetState?.instanceId || 'unknown',
        baselineKind
      },
      runtimeContext: context
    });

    if (!this.applyPreviewCache) {
      this.applyPreviewCache = new Map();
    }

    // 清理过期 preview
    const now = Date.now();
    for (const [key, session] of this.applyPreviewCache.entries()) {
      if (session.expiresAt && session.expiresAt < now) {
        this.applyPreviewCache.delete(key);
      }
    }
    // 限制最大缓存条数 20
    if (this.applyPreviewCache.size >= 20) {
      const oldestKey = this.applyPreviewCache.keys().next().value;
      if (oldestKey) this.applyPreviewCache.delete(oldestKey);
    }

    this.applyPreviewCache.set(summary.previewId, {
      previewId: summary.previewId,
      summary,
      targetId: id,
      instanceId: targetState?.instanceId || 'unknown',
      operationGeneration: targetState?.operationGeneration,
      document: validated,
      documentHash: summary.documentHash,
      contextHash: summary.contextHash,
      baselineKind,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000 // 5 分钟 TTL
    });

    return summary;
  }

  async confirmApply(previewId, options = {}) {
    if (!previewId || typeof previewId !== 'string') {
      return { ok: false, code: 'INVALID_PREVIEW_ID', message: '确认令牌无效' };
    }
    const session = this.applyPreviewCache?.get(previewId);
    if (!session) {
      return { ok: false, code: 'EXPIRED_OR_NOT_FOUND', message: '变更摘要已失效或不存在，请重新生成' };
    }
    if (session.expiresAt && session.expiresAt < Date.now()) {
      this.applyPreviewCache.delete(previewId);
      return { ok: false, code: 'EXPIRED', message: '变更摘要已过期，请重新生成' };
    }

    const targetId = session.targetId;
    const targetState = targetId ? this.round5?.getTargetState(targetId, false) : null;
    if (('targetId' in options && options.targetId !== targetId) ||
        (session.instanceId !== 'unknown' && !targetState) ||
        targetState?.operationGeneration !== session.operationGeneration) {
      this.applyPreviewCache.delete(previewId);
      return { ok: false, code: 'TARGET_CHANGED', message: '目标或已应用外观发生变化，请重新生成摘要' };
    }
    if (options.currentDocument && require('../core/theme-diff.cjs').documentHash(validateThemeDocument(options.currentDocument)) !== session.documentHash) {
      this.applyPreviewCache.delete(previewId);
      return { ok: false, code: 'DOCUMENT_CHANGED', message: '草稿已变化，请重新生成摘要' };
    }
    if (targetState && session.instanceId !== 'unknown' && targetState.instanceId !== session.instanceId) {
      this.applyPreviewCache.delete(previewId);
      return { ok: false, code: 'TARGET_INSTANCE_CHANGED', message: '目标窗口实例已变化，请重新获取变更摘要' };
    }

    // 检查运行期环境变化 (视口/轮换/性能)
    const currentContext = targetId && this.round5 ? this.round5.contextFor(targetId) : {};
    const { documentHash } = require('../core/theme-diff.cjs');
    const currentContextHash = documentHash({
      instanceId: targetState?.instanceId || session.instanceId || 'unknown',
      runtimeContext: currentContext
    });
    if (currentContextHash !== session.contextHash) {
      this.applyPreviewCache.delete(previewId);
      return { ok: false, code: 'CONTEXT_CHANGED', message: '运行期环境（视口/轮换/性能）已发生变化，请重新生成摘要' };
    }

    // 消费此会话防止二次提交
    this.applyPreviewCache.delete(previewId);

    // 真正应用经过验证的主题文档
    return await this.applyEditorDocument(session.document, targetId, { allowDegraded: options.allowDegraded === true });
  }
}

module.exports = { StudioService };

