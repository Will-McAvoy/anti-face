# 第五轮架构

当前版本 v0.4.0。主题文档升到 schema 2。个人库、偏好、`settings.json` 和 `appearance.json` 信封仍是 schema 1。信封里的 `document` 可以是 schema 2。未来 schema 只读原文件，不改写。第一次启动如果还没有 `appearance.json`，会用现有 schema 1 设置迁移出一份文档：阅读保护关闭、对比目标 4.5、场景关闭、构图手动且矩形为空。这不改原来的颜色和焦点。

## 共享链路

`core/effective-appearance.cjs` 的 `resolveEffectiveAppearance` 是唯一的有效外观计算。预览、真实应用、配色候选和精选预览都走它。渲染进程不引入 `node:crypto` 或图片解码。

计算顺序：

1. 校验并迁移主题文档。
2. 场景只使用 `home` / `chat`。标题不能当场景。试穿期间冻结进入试穿时的场景。
3. 构图用 `core/wallpaper-layout.cjs` 的同一套 cover/contain 变换。策略是 `manual`、`protect-subject`、`protect-text`、`balanced`。主体和文字区冲突给出 `COMPOSITION_CONFLICT`，不缩放或模糊 `body`。
4. 阅读保护默认关闭。`suggest` 只出建议。`auto` 只改当次有效外观，不写回主题，除非用户点“采用到主题”。对比用最差和 p10，不用整图平均。没有像素样本时不给满分。

## 优先级

`core/priority.cjs` 的 `arbitrateDecision`：

1. 试穿中：推迟，不应用新的自动结果。
2. 手动固定：压过项目和定时。
3. 绑定的主题已不存在：不改去绑另一套。
4. 可靠且启用的项目绑定：压过定时和系统主题。定时关闭时，项目绑定仍然可以应用。
5. 其余沿用原来的定时决策。

手动固定按窗口保留，直到恢复自动或用户明确改绑。旧的代次栅栏还在：慢返回不能覆盖更新的窗口或更新的决定。

## 应用与恢复

`desktop/theme-service.cjs` 的 `applyDocument` 在 `verify: true` 时带上核对计划。壁纸指针检查只在这次应用真有壁纸时加入，并且是必查项。可选区域缺失得到 `partial`，不会自动当成完全核对通过。

核对失败先回滚再抛 `VERIFY_FAILED` 或 `RESTORE_UNCONFIRMED`。捕获这个错误时不再次恢复，避免把已经确认的旧样式清掉。`partial` 不能在未允许降级时提交试穿。

## 持久化

- 项目身份只用工作区 id 或规范化本地路径。Windows 盘符大写，其余小写，反斜杠，解析 `.` 和 `..`。界面只显示目录名。渲染进程不能自己造 `projectKey`。
- 绑定文件 schema 1。窗口会话绑定只在内存里。
- 版本记录先写不可变 `records/<id>.json`，再原子更新索引。保留固定项、当前项，以及有限条未固定历史。相同内容不重复记，恢复动作除外。
- 删除个人主题默认留着历史引用。只有明确 `releaseHistory` 才释放。资源回收跳过仍被版本引用的文件。
- 精选安装不自动应用。安装后的文档会写入壁纸 `assetId`，所以脏标记比较的是库里前后两份文档，而不是目录 payload 的哈希。用户改过的副本不会被静默替换。

## 进程边界

主进程新增能力走 `readability:*`、`diagnostics:*`、`scene:*`、`capture:*`、`generator:*`、`bindings:*`、`revisions:*`、`catalog:*`。迷你窗不能截图、安装主题或修改主题。

诊断导出去掉 URL、标题、完整路径和令牌。截图留在内存，直到用户自己导出。遮挡聊天的截图不能当作阅读保护证据。

远程精选源生产环境不配置。界面写“内置精选”和“远程源未配置”。测试里的远程地址只接受预配置来源，并核对响应和哈希。

图片生成在 `desktop/workers/image-analysis.cjs`。这个 worker 被解包出 asar。取消会在任务登记前生效；关闭面板或再生成一次会取消上一张图的任务，不会把上一张的候选写进当前界面。
