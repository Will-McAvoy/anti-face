const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const themes = require('../shared/themes.json');
const { appError } = require('../core/errors.cjs');
const { assertTargetId, validateThemeDocument } = require('../core/theme-schema.cjs');
const { resolveEffectiveAppearance, visualSnapshot } = require('../core/effective-appearance.cjs');
const { buildVerificationPlan } = require('../core/apply-verification.cjs');
const { identifyProject } = require('../core/project-identity.cjs');
const { partialRestore, documentHash } = require('../core/theme-diff.cjs');
const { DiagnosticsService, redactDiagnostics } = require('./diagnostics-service.cjs');
const { SceneObserver } = require('./scene-observer.cjs');
const { CaptureService } = require('./capture-service.cjs');
const { ProjectBindingsStore } = require('./project-bindings-store.cjs');
const { ThemeRevisionStore } = require('./theme-revision-store.cjs');
const { CatalogService } = require('./catalog-service.cjs');
const { ImageAnalysisService } = require('./image-analysis-service.cjs');

const MASK_ON = `(() => {
  const id = 'anti-face-capture-mask';
  const previous = document.getElementById(id);
  if (previous) previous.remove();
  const selectors = ['[data-testid="conversation-turn"]', '[data-testid="agent-input-box"]'];
  const node = document.createElement('div');
  node.id = id;
  node.setAttribute('data-anti-face-mask', '1');
  node.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:transparent';
  let covered = 0;
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const cover = document.createElement('div');
      cover.setAttribute('data-anti-face-mask-part', '1');
      cover.style.cssText = 'position:fixed;background:#111111;pointer-events:none';
      cover.style.left = box.x + 'px';
      cover.style.top = box.y + 'px';
      cover.style.width = box.width + 'px';
      cover.style.height = box.height + 'px';
      node.appendChild(cover);
      covered += 1;
    }
  }
  node.dataset.covered = String(covered);
  node.dataset.limited = covered ? '0' : '1';
  document.documentElement.appendChild(node);
  return { ok: true, covered, limited: covered === 0 };
})()`;

const MASK_OFF = `(() => {
  const node = document.getElementById('anti-face-capture-mask');
  if (node && node.parentNode) node.parentNode.removeChild(node);
  return true;
})()`;

const REGION_CLIP_SELECTORS = {
  sidebar: '[data-testid="conversation-list-sidebar"]',
  chat: '.h-screen.w-screen.bg-background',
  composer: '[data-testid="agent-input-box"]',
  card: '.bg-card'
};

