# 第六轮 0.5.1 测试报告

日期：2026-10-10。数字来自当次命令输出，不用 0.5.0 的 184 项或模块 smoke 7/7 代替。

## 命令与退出码

日志目录：`artifacts/round6-fix/resume-2026-10-10/`。下表是同一次顺序执行，前面失败则不会继续。第 11 条失败后又跑了一次，那次退出码 0，但锁等待可以在锁仍被占用时返回，不能当作强退通过。严格补跑见后文「2026-10-10 监督补跑」。

| 命令 | 退出码 | 耗时 | 日志 |
|---|---:|---:|---|
| `npm run check` | 0 | 61.9 秒 | `01.log` |
| `npm run test:round6` | 0 | 12.5 秒 | `02.log` |
| `node --test tests/round6-fix.test.cjs` | 0 | 5.5 秒 | `03.log` |
| `node --test tests/v043-regression.test.cjs` | 0 | 1.7 秒 | `04.log` |
| `node scripts/smoke-round6-fix.cjs` | 0 | 37.5 秒 | `05.log` |
| `node scripts/smoke-v043.cjs` | 0 | 33.7 秒 | `06.log` |
| `npm run test:desktop:round5:e2e` | 0 | 297.0 秒 | `07.log` |
| `npm run package` | 0 | 928.4 秒 | `08.log` |
| `node scripts/verify-round5-package.cjs` | 0 | 2.0 秒 | `09.log` |
| `node scripts/smoke-packed.cjs` | 0 | 163.9 秒 | `10.log` |
| `node scripts/smoke-round6-packed.cjs`（第一次） | 1 | 248.1 秒 | `11.log` |
| `node scripts/smoke-round6-packed.cjs`（锁等待放宽后的重跑，不作强退验收） | 0 | 269.8 秒 | 副本 `resume-2026-10-10/packed-results-weak-lock.json` |

`npm run check` 含构建，测试 207 项通过、0 失败、0 跳过。`npm run test:round6` 为 56 项通过。`tests/v043-regression.test.cjs` 为 4 项通过。`tests/round6-fix.test.cjs` 含在上述 Round 6 集合里，单独跑同样通过，其中有一条断言：备份包把绑定标成启用时，恢复后仍是关闭并要求重新关联。

## 各层分别证明什么

Node 层使用临时目录和合成 PNG。它断言恢复后的图片能从 AssetStore 读出，检查令牌过期、文件被换、重复提交和非法路径会在改 live 数据前失败，以及每个提交边界强退后是完整旧状态或完整新状态。这不是 Electron 界面。

开发态 Electron（`05.log`，`smoke-round6-fix.cjs`，退出码 0，2026-10-10T12:52:55Z 启动）启动了主窗口和切换窗，经 preload 完成导出、检查、预览和恢复。受控宿主上，电池策略把 computed `filter` 收到 `blur(8px)`，交流电事件恢复用户值且磁盘上的主题模糊仍是 28。安全模式下切换器注入次数不增加。保存被拒绝时草稿还在，且结果不是 saved。搜索后 Enter 会应用，Esc 会关闭。屏幕事件后主窗和迷你窗离开了坐标 20000。这次早于严格清理，其中的强退不能当作当前证据。同一条链在下面的监督补跑里重新通过。

Chromium 核对只覆盖上述受控宿主里的 computed blur，没有在真实 Antigravity 窗口上测量。

最终包核对 `verify-round5-package.cjs` 退出码 0：版本 0.5.1，比了 77 个源文件，前端资源为 `assets/index-DtNcNcKy.js` 与 `assets/index-Bj2m9pDA.css`。这是 ASAR 与当时磁盘一致，不是便携外壳已启动。

`smoke-packed.cjs` 退出码 0，启动的是 `release/win-unpacked/Anti Face.exe`。

`smoke-round6-packed.cjs` 第一次退出码 1，日志 `11.log`：备份、图片、性能持久化和安全模式拒绝已经通过，强退后的再次启动被 Windows 单实例锁挡住。随后的重跑把锁等待改成超时后只打印并继续，退出码 0（2026-10-10T13:32:34Z，269.8 秒）。锁仍占用且进程列表为空时，那次等待会返回，所以不能把它当成强退通过。`11.log` 和 `packed-results-weak-lock.json` 都保留。

