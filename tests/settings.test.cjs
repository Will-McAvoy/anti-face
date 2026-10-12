const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SettingsStore } = require('../desktop/settings.cjs');
test('atomic saves are serialized, invalid writes preserve data, corrupt reads have a warning', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-settings-'));
  try {
    const store = new SettingsStore(dir);
    const initial = await store.load();
    assert.equal(initial.warning, null);
    await Promise.all(['pearl', 'aurora', 'ink'].map(themeId => store.save({ ...initial.settings, themeId })));
    assert.equal((await store.load()).settings.themeId, 'ink');
    assert.throws(() => store.save({ themeId: 'invalid' }));
    assert.equal((await store.load()).settings.themeId, 'ink');
    assert.deepEqual(await fs.readdir(dir), ['settings.json']);
    await fs.writeFile(store.file, '{corrupt');
    assert.ok((await store.load()).warning);
    assert.equal(await fs.readFile(store.file, 'utf8'), '{corrupt');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
