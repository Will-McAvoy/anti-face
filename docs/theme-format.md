# 主题数据约定

当前内置主题在 src/themes.ts 中，由 Theme 类型约束：
id / name / description / mode / accent / background / panel / foreground / muted / gradient / glass。

Appearance 是可覆盖的外观参数：blur (0–40px)、opacity (35–100%)、radius (0–28px)、wallpaper (本地图片 data URL 或 null)。

计划的可导入主题格式应增加 schemaVersion 和 assets 清单；外部主题必须经主进程校验。颜色仅接受严格格式，背景仅允许本地已复制的图片，数值限制范围。不允许外部主题携带可执行脚本、任意 CSS @import 或网络追踪资源。

预览 CSS 使用自己的模拟 DOM，因此其选择器不能直接用于 Antigravity。真实宿主选择器由适配器维护，并绑定已验证版本。
