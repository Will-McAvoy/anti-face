const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

test('host identity is hashed once per unchanged install and re-read after an update', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-face-host-'));
  const dir = path.join(root, 'Programs', 'antigravity');
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  const exe = path.join(dir, 'Antigravity.exe');
  const bundle = path.join(dir, 'resources', 'app.asar');
  fs.writeFileSync(exe, 'exe');
  fs.writeFileSync(bundle, 'bundle-v1');

  const originalExecFile = childProcess.execFile;
  const originalLocal = process.env.LOCALAPPDATA;
  let versionReads = 0;
  let version = '1.0.0';
  childProcess.execFile = (file, args, options, callback) => { versionReads += 1; callback(null, { stdout: `${version}\n` }); };
  process.env.LOCALAPPDATA = root;
  const modulePath = require.resolve('../desktop/host.cjs');
  delete require.cache[modulePath];
  try {
    const { inspectHost } = require(modulePath);
    const first = await inspectHost();
    assert.equal(first.version, '1.0.0');
    assert.ok(first.fingerprint);
    first.version = 'mutated';
    const second = await inspectHost();
    assert.equal(versionReads, 1);
    assert.equal(second.version, '1.0.0', 'callers cannot mutate the cached identity');

    version = '2.0.0';
    fs.writeFileSync(bundle, 'bundle-v2-longer');
    const updated = await inspectHost();
    assert.equal(versionReads, 2);
    assert.equal(updated.version, '2.0.0');
    assert.notEqual(updated.fingerprint, first.fingerprint);

    fs.rmSync(exe);
    assert.equal((await inspectHost()).installed, false);
  } finally {
    childProcess.execFile = originalExecFile;
    if (originalLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = originalLocal;
    delete require.cache[modulePath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a debug port file left by a closed host asks the user to start Antigravity', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-face-port-'));
  fs.mkdirSync(path.join(root, 'Antigravity'));
  fs.writeFileSync(path.join(root, 'Antigravity', 'DevToolsActivePort'), '58668\n/devtools/browser/7c9b0144-e2bf-4964-b378-cef26b7d8014\n');
  const originalExecFile = childProcess.execFile;
  const originalAppData = process.env.APPDATA;
  const host = { installed: true, path: 'C:\\Programs\\antigravity\\Antigravity.exe' };
  const modulePath = require.resolve('../desktop/host.cjs');
  process.env.APPDATA = root;
  try {
    // No listener: the ownership query prints nothing.
    childProcess.execFile = (file, args, options, callback) => callback(null, { stdout: '' });
    delete require.cache[modulePath];
    await assert.rejects(require(modulePath).discoverEndpoint(host), { message: '请先启动 Antigravity Desktop，再点击重新检测' });

    // A query failure (such as a non-loopback listener) never leaks raw PowerShell output.
    childProcess.execFile = (file, args, options, callback) => callback(new Error('Command failed: powershell.exe ... Non-loopback listener'));
    delete require.cache[modulePath];
    await assert.rejects(require(modulePath).discoverEndpoint(host), { message: '无法确认 Antigravity 调试端口归属，请重新检测' });

    childProcess.execFile = (file, args, options, callback) => callback(null, { stdout: 'C:\\Other\\app.exe\n' });
    delete require.cache[modulePath];
    await assert.rejects(require(modulePath).discoverEndpoint(host), { message: '调试端口不属于已检测的 Antigravity 程序' });
  } finally {
    childProcess.execFile = originalExecFile;
    if (originalAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppData;
    delete require.cache[modulePath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable host identity is retried instead of being cached', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-face-host-'));
  const dir = path.join(root, 'Programs', 'antigravity');
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Antigravity.exe'), 'exe');
  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'bundle');

  const originalExecFile = childProcess.execFile;
  const originalLocal = process.env.LOCALAPPDATA;
  let versionReads = 0;
  childProcess.execFile = (file, args, options, callback) => { versionReads += 1; callback(new Error('busy')); };
  process.env.LOCALAPPDATA = root;
  const modulePath = require.resolve('../desktop/host.cjs');
  delete require.cache[modulePath];
  try {
    const { inspectHost } = require(modulePath);
    assert.equal((await inspectHost()).compatibility, 'untested');
    await inspectHost();
    assert.equal(versionReads, 2);
  } finally {
    childProcess.execFile = originalExecFile;
    if (originalLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = originalLocal;
    delete require.cache[modulePath];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
