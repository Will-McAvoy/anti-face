const fs = require('node:fs/promises');
// Electron interprets .asar paths as virtual directories; hash the archive's raw bytes.
const rawFs = process.versions.electron ? require('original-fs').promises : fs;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const manifest = require('../compatibility/manifest.json');
const { checkCompatibility } = require('../core/compatibility.cjs');
const { getJSON } = require('./cdp.cjs');
async function powershell(command, env = {}) {
  const shell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-Command', command],
    { env: { ...process.env, ...env }, windowsHide: true, timeout: 10000 });
  return stdout.trim();
}
// Identity only changes when the host is reinstalled or updated, so reuse it while both files are untouched.
let identityCache = null;
async function inspectHost() {
  const absent = { installed: false, path: null, version: null, fingerprint: null, compatibility: 'not-installed' };
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return absent;
  const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe');
  let key;
  try {
    const [exeStat, bundleStat] = await Promise.all([
      fs.stat(exe),
      rawFs.stat(path.join(path.dirname(exe), 'resources', 'app.asar')).catch(() => null)
    ]);
    key = [exe, exeStat.mtimeMs, exeStat.size, bundleStat?.mtimeMs, bundleStat?.size].join('|');
  } catch { identityCache = null; return absent; }
  if (identityCache?.key === key) return { ...identityCache.result };
  const result = await readIdentity(exe);
  // Unreadable identities are retried next time instead of being pinned as untested.
  identityCache = result.version && result.fingerprint ? { key, result } : null;
  return { ...result };
}
async function readIdentity(exe) {
  let version = null, fingerprint = null;
  try {
    // Fixed command. The executable path travels through the environment, not shell interpolation.
    version = await powershell('(Get-Item -LiteralPath $env:ANTI_FACE_HOST_EXE).VersionInfo.ProductVersion', { ANTI_FACE_HOST_EXE: exe }) || null;
    const bundle = await rawFs.readFile(path.join(path.dirname(exe), 'resources', 'app.asar'));
    fingerprint = crypto.createHash('sha256').update(bundle).digest('hex');
  } catch { /* An unreadable identity is unverified, never implicitly compatible. */ }
  const host = { installed: true, path: exe, version, fingerprint };
  return { ...host, compatibility: checkCompatibility(host, manifest).allowed ? 'verified' : 'untested' };
}
async function discoverEndpoint(host) {
  if (!host.installed || !process.env.APPDATA) throw new Error('未找到 Antigravity Desktop，请先安装并启动');
  let lines;
  try { lines = (await fs.readFile(path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); }
  catch { throw new Error('请先启动 Antigravity Desktop，再点击重新检测'); }
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(lines[1])) throw new Error('Antigravity 调试端口记录无效');
  let owner;
  try {
    owner = await powershell('$c = Get-NetTCPConnection -State Listen -LocalPort ([int]$env:ANTI_FACE_PORT) -ErrorAction SilentlyContinue; $c | ForEach-Object { if ($_.LocalAddress -ne "127.0.0.1" -and $_.LocalAddress -ne "::1") { throw "Non-loopback listener" }; (Get-CimInstance Win32_Process -Filter ("ProcessId = " + $_.OwningProcess)).ExecutablePath }', { ANTI_FACE_PORT: String(port) });
  } catch { throw new Error('无法确认 Antigravity 调试端口归属，请重新检测'); }
  // A port file left behind by a closed or crashed host has no listener.
  if (!owner) throw new Error('请先启动 Antigravity Desktop，再点击重新检测');
  if (owner.split(/\r?\n/).some(exe => exe.toLowerCase() !== host.path.toLowerCase())) throw new Error('调试端口不属于已检测的 Antigravity 程序');
  const version = await getJSON(port, '/json/version');
  if (new URL(version.webSocketDebuggerUrl).pathname !== lines[1]) throw new Error('Antigravity 已重启，请重新检测');
  return { port };
}
module.exports = { inspectHost, discoverEndpoint };