function measureClipExpression(selector) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { ok: false, message: '区域不存在' };
    const box = element.getBoundingClientRect();
    if (!(box.width >= 2) || !(box.height >= 2)) return { ok: false, message: '区域不可测量' };
    return { ok: true, clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }, dpr: window.devicePixelRatio || 1 };
  })()`;
}

const SCENE_PROBE = `(() => {
  const transcript = !!document.querySelector('[data-testid="conversation-turn"]');
  const conversation = !!document.querySelector('[data-testid="agent-input-box"]');
  return { routeHint: transcript ? 'chat' : (conversation ? 'home' : ''), hasTranscript: transcript, hasConversation: conversation };
})()`;

class Round5Service {
  constructor(studio, deps = {}) {
    this.studio = studio;
    this.revisions = deps.revisions || new ThemeRevisionStore(path.join(studio.userData, 'theme-revisions'), { assets: studio.assets });
    this.bindings = deps.bindings || new ProjectBindingsStore(path.join(studio.userData, 'project-bindings.json'));
    this.catalog = deps.catalog || new CatalogService({ root: deps.catalogRoot || path.join(__dirname, '../assets/catalog'), remoteBaseUrl: null });
    this.diagnostics = deps.diagnostics || new DiagnosticsService({ theme: studio.theme });
    this.captures = deps.captures || new CaptureService();
    this.imageAnalysis = deps.imageAnalysis || new ImageAnalysisService({ assets: studio.assets });
    this.scenes = deps.scenes || new SceneObserver({
      onScene: (targetId, scene) => { void this.onAutoScene(targetId, scene); }
    });
    this.manualHolds = new Map();
    this.frozenScene = new Map();
    this.viewports = new Map();
    this.identified = new Map();
    this.pixelCache = new Map();
    this.jobs = new Map();
    this.cancelled = new Set();
    this.bindingError = null;
    this.lastSceneApply = new Map();
    this.targetStates = new Map();
    this.suggestions = new Map();
    this.workerTimeoutMs = deps.workerTimeoutMs ?? 15000;
    this.maxWorkers = deps.maxWorkers ?? 2;
    this.stopping = false;
    this.writeChains = new Map();
    this.pendingSaves = new Map();
  }

  async start() {
    await this.revisions.load();
    try {
      await this.bindings.load();
    } catch (error) {
      this.bindingError = error.message;
    }
    if (this.studio.automation) {
      this.studio.automation.contextDecision = targetId => this.contextDecision(targetId);
    }
  }

  stop() {
    this.stopping = true;
    this.scenes.stop();
    this.imageAnalysis?.stop?.();
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      if (typeof job.abort === 'function') job.abort('STOPPED', '程序退出');
      if (job.worker) {
        try { void job.worker.terminate(); } catch {}
      }
    }
    this.jobs.clear();
  }

  getTargetState(targetId, create = true) {
    if (!targetId) return null;
    let state = this.targetStates.get(targetId);
    if (!state && create) {
      state = {
        targetId,
        instanceId: randomUUID(),
        targetEpoch: 1,
        operationGeneration: 1,
        sceneSerial: 0,
        activeDocument: null,
        lastVerifiedDocument: null,
        lastVerifiedAppearance: null,
        lastVerifiedDocumentHash: null,
        verificationStatus: 'unknown',
        scene: 'unknown',
        viewport: null,
        projectIdentity: null,
        manualHold: this.manualHolds.has(targetId),
        disposed: false
      };
      this.targetStates.set(targetId, state);
    }
    return state || null;
  }

  bumpGeneration(targetId) {
    const state = this.getTargetState(targetId);
    if (state) {
      state.operationGeneration += 1;
      return state.operationGeneration;
    }
    return 1;
  }

  // beginIntent is the user-operation token: it invalidates older intents, then
  // the caller may hold() without a second bump. captureIntent is for automation
  // and must not bump. setActiveDocument bumps unless keepGeneration is set,
  // so a scene token taken before it dies, while the same apply can commit.
  beginIntent(targetId) {
    const id = assertTargetId(targetId);
    if (!id) return { targetId: null, instanceId: null, generation: 0, requestId: randomUUID(), unbound: true };
    const state = this.getTargetState(id, true);
    state.operationGeneration += 1;
    return {
      targetId: id,
      instanceId: state.instanceId,
      generation: state.operationGeneration,
      requestId: randomUUID()
    };
  }

  captureIntent(targetId) {
    const id = assertTargetId(targetId);
    if (!id) return { targetId: null, instanceId: null, generation: 0, requestId: randomUUID(), unbound: true, automated: true };
    const state = this.getTargetState(id, true);
    return {
      targetId: id,
      instanceId: state.instanceId,
      generation: state.operationGeneration,
      requestId: randomUUID(),
      automated: true
    };
  }

  intentCurrent(intent, options = {}) {
    if(!options.recovery && (this.studio.safeMode || this.studio.migrationActive)) return false;
    if (!intent || intent.unbound) return true;
    const current = this.targetStates.get(intent.targetId);
    if (!current || current.disposed) return false;
    if (current.instanceId !== intent.instanceId) return false;
    if (current.operationGeneration !== intent.generation) return false;
    if (intent.automated && (current.manualHold || this.manualHolds.has(intent.targetId))) return false;
    return true;
  }

  setActiveDocument(targetId, document, options = {}) {
    const id = assertTargetId(targetId);
    if (!id) return;
    const state = this.getTargetState(id);
    state.activeDocument = document ? validateThemeDocument(document) : null;
    if(document) state.performanceHold=false;
    if (!options.keepGeneration) state.operationGeneration += 1;
  }

  clearActiveDocument(targetId, options = {}) {
    const id = assertTargetId(targetId);
    if (!id) return;
    const state = this.getTargetState(id);
    state.activeDocument = null;
    if (!options.keepGeneration) state.operationGeneration += 1;
  }

  dropTarget(targetId) {
    const id = assertTargetId(targetId);
    if (!id) return;
    const state = this.targetStates.get(id);
    if (state) {
      state.disposed = true;
      state.operationGeneration += 1;
      state.activeDocument = null;
    }
    this.targetStates.delete(id);
    this.manualHolds.delete(id);
    this.lastSceneApply.delete(id);
    this.captures?.clear?.(id);
    this.identified?.delete?.(`target:${id}`);
    this.viewports?.delete?.(id);
    this.frozenScene?.delete?.(id);
    this.scenes?.unwatch?.(id);
    if (this.suggestions) {
      for (const [key, value] of this.suggestions) {
        if (value?.targetId === id) this.suggestions.delete(key);
      }
    }
  }

  replaceTarget(targetId) {
    this.dropTarget(targetId);
    return this.getTargetState(targetId, true);
  }

  noteNavigation(targetId) {
    const state = this.getTargetState(targetId, false);
    if (!state) return;
    state.operationGeneration += 1;
    state.viewport = null;
    this.viewports.delete(targetId);
    this.lastSceneApply.delete(targetId);
  }

  _sceneToken(targetId, state) {
    return {
      instanceId: state?.instanceId || null,
      stateObject: state,
      epoch: state?.targetEpoch ?? 1,
      generation: state?.operationGeneration ?? 1,
      sceneSerial: state?.sceneSerial ?? 0,
      targetId
    };
  }

  _sceneCurrent(token) {
    if(this.studio.safeMode || this.studio.migrationActive) return false;
    const cur = this.targetStates.get(token.targetId);
    if (!cur || cur.disposed) return false;
    if (token.instanceId) {
      if (cur.instanceId !== token.instanceId) return false;
    } else if (cur !== token.stateObject) {
      return false;
    }
    return cur.targetEpoch === token.epoch
      && cur.operationGeneration === token.generation
      && cur.sceneSerial === token.sceneSerial
      && !cur.manualHold
      && !this.manualHolds.has(token.targetId)
      && this.studio.preview.state(token.targetId).phase === 'idle';
  }

  summary(targetId = this.studio.selectedTargetId) {
    const project = this.projectDecision(targetId);
    const state = this.getTargetState(targetId, false);
    return {
      remote: this.catalog.remoteBaseUrl ? '远程源已配置' : '远程源未配置',
      catalogLabel: '内置精选',
      revisionFrozen: this.revisions.frozen === true,
      bindingFrozen: this.bindings.frozen === true,
      bindingError: this.bindingError,
      hold: targetId ? (state?.manualHold || this.manualHolds.has(targetId)) : false,
      scene: targetId ? this.scenes.current(targetId) : 'unknown',
      project: project ? {
        reliable: project.reliable === true,
        dangling: project.dangling === true,
        displayHint: project.displayHint || null,
        themeId: project.themeId || null,
        sessionOnly: project.sessionOnly === true
      } : null
    };
  }

  hold(targetId) {
    const id = assertTargetId(targetId);
    if (id) {
      this.manualHolds.set(id, true);
      const state = this.getTargetState(id);
      state.manualHold = true;
      state.performanceHold=true;
    }
  }

  // Clears the in-flight manual guard without bumping generation, so a finished
  // user operation does not permanently block a later schedule or project apply.
  releaseHold(targetId) {
    const id = assertTargetId(targetId);
    if (!id) return;
    this.manualHolds.delete(id);
    const state = this.getTargetState(id, false);
    if (state) state.manualHold = false;
  }

  resume(targetId) {
    const id = assertTargetId(targetId);
    if (id) {
      this.manualHolds.delete(id);
      const state = this.getTargetState(id);
      state.manualHold = false;
      state.operationGeneration += 1;
    }
    return { ok: true, hold: false };
  }

  contextDecision(targetId) {
    const id = targetId || this.studio.selectedTargetId;
    const preview = id ? this.studio.preview.state(id) : { phase: 'idle' };
    const state = this.getTargetState(id, false);
    return {
      manualHold: !!(id && (state?.manualHold || this.manualHolds.has(id))),
      previewing: preview.phase !== 'idle',
      project: this.projectDecision(id)
    };
  }

  themeExists(themeId) {
    if (themes.some(theme => theme.id === themeId)) return true;
    return this.studio.library?.has?.(themeId) === true;
  }

  projectDecision(targetId) {
    if (!targetId) return null;
    const session = this.bindings.session(targetId);
    if (session) {
      const dangling = !this.themeExists(session.themeId);
      return {
        reliable: true,
        enabled: true,
        sessionOnly: true,
        dangling,
        themeId: session.themeId,
        displayHint: session.label || '当前窗口',
        bindingId: null
      };
    }
    const known = this.identified.get(`target:${targetId}`) || null;
    if (!known?.reliable) return null;
    const binding = this.bindings.find(known.projectKey);
    if (!binding || binding.enabled === false) return null;
    return {
      reliable: true,
      enabled: true,
      dangling: !this.themeExists(binding.themeId),
      themeId: binding.themeId,
      bindingId: binding.bindingId,
      displayHint: binding.displayHint,
      projectKey: binding.projectKey
    };
  }

  contextFor(targetId, extras = {}) {
    const preview = targetId ? this.studio.preview.state(targetId) : { phase: 'idle' };
    const live = extras.scene || (targetId ? this.scenes.current(targetId) : 'unknown');
    const hostViewport = targetId ? (this.getTargetState(targetId, false)?.viewport || this.viewports.get(targetId) || null) : null;
    const contextKind = extras.contextKind || (preview.phase !== 'idle' ? 'try-on' : 'host');
    const previewViewport = contextKind === 'preview' ? (extras.viewport || null) : null;
    const viewport = contextKind === 'preview'
      ? previewViewport
      : (extras.viewport || hostViewport || null);

    const perfState = (extras.performanceTier || extras.performanceOverrides)
      ? { tier: extras.performanceTier, overrides: extras.performanceOverrides }
      : (this.studio?.performance && targetId ? this.studio.performance.getTargetState(targetId) : null);

    const rotationOverride = extras.wallpaperOverride || (this.studio?.wallpaperRotation?.getOverride?.(targetId) || null);
    const rotationActive = !!(rotationOverride || (this.studio?.wallpaperRotation?.config?.enabled && this.studio?.wallpaperRotation?.candidates?.length > 0));

    return {
      contextKind,
      scene: live === 'home' || live === 'chat' ? live : null,
      previewing: preview.phase !== 'idle',
      previewScene: extras.previewScene || null,
      frozenScene: targetId ? (this.frozenScene.get(targetId) || null) : null,
      viewport,
      viewportKind: contextKind === 'preview' ? 'preview' : (viewport ? 'host' : 'unspecified'),
      hostViewport,
      previewViewport,
      performanceTier: perfState?.tier || 'normal',
      performanceOverrides: perfState?.overrides || null,
      wallpaperOverride: rotationOverride || null,
      rotationActive
    };
  }

  notePreview(targetId) {
    const scene = this.scenes.current(targetId);
    if (scene === 'home' || scene === 'chat') this.frozenScene.set(targetId, scene);
  }

  async prepareImageAnalysis(document) {
    if (!document) return null;
    if (!this.imageAnalysis) {
      this.imageAnalysis = new ImageAnalysisService({ assets: this.studio?.assets, createWorker: this._createWorker });
    }
    return this.imageAnalysis.prepare(document);
  }

  analysisFor(document) {
    const wp = document?.wallpaper;
    if (!wp?.assetId && !wp?.legacyDataUrl) return null;
    if (!this.imageAnalysis && this.studio?.assets) {
      this.imageAnalysis = new ImageAnalysisService({ assets: this.studio.assets, createWorker: this._createWorker });
    }
    const fromAnalysis = this.imageAnalysis?.analysisFor?.(document);
    if (fromAnalysis?.image?.data) return fromAnalysis;
    if (fromAnalysis?.error) return fromAnalysis;
    return null;
  }

  async decorateApply(document, targetId, meta = {}) {
    const validated = validateThemeDocument(document);
    if (meta.isCurrent && !meta.isCurrent()) return { stale: true, isCurrent: meta.isCurrent };
    const context = this.contextFor(targetId, meta.context || {});
    if (meta.context?.wallpaperOverride) {
      context.wallpaperOverride = meta.context.wallpaperOverride;
      context.rotationActive = true;
    }

    let docForAnalysis = validated;
    const targetOverride = context.wallpaperOverride;
    if (targetOverride?.assetId && validated.wallpaper?.assetId !== targetOverride.assetId) {
      docForAnalysis = {
        ...validated,
        wallpaper: {
          ...validated.wallpaper,
          assetId: targetOverride.assetId,
          legacyDataUrl: null
        }
      };
    }

    await this.prepareImageAnalysis(docForAnalysis).catch(() => {});
    if (meta.isCurrent && !meta.isCurrent()) return { stale: true, isCurrent: meta.isCurrent };
    const effective = resolveEffectiveAppearance(validated, context, this.analysisFor(docForAnalysis));

    const effectiveWallpaperDoc = (effective.resolved?.wallpaper?.assetId)
      ? { wallpaper: { assetId: effective.resolved.wallpaper.assetId } }
      : (effective.resolved || validated);
    const assetUrl = (targetOverride?.assetId && this.studio?._assetUrl)
      ? await this.studio._assetUrl(effectiveWallpaperDoc)
      : (meta.assetUrl || await this.studio._assetUrl(effectiveWallpaperDoc));

    if (meta.isCurrent && !meta.isCurrent()) return { stale: true, isCurrent: meta.isCurrent };
    const wallpaper = !!(assetUrl || effective.resolved?.wallpaper?.assetId || validated.wallpaper?.assetId || validated.wallpaper?.legacyDataUrl);
    const verify = meta.verify !== false;
    const plan = verify ? buildVerificationPlan(effective.resolved, { wallpaper }) : null;
    return {
      assetUrl,
      source: meta.source || 'editor',
      isCurrent: meta.isCurrent,
      resolved: effective.resolved,
      plan,
      verify,
      effective
    };
  }

  async explain(document, targetId, extras = {}) {
    const validated = validateThemeDocument(document);
    const state = targetId ? this.getTargetState(targetId, false) : null;
    if (extras.viewport && extras.contextKind !== 'preview' && targetId) {
      const hostViewport = {
        width: extras.viewport.width,
        height: extras.viewport.height,
        dpr: extras.viewport.dpr || 1,
        source: 'host',
        instanceId: state?.instanceId || null
      };
      this.viewports.set(targetId, hostViewport);
      if (state) state.viewport = hostViewport;
    }
    const contextVersion=this.studio.display?.getTargetContext(targetId)?.version;
    const generation=state?.operationGeneration;
    const prepared = await this.prepareImageAnalysis(validated).catch(error => ({ error: { code: 'IMAGE_CORRUPT', message: error.message } }));
    if(this.studio.display?.getTargetContext(targetId)?.version!==contextVersion || (state && state.operationGeneration!==generation)) throw appError('STALE_SUGGESTION','宿主视口或目标已变化，请重新分析');
    const analysis = prepared?.error ? null : (prepared?.image ? prepared : this.analysisFor(validated));
    const context = this.contextFor(targetId, extras);
    const effective = resolveEffectiveAppearance(validated, context, analysis);
    if (prepared?.error && effective.readability) {
      effective.warnings.push({ code: prepared.error.code, message: prepared.error.message, retryable: prepared.error.code !== 'UNSUPPORTED_IMAGE' });
    }
    const suggestionId = randomUUID();
    const sceneName = typeof effective.scene === 'string' ? effective.scene : (effective.scene?.scene || null);
    const suggestion = {
      suggestionId,
      targetId: targetId || null,
      targetInstance: state?.instanceId || null,
      documentHash: effective.documentHash,
      scene: sceneName,
      viewport: context.viewport,
      viewportKind: context.viewportKind,
      analysisId: analysis?.analysisId || analysis?.hash || null,
      adjustments: effective.adjustments,
      readability: effective.readability
    };
    if (this.suggestions) {
      this.suggestions.set(suggestionId, suggestion);
      if (this.suggestions.size > 32) {
        const oldest = this.suggestions.keys().next().value;
        this.suggestions.delete(oldest);
      }
    }
    return {
      documentHash: effective.documentHash,
      effectiveHash: effective.effectiveHash,
      scene: sceneName,
      sceneSource: effective.scene?.source || null,
      adjustments: effective.adjustments,
      warnings: effective.warnings,
      effectiveVisual: visualSnapshot(effective.resolved),
      readability: effective.readability ? {
        reached: effective.readability.reached,
        measurement: effective.readability.measurement,
        projected: effective.readability.projected,
        adjustments: effective.readability.adjustments,
        warnings: effective.readability.warnings,
        regions: effective.readability.regions || null
      } : null,
      provenance: effective.provenance,
      suggestionId,
      suggestion,
      wallpaper: {
        focusX: effective.resolved.wallpaper.focusX,
        focusY: effective.resolved.wallpaper.focusY,
        maskStrength: effective.resolved.wallpaper.maskStrength
      }
    };
  }

  adoptReadability(document, fields, targetId, suggestionId) {
    const validated = validateThemeDocument(document);
    let adjustments;
    if (suggestionId) {
      const suggestion = this.suggestions?.get(suggestionId);
      if (!suggestion) throw appError('STALE_SUGGESTION', '这条建议已经失效，请重新分析');
      const state = targetId ? this.getTargetState(targetId, false) : null;
      if (suggestion.documentHash !== documentHash(validated)) throw appError('STALE_SUGGESTION', '文档已变化，请重新分析后再采用');
      if (suggestion.targetId && targetId && suggestion.targetId !== targetId) throw appError('STALE_SUGGESTION', '建议属于另一个窗口');
      if (suggestion.targetInstance && state?.instanceId && suggestion.targetInstance !== state.instanceId) throw appError('STALE_SUGGESTION', '窗口已重连，请重新分析');
      adjustments = suggestion.adjustments || [];
    } else {
      const hostViewport = targetId ? this.viewports.get(targetId) : null;
      const explained = resolveEffectiveAppearance(validated, {
        viewport: hostViewport || { width: 1280, height: 800 },
        scene: null,
        contextKind: hostViewport ? 'host' : 'preview',
        viewportKind: hostViewport ? 'host' : 'unspecified'
      }, this.analysisFor(validated));
      adjustments = explained.adjustments;
    }
    const wanted = new Set(Array.isArray(fields) && fields.length ? fields : adjustments.map(item => item.field));
    const next = JSON.parse(JSON.stringify(validated));
    for (const item of adjustments) {
      if (!wanted.has(item.field) || item.to == null) continue;
      if (item.field === 'wallpaper.maskStrength') next.wallpaper.maskStrength = item.to;
      if (item.field === 'regions.chat.opacity') {
        next.regions.chat = { ...(next.regions.chat || {}), opacity: item.to };
      }
      if (item.field === 'regions.sidebar.opacity') {
        next.regions.sidebar = { ...(next.regions.sidebar || {}), opacity: item.to };
      }
      if (item.field === 'regions.composer.opacity') {
        next.regions.composer = { ...(next.regions.composer || {}), opacity: item.to };
      }
      if (item.field === 'regions.card.opacity') {
        next.regions.card = { ...(next.regions.card || {}), opacity: item.to };
      }
      if (item.field === 'colors.foreground') next.colors.foreground = item.to;
    }
    return validateThemeDocument(next);
  }

  async remember(document, meta = {}) {
    if (!this.pendingSaves) this.pendingSaves = new Map();
    const operationId = meta.operationId || randomUUID();
    const payload = {
      document,
      themeId: meta.themeId || document.id,
      source: meta.source || 'save',
      parentRevisionId: meta.parentRevisionId || null,
      restoredFromRevisionId: meta.restoredFromRevisionId || null,
      operationId
    };
    this.pendingSaves.set(operationId, { document, meta: { ...meta, operationId } });
    try {
      const recorded = await this.revisions.record(payload);
      this.pendingSaves.delete(operationId);
      return {
        ok: true,
        operationId,
        applied: meta.applied === true,
        documentSaved: meta.documentSaved !== false,
        revisionSaved: true,
        revisionId: recorded.revision?.revisionId || null,
        rollback: 'not-required',
        retryable: false,
        ...recorded
      };
    } catch (error) {
      return {
        ok: false,
        operationId,
        applied: meta.applied === true,
        documentSaved: meta.documentSaved === true,
        revisionSaved: false,
        code: error.code || 'SAVE_FAILED',
        message: error.message || '版本没有写入',
        retryable: error.retryable !== false,
        rollback: meta.rollback || 'not-required'
      };
    }
  }

  async retryRemember(operationId) {
    const pending = this.pendingSaves.get(operationId);
    if (!pending) return { ok: false, operationId, revisionSaved: false, code: 'SAVE_FAILED', message: '没有可重试的历史写入', retryable: false };
    return this.remember(pending.document, pending.meta);
  }

  async inspect(targetId) {
    const id = assertTargetId(targetId);
    const entry = id ? this.studio.theme.verifiedEntry?.(id) || this.studio.theme.targets?.get?.(id) : null;
    let probe = entry?.probe || null;
    if (entry?.client?.evaluate) {
      probe = await entry.client.evaluate(SCENE_PROBE).catch(() => probe);
    }
    const project = id ? this.identified.get(`target:${id}`) : null;
    return redactDiagnostics(await this.diagnostics.inspect(id, {
      probe,
      project: project ? { workspaceId: project.workspaceId, projectPath: project.normalizedPath } : {},
      captureSupported: !!(entry?.client?.captureScreenshot)
    }));
  }

  exportDiagnostics(targetId) {
    return this.diagnostics.exportable(assertTargetId(targetId));
  }

  watchScene(targetId) {
    const id = assertTargetId(targetId);
    if (!id) throw appError('INVALID_ARGUMENT', '先选择一个窗口');
    this.scenes.watch(id, async () => {
      const entry = this.studio.theme.targets?.get?.(id);
      if (!entry?.client?.evaluate) return entry?.probe || {};
      return entry.client.evaluate(SCENE_PROBE).catch(() => entry.probe || {});
    });
    return { scene: this.scenes.current(id) };
  }

  unwatchScene(targetId) {
    this.scenes.unwatch(assertTargetId(targetId));
    return { ok: true };
  }

  async pollScene(targetId) {
    const id = assertTargetId(targetId);
    if (!id) throw appError('INVALID_ARGUMENT', '先选择一个窗口');
    const result = await this.scenes.poll(id);
    return { scene: typeof result === 'string' ? result : (result?.scene || 'unknown') };
  }

  async onAutoScene(targetId, scene) {
    const state = this.getTargetState(targetId, true);
    const entry = this.studio.theme?.targets?.get?.(targetId);
    const document = state?.activeDocument || entry?.desiredSettings || null;
    if (!document || document.sceneAppearance?.mode !== 'auto') return;
    if (state.disposed || this.studio.preview.state(targetId).phase !== 'idle') return;
    if (state.manualHold || this.manualHolds.has(targetId)) return;
    state.scene = scene === 'home' || scene === 'chat' ? scene : state.scene;
    state.sceneSerial = (state.sceneSerial || 0) + 1;
    const token = this._sceneToken(targetId, state);
    const isCurrent = () => this._sceneCurrent(token);
    if (!isCurrent()) return;
    if (!this.writeChains) this.writeChains = new Map();
    const previous = this.writeChains.get(targetId) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      if (!isCurrent()) return;
      try {
        const decorated = await this.decorateApply(document, targetId, { source: 'scene', verify: true, context: { scene }, isCurrent });
        if (!isCurrent() || decorated?.stale || !decorated?.effective) return;
        if (this.lastSceneApply.get(targetId) === decorated.effective.effectiveHash) return;
        const status = await this.studio.theme.applyDocument(document, targetId, decorated).catch(() => null);
        if (!isCurrent()) return;
        if (status?.state === 'applied') {
          this.lastSceneApply.set(targetId, decorated.effective.effectiveHash);
          const current = this.targetStates.get(targetId);
          if (current && current.instanceId === token.instanceId) {
            current.lastVerifiedAppearance = decorated.effective;
            current.lastVerifiedDocument = document;
            current.lastVerifiedDocumentHash = decorated.effective.documentHash || decorated.effective.effectiveHash;
            current.verificationStatus = status.verification?.status || 'verified';
          }
        }
      } catch {
        // Auto scene is a background task; a later decision supersedes this one.
      }
    });
    this.writeChains.set(targetId, run);
    return run;
  }

  async capture(request) {
    const id = assertTargetId(request?.targetId);
    const entry = this.studio.theme.verifiedEntry?.(id);
    if (!entry?.client?.captureScreenshot) {
      return { ok: false, code: 'CAPTURE_UNAVAILABLE', message: '当前窗口不能截图', retryable: true };
    }
    await this.studio.observeHostContexts?.();
    const generation = entry.generation;
    const contextVersion=this.studio.display?.getTargetContext(id)?.version;
    const state = this.getTargetState(id, false);
    const viewport = state?.viewport || this.viewports.get(id) || entry.probe?.viewport || request.viewport || null;
    let clip = request.clip || null;
    if (!clip && request.region && request.region !== 'full') {
      const selector = REGION_CLIP_SELECTORS[request.region];
      if (!selector || !entry.client.evaluate) {
        return { ok: false, code: 'REGION_UNMEASURED', message: '这个区域当前窗口量不到', retryable: false };
      }
      const measured = await entry.client.evaluate(measureClipExpression(selector)).catch(() => null);
      if (!measured?.ok || !measured.clip) {
        return { ok: false, code: 'REGION_UNMEASURED', message: measured?.message || '这个区域当前窗口量不到', retryable: true };
      }
      clip = measured.clip;
    }
    const phase = request.phase === 'after' ? 'after' : 'before';
    const groupId = request.groupId || (phase === 'after' ? this.captures.latestOpenBefore(id) : null) || randomUUID();
    return this.captures.take({
      client: {
        captureScreenshot: options => entry.client.captureScreenshot(options),
        mask: async enabled => entry.client.evaluate(enabled ? MASK_ON : MASK_OFF)
      },
      targetId: id,
      phase,
      groupId,
      clip,
      viewport,
      dpr: viewport?.dpr || request.dpr || null,
      navigationId: request.navigationId || entry.identity?.url || null,
      instanceId: state?.instanceId || null,
      hideSensitive: request.hideSensitive === true,
      generation,
      documentHash: request.documentHash || null,
      isCurrent: () => entry.generation === generation && this.studio.theme.targets.get(id) === entry && this.studio.display?.getTargetContext(id)?.version === contextVersion
    });
  }

  captureList(targetId) {
    return this.captures.list(assertTargetId(targetId));
  }

  captureImage(groupId, phase) {
    const image = this.captures.image(groupId, phase === 'after' ? 'after' : 'before');
    if (!image?.png) return null;
    return { width: image.width, height: image.height, bytes: image.bytes, dataUrl: `data:image/png;base64,${image.png.toString('base64')}` };
  }

  clearCapture(targetId) {
    this.captures.clear(assertTargetId(targetId));
    return { ok: true };
  }

  invalidateCapture(targetId) {
    const id = assertTargetId(targetId);
    if (id) this.captures.invalidate(id);
    else this.captures.invalidate(null);
    return { ok: true };
  }

  async generate(assetId, locks, requestId) {
    if (typeof assetId !== 'string') throw appError('ASSET_INVALID', '没有这张图片');
    const id = requestId || randomUUID();
    if (this.stopping) return { ok: false, code: 'STOPPED', message: '程序正在退出', requestId: id };
    if (this.cancelled.has(id)) {
      this.cancelled.delete(id);
      return { ok: false, code: 'CANCELLED', message: '生成已取消', requestId: id };
    }
    if (this.jobs.has(id)) return { ok: false, code: 'REQUEST_CONFLICT', message: '这个生成请求还在进行', requestId: id };
    const active = [...this.jobs.values()].filter(job => !job.cancelled).length;
    if (active >= (this.maxWorkers ?? 2)) return { ok: false, code: 'BUSY', message: '生成队列已满', requestId: id, retryable: true };
    const timeoutMs = this.workerTimeoutMs ?? 15000;
    const token = { id, cancelled: false, worker: null, timer: null };
    this.jobs.set(id, token);

    try {
      let buffer;
      try {
        buffer = await this.studio.assets.read(assetId);
      } catch (err) {
        return { ok: false, code: 'ASSET_INVALID', message: err.message || '没有这张图片', requestId: id };
      }
      if (this.stopping || token.cancelled || this.cancelled.has(id)) {
        return { ok: false, code: this.stopping ? 'STOPPED' : 'CANCELLED', message: this.stopping ? '程序正在退出' : '生成已取消', requestId: id };
      }
      const contentHash = createHash('sha256').update(buffer).digest('hex');

      const packedWorker = path.join(__dirname, 'workers/image-analysis.cjs');
      const unpackedWorker = packedWorker.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      const workerPath = require('node:fs').existsSync(unpackedWorker) ? unpackedWorker : packedWorker;

      const worker = typeof this._createWorker === 'function'
        ? this._createWorker(workerPath)
        : new Worker(workerPath);
      token.worker = worker;

      const message = await new Promise((resolve, reject) => {
        let settled = false;
        function finish(err, val) {
          if (settled) return;
          settled = true;
          if (token.timer) { clearTimeout(token.timer); token.timer = null; }
          worker.removeListener('message', onMsg);
          worker.removeListener('error', onErr);
          worker.removeListener('exit', onExit);
          if (err) reject(err);
          else resolve(val);
        }

        token.abort = (code = 'CANCELLED', msg = '生成已取消') => {
          const err = new Error(msg);
          err.code = code;
          finish(err);
          try { void worker.terminate(); } catch {}
        };

        function onMsg(val) { finish(null, val); }
        function onErr(err) { finish(err); }
        function onExit(code) {
          if (!settled) {
            const err = new Error(`Worker exited with code ${code}`);
            err.code = 'WORKER_EXITED';
            finish(err);
          }
        }

        worker.on('message', onMsg);
        worker.on('error', onErr);
        worker.on('exit', onExit);

        token.timer = setTimeout(() => {
          const err = new Error('生成超时');
          err.code = 'TIMEOUT';
          finish(err);
          try { void worker.terminate(); } catch {}
        }, timeoutMs);

        try {
          worker.postMessage({ bytes: buffer, locks: locks || {}, coreRoot: path.join(__dirname, '../core') });
        } catch (postErr) {
          finish(postErr);
        }
      });

      if (token.cancelled || this.cancelled.has(id)) {
        return { ok: false, code: 'CANCELLED', message: '生成已取消', requestId: id };
      }
      if (!message?.ok) {
        return { ok: false, code: message?.code || 'ASSET_INVALID', message: message?.message || '图片分析失败', requestId: id };
      }

      return {
        ok: true,
        requestId: id,
        contentHash,
        lockSnapshot: { ...(locks || {}) },
        schemes: message.themes?.schemes || [],
        warnings: message.themes?.warnings || [],
        approximation: true
      };
    } catch (error) {
      return {
        ok: false,
        code: error.code || 'GENERATION_FAILED',
        message: error.message || '生成失败',
        requestId: id
      };
    } finally {
      if (token.timer) clearTimeout(token.timer);
      if (token.worker) {
        try { await token.worker.terminate().catch(() => {}); } catch {}
      }
      if (this.jobs.get(id) === token) this.jobs.delete(id);
      this.cancelled.delete(id);
    }
  }

  cancelGenerate(requestId) {
    if (typeof requestId !== 'string' || !requestId) return { ok: false };
    this.cancelled.add(requestId);
    const job = this.jobs.get(requestId);
    if (job) {
      job.cancelled = true;
      if (typeof job.abort === 'function') job.abort('CANCELLED', '生成已取消');
    }
    if (this.cancelled.size > 100) {
      const first = this.cancelled.values().next().value;
      this.cancelled.delete(first);
    }
    return { ok: true };
  }

  adoptColors(document, colors) {
    const validated = validateThemeDocument(document);
    const next = { ...validated, colors: { ...validated.colors } };
    for (const role of ['accent', 'background', 'panel', 'foreground', 'muted', 'border', 'selection']) {
      if (colors && colors[role]) next.colors[role] = colors[role];
    }
    return validateThemeDocument(next);
  }

  rememberProject(targetId, source) {
    const identified = identifyProject(source || {});
    const id = assertTargetId(targetId);
    if (!identified.reliable) {
      if (id) {
        this.identified.delete(`target:${id}`);
        const state = this.getTargetState(id, false);
        if (state) state.projectIdentity = null;
      }
      return identified;
    }
    this.identified.set(identified.projectKey, identified);
    if (id) {
      this.identified.set(`target:${id}`, identified);
      const state = this.getTargetState(id, false);
      if (state) state.projectIdentity = identified;
    }
    return {
      reliable: true,
      identityKind: identified.identityKind,
      projectKey: identified.projectKey,
      displayHint: identified.displayHint,
      confidence: identified.confidence
    };
  }

  async saveBinding(input) {
    const known = this.identified.get(input?.projectKey);
    if (!known?.reliable) throw appError('INVALID_ARGUMENT', '请先识别项目，再保存绑定');
    if (!this.themeExists(input.themeId)) throw appError('INVALID_ARGUMENT', '要绑定的主题不存在');
    const saved = await this.bindings.saveBinding({
      projectKey: known.projectKey,
      identityKind: known.identityKind,
      themeId: input.themeId,
      displayHint: known.displayHint,
      enabled: input.enabled !== false
    });
    if (input.targetId) this.resume(input.targetId);
    return saved.binding;
  }

  async removeBinding(projectKey) {
    if (!this.identified.has(projectKey) && !this.bindings.find(projectKey)) {
      throw appError('INVALID_ARGUMENT', '没有这个项目绑定');
    }
    return this.bindings.remove(projectKey);
  }

  bindSession(targetId, themeId, label) {
    const id = assertTargetId(targetId);
    if (!id) throw appError('INVALID_ARGUMENT', '先选择一个窗口');
    if (!this.themeExists(themeId)) throw appError('INVALID_ARGUMENT', '要绑定的主题不存在');
    this.resume(id);
    return this.bindings.bindSession(id, themeId, label || '当前窗口');
  }

  listBindings(targetId) {
    const id = assertTargetId(targetId);
    return {
      persisted: this.bindings.data.bindings.map(item => ({
        ...item,
        dangling: !this.themeExists(item.themeId)
      })),
      session: id ? this.bindings.session(id) : null,
      current: this.projectDecision(id),
      identified: this._identifiedSummary(id)
    };
  }

  _identifiedSummary(targetId) {
    const known = targetId ? this.identified.get(`target:${targetId}`) : null;
    if (!known?.reliable) return null;
    return { reliable: true, projectKey: known.projectKey, displayHint: known.displayHint || '项目' };
  }

  async revisionsFor(themeId) {
    return this.revisions.list(themeId);
  }

  candidatesFor(themeId) {
    const items = this.revisions.recoveryCandidates || [];
    return themeId ? items.filter(item => item.themeId === themeId) : items.slice();
  }

  adoptRecoveryCandidate(revisionId) {
    return this.revisions.adoptCandidate(revisionId);
  }

  async diffRevisions(leftId, rightId) {
    return this.revisions.diff(leftId, rightId);
  }

  async pinRevision(themeId, revisionId, pinned) {
    return this.revisions.pin(themeId, revisionId, pinned === true);
  }

  async restoreRevision(revisionId, selection, confirm) {
    const record = await this.revisions.read(revisionId);
    const current = this.studio.document || record.document;
    const draft = selection ? validateThemeDocument(partialRestore(current, record.document, selection)) : validateThemeDocument(record.document);
    if (!confirm) return { ok: true, draft, preview: true };
    const saved = await this.studio.saveDocument(draft);
    const remembered = await this.remember(saved, {
      source: 'restore',
      themeId: saved.id,
      restoredFromRevisionId: revisionId,
      applied: false,
      documentSaved: true,
      operationId: confirm === true ? undefined : undefined
    });
    if (!remembered.ok) {
      return {
        ok: false,
        operationId: remembered.operationId,
        code: remembered.code || 'SAVE_FAILED',
        documentSaved: true,
        revisionSaved: false,
        retryable: remembered.retryable !== false,
        rollback: 'not-needed',
        message: `主题已保存，但版本记录写入失败: ${remembered.message}`,
        document: saved,
        revision: remembered,
        preview: false
      };
    }
    return {
      ok: true,
      documentSaved: true,
      revisionSaved: true,
      revisionId: remembered.revision?.revisionId,
      document: saved,
      revision: remembered,
      preview: false
    };
  }

  async catalogPage(query) {
    try {
      return await this.catalog.page(query || {});
    } catch (error) {
      throw appError(error.code || 'CATALOG_UNAVAILABLE', error.message || '内置精选暂时读不出来');
    }
  }

  async catalogGet(itemId) {
    const item = await this.catalog.getBundled(itemId);
    const installed = this.studio.library.data.themes.find(theme => theme.sourceItemId === item.itemId) || null;
    return {
      ...item,
      payload: item.payload,
      installed: installed ? {
        themeId: installed.id,
        dirty: installed.dirty === true,
        sourceVersion: installed.sourceVersion,
        update: installed.sourceVersion !== item.version || installed.sourceHash !== item.sha256
      } : null
    };
  }

  async catalogPreview(itemId) {
    const item = await this.catalog.getBundled(itemId);
    if (!item.wallpaper) return { dataUrl: null };
    const buffer = await this.catalog.readWallpaper(item.wallpaper, item.wallpaperSha256);
    return { dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  }

  async catalogInstall(itemId, mode) {
    const item = await this.catalog.getBundled(itemId);
    const existing = this.studio.library.data.themes.find(theme => theme.sourceItemId === item.itemId) || null;
    const same = existing && existing.sourceVersion === item.version && existing.sourceHash === item.sha256 && existing.dirty !== true;
    if (same && mode !== 'copy') return { ok: true, idempotent: true, theme: existing, applied: false };
    if (existing && existing.dirty === true && mode !== 'replace' && mode !== 'copy') {
      throw appError('CATALOG_DIRTY', '你改过这套主题，没有覆盖。可以另存，或明确替换。');
    }
    if (existing && !existing.dirty && existing.sourceHash !== item.sha256 && mode !== 'replace' && mode !== 'copy') {
      return { ok: false, code: 'CATALOG_UPDATE', message: '有新版本。另存会保留你的副本，替换会覆盖这份主题。', needsConfirm: true };
    }
    const document = await this._catalogDocument(item);
    if (mode === 'replace' && existing) {
      const updated = await this.studio.library.updateDocument(existing.id, { ...document, id: existing.id, name: existing.name });
      const sourced = await this.studio.library.attachSource(existing.id, {
        sourceItemId: item.itemId,
        sourceVersion: item.version,
        sourceHash: item.sha256,
        dirty: false
      });
      const remembered = await this.remember(sourced.document, { source: 'catalog', themeId: sourced.id, documentSaved: true });
      if (!remembered.ok) {
        return { ok: false, theme: updated, applied: false, replaced: true, documentSaved: true, revisionSaved: false, operationId: remembered.operationId, code: remembered.code, message: remembered.message, retryable: true };
      }
      return { ok: true, theme: updated, applied: false, replaced: true, revisionSaved: true, operationId: remembered.operationId };
    }
    const copyName = `${item.name} 副本`.slice(0, 40);
    const saved = await this.studio.library.saveNew(document, mode === 'copy' && existing ? copyName : item.name);
    const sourced = await this.studio.library.attachSource(saved.id, {
      sourceItemId: item.itemId,
      sourceVersion: item.version,
      sourceHash: item.sha256,
      dirty: false
    });
    const remembered = await this.remember(sourced.document, { source: 'catalog', themeId: sourced.id, documentSaved: true });
    if (!remembered.ok) {
      return { ok: false, theme: sourced, applied: false, documentSaved: true, revisionSaved: false, operationId: remembered.operationId, code: remembered.code, message: remembered.message, retryable: true };
    }
    return { ok: true, theme: sourced, applied: false, revisionSaved: true, operationId: remembered.operationId };
  }

  async _catalogDocument(item) {
    const document = JSON.parse(JSON.stringify(item.payload));
    if (item.wallpaper) {
      const buffer = await this.catalog.readWallpaper(item.wallpaper, item.wallpaperSha256);
      const generation = this.studio.assets.beginImport();
      const imported = await this.studio.assets.importImage(buffer, generation);
      if (!imported.record) throw appError('ASSET_INVALID', '精选壁纸没有导入');
      document.wallpaper = { ...(document.wallpaper || {}), assetId: imported.record.id, legacyDataUrl: null };
    }
    return validateThemeDocument(document);
  }
}

module.exports = { Round5Service, MASK_ON, MASK_OFF, SCENE_PROBE };
