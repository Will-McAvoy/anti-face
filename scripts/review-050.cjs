const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const { AssetStore } = require('../desktop/asset-store.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { BackupService } = require('../desktop/backup-service.cjs');
const { StudioService } = require('../desktop/studio-service.cjs');
const { QuickSwitcherController } = require('../desktop/quick-switcher.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { opacity: 80, blur: 0, radius: 8, wallpaper: null } });
async function stores(dir) {
  const assets = new AssetStore(path.join(dir, 'assets')); await assets.init();
  const library = new ThemeLibrary(path.join(dir, 'theme-library.json'), { assets }); await library.load();
  return { assets, library, backup: new BackupService({ userData: dir, assets, library }) };
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-review-050-'));
  const out = {};
  try {
    const source = await stores(path.join(dir, 'source'));
    const png = new PNG({ width: 8, height: 8 }); png.data.fill(255);
    const imported = await source.assets.importImage(PNG.sync.write(png), source.assets.beginImport());
    const d = doc(); d.wallpaper.assetId = imported.record.id;
    await source.library.saveNew(d, 'Review image theme');
    const archive = path.join(dir, 'backup.antiface-backup');
    await source.backup.exportBackup(archive);
    const inspection = await source.backup.inspectBackup(archive);
    try { await source.backup.previewRestore(structuredClone(inspection)); out.ipcRoundtrip = { ok: true }; }
    catch (e) { out.ipcRoundtrip = { ok: false, error: e.message }; }
    const dest = await stores(path.join(dir, 'dest'));
    const committed = await dest.backup.commitRestore(archive);
    const theme = dest.library.data.themes[0];
    let imageError = null;
    try { await dest.assets.read(theme.document.wallpaper.assetId); } catch (e) { imageError = e.message; }
    out.assetRestore = { commitOk: committed.ok, themeCount: dest.library.data.themes.length, assetReadable: !imageError, imageError };
    await dest.backup.commitRestore(archive);
    out.repeatRestore = { themeCount: dest.library.data.themes.length };
    const editor = Object.create(StudioService.prototype); let writes = 0;
    Object.assign(editor, { safeMode: true, selectedTargetId: 'A', preview: { state: () => ({ phase: 'idle' }) }, saveDocument: async v => v, _assetUrl: async () => null,
      automation: { noteManual() {} }, theme: { applyDocument: async () => { writes++; return { state: 'applied' }; } } });
    const applied = await editor.applyEditorDocument(doc(), 'A');
    out.safeModeApply = { writes, returnedState: applied.state };
    const switcher = new QuickSwitcherController({ studioService: { selectedTargetId: 'A', commitPreview: async () => { throw new Error('disk full'); } } });
    out.failedConflictSave = await switcher.resolveConflict('save', 'A');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  await fs.writeFile(path.join(__dirname, '../artifacts/review-050-results.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
