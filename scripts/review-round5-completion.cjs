// Review-only synthetic reproductions. Assertions confirm defects, not acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { CaptureService } = require('../desktop/capture-service.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');
const results = [];
const record = (id, evidence) => { results.push({ id, ...evidence }); console.log(JSON.stringify(results.at(-1))); };
const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { ...DEFAULT_APPEARANCE } });
(async () => {
  const r = Object.create(Round5Service.prototype);
  r.pixelCache = new Map();
  r.studio = { assets: { get: () => ({ width: 100, height: 100 }) } };
  const d = doc(); d.wallpaper.assetId = '11111111-1111-4111-8111-111111111111'; d.readability.mode = 'auto';
  const effective = resolveEffectiveAppearance(d, { viewport: { width: 1280, height: 800 } }, r.analysisFor(d));
  assert.equal(effective.readability.measurement.reason, 'missing-image');
  record('R01_READING_WITH_IMPORTED_IMAGE', { status: effective.readability.measurement.status, reason: effective.readability.measurement.reason, adjustments: effective.adjustments.length });

  const scene = Object.create(Round5Service.prototype);
  const sceneDoc = doc(); sceneDoc.sceneAppearance.mode = 'auto';
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const writes = [];
  scene.studio = { document: sceneDoc, preview: { state: () => ({ phase: 'idle' }) }, theme: { applyDocument: async (document, target, meta) => { writes.push({ target, theme: document.baseThemeId, guarded: typeof meta.isCurrent === 'function' }); return { state: 'applied' }; } } };
  scene.manualHolds = new Map(); scene.lastSceneApply = new Map();
  scene.decorateApply = async () => { await blocked; return { effective: { effectiveHash: 'test' } }; };
  const pending = scene.onAutoScene('A', 'chat');
  scene.hold('A'); release(); await pending;
  assert.equal(writes.length, 1);
  record('R02_SCENE_AFTER_MANUAL_HOLD', { writesAfterHold: writes.length, cancellationGuard: writes[0].guarded });
  scene.manualHolds.clear(); scene.lastSceneApply.clear();
  scene.studio.document = { ...sceneDoc, baseThemeId: 'pearl' }; // B's globally saved document
  await scene.onAutoScene('A', 'chat');
  assert.equal(writes.at(-1).theme, 'pearl');
  record('R03_SCENE_SHARED_DOCUMENT', { target: writes.at(-1).target, appliedThemeFromGlobalDocument: writes.at(-1).theme });

  const captures = new CaptureService();
  let finish; const shot = new Promise(resolve => { finish = resolve; });
  const taking = captures.take({ targetId: 'A', groupId: 'one', phase: 'before', viewport: { width: 100, height: 100 }, client: { captureScreenshot: () => shot }, isCurrent: () => true });
  captures.clear('A'); finish({ png: Buffer.from('synthetic'), width: 100, height: 100 });
  await taking;
  assert.equal(captures.list('A').length, 1);
  record('R04_CAPTURE_CLEAR_RACE', { groupsAfterClearAndLateResponse: captures.list('A').length });

  const restore = Object.create(Round5Service.prototype);
  restore.studio = { document: doc(), saveDocument: async document => document };
  restore.revisions = { read: async () => ({ document: doc() }), record: async () => { throw new Error('simulated disk full'); } };
  const result = await restore.restoreRevision('synthetic-revision', null, true);
  assert.equal(result.ok, true); assert.equal(result.revision.ok, false);
  record('R05_RESTORE_HISTORY_FAILURE', { operationOk: result.ok, revisionOk: result.revision.ok, error: result.revision.message });
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const filename = require.resolve('../desktop/round5-service.cjs');
  const nativeRequire = require('node:module').createRequire(filename);
  let terminated = false;
  class SilentWorker extends EventEmitter {
    postMessage() {}
    async terminate() { terminated = true; this.emit('exit', 1); }
  }
  const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), process, Buffer,
    require: name => name === 'node:worker_threads' ? { Worker: SilentWorker } : nativeRequire(name),
    setTimeout: fn => setTimeout(fn, 5), clearTimeout };
  vm.runInNewContext(require('node:fs').readFileSync(filename, 'utf8'), sandbox, { filename });
  const generation = Object.create(sandbox.module.exports.Round5Service.prototype);
  Object.assign(generation, { cancelled: new Set(), jobs: new Map(), studio: { assets: { read: async () => Buffer.from('fake') } } });
  const settled = await Promise.race([generation.generate('image', {}, 'request').then(() => 'settled', () => 'rejected'), new Promise(resolve => setTimeout(() => resolve('pending'), 40))]);
  assert.equal(terminated, true); assert.equal(settled, 'pending');
  record('R06_WORKER_TIMEOUT', { workerTerminated: terminated, requestState: settled, jobsRetained: generation.jobs.size });
  await fs.writeFile(path.join(__dirname, '../artifacts/round5-completion-review.json'), JSON.stringify({ reviewedOn: '2026-10-06', purpose: 'defect reproduction, not passing product tests', results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });

