const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { writeZip, readZip } = require('../desktop/zip-util.cjs');
const { isSafeRelativePath } = require('../core/backup-schema.cjs');
const { BackupService } = require('../desktop/backup-service.cjs');

test('F05: zip-util 零依赖 PKZip 压缩与解压真实二进制与文本数据', () => {
  const files = [
    { path: 'manifest.json', data: Buffer.from(JSON.stringify({ test: 'hello' }), 'utf8') },
    { path: 'assets/sample.bin', data: Buffer.from([1, 2, 3, 4, 5, 255, 254, 253]) },
    { path: 'themes/sub/theme.json', data: Buffer.from('{"name":"test-theme"}', 'utf8') }
  ];

  const zipBuffer = writeZip(files);
  assert.ok(zipBuffer.length > 0);
  // PKZip magic number: 0x50, 0x4B, 0x03, 0x04
  assert.equal(zipBuffer[0], 0x50);
  assert.equal(zipBuffer[1], 0x4b);

  const unpacked = readZip(zipBuffer);
  assert.equal(unpacked.length, 3);
  const m = unpacked.find(f => f.path === 'manifest.json');
  const b = unpacked.find(f => f.path === 'assets/sample.bin');
  const t = unpacked.find(f => f.path === 'themes/sub/theme.json');

  assert.equal(m.data.toString('utf8'), '{"test":"hello"}');
  assert.deepEqual(b.data, Buffer.from([1, 2, 3, 4, 5, 255, 254, 253]));
  assert.equal(t.data.toString('utf8'), '{"name":"test-theme"}');
});

test('F05: 安全校验 - 严厉拒绝路径穿越与绝对路径恶意条目', () => {
  // 安全相对路径
  assert.equal(isSafeRelativePath('manifest.json'), true);
  assert.equal(isSafeRelativePath('themes/theme-library.json'), true);
  assert.equal(isSafeRelativePath('assets/uuid.png'), true);

  // 恶意路径穿越与非法字符
  assert.equal(isSafeRelativePath('../evil.exe'), false);
  assert.equal(isSafeRelativePath('themes/../../evil.sh'), false);
  assert.equal(isSafeRelativePath('/etc/passwd'), false);
  assert.equal(isSafeRelativePath('C:\\Windows\\System32\\cmd.exe'), false);
  assert.equal(isSafeRelativePath('\\server\\share\\file'), false);
  assert.equal(isSafeRelativePath('themes/\0hidden'), false);
  assert.equal(isSafeRelativePath(''), false);
});

// Full migration now uses real UUID themes and AssetStore: tests/round6-fix.test.cjs.
