const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { buildVerificationPlan, verifyExpression, compareObservation } = require('../core/apply-verification.cjs');
const { StudioService } = require('../desktop/studio-service.cjs');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { ThemeRevisionStore } = require('../desktop/theme-revision-store.cjs');
const { SELECTORS, VARIABLES } = require('../core/runtime.cjs');

const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { opacity: 60, blur: 0, radius: 8, wallpaper: null } });
const CHAT_HTML = '<html><body style="margin:0"><div class="flex-1 flex flex-col min-w-0" style="width:280px;height:120px"><div class="flex-1 min-h-0" style="width:240px;height:64px">chat</div></div></body></html>';

function themed(fontSize, lineHeight) {
  const value = doc();
  value.typography.chatFontSize = fontSize;
  value.typography.lineHeight = lineHeight;
  return value;
}

async function install(page, document, html = CHAT_HTML) {
  await page.setContent(html);
  const built = buildDocumentCSS(document);
  await page.addStyleTag({ content: built.css });
  await page.evaluate(() => {
    const style = document.querySelector('style');
    style.id = 'anti-face-runtime-theme-v1';
    style.dataset.antiFaceOwner = 'v043';
  });
  const plan = buildVerificationPlan(built.resolved);
  const observed = await page.evaluate(verifyExpression(plan, 'v043'));
  return { plan, observed, result: compareObservation(plan, observed), built };
}

function lineCheck(result) {
  return result.checks.find(item => item.id === 'typography-line-height');
}

