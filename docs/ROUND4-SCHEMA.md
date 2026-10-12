# 第四轮数据约定

## 三类数据

- 主题文档 `ThemeDocument`，schema 1：基础主题、颜色、五个区域、壁纸参数、排版。
- 主题库 `theme-library.json`，schema 1：个人主题、收藏、缩略图引用。不包含历史、通知或快捷键。
- 应用偏好 `preferences.json`，schema 1：托盘、快捷键、提醒、自动切换、迷你窗。历史开关和刷新后自动恢复仍在 `settings.json`，避免旧版本读写互相覆盖。

导出的主题包 `kind: anti-face-theme-pack` 只带主题和内嵌图片。旧 schema 1 的 `{ themeId, appearance }` 仍可导入成一个新的个人主题。

## 继承

内置主题 → 全局覆盖 → 区域覆盖。缺省或 `inherit` 才继承。`blur: 0` 会保留。重置一个区域只清该区域。重置整套外观会清区域、壁纸和排版，界面文案与此一致。

数值范围见 `shared/appearance-ranges.json`。颜色只接受 `#RRGGBB` 或 0–255 的 RGB 整数。性能预设只改全局模糊、不透明度和圆角；对不上任一预设时记为 `custom`。

## 迁移

`migrateV1Settings` 把 schema 1 配置映射成主题文档，并原样带回 `autoRestoreOnReload` 和 `history`。不会把缺省的自动恢复写成 true。schema 大于已支持版本时，`SettingsStore` 和主题库停止写入，原文件字节不变。

## 壁纸

正式图片在 userData `assets/files`，按 SHA256 去重。前端拖动只提交焦点、缩放和效果，不重复传送图片字节。主进程用缓存的 data URL 生成 CSS。背景画在 `body::before`，`pointer-events: none`，模糊不放在 `body` 上。像素上限 25,000,000，文件上限 5 MB。PNG 会实际 inflate，JPEG 用 jpeg-js 解码，WebP 用 `@jsquash/webp`。

## 依赖

- `pngjs` 7.0.0，MIT，缩略图编码。
- `jpeg-js` 0.4.4，BSD-3-Clause，JPEG 解码。
- `@jsquash/webp` 1.4.0，Apache-2.0，WebP 解码。打包时 wasm 从 asar 解开。
