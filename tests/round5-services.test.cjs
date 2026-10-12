const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { AssetStore } = require('../desktop/asset-store.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { ThemeRevisionStore } = require('../desktop/theme-revision-store.cjs');
const { CatalogService } = require('../desktop/catalog-service.cjs');
const { CaptureService } = require('../desktop/capture-service.cjs');
const { SceneObserver } = require('../desktop/scene-observer.cjs');
const { ProjectBindingsStore } = require('../desktop/project-bindings-store.cjs');
const { AutomationService } = require('../desktop/automation-service.cjs');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { encodePng } = require('../core/image-decode.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { sha256Text } = require('../core/digest.cjs');

function png(r, g, b) {
  const data = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return encodePng(8, 8, data);
}

async function tempStudio() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r5-'));
  const assets = new AssetStore(path.join(dir, 'assets'));
  await assets.init();
  const library = new ThemeLibrary(path.join(dir, 'library.json'), { assets });
  await library.load();
  const studio = {
    userData: dir,
    assets,
    library,
    theme: { targets: new Map(), statusFor: () => ({ state: 'detached', message: '没有连接' }) },
    preview: { state: () => ({ phase: 'idle' }) },
    selectedTargetId: null,
    document: documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } }),
    automation: {},
    async _assetUrl() { return null; },
    async saveDocument(document) { this.document = document; return document; }
  };
  const round5 = new Round5Service(studio, { catalogRoot: path.join(__dirname, '../assets/catalog') });
  await round5.start();
  return { dir, studio, round5, assets, library };
}

