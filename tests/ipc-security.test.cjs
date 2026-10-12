const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { validateSettings, validateAppearance, DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { HistoryStorage } = require('../desktop/history-storage.cjs');

test('T14: IPC 安全与输入校验防护', async () => {
  // 1. 非法枚举与负 Token / 异常数值校验
  assert.throws(
    () => validateSettings({ schemaVersion: 1, themeId: 'non-existent', appearance: DEFAULT_APPEARANCE }),
    /主题不存在/
  );

  assert.throws(
    () => validateAppearance({ ...DEFAULT_APPEARANCE, blur: -5 }),
    /超出范围/
  );

  assert.throws(
    () => validateAppearance({ ...DEFAULT_APPEARANCE, opacity: 150 }),
    /超出范围/
  );

  assert.throws(
    () => validateAppearance({ ...DEFAULT_APPEARANCE, radius: 999 }),
    /超出范围/
  );

  // 2. CSS 注入与外部 URL 追踪拦截
  assert.throws(
    () => validateAppearance({ ...DEFAULT_APPEARANCE, blur: '1); } body { display:none' }),
    /超出范围/
  );

  assert.throws(
    () => validateAppearance({ ...DEFAULT_APPEARANCE, wallpaper: 'https://attacker.com/malicious.png' }),
    /壁纸数据格式无效/
  );

  assert.throws(
    () => validateAppearance({ ...DEFAULT_APPEARANCE, wallpaper: '../../../../windows/system32/cmd.exe' }),
    /壁纸数据格式无效/
  );

  // 3. 历史记录查询上限保护 (防止超大 limit 撑爆 IPC 缓冲区)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-ipc-'));
  try {
    const storage = new HistoryStorage(tempDir, { enabled: true });
    await storage.init();

    // 传入超大 pageSize: 1,000,000
    const query = await storage.queryRecords({ pageSize: 1000000 });
    // 系统必须限制在有界上限 (<= 100)
    assert.ok(query.pageSize <= 100, `pageSize 应被限制在 100 以内，实际为 ${query.pageSize}`);

    // 4. 保留周期非法值过滤
    storage.setRetentionDays(9999);
    assert.equal(storage.retentionDays, 30); // 维持默认，拒绝非法天数

    storage.setRetentionDays(7);
    assert.equal(storage.retentionDays, 7); // 合法天数允许
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
