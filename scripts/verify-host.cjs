// Reversible integration check. No conversation content is read.
// Records this exact binary fingerprint only after apply + restore succeed.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inspectHost } = require('../desktop/host.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { themes, DEFAULT_APPEARANCE, imageData } = require('../core/theme.cjs');
const root = path.join(__dirname, '..');
const snapshot = "(() => { const s=getComputedStyle(document.documentElement); return {foreground:s.getPropertyValue('--foreground').trim(),background:s.getPropertyValue('--background').trim(),nodes:document.querySelectorAll('style').length,owned:!!document.getElementById('anti-face-runtime-theme-v1')}; })()";
(async () => {
  const host = await inspectHost();
  assert.ok(host.version && host.fingerprint, '安装的客户端身份无法读取');
  const candidate = { schemaVersion: 1, adapters: [{ id: 'antigravity-desktop-v2', product: 'Antigravity Desktop', platform: 'win32', strategy: 'runtime-css', status: 'ready', verifiedHosts: [{ version: host.version, fingerprint: host.fingerprint }] }] };
  const service = new ThemeService({ manifest: candidate });
  try {
    assert.equal((await service.inspect()).state, 'ready');
    const client = () => {
      const entry = service.focusId && service.targets.get(service.focusId);
      if (!entry?.client) throw new Error('没有已连接的宿主页面');
      return entry.client;
    };
    const original = await client().evaluate(snapshot);
    assert.equal(original.owned, false);
    for (const theme of themes) {
      await service.apply({ schemaVersion: 1, themeId: theme.id, appearance: DEFAULT_APPEARANCE });
      const applied = await client().evaluate(snapshot);
      assert.equal(applied.foreground, theme.foreground);
      assert.equal(applied.background, theme.background);
      assert.equal(applied.nodes, original.nodes + 1);
      assert.equal(applied.owned, true);
    }
    const wallpaper = imageData(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=', 'base64'));
    await service.apply({ schemaVersion: 1, themeId: 'aurora', appearance: { blur: 27, opacity: 64, radius: 24, wallpaper } });
    const appearance = await client().evaluate("(() => { const shell=document.querySelector('.h-screen.w-screen.bg-background'); const panel=document.querySelector('.bg-sidebar'); const card=document.querySelector('.bg-card'); return { image:getComputedStyle(document.body).backgroundImage, shell:shell && getComputedStyle(shell).backgroundColor, blur:panel && getComputedStyle(panel).backdropFilter, radius:card && getComputedStyle(card).borderRadius }; })()");
    assert.ok(appearance.image.includes(wallpaper));
    assert.equal(appearance.shell, 'rgba(0, 0, 0, 0)');
    assert.equal(appearance.blur, 'blur(27px)');
    assert.equal(appearance.radius, '24px');
    assert.equal((await service.tick()).state, 'applied');
    assert.equal((await service.restore()).state, 'ready');
    assert.deepEqual(await client().evaluate(snapshot), original);
    const current = await inspectHost();
    assert.equal(current.fingerprint, host.fingerprint);
    assert.equal(current.version, host.version);
    const evidence = { verifiedAt: new Date().toISOString(), platform: process.platform, version: host.version, fingerprint: host.fingerprint, themesTested: themes.map(t => t.id), checks: ['DOM structure', 'CSS variable application', 'one owned style only', 'wallpaper visible through shell', 'blur and radius computed styles', 'heartbeat', 'original variables and style count restored'], limitations: ['Current main window only', 'No persistence across host reload', 'Visual fidelity outside main page not exhaustively verified'] };
    const manifestPath = path.join(root, 'compatibility/manifest.json');
    const existing = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const previous = existing.adapters.find(a => a.id === candidate.adapters[0].id)?.verifiedHosts || [];
    candidate.adapters[0].verifiedHosts = [...previous.filter(h => h.fingerprint !== host.fingerprint), ...candidate.adapters[0].verifiedHosts];
    await fs.writeFile(path.join(root, 'compatibility/verification.json'), JSON.stringify(evidence, null, 2) + '\n');
    await fs.writeFile(manifestPath, JSON.stringify(candidate, null, 2) + '\n');
    console.log('PASS: 15 themes applied and restored on Antigravity ' + host.version);
    console.log('Compatibility evidence saved. Host appearance restored.');
  } finally { await service.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
