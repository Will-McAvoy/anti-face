# Anti Face v0.4.2 第二轮修正报告

日期：2026-10-07。基线 v0.4.1。没有 Git。改前副本在 `.backups/grok-second-fix-2026-10-07`。方案见 `docs/GROK-SECOND-FIX-PLAN.md`。命令见 `docs/GROK-SECOND-FIX-TEST-REPORT.md`。

真实 Antigravity 窗口未验证。下面的 Electron 按钮都跑在 `tests/fixtures/desktop-round5-host.cjs` 上，不能写成真实宿主通过。

## M01 样式核对

触发：复核里，生成正确的半透明主题在真实 Chromium 中被判失败。旧核对读元素 opacity，容差大到盖住明显偏差；聊天字号读错元素；模糊只查字符串里有没有 `blur`。

正确结果：核对和生成共用 `core/style-contract.cjs`。区域背景是混进 panel 的 `color-mix` alpha。RGB 容差 2，alpha 0.02，模糊 0.5px。聊天字号用 `CHAT_CONTENT_SELECTOR`。没有壁纸时不要求伪元素。

回归：`realCssVerification` 在真实 Chromium 里，正确 CSS 通过，故意改错的 alpha 失败。

## M02 窗口实例和项目身份

触发：选中窗口没有自己的文档时套用全局草稿；同 ID 重连后旧任务的 `isCurrent()` 仍为真；不可靠识别留下旧的 `target:` 关联。

正确结果：新状态带 UUID `instanceId`，不从全局草稿播种。`onAutoScene` 只用该窗口的 `activeDocument` 或该窗口自己的 `desiredSettings`。`dropTarget` 递增代次并清截图、当前关联、viewport 和建议。不可靠识别删 `target:<id>`，已有永久键保留。断开走 `ThemeService.inspect` / `listTargets` 的替换和丢弃。

回归：`nativeTargetInheritsDraft`、`targetIdReuse`、`unknownProject`、`disconnect calls the real drop chain`。E04 先 `setActiveDocument`，应用次数断言没改（1，再加 1，手动保持后仍是 2）。

## M03 历史失败

触发：`applyEditorDocument` 忽略 `remember` 的失败，仍报已应用且已核对。重试按钮点下去没有下文，因为 `revisions:retry` 不在主窗口 IPC 允许列表里，调用在补写之前被拒绝。

正确结果：失败返回 `revisionSaved: false` 和 `operationId`。库保存、库更新和编辑器应用都把这个结果传出。界面显示部分失败和「重试写入历史」；拒绝或抛错会留在提示里。索引故障在记录文件写完后失败，新进程 `load()` 收成一条，同一 `operationId` 再写是去重。

回归：`historyFailure`、`historyRetryChannel`、`history disk boundary`。冒烟在模拟宿主上点出失败提示，清掉故障后再点重试，出现「版本历史已经补写完成。」

故障注入的边界：`fault === 'revision'` 是写入前抛错，不是把磁盘填满。`fault === 'index'` 是记录文件已经原子写完、索引替换失败。重启恢复跑的是另一个 Node 进程读同一临时目录。

## M04 图片、缓存、viewport

触发：合法 PNG data URL 解出来了，分析仍是 missing-image。缓存旁路可以无界。采用建议不防文档已经变了。

正确结果：键是 `content:<sha256>:v2-full-512`。LRU 默认 16 MiB、16 条。大于等于 512 KiB 走 worker 且 `decodeOnly`。`pixelCache` 仍是空 Map，只为既有 `.has` 不抛；生成不往里填。建议快照和当前文档或窗口实例不一致时是 `STALE_SUGGESTION`。

回归：`legacyImage`、`adopt rejects a suggestion after the document changes`、`generate refuses a third concurrent worker and does not keep a pixel side cache`。

## M05 预览场景

触发：工作室预览阶段是 idle 时，`previewScene` 为 home 或 chat 仍得到 scene null，前后哈希相同。

正确结果：`chooseScene` 在 `contextKind === 'preview'` 时直接采用该场景。`explain()` 的 `scene` 是字符串。多区域保护走 `protectRegions`，会改最终颜色。侧栏文字缺 `colors.muted` 时用前景色，避免空颜色把计算打崩。

