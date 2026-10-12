const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {
  validateAutoBackupConfig,
  isManagedAutoBackupFilename,
  parseAutoBackupTimestamp,
  selectBackupsToPrune
} = require('../core/auto-backup-policy.cjs');
const {
  AutoBackupService,
  DEBOUNCE_MS
} = require('../desktop/auto-backup-service.cjs');

test('F05: validateAutoBackupConfig 参数校验与边界钳制', () => {
  const defaults = validateAutoBackupConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.directoryRef, '');
  assert.equal(defaults.schedule, 'afterMajorChange');
  assert.equal(defaults.retainCount, 7);
  assert.equal(defaults.retainDays, 30);

  const clamped = validateAutoBackupConfig({
    enabled: true,
    directoryRef: ' D:\\Backups ',
    schedule: 'invalid',
    retainCount: 100, // 超过 50
    retainDays: 0 // 低于 1
  });
  assert.equal(clamped.enabled, true);
  assert.equal(clamped.directoryRef, 'D:\\Backups');
  assert.equal(clamped.schedule, 'afterMajorChange');
  assert.equal(clamped.retainCount, 50);
  assert.equal(clamped.retainDays, 1);
});

test('F05: selectBackupsToPrune 保留数量、过期清理与保底规则', () => {
  const now = 1700000000000;
  const dayMs = 86400000;

  // 构造 5 个备份文件，从旧到新
  const backups = [
    { filename: 'b1', filePath: '/backups/b1', createdAtMs: now - 40 * dayMs },
    { filename: 'b2', filePath: '/backups/b2', createdAtMs: now - 35 * dayMs },
    { filename: 'b3', filePath: '/backups/b3', createdAtMs: now - 20 * dayMs },
    { filename: 'b4', filePath: '/backups/b4', createdAtMs: now - 10 * dayMs },
    { filename: 'b5', filePath: '/backups/b5', createdAtMs: now - 1 * dayMs }
  ];

  // 场景 1: retainCount = 3, retainDays = 30
  // b1(40d,超期), b2(35d,超期), b3(20d,数量超), b4, b5
  const pruned1 = selectBackupsToPrune(backups, { retainCount: 3, retainDays: 30, nowMs: now });
  assert.deepEqual(pruned1.sort(), ['/backups/b1', '/backups/b2'].sort());

  // 场景 2: 数量超限（retainCount = 2）
  const pruned2 = selectBackupsToPrune(backups, { retainCount: 2, retainDays: 50, nowMs: now });
  assert.deepEqual(pruned2.sort(), ['/backups/b1', '/backups/b2', '/backups/b3'].sort());

  // 场景 3: 铁律保底：所有备份均已超期，但必须保留至少最新的 1 份
  const allExpired = [
    { filename: 'e1', filePath: '/backups/e1', createdAtMs: now - 100 * dayMs },
    { filename: 'e2', filePath: '/backups/e2', createdAtMs: now - 90 * dayMs }
  ];
  const prunedExpired = selectBackupsToPrune(allExpired, { retainCount: 5, retainDays: 30, nowMs: now });
  assert.deepEqual(prunedExpired, ['/backups/e1']); // e2 最新，绝不能删！
});

