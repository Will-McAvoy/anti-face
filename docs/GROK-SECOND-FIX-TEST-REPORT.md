# Anti Face v0.4.2 第二轮测试报告

日期：2026-10-07。工作目录 `D:\onedrive\work\hermes\anti_face`。PowerShell 不支持 `&&`。每条命令单独执行，退出码是该进程的 `$LASTEXITCODE`。用时是命令壁钟，不是测试框架内部的 `duration_ms`（两者都记在能取到的地方）。

日志目录：`artifacts/grok-second-fix/`。汇总：`command-summary.jsonl`。这一次是修正「离开对比页误删已拍完的图」之后的完整重跑，和打包用的是同一份源码。更早一次 E08 失败的日志留在 `10-test-desktop-round5-e2e-before-invalidate.log`，那次不能当通过。

## 命令

| 顺序 | 命令 | 退出码 | 用时 | pass / fail / skip | 日志里的结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | `npm run check` | 0 | 7086 ms | 147 / 0 / 0 | 类型检查、Vite 构建，然后 `tests/*.test.cjs` |
| 2 | `npm run test:round5` | 0 | 28677 ms | 26 / 0 / 0 | 含真实 Chromium 套色和 E04 |
| 3 | `npm run test:round5:fix` | 0 | 1804 ms | 16 / 0 / 0 | R01–R06、X01–X10 |
| 4 | `node --test tests/grok-second-fix.test.cjs` | 0 | 7074 ms | 16 / 0 / 0 | 框架自身 duration_ms 6704 |
| 5 | `node scripts/smoke-grok-second-fix.cjs` | 0 | 86485 ms | 脚本不报 pass 计数 | 最后一行 `{"ok":true,"step":"disconnect-chain"}` |
| 6 | `npm run test:desktop` | 0 | 115371 ms | 同上 | `PASS: desktop UI, filtering, persistence...` |
| 7 | `npm run test:desktop:round3` | 0 | 43385 ms | 同上 | `PASS: real desktop IPC/UI selects...` |
| 8 | `npm run test:desktop:round4` | 0 | 48197 ms | 同上 | `PASS: round4 desktop defaults...` |
| 9 | `npm run test:desktop:round5` | 0 | 38606 ms | 同上 | `PASS: round5 readability page, diagnostics, offline catalog install` |
| 10 | `npm run test:desktop:round5:e2e` | 0 | 286680 ms | 同上 | `PASS: round5 button chain E01-E12 on simulated host` |
| 11 | `npm run package` | 0 | 496305 ms | 不适用 | 产出 `release/Anti Face 0.4.2.exe` |
| 12 | `node scripts/verify-round5-package.cjs` | 0 | 393 ms | 不适用 | 动态比较 61 个源文件，不是写死 59 |
| 13 | `node scripts/smoke-packed.cjs` | 0 | 75556 ms | 同上 | `PASS: unpacked EXE panels...` |

`npm run test:grok-second` 就是第 4 条。第 1 条已经包含这 16 项，第 4 条再单独跑了一次。

## 测试落在哪一层

- 纯函数和服务：第 1–4 条。样式容差、场景选择、代次、历史返回值、裁切不相容都在这里断言，没有改成恒成功。
- 真实落盘：`history disk boundary` 用临时目录。`fault = 'index'` 在记录文件写完后让索引失败，然后另一个 Node 进程 `load()`。恢复后只有一条，同一 `operationId` 再写是去重。这不是把磁盘写满。
- 真实 Chromium：`realCssVerification` 和 `occlusion and slider` 启动 Playwright Chromium，读计算后的颜色或截图像素。第 2 条里的「真实 Chromium 会套用生成的颜色」也是。模拟宿主没有把 expected 填成 actual。
- Electron UI：第 5–10 条和第 13 条。宿主是夹具，不是 Antigravity。第 5 条用按钮走到预览、项目文案、慢截图切窗、换图后再生成、历史失败与重试、断开再连。
- 打包：第 11–13 条。核对脚本比较 asar 里的 desktop/core 与当前源码、20 个精选、解包的 worker 和声音、以及 dist。前端资源是 `assets/index-D_EujbUp.js` 和 `assets/index-Bj2m9pDA.css`。

## 包

- `release/Anti Face 0.4.2.exe`
- 101,642,031 字节
- SHA256 `62c7c258f5038edbf3254db85f8addf312e68185e96ef74e3797bddecd5ebb7c`
- 记录在 `artifacts/grok-second-fix/package-verification.json`，原始输出在 `12-verify-round5-package.log`
- `release/Anti Face 0.4.1.exe` 仍在，101,637,220 字节，没有覆盖
- 校验脚本会改写 `artifacts/round5-package-verification.json`。跑完后已按 `docs/ROUND5-FIX-TEST-REPORT.md` 里的原文把 0.4.1 那份放回去，避免冲掉旧证据

`node scripts/smoke-packed.cjs` 启动的是 `release/win-unpacked/Anti Face.exe`。便携外壳 `Anti Face 0.4.2.exe` 没有双击，也没有被这个脚本启动。

## 版本

`package.json` 和 `package-lock.json` 根上两处（文件第 3 行和第 9 行）是 0.4.2。`pe-library` 仍是 0.4.1。没有跑 `npm install`，没有升级依赖。

## 未验证

真实 Antigravity 窗口上的换肤、样式核对和截图：未验证。没有自动给其他用户窗口换肤，也没有保存聊天截图。

## 中间失败

第一次官方序列在 E08 退出码 1：离开对比页时 `clearCaptures` 删掉了已经拍完的「应用前」，回来拍的「应用后」不在同一组，`paired` 为 false。修正是离开页面只 `invalidate` 在途拍摄。该失败日志已保留。上表第 10 条是修正后的重跑。
