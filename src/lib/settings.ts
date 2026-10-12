import { themes } from '../themes';
import type { Settings } from '../types';
export const defaultSettings: Settings = { schemaVersion: 1, themeId: 'graphite', appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null } };
export function parseSettings(value: unknown): Settings {
  const s = value as Settings;
  if (!s || s.schemaVersion !== 1 || !themes.some(t => t.id === s.themeId)) throw new Error('配置版本或主题无效');
  const a = s.appearance;
  if (!a || !Number.isFinite(a.blur) || a.blur < 0 || a.blur > 40 || !Number.isFinite(a.opacity) || a.opacity < 40 || a.opacity > 100 || !Number.isFinite(a.radius) || a.radius < 0 || a.radius > 28) throw new Error('外观参数无效');
  if (a.wallpaper !== null && (typeof a.wallpaper !== 'string' || a.wallpaper.length > 7 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(a.wallpaper))) throw new Error('壁纸数据无效');
  const parsed: Settings = { schemaVersion: 1, themeId: s.themeId, appearance: { blur: Math.round(a.blur), opacity: Math.round(a.opacity), radius: Math.round(a.radius), wallpaper: a.wallpaper } };
  if (s.preset === 'performance' || s.preset === 'balanced' || s.preset === 'visual') parsed.preset = s.preset;
  if (typeof s.autoRestoreOnReload === 'boolean') parsed.autoRestoreOnReload = s.autoRestoreOnReload;
  if (s.history && typeof s.history === 'object') {
    const days = s.history.retentionDays;
    parsed.history = {
      enabled: s.history.enabled === true,
      retentionDays: days === 7 || days === 30 || days === 90 ? days : 30
    };
  }
  return parsed;
}
export function themeExchange(settings: Settings): Settings {
  const theme: Settings = { schemaVersion: 1, themeId: settings.themeId, appearance: settings.appearance };
  if (settings.preset) theme.preset = settings.preset;
  return theme;
}
export function readImage(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('请选择小于 5 MB 的图片'));
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return Promise.reject(new Error('仅支持 PNG、JPEG 和 WebP 图片'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
export function downloadSettings(settings: Settings) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(themeExchange(settings), null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'anti-face-' + settings.themeId + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