test('F05: 目录安全检查（防止选在 userData 内部导致递归打包）', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-autobackup-sec-'));
  const userData = path.join(tempDir, 'user-data');
  const insideDir = path.join(userData, 'backups');
  await fs.mkdir(insideDir, { recursive: true });

  const service = new AutoBackupService({ userData }, {
    config: { enabled: true, directoryRef: insideDir },
    setTimeout: () => null,
    clearTimeout: () => {}
  });

  await assert.rejects(
    () => service.runAutoBackup('test'),
    /备份目录不能位于程序内部数据目录中，防止递归打包/
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('F05: 重大修改防抖与无变更跳过 (Fingerprint Check)', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-autobackup-debounce-'));
  const userData = path.join(tempDir, 'user-data');
  const backupDir = path.join(tempDir, 'backups');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  // 模拟数据文件
  await fs.writeFile(path.join(userData, 'theme-library.json'), JSON.stringify({ v: 1 }));
  await fs.writeFile(path.join(userData, 'appearance.json'), JSON.stringify({ v: 1 }));
  await fs.writeFile(path.join(userData, 'preferences.json'), JSON.stringify({ v: 1 }));

  let scheduledDelay = null;
  let timerHandler = null;
  const mockSetTimeout = (fn, delay) => {
    scheduledDelay = delay;
    timerHandler = fn;
    return 123;
  };

  let exportedDest = null;
  const mockStudio = {
    userData,
    safeMode: false,
    migrationActive: false,
    backup: {
      exportBackup: async (dest) => {
        exportedDest = dest;
        await fs.writeFile(dest, 'mock backup content');
        return { ok: true, filePath: dest };
      }
    }
  };

  const service = new AutoBackupService(mockStudio, {
    config: { enabled: true, directoryRef: backupDir, schedule: 'afterMajorChange' },
    setTimeout: mockSetTimeout,
    clearTimeout: () => { scheduledDelay = null; }
  });

  // 1. 触发重大修改监听
  service.noteMajorChange('save-theme');
  assert.equal(scheduledDelay, DEBOUNCE_MS);
  assert.ok(timerHandler != null);

  // 2. 防抖定时器触发首次备份
  const run1 = await service.runAutoBackup('save-theme');
  assert.equal(run1.ok, true);
  assert.equal(run1.skipped, undefined);
  assert.ok(run1.filePath.endsWith('.antiface-backup'));
  assert.ok(run1.fingerprint != null);

  // 3. 数据未变化，再次触发：检测到相同指纹并跳过
  const run2 = await service.runAutoBackup('save-theme');
  assert.equal(run2.ok, true);
  assert.equal(run2.skipped, true);
  assert.equal(run2.reason, 'unchanged');

  // 4. 修改数据后，再次触发：成功生成新备份
  await fs.writeFile(path.join(userData, 'theme-library.json'), JSON.stringify({ v: 2 }));
  const run3 = await service.runAutoBackup('save-theme');
  assert.equal(run3.ok, true);
  assert.equal(run3.skipped, undefined);
  assert.notEqual(run3.fingerprint, run1.fingerprint);

  service.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('F05: 严格保留策略与非相关文件隔离保护', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-autobackup-prune-'));
  const userData = path.join(tempDir, 'user-data');
  const backupDir = path.join(tempDir, 'backups');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  // 1. 写入用户手动备份与其它无关文件（这些文件必须被严格保护，绝不被删除）
  const manualBackup = path.join(backupDir, 'anti-face-backup-manual.zip');
  const userText = path.join(backupDir, 'important-notes.txt');
  await fs.writeFile(manualBackup, 'user manual backup');
  await fs.writeFile(userText, 'user notes');

  // 2. 写入 5 个自动托管备份（命名遵循标准正则）
  const autoFiles = [
    'anti-face-auto_2026-10-01T10-00-00_a1.antiface-backup',
    'anti-face-auto_2026-10-02T10-00-00_a2.antiface-backup',
    'anti-face-auto_2026-10-03T10-00-00_a3.antiface-backup',
    'anti-face-auto_2026-10-04T10-00-00_a4.antiface-backup',
    'anti-face-auto_2026-10-05T10-00-00_a5.antiface-backup'
  ];
  for (const name of autoFiles) {
    await fs.writeFile(path.join(backupDir, name), 'mock auto backup');
  }

  const mockStudio = { userData, safeMode: false, migrationActive: false };
  const service = new AutoBackupService(mockStudio, {
    config: { enabled: true, directoryRef: backupDir, retainCount: 2, retainDays: 30 }
  });
  // Ownership comes from the service index, never from a matching filename.
  service.managedBackups = autoFiles.map(filename => ({
    filename, filePath: path.join(backupDir, filename),
    createdAtMs: parseAutoBackupTimestamp(filename), verified: true
  }));

  // 执行保留清理（retainCount = 2，应删除最旧的 a1, a2, a3，保留 a4, a5）
  const pruned = await service.pruneOldBackups(backupDir);
  assert.equal(pruned.length, 3);
  assert.ok(pruned.some(f => f.includes('a1')));
  assert.ok(pruned.some(f => f.includes('a2')));
  assert.ok(pruned.some(f => f.includes('a3')));

  // 验证剩余文件列表
  const remaining = await fs.readdir(backupDir);
  assert.ok(remaining.includes('important-notes.txt'), '绝不应删除用户文本文件');
  assert.ok(remaining.includes('anti-face-backup-manual.zip'), '绝不应删除用户手动备份');
  assert.ok(remaining.includes('anti-face-auto_2026-10-04T10-00-00_a4.antiface-backup'));
  assert.ok(remaining.includes('anti-face-auto_2026-10-05T10-00-00_a5.antiface-backup'));

  service.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('F05: 安全模式与迁移模式抑制保护', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-autobackup-safe-'));
  const userData = path.join(tempDir, 'user-data');
  const backupDir = path.join(tempDir, 'backups');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  const mockStudio = { userData, safeMode: true, migrationActive: false };
  const service = new AutoBackupService(mockStudio, {
    config: { enabled: true, directoryRef: backupDir }
  });

  await assert.rejects(
    () => service.runAutoBackup('test'),
    /安全模式下禁止自动备份/
  );

  mockStudio.safeMode = false;
  mockStudio.migrationActive = true;
  await assert.rejects(
    () => service.runAutoBackup('test'),
    /迁移恢复期间禁止自动备份/
  );

  service.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
});