test('F01 行距用同一元素的倍率核对，错误行距失败', { timeout: 40000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const correct = await install(page, themed(18, 1.5));
    const measured = await page.evaluate(() => {
      const node = document.querySelector('.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0');
      const computed = getComputedStyle(node);
      return { fontSize: computed.fontSize, lineHeight: computed.lineHeight };
    });
    assert.equal(measured.fontSize, '18px');
    assert.equal(measured.lineHeight, '27px');
    assert.equal(correct.plan.checks.find(item => item.id === 'typography-line-height').kind, 'line-height');
    assert.equal(lineCheck(correct.result).state, 'passed');
    assert.notEqual(correct.result.status, 'failed');
    assert.ok(Math.abs(lineCheck(correct.result).actual.ratio - 1.5) <= 0.02);

    for (const [fontSize, lineHeight] of [[16, 1.3], [20, 2]]) {
      const sample = await install(page, themed(fontSize, lineHeight));
      assert.equal(lineCheck(sample.result).state, 'passed', `${fontSize}/${lineHeight}`);
      assert.notEqual(sample.result.status, 'failed');
    }

    const inherited = themed(null, 1.5);
    await install(page, inherited, '<html><body style="margin:0"><div class="flex-1 flex flex-col min-w-0" style="width:280px;height:120px;font-size:20px"><div class="flex-1 min-h-0" style="width:240px;height:64px">chat</div></div></body></html>');
    const inheritedObserved = await page.evaluate(() => {
      const node = document.querySelector('.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0');
      const computed = getComputedStyle(node);
      return { fontSize: computed.fontSize, lineHeight: computed.lineHeight };
    });
    const inheritedPlan = buildVerificationPlan(buildDocumentCSS(inherited).resolved);
    const inheritedResult = compareObservation(inheritedPlan, await page.evaluate(verifyExpression(inheritedPlan, 'v043')));
    assert.equal(inheritedObserved.fontSize, '20px');
    assert.equal(lineCheck(inheritedResult).state, 'passed');
    assert.notEqual(lineCheck(inheritedResult).actual.fontSizePx, 16);

    await page.addStyleTag({ content: '.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0 { line-height:1.8 !important; }' });
    const wrongPlan = buildVerificationPlan(buildDocumentCSS(themed(18, 1.5)).resolved);
    const wrong = compareObservation(wrongPlan, await page.evaluate(verifyExpression(wrongPlan, 'v043')));
    assert.equal(lineCheck(wrong).state, 'failed');
    assert.equal(wrong.status, 'failed');

    await page.addStyleTag({ content: '.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0 { line-height:1.6 !important; font-size:18px !important; }' });
    const near = compareObservation(wrongPlan, await page.evaluate(verifyExpression(wrongPlan, 'v043')));
    assert.equal(lineCheck(near).state, 'failed');

    const untouched = await install(page, doc());
    assert.equal(untouched.plan.checks.some(item => item.id === 'typography-line-height'), false);
    assert.notEqual(untouched.result.status, 'failed');

    await page.setContent('<html><body style="margin:16px">no chat</body></html>');
    await page.addStyleTag({ content: buildDocumentCSS(themed(18, 1.5)).css });
    await page.evaluate(() => {
      const style = document.querySelector('style');
      style.id = 'anti-face-runtime-theme-v1';
      style.dataset.antiFaceOwner = 'v043';
    });
    const missingPlan = buildVerificationPlan(buildDocumentCSS(themed(18, 1.5)).resolved);
    const missingObserved = await page.evaluate(verifyExpression(missingPlan, 'v043'));
    const missing = compareObservation(missingPlan, missingObserved);
    assert.equal(lineCheck(missing).state, 'not-applicable');
    assert.equal(missing.status, 'partial');

    await page.setContent('<html><body style="margin:0"><div class="flex-1 flex flex-col min-w-0" style="font-size:18px"><div class="flex-1 min-h-0" style="width:200px;height:40px;line-height:normal">chat</div></div></body></html>');
    const normalPlan = { checks: [{ id: 'typography-line-height', required: false, kind: 'line-height', selector: '.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0', expectedRatio: 1.5, tolerance: 0.02 }] };
    const normal = compareObservation(normalPlan, await page.evaluate(verifyExpression(normalPlan, 'v043')));
    assert.equal(lineCheck(normal).state, 'unverifiable');
    assert.equal(normal.status, 'partial');

    const numberPlan = { checks: [{ id: 'n', required: true, kind: 'number', expected: '2', tolerance: 0.05 }] };
    assert.equal(compareObservation(numberPlan, { kind: 'anti-face-verify', checks: [{ id: 'n', state: 'present', actual: '2' }] }).status, 'verified');
    assert.equal(compareObservation(numberPlan, { kind: 'anti-face-verify', checks: [{ id: 'n', state: 'present', actual: '9' }] }).status, 'failed');
  } finally {
    await browser.close();
  }
});

function studioShell(dir) {
  const writes = [];
  const studio = Object.create(StudioService.prototype);
  Object.assign(studio, {
    userData: dir,
    selectedTargetId: 'A',
    library: { data: { themes: [] }, has() { return false; } },
    assets: {},
    preview: { state: () => ({ phase: 'idle' }), cancel: async () => ({ phase: 'idle' }), targets: new Map() },
    automation: { noteManual() {}, pause: () => ({ mode: 'off' }) },
    setAutomation: async () => {},
    onStudioChanged() {},
    tray: { render() {} },
    trayState() { return {}; },
    saveDocument: async document => document,
    _assetUrl: async () => null,
    theme: {
      targets: new Map([['A', {}], ['B', {}]]),
      status: { state: 'ready' },
      restore: async id => { writes.push({ kind: 'restore', id }); return { state: 'ready', message: '已恢复' }; },
      applyDocument: async (document, id, meta) => {
        if (meta?.isCurrent && !meta.isCurrent()) return { state: 'cancelled', stale: true };
        writes.push({ kind: 'apply', id, accent: document.colors?.accent || null });
        return { state: 'applied', verification: { status: 'verified' } };
      }
    }
  });
  studio.round5 = new Round5Service(studio);
  return { studio, writes };
}

function gateSave(studio) {
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  studio.saveDocument = async document => {
    entered();
    await gate;
    return document;
  };
  return { release, started };
}

