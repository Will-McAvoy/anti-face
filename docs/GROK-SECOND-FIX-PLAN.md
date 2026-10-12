# Anti Face 第二轮修正方案（v0.4.2）

日期：2026-10-07。基线：v0.4.1。本方案对应 `GROK_SECOND_FIX_PROMPT.md` 的 M01–M09。它描述已经落地的结构，不是待办清单。v0.4.1 的「全部完成」结论被本次复核否定，保留为历史，不在这里重复成当前状态。

没有 Git。改动前的副本在 `.backups/grok-second-fix-2026-10-07`。历史复核脚本 `scripts/review-gemini-2026-10-07.cjs` 和 `artifacts/review-gemini-2026-10-07.json` 不改。

## 共用约束

样式生成、核对、预览和真实应用共用 `core/style-contract.cjs` 与 `core/effective-appearance.cjs`。窗口状态在 `Round5Service.getTargetState`：每个目标有自己的 `instanceId`、`activeDocument`、代次和 viewport，不从全局草稿或全局 viewport 播种。保存结果用 `remember()` 的 `{ ok, revisionSaved, operationId }`，失败留下可重试的 pending，不把历史失败报成已完整成功。

模拟宿主 `tests/fixtures/desktop-round5-host.cjs` 只证明按钮和 IPC。样式对错由真实 Chromium 读计算后的颜色、模糊和图片。真实 Antigravity 窗口不在本轮环境里，验收里写「未验证」。

## M01 样式核对

区域背景是 `color-mix` 进 panel 的 alpha，不是元素 `opacity`。容差来自同一份合同：RGB 2、alpha 0.02、模糊 0.5px。聊天字号读 `CHAT_CONTENT_SELECTOR`，不读 `body`。壁纸模糊读 `body::before` 的数值 blur；没有壁纸时不要求伪元素。图片检查要能加载，不只看 url 子串。

`core/apply-verification.cjs` 解析 Chromium 的 `color(srgb … / alpha)` 和 rgba，再与计划比较。正确 CSS 必须通过，故意改错的 alpha 必须失败。回归：`tests/grok-second-fix.test.cjs` 的 `realCssVerification`。

## M02 窗口实例和项目身份

新状态带 `instanceId`（UUID）。旧场景任务同时比较 `instanceId` 和代次，同 ID 重连后旧任务写入 0 次。`onAutoScene` 只用该窗口的 `activeDocument` 或该窗口自己的 `desiredSettings`，不再回退 `studio.document`。

`dropTarget` / `replaceTarget` 标记 disposed、递增代次、删状态，并清截图、当前项目关联、viewport、冻结场景和建议。不可靠识别删掉 `target:<id>`，保留已有的永久项目键。断开检测走 `ThemeService` 的真实替换/丢弃，而不是只清空一个页面列表。

回归：`targetIdReuse`、`nativeTargetInheritsDraft`、`unknownProject`、`disconnect calls the real drop chain`。第五轮 E04 改为先 `setActiveDocument`，断言仍是稳定场景应用 1 次、再 1 次、手动保持后不再增加。

## M03 历史失败

`ThemeRevisionStore.record` 支持 `operationId`。提交过的日志直接返回；`index` 故障在记录文件写完后失败，重启 `load()` 把 pending 收成一条。`revision` 故障在写入前抛出 `SAVE_FAILED`。

`remember()` 先放入 `pendingSaves` 再写。失败返回 `{ ok: false, revisionSaved: false, retryable }`，不把异常吞成成功。`applyEditorDocument`、库保存和库更新都把这个结果传出去。核对状态是 `unknown` 时不记历史，也不假装已核对。

界面在 `revisionSaved === false` 时显示部分失败和「重试写入历史」。重试 IPC 是 `revisions:retry`。它必须在 `core/ipc-policy.cjs` 的主窗口允许列表里；迷你窗不能调用。拒绝或抛错要显示出来，不能让按钮点了没有下文。

回归：`historyFailure`、`historyRetryChannel`、`history disk boundary`，以及 `scripts/smoke-grok-second-fix.cjs` 的按钮重试。

## M04 图片、缓存、viewport