回归：`previewScene`。冒烟点击「预览首页」「预览对话」。

## M06 截图和对比

触发：`clear()` 只抬高已经在表里的目标，尚未登记的在途截图仍能写入。同视口、不同裁切仍允许滑块。遮挡曾经是整屏。滑块缩放上层图。

正确结果：`clear(null)` 递增 `clearEpoch`。离开对比页调用 `invalidate`，只作废还没落缓存的拍摄，不删除已经拍完的一组。否则去应用主题再回来就对不上「应用后」。这一点曾经把 E08 打成 `paired === false`，已改回，并保留 E08 原来的断言。在对比页换目标、点清除、断开，会删掉对应图。遮挡是局部块，底是透明的。滑块只用 `clip-path`，两张图布局宽度不变。100% 且知道像素尺寸时用真实像素。

回归：`clearAll`、`leaving the panel keeps a finished pair and drops an in-flight shot`、`differentClips`、`occlusion and slider`。冒烟里慢截图切窗后 A 的缓存是 0，B 可以再拍。E01–E12 在修正后退出码 0。

## M07 生成

触发：换图后生成停住；并发没有上限；worker 结束路径不清。

正确结果：生成并发默认 2，第三路 `BUSY`。图片分析 worker 默认 1。取消返回 `CANCELLED` 并清掉 job。冒烟在延迟读图时换壁纸，之后仍能生成到「深色专注」。

## M08 文案

不可靠身份显示「重启后要再次手动关联」。选中文件夹、形成可靠手动关联之后，才显示重启后当前窗口不会自动认成这个项目。这不是自动识别。版本颜色来自该版本自己的文档。

冒烟按了这两句文案，也走了断开后 `getTargetState('A')` 为空、再连上是新的 `instanceId`。

## 变更文件

相对 `.backups/grok-second-fix-2026-10-07` 有内容差异的：

`package.json`、`core/apply-verification.cjs`、`core/effective-appearance.cjs`、`core/readability.cjs`、`core/runtime.cjs`、`core/theme-css.cjs`、`desktop/capture-service.cjs`、`desktop/image-analysis-service.cjs`、`desktop/main.cjs`、`desktop/preload.cjs`、`desktop/round5-service.cjs`、`desktop/studio-service.cjs`、`desktop/theme-revision-store.cjs`、`desktop/theme-service.cjs`、`desktop/workers/image-analysis.cjs`、`src/App.tsx`、`src/types.ts`、`src/components/HostComparePanel.tsx`、`src/components/Preview.tsx`、`src/components/ProjectAppearancePanel.tsx`、`src/components/ReadabilityPanel.tsx`、`src/components/ThemeGeneratorPanel.tsx`、`src/components/ThemeRevisionPanel.tsx`、`tests/fixtures/desktop-round5-host.cjs`。

备份当时未覆盖、本轮写入或修改的：

`core/style-contract.cjs`、`core/compare-frame.cjs`、`core/compare-frame.d.cts`、`core/ipc-policy.cjs`、`package-lock.json`（只改根版本两处）、`tests/grok-second-fix.test.cjs`、`tests/round5-scenarios.test.cjs`（E04 在观察前写入该窗口自己的文档，断言次数未改）、`scripts/smoke-grok-second-fix.cjs`、`docs/GROK-SECOND-FIX-PLAN.md`、`docs/GROK-SECOND-FIX-REPORT.md`、`docs/GROK-SECOND-FIX-TEST-REPORT.md`、`docs/GROK-SECOND-FIX-ACCEPTANCE.md`。第五轮验收和测试报告只在顶部加了「已被取代」说明。

备份里当时与副本相同、文档阶段才改的：`README.md`、`docs/STATUS.md`。用户数据、个人主题库、`release/Anti Face 0.4.1.exe` 和其他旧版 EXE 没有动。

## 还没验证

- 真实 Antigravity 商业版窗口上的换肤、核对和截图：未验证。没有对不相关窗口自动换肤。
- `release/Anti Face 0.4.2.exe` 便携外壳没有双击。桌面检查启动的是 `release/win-unpacked/Anti Face.exe`。
