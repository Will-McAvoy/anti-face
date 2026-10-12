const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
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
} = require('../scripts/round6-process.cjs');

const exe = 'C:\\Anti Face.exe';

function utf16be(text) {
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  return be;
}

test('UTF-8 JSON with commas and quotes stays UTF-8', () => {
  const text = '[{"pid":1,"exe":"C:\\\\Anti Face.exe","commandLine":"a,b"}]';
  const decoded = decodeCommandOutput(Buffer.from(text, 'utf8'));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.encoding, 'utf8');
  assert.equal(parseProcessJson(decoded.text)[0].pid, 1);
  assert.equal(parseProcessJson(decoded.text)[0].exe, 'C:\\Anti Face.exe');
});

test('UTF-8 BOM JSON parses without treating the BOM as content', () => {
  const decoded = decodeCommandOutput(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('[{"pid":7,"parentPid":1}]', 'utf8'),
  ]));
  assert.equal(decoded.encoding, 'utf8');
  assert.equal(parseProcessJson(decoded.text)[0].pid, 7);
});

test('UTF-16LE BOM and NUL-pattern PID paths decode without a comma guess', () => {
  const json = '[{"pid":2,"parentPid":1}]';
  const withBom = decodeCommandOutput(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]));
  assert.equal(withBom.encoding, 'utf16le');
  assert.equal(parseProcessJson(withBom.text)[0].pid, 2);

  const lines = '8800|C:\\Anti Face.exe\r\n';
  const nulPattern = decodeCommandOutput(Buffer.from(lines, 'utf16le'));
  assert.equal(nulPattern.encoding, 'utf16le');
  assert.deepEqual(parsePidPathLines(nulPattern.text), [{ pid: 8800, path: 'C:\\Anti Face.exe' }]);

  const pairs = decodeCommandOutput(Buffer.from('1234,5678\r\n', 'utf16le'));
  assert.equal(pairs.encoding, 'utf16le');
  assert.deepEqual(parsePidParentLines(pairs.text), [{ pid: 1234, parentPid: 5678 }]);
});

test('UTF-16BE BOM PID path parses only after that decode', () => {
  const text = '9|C:\\Anti Face.exe\r\n';
  const decoded = decodeCommandOutput(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be(text)]));
  assert.equal(decoded.encoding, 'utf16be');
  assert.deepEqual(parsePidPathLines(decoded.text), [{ pid: 9, path: 'C:\\Anti Face.exe' }]);
});

test('GBK bytes with a comma are undetermined and are not turned into a PID', () => {
  const decoded = decodeCommandOutput(Buffer.from([0xb2, 0xe2, 0x2c, 0x31]));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.encoding, 'undetermined');
  assert.equal(decoded.text, null);
});

test('interior NULs that are not UTF-16LE ASCII are undetermined', () => {
  const decoded = decodeCommandOutput(Buffer.from([0x61, 0x00, 0x62, 0x01, 0x63, 0x00, 0x64, 0x02]));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.encoding, 'undetermined');
});

test('tasklist CSV and a single PowerShell process object parse after a UTF-8 decode', () => {
  const csv = [
    '"Image Name","PID","Session Name","Session#","Mem Usage"',
    '"Anti Face.exe","4321","Console","1","12,345 K"',
  ].join('\r\n');
  const decoded = decodeCommandOutput(Buffer.from(csv, 'utf8'));
  assert.equal(decoded.encoding, 'utf8');
  const rows = parseTasklistCsv(decoded.text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pid, 4321);
  assert.equal(rows[0].image, 'Anti Face.exe');
  assert.equal(rows[0].memory, '12,345 K');

  const one = parseProcessJson('{"ProcessId":8,"ParentProcessId":1,"CreationDate":"a","ExecutablePath":"C:\\\\Anti Face.exe"}');
  assert.equal(one.length, 1);
  assert.equal(one[0].pid, 8);
  assert.equal(one[0].created, 'a');
  assert.deepEqual(parseProcessJson('null'), []);
});