分析键是 `content:<sha256>:v2-full-512`。合法 PNG/JPEG/WebP data URL 自己解码，不再报 missing-image。非法类型是 `UNSUPPORTED_IMAGE`。缓存是 LRU，默认 16 MiB、16 条，没有无界像素旁路。大于等于 512 KiB 的缓冲走 worker，并且 `decodeOnly`。`prepare()` 合并 in-flight，并检查 epoch / stopped。

`Round5Service.pixelCache` 保留空 Map，只为既有 E06 的 `.has` 不抛错；生成路径不往里填。宿主 viewport 存在目标状态上，预览 viewport 只随预览请求走。采用建议时对照建议快照；文档或窗口实例变了就 `STALE_SUGGESTION`。

回归：`legacyImage`、`adopt rejects a suggestion after the document changes`、`generate refuses a third concurrent worker and does not keep a pixel side cache`。

## M05 预览场景和多区域保护

`chooseScene`：`contextKind === 'preview'` 且 `previewScene` 是 home 或 chat 时，即使工作室预览阶段是 idle，也返回该场景，来源 `preview`。`explain()` 的 `scene` 是字符串；`sceneSource` 另给。`protectRegions` 在模式不是 off 时改最终颜色。侧栏文字角色用 `colors.muted`，缺失时才用 `colors.foreground`，避免空颜色把候选计算打崩。

回归：`previewScene`。按钮「预览首页 / 预览对话」在第二轮冒烟里点击。

## M06 截图和对比

`CaptureService.clear(null)` 递增 `clearEpoch`，并抬高每个已知目标的代次。尚未登记的在途写入也会因 epoch 失败。滑块只在 clip、DPR、viewport、导航和实例都相容时可用，否则退回并排。签名存在每次截图上。

遮挡是若干局部块，遮罩底是透明的，不是整屏涂黑。坐标来自元素盒，不是写死的全屏矩形。滑块用 `clip-path: inset(...)`，两张图的布局宽度不变。100% 且已知像素尺寸时，`frameBox` 用真实像素，不把图缩放去适应。

切窗（对比页还开着时换目标）、点清除和断开会删掉已拍下的图。离开对比页只作废还没写进缓存的拍摄，已经拍完的一组留下来，这样去应用主题再回来仍能拍「应用后」。拍摄按钮在请求失效后恢复空闲。回归：`clearAll`、`leaving the panel keeps a finished pair`、`differentClips`、`occlusion and slider`，以及冒烟里的慢截图切窗。E08 依赖这组前后图在离开页面后仍然配对。

## M07 配色生成

换图之后可以再次生成；进行中的请求可取消。生成并发上限默认 2，第三路返回 `BUSY`。图片分析 worker 上限默认 1，排队而不是无界开线程。取消和停止都会结束 Promise，并清掉 job。回归：`generate refuses a third concurrent worker…`，冒烟在延迟读图期间换壁纸后仍能生成到「深色专注」。

## M08 项目关联和历史文案

不可靠身份显示「重启后要再次手动关联」。用户选中文件夹并形成可靠手动关联后，才显示持久绑定还在、但重启后当前窗口不会自动认成这个项目，需要手动重新关联。这不是自动识别。版本历史面板的颜色来自该版本自己的文档；缺壁纸只显示颜色。恢复如果文档已保存而历史没写完，同样给出重试，而不是报成整次成功。

## M09 测试、版本和包

新测试在 `tests/grok-second-fix.test.cjs`，由 `npm test` 和 `npm run test:grok-second` 执行。按钮链路是 `node scripts/smoke-grok-second-fix.cjs`。版本 0.4.2 只改 `package.json` 和 lockfile 根上的两处版本；不改 `pe-library` 等嵌套依赖。保留 `release/Anti Face 0.4.1.exe`。打包后若再改业务源码，必须重编重包。

命令、退出码和未验证项写在 `docs/GROK-SECOND-FIX-TEST-REPORT.md` 与 `docs/GROK-SECOND-FIX-ACCEPTANCE.md`。机器可读结果在 `artifacts/grok-second-fix/results.json`，数字来自当次运行日志。
