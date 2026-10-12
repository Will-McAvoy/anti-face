const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');
const { Round5Service, MASK_ON, MASK_OFF } = require('../desktop/round5-service.cjs');
const { StudioService } = require('../desktop/studio-service.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { CaptureService } = require('../desktop/capture-service.cjs');
const { ThemeRevisionStore } = require('../desktop/theme-revision-store.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { buildVerificationPlan, verifyExpression, compareObservation } = require('../core/apply-verification.cjs');
const { sliderClip } = require('../core/compare-frame.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');

const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { opacity: 60, blur: 0, radius: 8, wallpaper: null } });

function sceneDoc() {
  const value = doc();
  value.sceneAppearance.mode = 'auto';
  value.sceneAppearance.home = { opacity: 40, maskStrength: null };
  value.sceneAppearance.chat = { opacity: 90, maskStrength: null };
  return value;
}

function studioFor(document) {
  return {
    userData: 'unused-review-path',
    assets: {},
    document,
    selectedTargetId: 'A',
    theme: { targets: new Map([['A', {}]]) },
    preview: { state: () => ({ phase: 'idle' }) }
  };
}

test('legacyImage: 合法 data URL 能独立分析，不再 missing-image', async () => {
  const studio = { userData: 'unused-review-path', assets: {}, theme: { targets: new Map() }, preview: { state: () => ({ phase: 'idle' }) } };
  const service = new Round5Service(studio);
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(255);
  const legacy = doc();
  legacy.wallpaper.legacyDataUrl = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
  legacy.readability.mode = 'auto';
  const prepared = await service.prepareImageAnalysis(legacy);
  const again = service.analysisFor(legacy);
  const explained = await service.explain(legacy, 'A', { viewport: { width: 800, height: 600 } });
  assert.equal(prepared.image?.data?.length > 0, true);
  assert.equal(again?.image?.data?.length > 0, true);
  assert.equal(again.hash, prepared.hash);
  assert.notEqual(explained.readability.measurement.reason, 'missing-image');
  assert.equal(explained.readability.measurement.status, 'estimated');
});

test('previewScene: idle 编辑预览的 home/chat 使用各自场景值', async () => {
  const service = new Round5Service(studioFor(sceneDoc()));
  const document = sceneDoc();
  const home = await service.explain(document, null, { previewScene: 'home', contextKind: 'preview', viewport: { width: 800, height: 600 } });
  const chat = await service.explain(document, null, { previewScene: 'chat', contextKind: 'preview', viewport: { width: 800, height: 600 } });
  assert.equal(home.scene, 'home');
  assert.equal(chat.scene, 'chat');
  assert.equal(home.effectiveVisual.regions.chat.opacity, 40);
  assert.equal(chat.effectiveVisual.regions.chat.opacity, 90);
  assert.equal(home.effectiveHash === chat.effectiveHash, false);
});

test('clearAll: 尚未入缓存的截图被 clear() 作废', async () => {
  const capture = new CaptureService();
  let release;
  const taking = capture.take({ targetId: 'A', groupId: 'pending', phase: 'before', client: { captureScreenshot: () => new Promise(resolve => { release = resolve; }) } });
  capture.clear();
  release({ png: Buffer.from('synthetic'), width: 10, height: 10 });
  const returned = await taking;
  assert.equal(returned.ok, false);
  assert.equal(capture.list().length, 0);
});

test('leaving the panel keeps a finished pair and drops an in-flight shot', async () => {
  const capture = new CaptureService();
  const client = { captureScreenshot: async () => ({ png: Buffer.from('kept'), width: 10, height: 8 }) };
  await capture.take({ targetId: 'A', groupId: 'kept', phase: 'before', client, viewport: { width: 1280, height: 720 } });
  capture.invalidate('A');
  assert.equal(capture.list('A').some(item => item.id === 'kept' && item.before), true);
  let release;
  const pending = capture.take({
    targetId: 'A',
    groupId: 'late',
    phase: 'before',
    client: { captureScreenshot: () => new Promise(resolve => { release = resolve; }) }
  });
  capture.invalidate('A');
  release({ png: Buffer.from('late'), width: 4, height: 4 });
  const late = await pending;
  assert.equal(late.ok, false);
  assert.equal(late.code, 'GENERATION_STALE');
  assert.equal(capture.list('A').some(item => item.id === 'late'), false);
  assert.equal(capture.list('A').some(item => item.id === 'kept'), true);
});