最终包没有在同一次里跑切换器键盘和 computed blur。那两项只在开发态 Electron。

## 2026-10-10 监督补跑

只改了测试清理：`scripts/round6-process.cjs`、`scripts/smoke-round6-fix.cjs`、`tests/round6-fix-cleanup.test.cjs`。业务源码没有改，没有重打包。补跑之后重新计算的 `release/Anti Face 0.5.1.exe` 仍是 101,681,640 字节，SHA256 `a71af3fc2a78118ae18643e023797b8937e070ab8b47369dee6e01e752ef6365`。

日志目录：`artifacts/round6-fix/supervision-2026-10-10/`。

| 命令 | 退出码 | 耗时 | 日志 |
|---|---:|---:|---|
| `node --test tests/round6-fix-cleanup.test.cjs` | 0 | 5.0 秒 | `cleanup.log`，11 项通过 |
| `node scripts/smoke-round6-fix.cjs` | 0 | 42.2 秒 | `electron.log`；`electron-results.json`，startedAt 2026-10-10T14:06:05.709Z |
| `node scripts/smoke-round6-packed.cjs` | 0 | 76.7 秒 | `packed.log`；`packed-results.json`，startedAt 2026-10-10T14:07:16.358Z |

清理测试覆盖三件事。UTF-8 里的逗号和引号仍是 UTF-8。没有 BOM 的 UTF-16LE `PID|路径` 按 NUL 特征解码，GBK 字节保持无法判断，不编造成 PID。杀集只有本次记录的进程及其子进程；同路径、同一个父进程的旁观进程不在里面。实跑是两个 `node.exe`、两份 userData：只结束被记录的那个，旁观进程仍在。另一项由无关 PowerShell 以不共享方式占着 `lockfile`，记录中的 PID 已经不存在时，清理以 `LOCK_BUSY` 失败，并且没有杀掉占锁进程。

开发态 Electron 这 17 项在严格清理下重新通过，包括电池 computed `blur(8px)`、交流电恢复且文档模糊仍是 28、切换器搜索后 Enter、Esc 关闭、屏幕事件后主窗和迷你窗离开坐标 20000，以及强退后的「异常启动选择」。强退记下的是本次 root 14144 和 main 4412，父 PID 31700 不是目标。

win-unpacked 这 9 项在当前 `Anti Face.exe` 上通过：导出、检查、预览、提交、新 Store 读出图片、性能 auto 跨重启、安全模式拒绝编辑 IPC、按记录 PID 强退后出现启动选择且安全模式为真、无页面错误。强退目标是 root 4552 和 main 30544，父 PID 1232 不是目标。包内这次没有重复切换器键盘、computed blur 和屏幕救援。

## 包

- 当前便携包：`release/Anti Face 0.5.1.exe`
- 大小：101,681,640 字节
- SHA256：`a71af3fc2a78118ae18643e023797b8937e070ab8b47369dee6e01e752ef6365`
- 打包前那份尚未通过最终 smoke 的 0.5.1（101,682,211 字节，SHA256 `f77df5dd7ad6be928ffb442c83adc90c0bb6ee4e1ab15ff23af1746dd5b0dd2e`）已被这次构建替换。0.1.0 到 0.5.0 的大小和 SHA256 与打包前一致，0.5.0 仍是 `2cf9ee56616ebaf5b367fb74c78a3e5490be87d8317c7eb0d7b2a58a496b17be`。
- 便携外壳没有双击自解压。已验证的是 win-unpacked。

## 没有验证的环境

- 真实 Antigravity 窗口没有连接。完成提醒因此不能按真实整任务终态验收，测试里的真实完成次数是 0。
- 没有物理双屏。屏幕救援来自可控 screen 事件和开发态窗口，不是两台显示器。
- 没有在真实电池或交流电适配器上操作。电源事件来自可注入适配器，业务链是真实服务。
- 系统通知「已请求」和「用户看见」没有分开做现场确认。
- 进程强退不是断电测试。
