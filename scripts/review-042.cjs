// Read-only product review using synthetic DOM, mocked host boundary and temporary data.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { buildVerificationPlan, verifyExpression, compareObservation } = require('../core/apply-verification.cjs');
const { StudioService } = require('../desktop/studio-service.cjs');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { ThemeRevisionStore } = require('../desktop/theme-revision-store.cjs');
const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { opacity: 60, blur: 0, radius: 8, wallpaper: null } });
async function main() {
  const out = { note: 'Observations, not acceptance passes. No real host touched.' };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><div id="root"><div data-testid="conversation-list-sidebar" style="width:120px;height:40px">sidebar</div><div class="h-screen w-screen bg-background" style="width:300px;height:40px"><div class="flex-1 flex flex-col min-w-0"><div class="flex-1 min-h-0">chat</div></div></div><div data-testid="agent-input-box" style="width:120px;height:40px">input</div><div class="bg-card" style="width:120px;height:40px">card</div></div></body></html>');
    const d = doc(); d.typography.chatFontSize = 18; d.typography.lineHeight = 1.5;
    const built = buildDocumentCSS(d);
    await page.addStyleTag({ content: built.css });
    await page.evaluate(() => { const s = document.querySelector('style'); s.id = 'anti-face-runtime-theme-v1'; s.dataset.antiFaceOwner = 'review'; });
    const plan = buildVerificationPlan(built.resolved);
    const observed = await page.evaluate(verifyExpression(plan, 'review'));
    const result = compareObservation(plan, observed);
    out.lineHeight = { requestedMultiplier: 1.5, fontSize: 18, result: result.status, failed: result.checks.filter(x => x.state === 'failed') };
  } finally { await browser.close(); }
  const studio = Object.create(StudioService.prototype);
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  const events = [];
  Object.assign(studio, { userData: 'unused', selectedTargetId: 'A', assets: {},
    saveDocument: async d => d, _assetUrl: async () => null,
    preview: { state: () => ({ phase: 'idle' }), cancel: async () => ({ phase: 'idle' }) },
    automation: { noteManual() {}, pause: () => ({ enabled: false }) }, setAutomation: async () => {},
    theme: { targets: new Map([['A', {}]]), restore: async () => { events.push('restored'); return { state: 'ready' }; },
      applyDocument: async (_d, _id, meta) => { if (!meta.isCurrent || meta.isCurrent()) events.push('applied'); return { state: 'applied' }; } }
  });
  studio.round5 = new Round5Service(studio);
  studio.round5.decorateApply = async (_d, _id, meta) => { entered(); await gate; return meta; };
  const applying = studio.applyEditorDocument(doc(), 'A');
  await started;
  await studio.restoreSelected('A');
  release(); await applying;
  out.manualRestoreRace = { events, activeDocumentAfterRestore: !!studio.round5.getTargetState('A').activeDocument };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-review-042-'));
  try {
    const store = new ThemeRevisionStore(dir); await store.load();
    // Delay the first index write until both transactions have prepared a snapshot.
    // This controls scheduling only; record/index/journal I/O remains real.
    const original = store._writeIndex.bind(store);
    let count = 0, unlock;
    const both = new Promise(r => { unlock = r; });
    store._writeIndex = async index => { if (++count === 2) unlock(); await both; return original(index); };
    const a = doc(), b = doc(); b.colors.accent = '#123456';
    const saved = await Promise.all([
      store.record({ document: a, themeId: a.id, operationId: 'review-a' }),
      store.record({ document: b, themeId: a.id, operationId: 'review-b' })
    ]);
    const reloaded = new ThemeRevisionStore(dir); await reloaded.load();
    out.concurrentHistory = { successfulReturns: saved.length, indexedBeforeRestart: store.list(a.id).length, indexedAfterRestart: reloaded.list(a.id).length, recordFiles: (await fs.readdir(store.recordDir)).length };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  await fs.writeFile(path.join(__dirname, '../artifacts/review-042-results.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
