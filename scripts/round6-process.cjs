const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LOCK_NAMES = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];

// Commas and quotes are not an encoding signal. UTF-16 is accepted only from a BOM or an even-length ASCII NUL pattern.
const POWERSHELL = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$OutPath,
  [string]$SeedPids = ''
)
$ErrorActionPreference = 'Stop'
function Add-Row([System.Collections.Generic.List[object]]$List, $Proc, $Seen) {
  if ($null -eq $Proc) { return }
  $id = [string][int]$Proc.ProcessId
  if ($Seen.ContainsKey($id)) { return }
  $Seen[$id] = $true
  $created = ''
  if ($null -ne $Proc.CreationDate) {
    $when = $Proc.CreationDate
    if ($when -is [datetime]) { $created = [string]$when.ToFileTimeUtc() } else { $created = [string]$when }
  }
  $exe = ''
  if ($null -ne $Proc.ExecutablePath) { $exe = [string]$Proc.ExecutablePath }
  $commandLine = ''
  if ($null -ne $Proc.CommandLine) { $commandLine = [string]$Proc.CommandLine }
  [void]$List.Add([pscustomobject]@{
    pid = [int]$Proc.ProcessId
    parentPid = [int]$Proc.ParentProcessId
    created = $created
    exe = $exe
    commandLine = $commandLine
  })
}
function Read-IdList([string]$Text) {
  $ids = New-Object System.Collections.Generic.List[int]
  if (-not $Text) { return $ids }
  foreach ($part in $Text.Split(',')) {
    if ($part -match '^\d+$') {
      $value = [int]$part
      if ($value -gt 0) { [void]$ids.Add($value) }
    }
  }
  return $ids
}
$rows = New-Object System.Collections.Generic.List[object]
$seen = @{}
$seeds = Read-IdList $SeedPids
foreach ($id in $seeds) {
  $proc = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId=" + $id) -ErrorAction SilentlyContinue
  Add-Row $rows $proc $seen
}
$frontier = New-Object System.Collections.Generic.List[int]
foreach ($id in $seeds) { [void]$frontier.Add([int]$id) }
$guard = 0
while ($frontier.Count -gt 0 -and $guard -lt 32) {
  $guard++
  $next = New-Object System.Collections.Generic.List[int]
  foreach ($id in $frontier) {
    $kids = @(Get-CimInstance -ClassName Win32_Process -Filter ("ParentProcessId=" + $id) -ErrorAction SilentlyContinue)
    foreach ($kid in $kids) {
      if ($null -eq $kid) { continue }
      $kidId = [int]$kid.ProcessId
      if ($seen.ContainsKey([string]$kidId)) { continue }
      Add-Row $rows $kid $seen
      if ($kidId -gt 0) { [void]$next.Add($kidId) }
    }
  }
  $frontier = $next
}
if ($rows.Count -eq 0) { $json = '[]' } else { $json = ConvertTo-Json -InputObject @($rows.ToArray()) -Compress -Depth 4 }
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($OutPath, $json, $utf8)
exit 0
`;

class ProcessError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProcessError';
    this.code = code;
    this.details = details;
  }
}

function decodeUtf8Strict(buffer) {
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

function decodeUtf16Be(buffer) {
  const length = buffer.length - (buffer.length % 2);
  const swapped = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString('utf16le');
}

function isPrintableAscii(value) {
  return value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126);
}

function looksLikeUtf16LeAscii(buffer) {
  if (buffer.length < 8 || buffer.length % 2 !== 0) return false;
  for (let i = 0; i < buffer.length; i += 2) {
    if (buffer[i + 1] !== 0 || !isPrintableAscii(buffer[i])) return false;
  }
  return true;
}

function undetermined() {
  return { ok: false, encoding: 'undetermined', text: null };
}

function decodeCommandOutput(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  if (buffer.length === 0) return { ok: true, encoding: 'empty', text: '' };
  let body = buffer;
  let encoding = '';
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    encoding = 'utf8';
    body = buffer.subarray(3);
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = 'utf16le';
    body = buffer.subarray(2);
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = 'utf16be';
    body = buffer.subarray(2);
  } else if (looksLikeUtf16LeAscii(buffer)) {
    encoding = 'utf16le';
  } else if (buffer.includes(0)) {
    return undetermined();
  }
  try {
    const text = encoding === 'utf16le'
      ? body.toString('utf16le')
      : encoding === 'utf16be'
        ? decodeUtf16Be(body)
        : decodeUtf8Strict(body);
    if (text.includes('\uFFFD')) return undetermined();
    return { ok: true, encoding: encoding || 'utf8', text };
  } catch {
    return undetermined();
  }
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstField(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return undefined;
}

function integerField(row, keys) {
  const value = firstField(row, keys);
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function parseProcessJson(text) {
  return asArray(JSON.parse(text)).filter(row => row && typeof row === 'object').map(row => ({
    pid: integerField(row, ['pid', 'ProcessId']),
    parentPid: integerField(row, ['parentPid', 'ParentProcessId']),
    created: String(firstField(row, ['created', 'CreationDate']) ?? ''),
    exe: String(firstField(row, ['exe', 'ExecutablePath']) ?? ''),
    commandLine: String(firstField(row, ['commandLine', 'CommandLine']) ?? ''),
  })).filter(row => Number.isInteger(row.pid) && row.pid > 0);
}

function parsePidParentLines(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+),(\d+)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), parentPid: Number(match[2]) });
  }
  return rows;
}

function parsePidPathLines(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    const split = trimmed.indexOf('|');
    if (split <= 0) continue;
    const pid = Number(trimmed.slice(0, split));
    if (!Number.isInteger(pid)) continue;
    rows.push({ pid, path: trimmed.slice(split + 1) });
  }
  return rows;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function parseTasklistCsv(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = parseCsvLine(trimmed);
    if (cells.length < 2) continue;
    const pid = Number(cells[1]);
    if (!Number.isInteger(pid)) continue;
    rows.push({ pid, image: cells[0], session: cells[2] || '', memory: cells[4] || '' });
  }
  return rows;
}

function positivePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

// Parent and any same-path process outside this recorded tree are omitted.
// A seed whose creation time no longer matches is a reused PID and is not a kill root.
function killSet(records, identity) {
  const byPid = new Map();
  const children = new Map();
  for (const record of records || []) {
    const pid = positivePid(record.pid);
    if (!pid) continue;
    byPid.set(pid, record);
    const parent = Number(record.parentPid);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(pid);
  }
  const parentPid = positivePid(identity.parentPid);
  const rootPid = positivePid(identity.rootPid);
  const mainPid = positivePid(identity.mainPid);
  function seedMatches(pid) {
    const record = byPid.get(pid);
    if (!record) return false;
    if (pid === rootPid) return String(record.created) === String(identity.rootCreated);
    if (pid === mainPid) return String(record.created) === String(identity.mainCreated);
    return false;
  }
  const seeds = [];
  for (const pid of [rootPid, mainPid]) {
    if (!pid || pid === parentPid || pid === process.pid || seeds.includes(pid)) continue;
    if (seedMatches(pid)) seeds.push(pid);
  }
  const kill = [];
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const pid = stack.pop();
    if (!pid || pid === parentPid || pid === process.pid || seen.has(pid)) continue;
    if ((pid === rootPid || pid === mainPid) && !seedMatches(pid)) continue;
    seen.add(pid);
    kill.push(pid);
    for (const child of children.get(pid) || []) stack.push(child);
  }
  kill.sort((left, right) => left - right);
  return kill;
}

function lockDecision({ enumeration, knownAlive, lockBusy }) {
  if (!enumeration || enumeration.ok === false) return 'enumeration-failed';
  if (knownAlive && knownAlive.length) return 'test-process-alive';
  if (lockBusy && lockBusy.length) return 'lock-busy';
  return 'lock-released';
}

function pidAlive(pid) {
  const id = positivePid(pid);
  if (!id) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function lockStatus(userData) {
  const busy = [];
  for (const name of LOCK_NAMES) {
    const file = path.join(userData, name);
    let code = null;
    try {
      const handle = await fsp.open(file, 'r+');
      await handle.close();
    } catch (error) {
      if (error.code !== 'ENOENT') code = error.code || 'UNKNOWN';
    }
    if (!code) continue;
    if (code !== 'EBUSY') {
      try {
        const handle = await fsp.open(file, 'r');
        await handle.close();
        continue;
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        code = error.code || code;
      }
    }
    busy.push(`${name}:${code}`);
  }
  return busy;
}

function numericList(values) {
  const ids = [];
  for (const value of values) {
    const pid = positivePid(value);
    if (pid && !ids.includes(pid)) ids.push(pid);
  }
  return ids;
}

function queryTree(seedPids) {
  const ids = numericList(seedPids);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-r6-ps-'));
  const script = path.join(dir, 'query.ps1');
  const out = path.join(dir, 'out.json');
  try {
    fs.writeFileSync(script, POWERSHELL, 'ascii');
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-OutPath', out, '-SeedPids', ids.join(','),
    ], { windowsHide: true, timeout: 20000 });
    if (result.error || result.status !== 0) {
      return { ok: false, reason: result.error ? result.error.code || 'spawn' : 'exit', status: result.status };
    }
    if (!fs.existsSync(out)) return { ok: false, reason: 'missing-output' };
    const decoded = decodeCommandOutput(fs.readFileSync(out));
    if (!decoded.ok) return { ok: false, reason: 'encoding', encoding: decoded.encoding };
    try {
      return { ok: true, processes: parseProcessJson(decoded.text) };
    } catch (error) {
      return { ok: false, reason: 'json', message: error.message };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function validateIdentity(identity) {
  if (!identity || typeof identity.userData !== 'string' || !identity.userData) throw new ProcessError('ENUMERATION_FAILED', 'enumeration-failed: missing userData');
  if (!positivePid(identity.rootPid) || !positivePid(identity.mainPid)) throw new ProcessError('ENUMERATION_FAILED', 'enumeration-failed: missing pid');
  if (!identity.rootCreated || !identity.mainCreated) throw new ProcessError('ENUMERATION_FAILED', 'enumeration-failed: missing creation time');
}

async function captureIdentity({ rootPid, mainPid, userData }) {
  const enumeration = queryTree([rootPid, mainPid]);
  if (!enumeration.ok) throw decisionError({ decision: 'enumeration-failed', enumeration, knownAlive: [], lockBusy: [] });
  const root = enumeration.processes.find(record => record.pid === positivePid(rootPid));
  const main = enumeration.processes.find(record => record.pid === positivePid(mainPid));
  if (!root || !main || !root.created || !main.created) {
    throw decisionError({ decision: 'enumeration-failed', enumeration: { ok: false, reason: 'missing-seed' }, knownAlive: [], lockBusy: [] });
  }
  return {
    userData,
    rootPid: root.pid,
    mainPid: main.pid,
    parentPid: root.parentPid,
    rootCreated: String(root.created),
    mainCreated: String(main.created),
  };
}

function reusedSeed(identity, enumeration) {
  if (!enumeration || !enumeration.ok) return null;
  const pairs = [[positivePid(identity.rootPid), identity.rootCreated], [positivePid(identity.mainPid), identity.mainCreated]];
  for (const [pid, created] of pairs) {
    if (!pidAlive(pid)) continue;
    const record = enumeration.processes.find(item => item.pid === pid);
    if (record && String(record.created) !== String(created)) return pid;
  }
  return null;
}

function knownAlivePids(identity, enumeration, recorded) {
  if (!enumeration || !enumeration.ok) return [...recorded.keys()].filter(pid => pidAlive(pid));
  const alive = [];
  for (const [pid, created] of recorded) {
    if (!pidAlive(pid)) continue;
    const record = enumeration.processes.find(item => item.pid === pid);
    if (record && String(record.created) === String(created)) alive.push(pid);
  }
  for (const pid of killSet(enumeration.processes, identity)) {
    if (pidAlive(pid)) alive.push(pid);
  }
  return [...new Set(alive)];
}

async function inspectIdentity(identity, recorded) {
  const enumeration = queryTree([...recorded.keys(), identity.rootPid, identity.mainPid]);
  const reused = reusedSeed(identity, enumeration);
  const lockBusy = await lockStatus(identity.userData);
  if (reused) return { decision: 'pid-reused', reused, enumeration, knownAlive: [], lockBusy };
  const knownAlive = knownAlivePids(identity, enumeration, recorded);
  return { decision: lockDecision({ enumeration, knownAlive, lockBusy }), enumeration, knownAlive, lockBusy };
}

function decisionError(snapshot) {
  const decision = snapshot.decision || 'enumeration-failed';
  const code = {
    'enumeration-failed': 'ENUMERATION_FAILED',
    'test-process-alive': 'TEST_PROCESS_ALIVE',
    'lock-busy': 'LOCK_BUSY',
    'pid-reused': 'PID_REUSED',
  }[decision] || 'ENUMERATION_FAILED';
  const details = {
    decision,
    knownAlive: snapshot.knownAlive || [],
    lockBusy: snapshot.lockBusy || [],
    enumerationOk: Boolean(snapshot.enumeration && snapshot.enumeration.ok),
    enumerationReason: snapshot.enumeration && snapshot.enumeration.reason,
    reused: snapshot.reused,
  };
  return new ProcessError(code, `${decision}: ${JSON.stringify(details)}`, details);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function taskkill(pid, tree) {
  const id = positivePid(pid);
  if (!id || id === process.pid) return;
  spawnSync('taskkill', tree ? ['/PID', String(id), '/T', '/F'] : ['/PID', String(id), '/F'], { windowsHide: true });
}

function killMatching(recorded, enumeration, parentPid) {
  if (!enumeration || !enumeration.ok) return;
  for (const [pid, created] of recorded) {
    if (pid === parentPid || pid === process.pid || !pidAlive(pid)) continue;
    const record = enumeration.processes.find(item => item.pid === pid);
    if (record && String(record.created) === String(created)) taskkill(pid, false);
  }
}

async function pollRelease(identity, recorded, options, killSurvivors) {
  const timeoutMs = options.timeoutMs ?? 20000;
  const pollMs = options.pollMs ?? 400;
  const deadline = Date.now() + timeoutMs;
  let last;
  while (true) {
    last = await inspectIdentity(identity, recorded);
    if (last.decision === 'pid-reused') throw decisionError(last);
    if (last.decision === 'lock-released') return last;
    if (killSurvivors) killMatching(recorded, last.enumeration, positivePid(identity.parentPid));
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(50, deadline - Date.now())));
  }
  last = await inspectIdentity(identity, recorded);
  if (last.decision === 'lock-released') return last;
  throw decisionError(last);
}

async function waitLockReleased(identity, options = {}) {
  validateIdentity(identity);
  const recorded = new Map([
    [positivePid(identity.rootPid), String(identity.rootCreated)],
    [positivePid(identity.mainPid), String(identity.mainCreated)],
  ]);
  return pollRelease(identity, recorded, options, false);
}

async function forceStopRecorded(identity, options = {}) {
  validateIdentity(identity);
  const started = Date.now();
  const first = queryTree([identity.rootPid, identity.mainPid]);
  if (!first.ok) throw decisionError({ decision: 'enumeration-failed', enumeration: first, knownAlive: [], lockBusy: [] });
  const reused = reusedSeed(identity, first);
  if (reused) throw decisionError({ decision: 'pid-reused', reused, enumeration: first, knownAlive: [], lockBusy: [] });
  const selected = killSet(first.processes, identity);
  const recorded = new Map();
  for (const pid of selected) {
    const record = first.processes.find(item => item.pid === pid);
    if (record && record.created) recorded.set(pid, String(record.created));
  }
  if (!recorded.size) {
    recorded.set(positivePid(identity.rootPid), String(identity.rootCreated));
    recorded.set(positivePid(identity.mainPid), String(identity.mainCreated));
  }
  const seeds = numericList([identity.rootPid, identity.mainPid]).filter(pid => selected.includes(pid));
  for (const pid of seeds) taskkill(pid, true);
  const elapsed = Date.now() - started;
  const timeoutMs = Math.max(0, (options.timeoutMs ?? 20000) - elapsed);
  return pollRelease(identity, recorded, { ...options, timeoutMs }, true);
}

module.exports = {
  ProcessError,
  decodeCommandOutput,
  parseProcessJson,
  parsePidParentLines,
  parsePidPathLines,
  parseTasklistCsv,
  killSet,
  lockDecision,
  pidAlive,
  lockStatus,
  captureIdentity,
  forceStopRecorded,
  waitLockReleased,
};
