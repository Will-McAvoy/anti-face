# Grok 第五轮完成情况复查

日期：2026-10-06。被查版本：0.4.0。对照：FIFTH_ROUND_GROK_IMPLEMENTATION_PROMPT.md。

## 结论

已完成大量真实实现：10 项均有模块及界面，包含 schema 2、20 套离线精选、版本存储、截图和主进程接口，并有发布包。不是只有设计稿或空文件。

但不能通过第五轮完整验收：本次发现 6 个隔离可复现的问题，加上共享预览链路和若干功能验收缺口。应定为“功能初版已交付，需要修正与补验收”，而不是“10 项完整完成，仅差真实宿主测试”。不按文件数量给虚假的完成百分比。

## 本次实际运行

| 命令 | 结果 | 能证明什么 |
| --- | --- | --- |
| npm run check | 退出 0，115/115 测试，构建与类型检查通过 | 现有回归通过，不代表遗漏场景通过 |
| npm run test:desktop:round5 | 退出 1 | 点击加入个人库后，在 smoke-round5.cjs:44 读取尚不存在的 theme-library.json 时 ENOENT；轮询未处理初次文件尚未创建 |
| node scripts/verify-round5-package.cjs | 退出 0 | 58 个源码文件及前端产物、20 套精选资源与包核对通过 |
| node scripts/review-round5-completion.cjs | 退出 0，6 个缺陷场景成功复现 | 此脚本断言缺陷存在，不能计作产品验收通过 |

便携 EXE：release/Anti Face 0.4.0.exe，101,629,009 字节，SHA256 bfe1518ba917aa60838ee28a0b593f3a2ee7d67261bcf24d6874e83029da30ec。

本次未重跑耗时较长的 smoke-round5-e2e.cjs、完整旧轮次桌面套件和 packed smoke；文档中的 E01–E12 全通过是之前记录，不是本次重新验证的结论。本次未给真实宿主换肤、截图或修改其设置。

## 已复现的功能问题

### R01 / P1：阅读保护依赖先运行另一项功能

代码：desktop/round5-service.cjs 的 analysisFor、explain、decorateApply、generate；core/effective-appearance.cjs。

analysisFor 只从 pixelCache 取像素，代码中像素缓存的填充发生在 generate 完成后。普通导入壁纸、从个人库载入、重启后恢复并不会主动准备阅读保护像素。本次使用有有效资源元数据、但未运行“生成整套主题”的场景，保护结果为 status=unknown、reason=missing-image、adjustments=0。

这不是图片源不存在，而是阅读保护没有独立完成数据准备。viewports 也主要依赖 explain 的传入值，界面传固定 1280×800，而非持续观测真实窗口；会影响保护和构图。

建议：把图像分析准备移入独立共享服务；apply/analyze 前按资源哈希准备有界像素，支持重启和淘汰；使用目标视口。补普通导入即保护、重启恢复、换图取消和 resize 测试。

### R02 / P1：自动场景的旧异步任务仍能覆盖手动操作

代码：desktop/round5-service.cjs:304 的 onAutoScene。

仅在 await decorateApply 之前检查 manualHolds/preview；等待完成后没有重新检查，传给 applyDocument 的 meta 也没有 isCurrent 栅栏。

隔离复现：阻塞 decorateApply → 用户 hold(A) → 释放旧任务，仍发生一次 apply，cancellationGuard=false。

建议：将场景决策绑定窗口代次；手动暂停、恢复、取消、切主题和进入试穿都立即使旧任务失效，并把校验贯通实际注入及验证/回滚阶段。

### R03 / P1：场景切换会使用其他窗口保存的主题

代码：desktop/round5-service.cjs:305；desktop/studio-service.cjs 的 applyLibraryTheme/saveDocument。

onAutoScene(targetId) 读取单个 this.studio.document，而不是该 target 的文档。不同窗口应用主题会改变全局文档。

隔离复现：全局文档模拟已变为 B 的 pearl，再触发 A 场景切换，传向 A 的主题也是 pearl。该复现验证了服务数据流，未在真实 A/B 宿主窗口制造覆盖。

建议：保存每目标已确认文档/有效状态，编辑器文档与目标基线分开；补两窗口应用不同主题后分别自动切换场景、切项目和重载的端到端测试。

### R04 / P1：清除或切换窗口后，截图迟到结果仍可保留/显示

代码：desktop/capture-service.cjs clear/take；src/components/HostComparePanel.tsx shoot/useEffect。

clear 只移除现有缓存，没有使在途截图失效。隔离复现：开始慢截图 → clear(A) → 截图返回，缓存重新出现 1 组。

界面另有同类问题：切 target 只重置 state，旧 shoot 闭包在 await 后没有核对新 target 或请求代次；可能把 A 的截图显示在 B 面板。此界面竞态为代码路径确认，未做额外双窗口截图 E2E 复现。

建议：截图采用每目标/面板请求代次，clear/unmount/target change 同时取消；补迟到截图、迟到 captureImage 和连续清除测试。

