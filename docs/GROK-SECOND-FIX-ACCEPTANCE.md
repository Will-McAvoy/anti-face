# Anti Face v0.4.2 第二轮验收

日期：2026-10-07。对照 `GROK_SECOND_FIX_PROMPT.md` 第 15 节。证据是当次命令日志，不是把旧的「已完成」抄过来。

真实 Antigravity 窗口未验证。模拟宿主通过只说明按钮和 IPC。

| 验收项 | 结果 | 证据 | 限制 |
| --- | --- | --- | --- |
| 正确 CSS 在真实 Chromium 通过；故意改错的 alpha 失败 | 通过 | `realCssVerification`，`04-grok-second-fix.log` | 不是 Antigravity 窗口里的目视 |
| 字体、模糊、图片与生成语义一致，不读错元素，不只查子串 | 通过 | `core/style-contract.cjs` 与 `core/apply-verification.cjs`；无壁纸时计划不因伪元素失败（第 2 条命令） | 同上 |
| 原生窗口不继承全局草稿；同 ID 重连后旧任务写入 0 | 通过 | `nativeTargetInheritsDraft`、`targetIdReuse` | 夹具里的目标，不是商业版窗口 |
| 断开、未知项目、恢复、切换走真实失效链 | 通过 | `unknownProject`、`disconnect calls the real drop chain`；冒烟 `disconnect-chain`；E04 次数未放宽 | 恢复路径沿用第五轮既有测试，本轮没有另造一个真实磁盘拔除 |
| 保存入口表达历史失败；有落盘边界和重启恢复 | 通过 | `historyFailure`、库保存/更新返回 `revisionSaved: false`、`history disk boundary`、冒烟重试按钮 | `revision` / `index` 故障是进程内注入。索引故障会留下记录文件再失败，新进程读同一目录。不是物理磁盘满 |
| asset 与 legacy 图都能独立分析；缓存没有无界旁路 | 通过 | `legacyImage`；分析缓存 16 MiB / 16 条；`pixelCache` 大小保持 0 | `pixelCache` 这个空 Map 还在，避免旧测试对 `.has` 抛错，生成不写入 |
| 宿主 viewport 与预览 viewport 分开；采用建议有快照 | 通过 | 目标状态的 viewport 不从全局播种；`adopt rejects a suggestion after the document changes` | 预览尺寸文案在冒烟里出现过 |
| 编辑预览 home/chat 会改变有效场景；多区域保护改变最终模型 | 通过 | `previewScene`；冒烟点了预览首页和预览对话；X07 仍通过 | 预览阶段可以是 idle |
| clear-all、切窗、卸载使截图失效，busy 恢复 | 通过，语义分两种 | `clearAll`；`leaving the panel...`；冒烟慢截图切窗后 A 的列表长度为 0 | 卸载作废还没写进缓存的拍摄，并让界面不再接收旧结果。已经拍完的一组不删，否则 E08 的前后对比不成立。点清除、断开、在对比页换目标会删除 |
| clip / DPR / 导航不兼容时不叠滑块 | 通过 | `differentClips` 得到 `incompatibility: clip` | DPR 与导航的判断在 `incompatibility()`，本轮新增断言覆盖的是 clip |
| 遮挡是局部的，不是整屏涂黑；区域不是固定坐标 | 通过 | `occlusion and slider` 读了遮罩块和截图像素；区域用测量选择器 | 夹具页面，不是真实聊天 DOM |
| 滑块不缩放上层图；100% 是实际像素 | 通过 | 同一测试里 0/50/100 的两张图布局宽度都是 200；`frameBox('100%')` 用像素 | 同上 |
| 换图后能继续生成；worker 结束路径和并发上限有证据 | 通过 | 第三路 `BUSY`；取消得到 `CANCELLED` 且 `jobs` 为空；冒烟换图后生成出「深色专注」；X06 仍通过 | 生成上限默认 2，图片分析 worker 默认 1 |
| 项目重启关联和版本历史文案与能力一致 | 通过 | 冒烟先见到「重启后要再次手动关联」，选文件夹后才见到「需要手动重新关联」 | 重启后的「不会自动认窗口」是文案和身份模型，没有把整个 Electron 进程杀掉再开一次来点这句 |
| 新测试断言的是行为；真实渲染和真实 UI 不是 mock 结果冒充 | 通过 | 16 项新测试；Chromium 与 Electron 分开 | Electron 宿主仍是夹具 |
| 源码、版本、锁文件、构建、包、校验一致 | 通过 | 0.4.2；锁文件根两处 0.4.2；`pe-library` 仍 0.4.1；包 101,642,031 字节，SHA256 `62c7c258f5038edbf3254db85f8addf312e68185e96ef74e3797bddecd5ebb7c`；比较了 61 个文件 | 打包之后只改了文档和这份结果，没有改业务源码，因此没有再打包 |
| 未验证项写明；旧的「全部完成」已改口 | 通过 | 本文、`docs/STATUS.md`、`README.md`，以及第五轮验收/测试报告顶部的历史说明 | 见下 |

## 未验证

- 真实 Antigravity 窗口：未验证。
- 便携外壳没有双击。已启动的是 `release/win-unpacked/Anti Face.exe`（`smoke-packed.cjs`）。

## 不能再说的话

v0.4.1 的「131 项全部通过，所以第五轮缺陷已经彻底解决」已被这次复核和 v0.4.2 取代。旧报告正文没删。当前以本文件和 `artifacts/grok-second-fix/results.json` 为准。
