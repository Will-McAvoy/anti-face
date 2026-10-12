# 第五轮验收

版本 v0.4.0。状态只用这四种：

1. 已实现且自动化及所需真实场景验证通过。
2. 已实现且自动化通过，真实环境待验证。
3. 当前数据来源不支持，已明确降级。
4. 未完成或存在阻断。

没有用户指定的 Antigravity 测试窗口，所以凡是要改宿主外观或截宿主画面的项都不是状态 1。不要把本页读成“全部完成”。

| 项 | 状态 | 实现 | 自动化 | 真实环境 |
| --- | --- | --- | --- | --- |
| F01 阅读保护 | 2 | `core/readability.cjs`，`src/components/ReadabilityPanel.tsx` | `阅读对比使用独立的黑白 21:1 和同色 1:1`；`亮点图不能靠平均亮度蒙混`；`没有图片采样时不给满分`；`E01 阅读建议不改原文档` | 未在真实宿主上核对正文、代码和输入框 |
| F02 自检与恢复 | 2 | `core/apply-verification.cjs`，`desktop/theme-service.cjs` | `没有壁纸时核对计划不因伪元素失败`；`E07 写入成功但颜色被盖住时要失败并确认恢复` | 未在真实宿主上制造样式覆盖 |
| F03 诊断 | 2 | `desktop/diagnostics-service.cjs`，`src/components/DiagnosticsPanel.tsx` | `E12 诊断导出去掉路径、标题和令牌`；Electron 烟测点了“重新检查” | 未连接真实宿主，诊断结果是未连接 |
| F04 场景 | 2 | `core/scene-policy.cjs`，`desktop/scene-observer.cjs` | `场景迟滞不会因为一次抖动切换`；`E04 场景稳定后才切换，手动固定不再自动应用` | 未在真实首页/聊天页上确认 |
| F05 构图 | 2 | `core/wallpaper-layout.cjs`，`src/components/WallpaperCompositionEditor.tsx` | `构图按手算的 cover 裁切，冲突会告警`；模拟宿主按钮链路拖过一次「主体」 | 未在宽窄真实窗口上目视 |
| F06 截图对比 | 2 | `desktop/capture-service.cjs`，`src/components/HostComparePanel.tsx` | `截图按目标隔离，超时和遮挡都会收尾`；`E08` 在模拟宿主上点「拍摄之前」「拍摄之后」 | 没有真实截图。像素差只是提示，不是宿主生效证明 |
| F07 整套配色 | 2 | `core/palette-generator.cjs`，`desktop/workers/image-analysis.cjs` | `三套配色角色不同，锁定强调色会被保留`；`E06` 在模拟宿主上点取消；打包烟测导入图片后生成并保存 | 未在真实宿主上试穿生成结果 |
| F08 项目外观 | 2 | `core/project-identity.cjs`，`core/priority.cjs`，`desktop/project-bindings-store.cjs` | `项目路径规范化，标题不能当项目`；`优先级：试穿和手动优先，悬空绑定不换主题`；`E02` 两个窗口绑定不同项目主题；`E05` 改绑的是 proj-alpha | 未对两个真实窗口分别换肤 |
| F09 版本历史 | 2 | `desktop/theme-revision-store.cjs`，`core/theme-diff.cjs` | `迁移不改变可见颜色，局部恢复只动侧栏`；`版本修剪保留固定和当前`；`E01` 试穿提交只增加一条版本；`E11` 未来 schema 保存失败且文件字节不变 | 未做“删主题后重启再恢复”的人工操作。服务测试覆盖了引用不被回收 |
| F10 本地精选 | 2 | `assets/catalog`，`desktop/catalog-service.cjs`，`src/components/ThemeCatalogPanel.tsx` | `内置精选可安装、脏副本不被静默覆盖`；`未来精选目录版本被拒绝`；`E10` 与两条 Electron 烟测都加入了「石墨夜读」。打包烟测还生成并保存了「打包生成」 | win-unpacked 已离线加入个人库，并读到包内预览图、壁纸和已解包的分析 worker。便携外壳没有单独双击。没有线上服务 |
| F10 远程精选 | 3 | 生产 `remoteBaseUrl` 为空 | 本地 HTTP 桩拒绝错误来源、404 和坏正文。不是线上服务 | 线上主题服务没有部署 |

明确没做：账号、社区、支付、云端生成、视频壁纸、跨宿主和插件系统。

`node scripts/smoke-round5-e2e.cjs` 在模拟宿主上走完 E01–E12 的按钮、滑块、拖动和对话框，退出码 0，用时 281.84 秒，输出 `PASS: round5 button chain E01-E12 on simulated host`。宿主、时钟和文件框是测试夹具，业务方法仍是正式实现。这不是真实 Antigravity，上表状态保持 2 和 3。`node scripts/smoke-packed.cjs` 在当前 win-unpacked 里打开离线主题中心、诊断、版本历史，加入「石墨夜读」，导入图片后生成并保存「打包生成」，并用 `process.getBuiltinModule` 读了包内 PNG 和解包 worker，退出码 0，用时 130.95 秒。`scripts/accept-round5-host.cjs` 和 `scripts/verify-host.cjs` 没有对真实窗口运行。便携外壳没有双击。冷启动相对 0.3.1 的增量没有测。