test('F02 恢复和新操作取消尚未写完的旧应用', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-v043-intent-'));
  try {
    const editor = studioShell(dir);
    const editorGate = gateSave(editor.studio);
    const pendingEditor = editor.studio.applyEditorDocument(doc(), 'A');
    await editorGate.started;
    await editor.studio.restoreSelected('A');
    editorGate.release();
    const editorResult = await pendingEditor;
    assert.equal(editorResult.stale, true);
    assert.equal(editorResult.code, 'STALE');
    assert.equal(editorResult.applied, false);
    assert.equal(editor.writes.filter(item => item.kind === 'apply').length, 0);
    assert.equal(editor.studio.round5.getTargetState('A').activeDocument, null);

    const library = studioShell(dir);
    const libraryGate = gateSave(library.studio);
    const pendingLibrary = library.studio.applyLibraryTheme('graphite', 'library', 'A');
    await libraryGate.started;
    await library.studio.restoreSelected('A');
    libraryGate.release();
    const libraryResult = await pendingLibrary;
    assert.equal(libraryResult.code, 'STALE');
    assert.equal(library.writes.filter(item => item.kind === 'apply').length, 0);
    assert.equal(library.studio.round5.getTargetState('A').activeDocument, null);

    const race = studioShell(dir);
    let releaseSlow;
    let slowEntered;
    const slowGate = new Promise(resolve => { releaseSlow = resolve; });
    const slowStarted = new Promise(resolve => { slowEntered = resolve; });
    race.studio.theme.applyDocument = async (document, id, meta) => {
      const current = () => !meta?.isCurrent || meta.isCurrent();
      if (!current()) return { state: 'cancelled', stale: true };
      if (document.colors.accent === '#111111') {
        slowEntered();
        await slowGate;
      }
      if (!current()) return { state: 'cancelled', stale: true };
      race.writes.push({ kind: 'apply', id, accent: document.colors.accent });
      return { state: 'applied', verification: { status: 'verified' } };
    };
    const slow = doc();
    slow.colors.accent = '#111111';
    const fast = doc();
    fast.colors.accent = '#222222';
    const slowApply = race.studio.applyEditorDocument(slow, 'A');
    await slowStarted;
    const fastResult = await race.studio.applyEditorDocument(fast, 'A');
    releaseSlow();
    const slowResult = await slowApply;
    assert.equal(slowResult.code, 'STALE');
    assert.equal(fastResult.stale, undefined);
    assert.equal(fastResult.state, 'applied');
    assert.deepEqual(race.writes.filter(item => item.kind === 'apply').map(item => item.accent), ['#222222']);
    assert.equal(race.studio.round5.getTargetState('A').activeDocument.colors.accent, '#222222');

    const rebound = studioShell(dir);
    rebound.studio.saveDocument = async document => {
      rebound.studio.selectedTargetId = 'B';
      return document;
    };
    await rebound.studio.applyLibraryTheme('graphite', 'library');
    assert.deepEqual(rebound.writes.filter(item => item.kind === 'apply').map(item => item.id), ['A']);

    const both = studioShell(dir);
    let arrived = 0;
    let releaseBoth;
    let bothStarted;
    const bothGate = new Promise(resolve => { releaseBoth = resolve; });
    const bothReady = new Promise(resolve => { bothStarted = resolve; });
    both.studio.saveDocument = async document => {
      arrived += 1;
      if (arrived === 2) bothStarted();
      await bothGate;
      return document;
    };
    const left = both.studio.applyEditorDocument(doc(), 'A');
    const right = both.studio.applyLibraryTheme('pearl', 'tray', 'B');
    await bothReady;
    await both.studio.restoreAll();
    releaseBoth();
    const [leftResult, rightResult] = await Promise.all([left, right]);
    assert.equal(leftResult.code, 'STALE');
    assert.equal(rightResult.code, 'STALE');
    assert.equal(both.writes.filter(item => item.kind === 'apply').length, 0);
    assert.equal(both.studio.round5.getTargetState('A').activeDocument, null);
    assert.equal(both.studio.round5.getTargetState('B').activeDocument, null);

    const automatic = studioShell(dir);
    const autoGate = gateSave(automatic.studio);
    const autoApply = automatic.studio.applyLibraryTheme('graphite', 'schedule', 'A');
    await autoGate.started;
    await automatic.studio.restoreSelected('A');
    autoGate.release();
    assert.equal((await autoApply).code, 'STALE');
    assert.equal(automatic.writes.filter(item => item.kind === 'apply').length, 0);

    const replaced = studioShell(dir);
    replaced.studio.saveDocument = async document => {
      replaced.studio.round5.dropTarget('A');
      replaced.studio.round5.getTargetState('A', true);
      return document;
    };
    const replacedResult = await replaced.studio.applyEditorDocument(doc(), 'A');
    assert.equal(replacedResult.code, 'STALE');
    assert.equal(replaced.writes.filter(item => item.kind === 'apply').length, 0);
    assert.equal(replaced.studio.round5.getTargetState('A').activeDocument, null);

    const plain = studioShell(dir);
    const plainResult = await plain.studio.applyEditorDocument(doc(), 'A');
    assert.equal(plainResult.state, 'applied');
    assert.equal(plainResult.stale, undefined);
    assert.equal(plain.studio.round5.getTargetState('A').activeDocument.baseThemeId, 'graphite');
    assert.equal(plain.writes.filter(item => item.kind === 'apply').length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('F02 过期核对不能删掉后来的样式节点', async () => {
  const state = { owner: null, css: '', removes: 0 };
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const probe = () => ({
    title: 'Workspace - Antigravity',
    selectors: Object.fromEntries(SELECTORS.map(item => [item, true])),
    variables: Object.fromEntries(VARIABLES.map(item => [item, true])),
    supportsBackdropFilter: true,
    sessionId: state.owner && state.owner !== 'later-owner' ? state.owner : null
  });
  const client = {
    close() {},
    evaluate: async expression => {
      if (expression.includes('selectors:')) return probe();
      if (expression.includes('const plan = ')) {
        state.owner = 'later-owner';
        state.css = 'NEWER';
        entered();
        await gate;
        return { kind: 'anti-face-verify', checks: [] };
      }
      if (expression.includes('style.textContent')) {
        state.owner = expression.match(/owner = "([^"]+)"/)[1];
        state.css = 'OLD';
        return { sessionId: state.owner, rules: 4 };
      }
      if (expression.includes('dataset.antiFaceOwner') && expression.includes('getElementById')) return state.owner || '';
      if (expression.includes('s.remove()')) {
        if (state.owner === 'later-owner') return false;
        state.removes += 1;
        state.owner = null;
        state.css = '';
        return true;
      }
      return !!state.owner;
    }
  };
  const baseHost = { installed: true, path: 'test.exe', version: '1', fingerprint: 'abc' };
  const service = new ThemeService({
    inspectHost: async () => baseHost,
    discoverEndpoint: async () => ({ port: 1234 }),
    getJSON: async () => [{ id: 'target', type: 'page', url: 'https://127.0.0.1:1235', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/target' }],
    connect: async () => client,
    manifest: { adapters: [{ id: 'test', platform: process.platform, status: 'ready', verifiedHosts: [baseHost] }] }
  });
  const first = await service.applyDocument(doc(), 'target', { verify: false, isCurrent: () => true });
  assert.equal(first.state, 'applied');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-v043-verify-'));
  try {
    const studio = { userData: dir, preview: { state: () => ({ phase: 'idle' }) }, theme: service, assets: {} };
    const round5 = new Round5Service(studio);
    service.round5 = round5;
    const intent = round5.beginIntent('target');
    const plan = buildVerificationPlan(buildDocumentCSS(doc()).resolved);
    const pending = service.applyDocument(doc(), 'target', { verify: true, plan, isCurrent: () => round5.intentCurrent(intent) });
    await started;
    round5.beginIntent('target');
    release();
    const result = await pending;
    assert.equal(result.stale, true);
    assert.equal(state.css, 'NEWER');
    assert.equal(state.owner, 'later-owner');
    assert.equal(state.removes, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function withStore(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-v043-history-'));
  try {
    const store = new ThemeRevisionStore(dir);
    await store.load();
    await run(store, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('F03 并发保存都可见，重试不重复，删除不复活', async () => {
  await withStore(async store => {
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    store.beforeMutation = async kind => {
      if (kind !== 'record') return;
      entered();
      await gate;
    };
    const left = doc();
    const right = doc();
    right.colors.accent = '#123456';
    const first = store.record({ document: left, themeId: 'theme-a', operationId: 'a' });
    await started;
    let secondEntered = false;
    const previous = store.beforeMutation;
    store.beforeMutation = async kind => {
      if (kind === 'record') secondEntered = true;
      await previous(kind);
    };
    const second = store.record({ document: right, themeId: 'theme-a', operationId: 'b' });
    await Promise.resolve();
    assert.equal(secondEntered, false);
    release();
    store.beforeMutation = null;
    const saved = await Promise.all([first, second]);
    assert.equal(saved.length, 2);
    assert.equal(store.list('theme-a').length, 2);
    assert.equal(store.list('theme-a')[0].parentRevisionId, store.list('theme-a')[1].revisionId);
    const reloaded = new ThemeRevisionStore(store.dir);
    await reloaded.load();
    assert.equal(reloaded.list('theme-a').length, 2);
  });

  await withStore(async store => {
    const left = doc();
    const right = doc();
    right.colors.accent = '#654321';
    await Promise.all([
      store.record({ document: left, themeId: 'one', operationId: 'one' }),
      store.record({ document: right, themeId: 'two', operationId: 'two' })
    ]);
    const reloaded = new ThemeRevisionStore(store.dir);
    await reloaded.load();
    assert.equal(reloaded.list('one').length, 1);
    assert.equal(reloaded.list('two').length, 1);
    assert.notEqual(reloaded.list('one')[0].revisionId, reloaded.list('two')[0].revisionId);
  });

  await withStore(async store => {
    const document = doc();
    const [first, second] = await Promise.all([
      store.record({ document, themeId: 'theme-a', operationId: 'same' }),
      store.record({ document, themeId: 'theme-a', operationId: 'same' })
    ]);
    assert.equal(first.revision.revisionId, second.revision.revisionId);
    assert.equal(store.list('theme-a').length, 1);
    const reloaded = new ThemeRevisionStore(store.dir);
    await reloaded.load();
    assert.equal(reloaded.list('theme-a').length, 1);
  });

  await withStore(async store => {
    const first = await store.record({ document: doc(), themeId: 'theme-a', operationId: 'pin-base' });
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    store.beforeMutation = async kind => {
      if (kind !== 'record') return;
      entered();
      await gate;
    };
    const next = doc();
    next.colors.accent = '#abcdef';
    const recording = store.record({ document: next, themeId: 'theme-a', operationId: 'pin-next' });
    await started;
    let pinEntered = false;
    store.beforeMutation = async kind => {
      if (kind === 'pin') pinEntered = true;
      if (kind === 'record') await gate;
    };
    const pinning = store.pin('theme-a', first.revision.revisionId, true);
    await Promise.resolve();
    assert.equal(pinEntered, false);
    release();
    await recording;
    const pinned = await pinning;
    assert.equal(pinned.pinned, true);
    assert.equal(store.list('theme-a').length, 2);
    assert.equal(store.list('theme-a').some(item => item.revisionId === first.revision.revisionId && item.pinned), true);
  });

  await withStore(async store => {
    const created = await store.record({ document: doc(), themeId: 'theme-a', operationId: 'remove-base' });
    const removedRecord = await fs.readFile(path.join(store.recordDir, `${created.revision.revisionId}.json`), 'utf8');
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    store.beforeMutation = async kind => {
      if (kind !== 'record') return;
      entered();
      await gate;
    };
    const extra = doc();
    extra.colors.accent = '#102030';
    const recording = store.record({ document: extra, themeId: 'theme-a', operationId: 'remove-next' });
    await started;
    let removeEntered = false;
    store.beforeMutation = async kind => {
      if (kind === 'remove') removeEntered = true;
    };
    const removing = store.removeTheme('theme-a');
    await Promise.resolve();
    assert.equal(removeEntered, false);
    release();
    await recording;
    await removing;
    assert.equal(store.list('theme-a').length, 0);
    await fs.writeFile(path.join(store.recordDir, `${created.revision.revisionId}.json`), removedRecord);
    const reloaded = new ThemeRevisionStore(store.dir);
    await reloaded.load();
    assert.equal(reloaded.list('theme-a').length, 0);
    assert.equal(reloaded.recoveryCandidates.some(item => item.revisionId === created.revision.revisionId), false);
  });

  await withStore(async (store, dir) => {
    store.fault = 'index';
    const failed = doc();
    await assert.rejects(
      () => store.record({ document: failed, themeId: 'theme-a', operationId: 'failed-op' }),
      error => error.code === 'SAVE_FAILED'
    );
    store.fault = null;
    const next = doc();
    next.colors.accent = '#445566';
    const continued = await store.record({ document: next, themeId: 'theme-a', operationId: 'continued-op' });
    assert.equal(continued.deduped, false);
    const reloaded = new ThemeRevisionStore(dir);
    await reloaded.load();
    assert.equal(reloaded.list('theme-a').length, 2);
    const retry = await reloaded.record({ document: failed, themeId: 'theme-a', operationId: 'failed-op' });
    assert.equal(retry.deduped, true);
    assert.equal(reloaded.list('theme-a').length, 2);
  });

  await withStore(async (store, dir) => {
    const saved = await store.record({ document: doc(), themeId: 'theme-a', operationId: 'lost-index' });
    const index = JSON.parse(await fs.readFile(store.indexFile, 'utf8'));
    index.themes['theme-a'] = { currentRevisionId: null, items: [] };
    await fs.writeFile(store.indexFile, JSON.stringify(index));
    const reloaded = new ThemeRevisionStore(dir);
    await reloaded.load();
    assert.equal(reloaded.list('theme-a').some(item => item.revisionId === saved.revision.revisionId), true);
    const again = new ThemeRevisionStore(dir);
    await again.load();
    assert.equal(again.list('theme-a').filter(item => item.revisionId === saved.revision.revisionId).length, 1);
  });

  await withStore(async (store, dir) => {
    const saved = await store.record({ document: doc(), themeId: 'theme-a', operationId: 'old-index' });
    const record = await fs.readFile(path.join(store.recordDir, `${saved.revision.revisionId}.json`), 'utf8');
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ schemaVersion: 1, themes: {} }));
    await fs.writeFile(path.join(store.recordDir, `${saved.revision.revisionId}.json`), record);
    const reloaded = new ThemeRevisionStore(dir);
    const snapshot = await reloaded.load();
    assert.equal(reloaded.list('theme-a').length, 0);
    assert.equal(snapshot.recoveryCandidates.some(item => item.revisionId === saved.revision.revisionId), true);
    await reloaded.adoptCandidate(saved.revision.revisionId);
    assert.equal(reloaded.list('theme-a').length, 1);
    const again = new ThemeRevisionStore(dir);
    await again.load();
    assert.equal(again.list('theme-a').length, 1);
    assert.equal(again.recoveryCandidates.length, 0);
  });
});