test('kill set is the recorded tree only, never the parent or a same-path spectator', () => {
  const records = [
    { pid: 1, parentPid: 0, created: 'p', exe: 'C:\\Windows\\System32\\node.exe' },
    { pid: 2, parentPid: 1, created: 'a', exe, commandLine: 'Anti Face userData=A' },
    { pid: 3, parentPid: 2, created: 'c', exe },
    { pid: 4, parentPid: 1, created: 'b', exe, commandLine: 'Anti Face userData=B' },
    { pid: 5, parentPid: 4, created: 'd', exe },
  ];
  const identity = { rootPid: 2, mainPid: 2, parentPid: 1, rootCreated: 'a', mainCreated: 'a', userData: 'A' };
  assert.deepEqual(killSet(records, identity), [2, 3]);
  const reused = records.map(record => record.pid === 2 ? { ...record, created: 'REUSED' } : record);
  assert.deepEqual(killSet(reused, identity), []);
});

test('lock decision fails closed when enumeration fails, a test PID is alive, or the lock is busy', () => {
  assert.equal(lockDecision({ enumeration: { ok: false }, knownAlive: [], lockBusy: [] }), 'enumeration-failed');
  assert.equal(lockDecision({ enumeration: { ok: true, processes: [] }, knownAlive: [2], lockBusy: [] }), 'test-process-alive');
  assert.equal(lockDecision({ enumeration: { ok: true, processes: [] }, knownAlive: [], lockBusy: ['lockfile:EBUSY'] }), 'lock-busy');
  assert.equal(lockDecision({ enumeration: { ok: true, processes: [] }, knownAlive: [], lockBusy: [] }), 'lock-released');
});

function killPid(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}

function sleeper(userData) {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { ...process.env, ANTI_FACE_TEST_USER_DATA: userData },
    stdio: 'ignore',
    windowsHide: true,
  });
}

test('forceStop kills only the recorded same-path process', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'af-r6-spectator-'));
  const victimDir = path.join(root, 'victim');
  const spectatorDir = path.join(root, 'spectator');
  await fs.mkdir(victimDir);
  await fs.mkdir(spectatorDir);
  const victim = sleeper(victimDir);
  const spectator = sleeper(spectatorDir);
  try {
    assert.notEqual(victim.pid, spectator.pid);
    let identity;
    let last;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        identity = await captureIdentity({ rootPid: victim.pid, mainPid: victim.pid, userData: victimDir });
        break;
      } catch (error) {
        last = error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    if (!identity) throw last;
    assert.equal(identity.parentPid, process.pid);
    assert.equal(pidAlive(spectator.pid), true);
    await forceStopRecorded(identity, { timeoutMs: 15000, pollMs: 300 });
    assert.equal(pidAlive(victim.pid), false);
    assert.equal(spectator.exitCode, null);
    assert.equal(pidAlive(spectator.pid), true);
    assert.equal(pidAlive(process.pid), true);
  } finally {
    killPid(victim.pid);
    killPid(spectator.pid);
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test('a busy lock with no recorded process fails and does not kill the holder', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'af-r6-lock-'));
  const lockPath = path.join(dir, 'lockfile');
  const scriptPath = path.join(dir, 'hold.ps1');
  const script = [
    'param([Parameter(Mandatory=$true)][string]$LockPath)',
    '$stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)',
    'try { while ($true) { Start-Sleep -Seconds 2 } } finally { $stream.Dispose() }',
    '',
  ].join('\r\n');
  await fs.writeFile(scriptPath, script, 'ascii');
  const holder = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath, '-LockPath', lockPath,
  ], { windowsHide: true, stdio: 'ignore' });
  let ghost = 2147483000;
  while (pidAlive(ghost) && ghost > 2147482000) ghost -= 1;
  const identity = {
    userData: dir,
    rootPid: ghost,
    mainPid: ghost,
    parentPid: process.pid,
    rootCreated: 'not-this-test',
    mainCreated: 'not-this-test',
  };
  try {
    let busy = [];
    const started = Date.now();
    while (Date.now() - started < 10000) {
      busy = await lockStatus(dir);
      if (busy.some(item => item.startsWith('lockfile:'))) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(busy.some(item => item.startsWith('lockfile:')), `lockfile was not busy: ${busy.join(',')}`);
    await assert.rejects(
      () => forceStopRecorded(identity, { timeoutMs: 1500, pollMs: 200 }),
      error => {
        assert.equal(error.code, 'LOCK_BUSY');
        assert.match(error.message, /lock-busy/);
        return true;
      },
    );
    assert.equal(holder.exitCode, null);
    assert.equal(pidAlive(holder.pid), true);
  } finally {
    killPid(holder.pid);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