test('differentClips: 同视口不同裁切不能滑块叠加', async () => {
  const pair = new CaptureService();
  const base = { targetId: 'A', groupId: 'pair', viewport: { width: 800, height: 600 }, client: { captureScreenshot: async () => ({ png: Buffer.from('synthetic'), width: 100, height: 100 }) } };
  await pair.take({ ...base, phase: 'before', clip: { x: 0, y: 0, width: 100, height: 100 } });
  const after = await pair.take({ ...base, phase: 'after', clip: { x: 200, y: 200, width: 100, height: 100 } });
  assert.equal(after.comparable, false);
  assert.equal(after.incompatibility, 'clip');
});

test('historyFailure: 编辑器应用在历史写入失败时不能报成无条件成功', async () => {
  let attempted = 0;
  const editor = Object.create(StudioService.prototype);
  Object.assign(editor, {
    selectedTargetId: 'A',
    saveDocument: async value => value,
    _assetUrl: async () => null,
    preview: { state: () => ({ phase: 'idle' }) },
    automation: { noteManual() {} },
    round5: {
      hold() {},
      setActiveDocument() {},
      decorateApply: async () => ({}),
      remember: async () => { attempted += 1; return { ok: false, code: 'SAVE_FAILED', message: '磁盘满了', operationId: 'op-1', retryable: true }; }
    },
    theme: { applyDocument: async () => ({ state: 'applied', verification: { status: 'verified' } }) }
  });
  const returned = await editor.applyEditorDocument(doc(), 'A');
  assert.equal(attempted, 1);
  assert.equal(returned.applied, true);
  assert.equal(returned.revisionSaved, false);
  assert.equal(returned.ok, false);
  assert.equal(returned.code, 'SAVE_FAILED');
  assert.match(returned.message, /版本历史/);
});

test('historyRetryChannel: 主窗口可以重试历史写入，迷你窗不可以', () => {
  const { authorize } = require('../core/ipc-policy.cjs');
  const preload = require('node:fs').readFileSync(require('node:path').join(__dirname, '../desktop/preload.cjs'), 'utf8');
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]);
  assert.ok(channels.includes('revisions:retry'));
  for (const channel of channels) assert.equal(authorize('main', channel), true, channel);
  assert.equal(authorize('mini', 'revisions:retry'), false);
  assert.equal(authorize(null, 'revisions:retry'), false);
});

test('targetIdReuse: 同 ID 新实例不接收旧场景任务', async () => {
  const document = sceneDoc();
  const sceneStudio = studioFor(document);
  const sceneService = new Round5Service(sceneStudio);
  sceneService.setActiveDocument('A', document);
  let finishAnalysis;
  const pendingAnalysis = new Promise(resolve => { finishAnalysis = resolve; });
  const writes = [];
  sceneService.decorateApply = async (_document, _target, meta) => {
    await pendingAnalysis;
    return { ...meta, effective: { effectiveHash: 'old-job' } };
  };
  sceneStudio.theme.applyDocument = async (value, _target, meta) => {
    if (meta.isCurrent()) writes.push(value.baseThemeId);
    return { state: 'applied' };
  };
  const oldScene = sceneService.onAutoScene('A', 'chat');
  const previous = sceneService.getTargetState('A', false).instanceId;
  sceneService.dropTarget('A');
  const next = sceneService.getTargetState('A', true);
  finishAnalysis();
  await oldScene;
  assert.notEqual(next.instanceId, previous);
  assert.equal(writes.length, 0);
});

test('nativeTargetInheritsDraft: 没有自己主题的窗口不套用全局草稿', async () => {
  const sceneStudio = studioFor(sceneDoc());
  const nativeService = new Round5Service(sceneStudio);
  const writes = [];
  nativeService.decorateApply = async (value, _target, meta) => ({ ...meta, effective: { effectiveHash: 'inherited' } });
  sceneStudio.theme.applyDocument = async (value) => { writes.push(value.baseThemeId); return { state: 'applied' }; };
  await nativeService.onAutoScene('A', 'chat');
  assert.equal(writes.length, 0);
  assert.equal(nativeService.getTargetState('A', false).activeDocument, null);
});