### R05 / P1：历史写入失败仍返回恢复成功

代码：desktop/round5-service.cjs remember/restoreRevision；src/components/ThemeRevisionPanel.tsx。

restoreRevision 先保存文档，remember 将版本写入异常转换为 ok:false，但外层仍返回 ok:true；界面也没有处理嵌套失败。

隔离注入版本写入磁盘失败：operationOk=true、revisionOk=false，错误为 simulated disk full。

建议：定义文档与历史索引的提交/补偿协议；无法提交版本时明确报告部分成功或回滚，不要统一显示成功。补恢复、个人库保存和精选更新的写盘失败链路。

### R06 / P2：配色 worker 超时后请求不结束

代码：desktop/round5-service.cjs:372–381。

计时器只 terminate worker；等待消息的 Promise 只监听 message/error，没有 exit 或独立超时 reject。worker 在发消息前被终止时，Promise 可以一直 pending，finally 无法清理 jobs。

隔离复现使用静默 worker 与缩短的注入时钟：workerTerminated=true、requestState=pending、jobsRetained=1。未让真实解码进程卡死。

建议：message/error/exit/timeout/cancel 都汇入一次性 settle，确保清理定时器、监听器和 jobs，取消应实际结束工作。

## 代码确认的结构与范围缺口

### 共享预览链路未真正统一（P1）

src/components/Preview.tsx 仍从原始 document 手工读取颜色、透明度和焦点，src/App.tsx:622 直接传入 round4.document。没有消费 resolveEffectiveAppearance 的场景、构图和阅读保护结果。

因此“纯函数存在”不等于预览和宿主一致。应让 Preview、应用、候选和精选共用 effective model，再比较开启自动保护/场景/构图后的预览与宿主 computed style。

### 验收要求尚有删减

- F01：目前只建立 chat 区域模型，未分别验证输入框、侧栏、辅助文字；阅读保护面板没有提示词要求的锁定参数控件。
- F02：VerificationPlan 主要检查 owned style、body 色/filter、背景 pointer-events 和区域圆角；缺少图片实际加载与重点面板透明度、排版等核对，不能泛称完整视觉自检。
- F05：有矩形编辑，但完整键盘操作、视口跟随以及与真实预览共用计算仍需补验收。
- F06：界面只有前后两图，没有规定的区域选择、缩放和滑块对比；hideSensitive 固定 false。后台 MASK_ON 是整窗纯色遮挡，不能当成选择性隐藏聊天的效果对比。
- F07：界面调用 generateThemes 时锁参数固定为空对象，仅提供“采用整套”，没有按角色采用和锁定入口；依赖于 UI 的相关承诺尚未完成。
- F08：项目识别来自用户输入 workspaceId 或选择目录；没有看到稳定宿主项目身份自动观测接入。持久化绑定不等于重启后自动识别项目，需明确降级或补全。
- F09：界面只提供最近两版路径列表、整套与侧栏恢复，未提供任意两版比较、前后值、各组局部恢复和版本缩略图。
- F10：20 套内置资源及安装路径确实存在；无线上服务已明确说明。远程 provider 的存在不能算线上主题中心已部署，这一点交付文档表述较诚实。

## 按 10 项的判定

| 功能 | 本次判定 |
| --- | --- |
| F01 阅读保护 | 有算法和入口，独立数据准备/区域覆盖/预览接入不足，未完整完成 |
| F02 自检恢复 | 有基础验证与回滚，核对范围不足，需扩展验收 |
| F03 诊断 | 基础实现与页面存在，真实宿主能力仍待验证 |
| F04 场景 | 有识别/观察/模式，存在手动优先和多窗口缺陷 |
| F05 构图 | 有求解器与矩形编辑，真实视口及统一预览仍有缺口 |
| F06 截图 | 有截图与导出，但取消竞态和对比交互未完成 |
| F07 配色 | 有本地 worker/三方案，锁定/局部采用及超时收尾需修正 |
| F08 项目外观 | 有绑定存储和优先级，自动身份恢复与窗口隔离需补全 |
| F09 历史 | 有持久化、diff、pin、恢复，但失败反馈与操作范围不足 |
| F10 精选 | 离线实现较完整；远程未配置；本次 smoke 失败需处理后重新验收 |

## 建议下一步

先修 R01–R06 和共享预览链路，再补 UI 功能缺口；之后重跑全部旧回归、第五轮专项和 E01–E12，并加入本文遗漏场景。最后在用户指定测试窗口做真实宿主验收。不要立即开启下一轮 10 个新功能。

## 证据和本次修改范围

- `scripts/review-round5-completion.cjs`：6 个隔离缺陷复现，退出 0 表示复现成功。
- `artifacts/round5-completion-review.json`：机器可读结果。
- 本报告与复现文件为本次新增；业务源码未修改。
- 运行 build/test/package verification 刷新了 dist 和相关测试产物。未重新打包，也未启动便携自解压外壳。

