const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const unpacked = process.env.ANTI_FACE_UNPACKED_DIR
  ? path.resolve(process.env.ANTI_FACE_UNPACKED_DIR)
  : path.join(root, 'release', 'win-unpacked');
const archive = path.join(unpacked, 'resources', 'app.asar');
const exe = path.join(root, 'release', `Anti Face ${pkg.version}.exe`);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readAsar(name) {
  const forward = name.split('\\').join('/');
  const windows = forward.split('/').join('\\');
  try { return asar.extractFile(archive, windows); }
  catch { return asar.extractFile(archive, forward); }
}

function walk(dir, suffix) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, suffix));
    else if (!suffix || full.endsWith(suffix)) found.push(full);
  }
  return found;
}

(async () => {
  await fsp.access(exe);
  await fsp.access(archive);
  const exeBytes = await fsp.readFile(exe);
  const exeHash = sha256(exeBytes);
  const packedPkg = JSON.parse(readAsar('package.json').toString('utf8'));
  assert.equal(packedPkg.name, pkg.name);
  assert.equal(packedPkg.version, pkg.version);
  assert.equal(packedPkg.main, pkg.main);
  const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  const assets = [...html.matchAll(/assets\/[^"']+/g)].map(match => match[0]);
  assert.ok(assets.length >= 2, 'dist/index.html 没有引用构建产物');
  for (const asset of assets) {
    const disk = fs.readFileSync(path.join(root, 'dist', asset));
    assert.equal(sha256(readAsar(`dist/${asset}`)), sha256(disk), asset);
  }
  assert.equal(sha256(readAsar('dist/index.html')), sha256(fs.readFileSync(path.join(root, 'dist', 'index.html'))));
  const compared = [];
  for (const folder of ['desktop', 'core', 'shared']) {
    for (const file of walk(path.join(root, folder)).filter(file=>folder==='shared' || /\.(cjs|html|css)$/.test(file))) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      const unpackedFile = path.join(unpacked, 'resources', 'app.asar.unpacked', ...relative.split('/'));
      const packed = fs.existsSync(unpackedFile) ? fs.readFileSync(unpackedFile) : readAsar(relative);
      assert.equal(sha256(packed), sha256(fs.readFileSync(file)), relative);
      compared.push(relative);
    }
  }
  const manifest = JSON.parse(readAsar('assets/catalog/manifest.json').toString('utf8'));
  assert.equal(manifest.items.length, 20);
  for (let index = 1; index <= 20; index += 1) {
    const name = String(index).padStart(2, '0');
    assert.ok(readAsar(`assets/catalog/wallpapers/${name}.png`).length > 32);
    assert.ok(readAsar(`assets/catalog/previews/${name}.png`).length > 32);
  }
  const unpackedWorker = path.join(unpacked, 'resources', 'app.asar.unpacked', 'desktop', 'workers', 'image-analysis.cjs');
  await fsp.access(unpackedWorker);
  assert.equal(sha256(fs.readFileSync(unpackedWorker)), sha256(fs.readFileSync(path.join(root, 'desktop', 'workers', 'image-analysis.cjs'))));
  for (const sound of ['completed.wav', 'failed.wav', 'preview.wav', 'waiting_user.wav']) {
    await fsp.access(path.join(unpacked, 'resources', 'app.asar.unpacked', 'assets', 'sounds', sound));
  }
  const report = {
    version: pkg.version,
    exe: path.relative(root, exe),
    bytes: exeBytes.length,
    sha256: exeHash,
    comparedSources: compared.length,
    frontendAssets: assets,
    catalogItems: manifest.items.length,
    portableShell: '未在本脚本启动便携外壳，只核对 win-unpacked 与 EXE 哈希',
    checkedAt: new Date().toISOString()
  };
  await fsp.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fsp.writeFile(path.join(root, 'artifacts', 'round5-package-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
