// Independent review: observed defects are recorded, not acceptance passes.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { StudioService } = require('../desktop/studio-service.cjs');
const { CaptureService } = require('../desktop/capture-service.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { buildVerificationPlan, verifyExpression, compareObservation } = require('../core/apply-verification.cjs');
const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { opacity: 60, blur: 0, radius: 8, wallpaper: null } });
async function main() {
  const results = {};
  const studio = { userData: 'unused-review-path', assets: {}, theme: { targets: new Map() }, preview: { state: () => ({ phase: 'idle' }) } };
  const service = new Round5Service(studio);
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(255);
  const legacy = doc();
  legacy.wallpaper.legacyDataUrl = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
  legacy.readability.mode = 'auto';
  const prepared = await service.prepareImageAnalysis(legacy);
  const explained = await service.explain(legacy, 'A', { viewport: { width: 800, height: 600 } });
  results.legacyImage = { decoded: !!prepared?.image, analysisAvailable: !!service.analysisFor(legacy), measurement: explained.readability.measurement };
  const sceneDoc = doc();
  sceneDoc.sceneAppearance.mode = 'auto';
  const home = await service.explain(sceneDoc, null, { previewScene: 'home', contextKind: 'preview', viewport: { width: 800, height: 600 } });
  const chat = await service.explain(sceneDoc, null, { previewScene: 'chat', contextKind: 'preview', viewport: { width: 800, height: 600 } });
  results.previewScene = { home: home.scene, chat: chat.scene, sameHash: home.effectiveHash === chat.effectiveHash };
  const capture = new CaptureService();
  let release;
  const taking = capture.take({ targetId: 'A', groupId: 'pending', phase: 'before', client: { captureScreenshot: () => new Promise(r => { release = r; }) } });
  capture.clear();
  release({ png: Buffer.from('synthetic'), width: 10, height: 10 });
  results.clearAll = { returned: await taking, groups: capture.list().length };
  const pair = new CaptureService();
  const base = { targetId: 'A', groupId: 'pair', viewport: { width: 800, height: 600 }, client: { captureScreenshot: async () => ({ png: Buffer.from('synthetic'), width: 100, height: 100 }) } };
  await pair.take({ ...base, phase: 'before', clip: { x: 0, y: 0, width: 100, height: 100 } });
  results.differentClips = await pair.take({ ...base, phase: 'after', clip: { x: 200, y: 200, width: 100, height: 100 } });
  let attempted = 0;
  const editor = Object.create(StudioService.prototype);
  Object.assign(editor, {
    selectedTargetId: 'A', saveDocument: async d => d, _assetUrl: async () => null,
    preview: { state: () => ({ phase: 'idle' }) }, automation: { noteManual() {} },
    round5: { hold() {}, setActiveDocument() {}, decorateApply: async () => ({}), remember: async () => { attempted++; return { ok: false, code: 'SAVE_FAILED' }; } },
    theme: { applyDocument: async () => ({ state: 'applied', verification: { status: 'verified' } }) }
  });
  results.historyFailure = { returned: await editor.applyEditorDocument(doc(), 'A'), failedHistoryWrites: attempted };
  const sceneStudio = { ...studio, document: sceneDoc, selectedTargetId: 'A', theme: { targets: new Map([['A', {}]]) } };
  const sceneService = new Round5Service(sceneStudio);
  let finishAnalysis;
  const pendingAnalysis = new Promise(r => { finishAnalysis = r; });
  const writes = [];
  sceneService.decorateApply = async (d, target, meta) => { await pendingAnalysis; return { ...meta, effective: { effectiveHash: 'old-job' } }; };
  sceneStudio.theme.applyDocument = async (d, target, meta) => { if (meta.isCurrent()) writes.push({ target, theme: d.baseThemeId }); return { state: 'applied' }; };
  const oldScene = sceneService.onAutoScene('A', 'chat');
  sceneService.dropTarget('A');
  sceneService.getTargetState('A', true);
  finishAnalysis();
  await oldScene;
  results.targetIdReuse = { oldJobWritesToNewTarget: writes.length, writes: [...writes] };
  const nativeService = new Round5Service(sceneStudio);
  nativeService.decorateApply = async (d, target, meta) => ({ ...meta, effective: { effectiveHash: 'inherited' } });
  const countBefore = writes.length;
  await nativeService.onAutoScene('A', 'chat');
  results.nativeTargetInheritsDraft = { writes: writes.length - countBefore };
  service.rememberProject('project-window', { workspaceId: 'old-workspace' });
  const unknown = service.rememberProject('project-window', {});
  results.unknownProject = { returned: unknown, staleIdentityRetained: service.identified.get('target:project-window')?.projectKey || null };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><div id="root"><div data-testid="conversation-list-sidebar" style="width:120px;height:40px">sidebar</div><div class="h-screen w-screen bg-background" style="width:300px;height:40px">chat</div><div data-testid="agent-input-box" style="width:120px;height:40px">input</div><div class="bg-card" style="width:120px;height:40px">card</div></div></body></html>');
    const compiled = buildDocumentCSS(doc());
    await page.addStyleTag({ content: compiled.css });
    await page.evaluate(() => { const s = document.querySelector('style'); s.id = 'anti-face-runtime-theme-v1'; s.dataset.antiFaceOwner = 'review'; });
    const plan = buildVerificationPlan(compiled.resolved);
    const observed = await page.evaluate(verifyExpression(plan, 'review'));
    results.realCssVerification = {
      computed: await page.locator('[data-testid="conversation-list-sidebar"]').evaluate(el => ({ opacity: getComputedStyle(el).opacity, background: getComputedStyle(el).backgroundColor })),
      result: compareObservation(plan, observed)
    };
  } finally { await browser.close(); }
  await fs.writeFile(path.join(__dirname, '../artifacts/review-gemini-2026-10-07.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