test('版本修剪保留固定和当前，删除主题不会丢掉仍被历史引用的图片', async () => {
  const { dir, assets, round5 } = await tempStudio();
  try {
    const imported = await assets.importImage(png(10, 20, 30), assets.beginImport());
    const base = documentFromLegacy({ schemaVersion: 1, themeId: 'ink', appearance: { blur: 1, opacity: 80, radius: 4, wallpaper: null } });
    base.wallpaper.assetId = imported.record.id;
    round5.revisions.keep = 1;
    const first = await round5.revisions.record({ document: base, themeId: 'theme-a', source: 'save' });
    await round5.revisions.pin('theme-a', first.revision.revisionId, true);
    for (let i = 0; i < 3; i += 1) {
      const next = documentFromLegacy({ schemaVersion: 1, themeId: 'ink', appearance: { blur: i + 2, opacity: 80, radius: 4, wallpaper: null } });
      next.wallpaper.assetId = imported.record.id;
      await round5.revisions.record({ document: next, themeId: 'theme-a', source: 'save' });
    }
    const items = round5.revisions.list('theme-a');
    assert.ok(items.some(item => item.revisionId === first.revision.revisionId && item.pinned));
    assert.ok(items.length <= 3);
    const file = path.join(dir, 'assets', 'files', assets.get(imported.record.id).file);
    await round5.revisions.removeTheme('theme-a', { release: false });
    assert.equal(await fs.stat(file).then(() => true, () => false), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('截图按目标隔离，超时和遮挡都会收尾', async () => {
  const capture = new CaptureService({ timeoutMs: 20 });
  const masks = [];
  const red = { png: png(200, 0, 0), width: 8, height: 8 };
  const blue = { png: png(0, 0, 200), width: 8, height: 8 };
  const a = await capture.take({
    client: { captureScreenshot: async () => red, mask: async enabled => { masks.push(enabled); } },
    targetId: 'A', phase: 'before', groupId: 'ga', hideSensitive: true, generation: 1, isCurrent: () => true
  });
  const b = await capture.take({
    client: { captureScreenshot: async () => blue },
    targetId: 'B', phase: 'before', groupId: 'gb', generation: 1, isCurrent: () => true
  });
  assert.notEqual(sha256Text(capture.image(a.groupId, 'before').png), sha256Text(capture.image(b.groupId, 'before').png));
  assert.deepEqual(masks, [true, false]);
  const late = await capture.take({
    client: { captureScreenshot: () => new Promise(() => {}) },
    targetId: 'A', phase: 'after', groupId: 'ga', generation: 1, isCurrent: () => true
  });
  assert.equal(late.code, 'CAPTURE_TIMEOUT');
  const negative = capture.take({
    client: { captureScreenshot: async () => red },
    targetId: 'A', clip: { x: -1, y: 0, width: 10, height: 10 }, generation: 1, isCurrent: () => true
  });
  assert.equal((await negative).code, 'INVALID_ARGUMENT');
});

test('一百次场景监听仍然只有一个定时器', async () => {
  const timers = new Set();
  const observer = new SceneObserver({
    schedule(fn) { const id = { fn }; timers.add(id); return id; },
    clear(id) { timers.delete(id); }
  });
  for (let i = 0; i < 100; i += 1) observer.watch('window-a', async () => ({ routeHint: i % 2 ? 'chat' : 'home' }));
  assert.equal(observer.activeTimers(), 1);
  assert.equal(timers.size, 1);
  observer.stop();
  assert.equal(timers.size, 0);
});

test('关闭定时后项目绑定仍会应用，手动暂停不会被抢回', async () => {
  const applied = [];
  const automation = new AutomationService({
    clock: () => new Date('2026-10-05T12:00:00Z'),
    hostAvailable: async () => true,
    apply: async job => { applied.push(job.themeId); return { ok: true }; }
  });
  automation.contextDecision = () => ({ manualHold: false, previewing: false, project: { reliable: true, enabled: true, themeId: 'ink', bindingId: 'b1' } });
  automation.setConfig({ mode: 'off' });
  const first = await automation.tick();
  assert.equal(first.applied, true);
  assert.equal(applied[0], 'ink');
  automation.contextDecision = () => ({ manualHold: true, previewing: false, project: { reliable: true, enabled: true, themeId: 'pearl' } });
  const held = await automation.tick();
  assert.equal(held.applied, false);
  assert.equal(held.reason, 'manual-hold');
  assert.deepEqual(applied, ['ink']);
});

test('内置精选可安装、脏副本不被静默覆盖，远程校验会拒绝坏包', async () => {
  const { dir, round5, library } = await tempStudio();
  const serverDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-catalog-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') return;
    if (req.url === '/missing') { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await round5.catalogPage({ pageSize: 8 });
    assert.ok(page.total >= 20);
    assert.equal(page.items.length, 8);
    const item = page.items[0];
    const installed = await round5.catalogInstall(item.itemId, 'install');
    assert.equal(installed.applied, false);
    const again = await round5.catalogInstall(item.itemId, 'install');
    assert.equal(again.idempotent, true);
    await library.updateDocument(installed.theme.id, { ...installed.theme.document, colors: { ...installed.theme.document.colors, accent: '#abcdef' } });
    await assert.rejects(() => round5.catalogInstall(item.itemId, 'install'), /改过/);
    const remote = new CatalogService({
      root: path.join(__dirname, '../assets/catalog'),
      remoteBaseUrl: `http://127.0.0.1:${server.address().port}`,
      fetchImpl: async url => {
        if (String(url).endsWith('/missing')) return { ok: false, headers: { get: () => '0' }, arrayBuffer: async () => new ArrayBuffer(0) };
        return { ok: true, headers: { get: () => '4' }, arrayBuffer: async () => Buffer.from('nope') };
      }
    });
    await assert.rejects(() => remote.fetchRemote('https://evil.example/manifest.json'), /预配置/);
    await assert.rejects(() => remote.fetchRemote(`http://127.0.0.1:${server.address().port}/missing`, { sha256: 'a'.repeat(64) }), /校验|不可用|没有返回/);
    const big = await round5.catalog.page({ page: 1, pageSize: 20, items: Array.from({ length: 500 }, (_, index) => ({
      name: `项${index}`, summary: '摘要', tags: index % 2 ? ['dark'] : ['light'], mode: index % 2 ? 'dark' : 'light'
    })) });
    assert.equal(big.items.length, 20);
    assert.equal(big.total, 500);
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(serverDir, { recursive: true, force: true });
  }
});

test('未来绑定文件停止写入且不删除原内容', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-bind-'));
  try {
    const file = path.join(dir, 'bindings.json');
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 9, secret: 'keep-me' }));
    const store = new ProjectBindingsStore(file);
    await assert.rejects(() => store.load(), /版本过新/);
    assert.equal(store.frozen, true);
    await assert.rejects(() => store.saveBinding({ projectKey: 'path:abc', themeId: 'ink', displayHint: '甲' }), /停止写入/);
    assert.match(await fs.readFile(file, 'utf8'), /keep-me/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
