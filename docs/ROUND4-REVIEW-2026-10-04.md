# 第四轮独立验收报告

日期：2026-10-04（Asia/Shanghai）。检查对象：Anti Face 0.3.0。
结论：构建与既有自动化通过，但第四轮不能判定为完整验收通过；存在真实状态一致性、失败事务和发布版音频路径问题。

## 实际执行结果

| 项目 | 本次结果 |
| --- | --- |
| npm run check | 退出 0；全新 TypeScript/Vite 构建成功；81/81 测试通过 |
| npm run test:desktop | 退出 0；原 UI、导入导出、重启、旧配置迁移、无 preload 回归通过 |
| npm run test:desktop:round3 | 退出 0；隔离 mock 宿主的多窗口/连接回归通过 |
| npm run test:desktop:round4 | 退出 0；第四轮当前脚本覆盖的默认值、主题库、导入错误、迷你窗路径通过 |
| node scripts/smoke-packed.cjs | 退出 0；win-unpacked 桌面冒烟通过 |
| node artifacts/round4-review/reproduce.cjs | 退出 0；复现 7 个当前缺陷，结果保存在 reproduction-results.json |
| node artifacts/round4-review/check-package.cjs | 52 个 desktop/core/shared/dist/assets/compatibility 文件逐字节一致 |
| 当前 portable SHA256 | e5d1fd8142f3afcabbba2d4277e9ed519c488cfa6eef0e4367b2a4deb00f954d |

本次未重新打包、未启动 portable 自解压外壳、未对用户真实 Antigravity 执行换肤/刷新/强杀、未改变 Windows 系统主题、未播放提示音。测试使用隔离 userData。没有修改产品实现。

## 已复现缺陷

| ID | 优先级 | 结论与证据 |
| --- | --- | --- |
| R01 | P1 | PreviewSession._drain 忽略 apply 返回 ok:false；commit 仍调用 save 并返回 idle/“试穿已保存”。复现 saved=true。 |
| R02 | P1 | AutomationService.tick 在等待 hostAvailable 后不复核手动事件代次。等待期间 noteManual('rose')，恢复后仍应用 graphite。 |
| R03 | P1 | ThemeLibrary.saveNew 在持久化前修改 this.data；写失败后内存保留失败主题，下一次成功保存将它一起写入磁盘。 |
| R04 | P1 | appearance.json 的未知未来 schema 被 _loadDocument 静默返回 null；之后 saveDocument 可以将 schema 99 覆盖为 1，没有冻结。 |
| R05 | P1 | NotificationPolicy 默认 now 为 () => 0，生产 NotificationService 未注入时钟；第一次提醒后不同任务等待 3.1 秒仍为 cooldown。 |
| R06 | P1 | 普通编辑器 applyEditorDocument 没有调用 noteManual；手动优先策略未接入最常用路径。 |
| R07 | P1 | cancelPreview 仅恢复 PreviewSession，StudioService.document 仍为未保存草稿；前端取消按钮也未回填文档和撤销栈。 |

复现脚本不连接真实宿主。它刻意展示当前错误行为，修复后要建立“断言正确行为”的正式回归测试，不能保留 reproduced=true 作为验收目标。

## 源码确认的问题与需求缺口

1. **发布音效路径不成立（P1）**：AudioPlayer 把 app.asar/assets/sounds/*.wav 交给系统 PowerShell/MediaPlayer；这些声音未 unpack，操作系统无法将 ASAR 当目录。实际 Test-Path 对 asar 与 asar.unpacked 对应声音路径均为 False。资源确实在包内，并非漏打包。播放器还只依据进程退出码返回结果，没有确认音频打开/播放成功。
2. **关闭失败仍隐藏（P1）**：desktop/main.cjs preview:resolveClose 捕获保存错误后仍 window.hide；取消返回 suspended 不抛异常也被当成功。前端无论结果都关闭 livePreview。
3. **多窗口试穿状态不一致（P1）**：前端 livePreview 是单一布尔，StudioService.document 也是单份；切换目标不按目标同步会话，未见主循环将宿主断线/刷新传入 preview.suspend。存在 A 会话仍活动、按钮却操作 B 的错误路径，需要集成复现。
4. **自动化状态与目标问题（P1）**：lastAppliedKey 只有 source/theme，无 target；选择 B 后相同主题可能跳过。noteManual 只更新 automation.config，未同步保存 preferences，后续 setPreferences 可覆盖暂停状态。应统一修正。
5. **预览与壁纸工作台不完整（P2）**：Preview.tsx 仍只接旧 Theme/Appearance，不使用 ThemeDocument 的区域、焦点、缩放、遮罩、亮度、排版；壁纸界面缺少可视化拖动，只有滑块；模糊层固定 inset:-64px，contain 是否真能完整显示需图像尺寸测试。
6. **主题库最多显示前 60 项（P2）**：snapshot 固定 query(pageSize:60)，前端仅过滤传入 items，无分页；第 61 项无法通过该搜索找到。缩略图生成了但前端未渲染实际主题缩略图。收藏重排使用过滤后的可见列表，需验证搜索下排序。
7. **后台变更未同步编辑器（P2）**：主页面轮询 targets/status/telemetry，不同步 Studio document；托盘/快捷键/自动换肤后编辑器可能仍保留旧主题，再点击应用覆盖后台选择。
8. **迷你窗生命周期未完成（P2）**：窗口无原生标题栏，页面未见拖动区；mini:move 接口存在但页面无移动调用；无 move/resize/display change 到持久化的完整接线。不能仅凭 clampBounds 单元测试声称位置保存和多显示器适配完成。
9. **文档证据过期/矛盾（P2）**：测试报告仍写 79 项、旧前端文件和旧哈希，当前为 81 项且 portable 为 101,579,517 字节；验收矩阵与测试报告对真实宿主/系统明暗测试的陈述不一致。需按实际运行记录统一。

## 为什么现有测试没抓到

- 许多 Txx 测试直接调用纯模块并注入成功依赖，没有经过 StudioService→IPC→UI。
- 提醒测试注入了假时钟，遗漏生产默认构造。
- 磁盘失败测试没有继续执行下一次成功写入并检查磁盘内容。
- 试穿失败测试侧重 save 失败，遗漏 apply 返回 ok:false。
- 自动事件测试只覆盖进入 tick 之前的旧事件，没有覆盖 await 中途发生手动操作。
- 第四轮 smoke 中迷你窗不存在时用 if(mini) 跳过，不是严格创建/关闭断言。
- 打包 smoke 没有验证外部播放器读取包内资源。

## 修复入口

详见项目根目录 FOURTH_ROUND_FUNCTION_FIX_PROMPT.md。
优先完成 R01–R07、音效路径和关闭行为，再处理状态同步与第四轮尚未闭环的功能。不能以 81 项通过代替上述失败路径验收。

