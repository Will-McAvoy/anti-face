const test = require('node:test');
const assert = require('node:assert/strict');
const { themes, DEFAULT_APPEARANCE, validateSettings, buildCSS, imageData } = require('../core/theme.cjs');
const settings = { schemaVersion: 1, themeId: 'graphite', appearance: { ...DEFAULT_APPEARANCE } };
test('all built-in palettes compile to constrained runtime CSS', () => {
  assert.equal(new Set(themes.map(t => t.id)).size, 15);
  for (const theme of themes) {
    const css = buildCSS({ ...settings, themeId: theme.id });
    assert.ok(css.includes('--foreground:' + theme.foreground));
    assert.ok(css.includes('color-scheme:' + theme.mode));
    assert.ok(!css.includes('undefined'));
  }
});
test('rejects CSS injection, external images and invalid numeric input', () => {
  for (const appearance of [{ ...DEFAULT_APPEARANCE, blur: '1); } body {display:none' }, { ...DEFAULT_APPEARANCE, opacity: NaN }, { ...DEFAULT_APPEARANCE, radius: 29 }, { ...DEFAULT_APPEARANCE, wallpaper: 'https://example.com/tracker.png' }, { ...DEFAULT_APPEARANCE, wallpaper: 'data:image/png;base64,YWJj' }]) {
    assert.throws(() => validateSettings({ ...settings, appearance }));
  }
  assert.throws(() => buildCSS({ ...settings, themeId: 'unknown' }));
});
test('valid image data survives JSON export and validated import', () => {
  const wallpaper = imageData(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=', 'base64'));
  const value = { ...settings, appearance: { ...DEFAULT_APPEARANCE, wallpaper } };
  assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(value))), value);
  assert.ok(buildCSS(value).includes(wallpaper));
  assert.throws(() => imageData(Buffer.alloc(5 * 1024 * 1024 + 1)), /5 MB/);
});