test('unknownProject: 不可靠身份清掉窗口当前关联，永久键可以留着', () => {
  const service = new Round5Service(studioFor(doc()));
  service.rememberProject('project-window', { workspaceId: 'old-workspace' });
  const permanent = service.identified.get('workspace:old-workspace');
  const unknown = service.rememberProject('project-window', {});
  assert.equal(unknown.reliable, false);
  assert.equal(service.identified.get('target:project-window') || null, null);
  assert.equal(permanent.projectKey, 'workspace:old-workspace');
  assert.equal(service.identified.get(permanent.projectKey).reliable, true);
});

test('realCssVerification: 正确样式在 Chromium 通过，故意改错的 alpha 失败', async () => {
  const document = doc();
  document.typography.chatFontSize = 18;
  const compiled = buildDocumentCSS(document);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body>
      <div id="root">
        <div data-testid="conversation-list-sidebar" style="width:120px;height:40px">sidebar</div>
        <div class="h-screen w-screen bg-background" style="width:300px;height:40px"><div class="flex-1 flex flex-col min-w-0"><div class="flex-1 min-h-0">chat</div></div></div>
        <div data-testid="agent-input-box" style="width:120px;height:40px">input</div>
        <div class="bg-card" style="width:120px;height:40px">card</div>
      </div>
    </body></html>`);
    await page.addStyleTag({ content: compiled.css });
    await page.evaluate(() => {
      const style = document.querySelector('style');
      style.id = 'anti-face-runtime-theme-v1';
      style.dataset.antiFaceOwner = 'review';
    });
    const plan = buildVerificationPlan(compiled.resolved, { wallpaper: false });
    const observed = await page.evaluate(verifyExpression(plan, 'review'));
    const correct = compareObservation(plan, observed);
    assert.equal(correct.checks.find(item => item.id === 'region-sidebar-background').state, 'passed');
    assert.equal(correct.checks.find(item => item.id === 'typography-font-size').state, 'passed');
    assert.notEqual(correct.status, 'failed');

    const wrong = compiled.css.replace('--af-sidebar-opacity:60%', '--af-sidebar-opacity:10%');
    await page.addStyleTag({ content: wrong });
    await page.evaluate(() => {
      const styles = [...document.querySelectorAll('style')];
      const style = styles[styles.length - 1];
      style.id = 'anti-face-runtime-theme-v1';
      style.dataset.antiFaceOwner = 'review';
      styles.slice(0, -1).forEach(node => node.remove());
    });
    const wrongObserved = await page.evaluate(verifyExpression(plan, 'review'));
    const failed = compareObservation(plan, wrongObserved);
    assert.equal(failed.checks.find(item => item.id === 'region-sidebar-background').state, 'failed');
    assert.equal(failed.status, 'failed');
  } finally {
    await browser.close();
  }
});

test('occlusion and slider: 遮挡是局部的，滑块不缩放上层图', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(`<html><body style="margin:0;background:#22aa55">
      <div data-testid="conversation-turn" style="position:absolute;left:40px;top:40px;width:80px;height:30px;color:#fff">SECRETTEXT</div>
      <div data-testid="agent-input-box" style="position:absolute;left:40px;top:100px;width:90px;height:24px">typed</div>
      <div id="open" style="position:absolute;left:250px;top:20px;width:40px;height:40px;background:#22aa55"></div>
    </body></html>`);
    await page.evaluate(MASK_ON);
    const boxes = await page.evaluate(() => {
      const mask = document.getElementById('anti-face-capture-mask');
      const parts = [...mask.querySelectorAll('[data-anti-face-mask-part]')].map(node => node.getBoundingClientRect());
      return { covered: mask.dataset.covered, background: mask.style.background, parts, viewport: { width: innerWidth, height: innerHeight } };
    });
    assert.equal(boxes.background, 'transparent');
    assert.equal(Number(boxes.covered) >= 1, true);
    assert.equal(boxes.parts.every(part => part.width < boxes.viewport.width && part.height < boxes.viewport.height), true);
    const shot = PNG.sync.read(await page.screenshot());
    const pixel = (x, y) => {
      const index = (Math.round(y) * shot.width + Math.round(x)) * 4;
      return [shot.data[index], shot.data[index + 1], shot.data[index + 2]];
    };
    const covered = pixel(50, 50);
    const open = pixel(260, 30);
    assert.ok(covered[0] < 40 && covered[1] < 40 && covered[2] < 40);
    assert.ok(open[1] > covered[1] + 40);
    await page.evaluate(MASK_OFF);
    assert.equal(await page.evaluate(() => document.getElementById('anti-face-capture-mask')), null);

    await page.setContent('<html><body style="margin:0"></body></html>');
    const widths = [];
    for (const percent of [0, 50, 100]) {
      await page.setContent(`<div id="frame" style="position:relative;width:200px;height:100px">
        <img id="after" alt="after" width="200" height="100" style="width:200px;height:100px;display:block">
        <img id="before" alt="before" width="200" height="100" style="position:absolute;inset:0;width:200px;height:100px;display:block;clip-path:${sliderClip(percent)}">
      </div>`);
      widths.push(await page.evaluate(() => ({
        before: document.getElementById('before').getBoundingClientRect().width,
        after: document.getElementById('after').getBoundingClientRect().width
      })));
    }
    assert.deepEqual(widths, [
      { before: 200, after: 200 },
      { before: 200, after: 200 },
      { before: 200, after: 200 }
    ]);
  } finally {
    await browser.close();
  }
});

test('history disk boundary: 索引失败后新进程能恢复，同一 operationId 只有一条', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-history-'));
  try {
    const store = new ThemeRevisionStore(dir);
    await store.load();
    const document = doc();
    store.fault = 'index';
    await assert.rejects(() => store.record({ document, themeId: document.id, source: 'save', operationId: 'op-restart' }), error => error.code === 'SAVE_FAILED');
    const script = `
      const { ThemeRevisionStore } = require(${JSON.stringify(path.join(__dirname, '../desktop/theme-revision-store.cjs'))});
      (async () => {
        const store = new ThemeRevisionStore(${JSON.stringify(dir)});
        const loaded = await store.load();
        const items = store.list(${JSON.stringify(document.id)});
        process.stdout.write(JSON.stringify({ frozen: loaded.frozen, count: items.length, ids: items.map(item => item.revisionId) }));
      })().catch(error => { console.error(error); process.exit(1); });
    `;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const recovered = JSON.parse(child.stdout);
    assert.equal(recovered.frozen, false);
    assert.equal(recovered.count, 1);
    const again = new ThemeRevisionStore(dir);
    await again.load();
    const retry = await again.record({ document, themeId: document.id, source: 'save', operationId: 'op-restart' });
    assert.equal(retry.deduped, true);
    assert.equal(again.list(document.id).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('disconnect calls the real drop chain', async () => {
  const dropped = [];
  let pages = [{ id: 'A', type: 'page', url: 'https://127.0.0.1/c/A', webSocketDebuggerUrl: 'ws://127.0.0.1/A' }];
  const service = new ThemeService({
    inspectHost: async () => ({ installed: true, path: 'mock', version: 'test', fingerprint: 'test' }),
    discoverEndpoint: async () => ({ port: 9 }),
    getJSON: async () => pages,
    connect: async () => ({ close() {}, async evaluate() { return {}; } }),
    manifest: { adapters: [] }
  });
  service.round5 = { dropTarget(id) { dropped.push(id); }, replaceTarget(id) { dropped.push(`replace:${id}`); } };
  await service.inspect('A');
  assert.equal(dropped.includes('replace:A'), true);
  pages = [];
  await service.listTargets();
  assert.equal(dropped.includes('A'), true);
  assert.equal(service.targets.has('A'), false);
});

test('adopt rejects a suggestion after the document changes', async () => {
  const service = new Round5Service(studioFor(doc()));
  const document = sceneDoc();
  const explained = await service.explain(document, 'A', { previewScene: 'chat', contextKind: 'preview', viewport: { width: 800, height: 600 } });
  document.colors.foreground = '#111111';
  assert.throws(() => service.adoptReadability(document, null, 'A', explained.suggestionId), error => error.code === 'STALE_SUGGESTION');
});

test('generate refuses a third concurrent worker and does not keep a pixel side cache', async () => {
  const service = new Round5Service(studioFor(doc()));
  service.maxWorkers = 1;
  let release;
  service.studio.assets = { read: () => new Promise(resolve => { release = () => resolve(Buffer.from('pending')); }) };
  const first = service.generate('asset', {}, 'one');
  const second = await service.generate('asset', {}, 'two');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'BUSY');
  assert.equal(service.pixelCache.size, 0);
  service.cancelGenerate('one');
  release();
  const finished = await first;
  assert.equal(finished.code, 'CANCELLED');
  assert.equal(service.jobs.size, 0);
});
