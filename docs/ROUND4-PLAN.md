# 第四轮方案与阶段记录

日期：2026-10-04。仓库没有 Git，变更直接落在当前目录。没有先恢复用户宿主上的主题。

## 方案

继续使用 Electron + React + TypeScript + Vite，后端保持 CJS。外观变更都进 `desktop/studio-service.cjs`：校验、目标窗口、试穿冲突、兼容性，然后调用原来的 `ThemeService` 写入同一个样式节点。没有第二套注入器。

每个试穿目标有自己的 revision / generation。CDP 写入仍走 `ThemeService` 原来的全局串行队列。原因：第二轮和第三轮的恢复竞态依赖这条队列，同一条 CDP 连接也不适合并发 `evaluate`。等价验收是 T11：延迟的 A 草稿不能写到 B，同一目标同时只有一个 pending。

旧 `settings.json` 保持 schema 1，这样已有回归和桌面冒烟继续读到 `themeId`、`appearance.blur`、`autoRestoreOnReload` 和 `history`。第四轮的主题文档、主题库、偏好和图片分别放在 userData 的 `appearance.json`、`theme-library.json`、`preferences.json` 和 `assets/`。未知的更高版本会冻结写入，不把原文件改成默认值。

## 试穿状态

`idle → starting → active → committing 或 cancelling → idle`。

另外有 `suspended`（断线或无法确认恢复）和 `comparing`（按住查看试穿前）。取消时按 baseline 恢复：没有样式就移除本工具样式，已有主题就写回那份主题。磁盘保存失败时停留在 active，文案是「已试穿但未保存」。

## 阶段

| 阶段 | 结果 |
| --- | --- |
| M0 | 无 Git。当前包当时是 0.2.1。界面版本改为读 `package.json`。 |
| M1 | schema、继承、迁移和图片解码有纯函数测试。 |
| M2 | 试穿、撤销、慢响应和切换目标有可运行服务。 |
| M3 | 区域 CSS 与壁纸背景层有 computed style 测试。真实宿主视觉未在本轮注入。 |
| M4 | 主题库重启由桌面冒烟验证。定时规则用假时钟。 |
| M5 | 托盘关闭决策、快捷键冲突、迷你窗权限和提醒去重有测试。真实全局快捷键注册留给用户打开开关后查看界面状态。 |
| M6 | 源码重新构建并打包 0.3.0。真实宿主换肤本轮没有做，见测试报告。 |
