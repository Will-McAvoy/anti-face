# 第五轮测试报告

日期：2026-10-05。机器：Windows，Intel Core Ultra 7 155H，22 逻辑处理器，Node v24.16.0。应用版本 v0.4.0。

## 命令和退出码

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --test tests/round5-core.test.cjs tests/round5-services.test.cjs tests/round5-scenarios.test.cjs` | 0 | 25 通过 |
| `node --test tests/round5-core.test.cjs` | 0 | 收尾复跑，13 通过，139.7 ms。迷你窗拒绝列表包含 `library:get` |
| `node --test tests/round5-render.test.cjs` | 0 | Chromium 上深浅色像素不同，输入框不被壁纸挡住，后写规则能盖住主题色，缺侧栏时选择器为空，第二个窗口颜色独立 |
| `npm test` | 0 | 收尾整包重跑，115 通过，约 19.0 秒。含第五轮纯函数、服务场景和 Chromium 渲染 |
| `npx tsc --noEmit` 与 `npm run build` | 0 | 类型检查通过。当前包内前端是 `assets/index-B8-d8ZvB.js`（360,448 字节）和 `assets/index-Bj2m9pDA.css`（19,275 字节） |
| `node scripts/smoke-round5.cjs` | 0 | 源码 Electron：九个分页、诊断重查、离线加入“石墨夜读” |
| `node scripts/smoke-round5-e2e.cjs` | 0 | 模拟宿主按钮链路 E01–E12，281.84 秒，`PASS: round5 button chain E01-E12 on simulated host`。不是真实 Antigravity |
| `npm run test:desktop` | 0 | 原桌面烟测 |
| `npm run test:desktop:round3` | 0 | 多窗口隔离 |
| `npm run test:desktop:round4` | 0 | 区域、个人库、迷你窗 |
| `npm run package` | 0 | `release/Anti Face 0.4.0.exe` |
| `node scripts/verify-round5-package.cjs` | 0 | 58 个 desktop/core 源文件与包内一致，前端 hash 一致，20 套图在包内，worker 和音效已解包 |
| `node scripts/smoke-packed.cjs` | 0 | 对当前 win-unpacked 重跑，130.95 秒。离线主题中心、诊断、版本历史、加入「石墨夜读」、导入图片后生成并保存「打包生成」，并读到包内 PNG 与解包 worker。Playwright 的 `evaluate` 里没有 `require`，脚本改为 `process.getBuiltinModule` |

更早一次打包烟测读库太早，看到的是尚未写上来源字段的半成品。那不是产品把来源丢掉：`saveNew` 先落盘，`attachSource` 紧接着写上来源。脚本会等到 `sourceItemId` 再断言。这次失败是另一件事：Playwright 的 `evaluate` 里没有 `require`，已改成 `process.getBuiltinModule` 后重跑通过。

## 性能样本

`node scripts/bench-round5.cjs`。512×512 图已在内存里，不含磁盘读取。20 次，没有单独预热。

- 阅读分析加三套配色：中位数 5.42 ms，p95 21.72 ms。目标 p95 ≤ 800 ms。
- 500 条目录分页：中位数 0.01 ms，p95 0.03 ms。这是传入内存摘要，不含远程下载。
- 3 个窗口一共 100 次 `watch`：活动定时器 3，`stop` 后 0。同一窗口重复监听只有一个定时器，见服务测试。

冷启动相对 0.3.1 的增量没有测。拖动构图只改渲染进程里的草稿，松手才提交，没有把图像算法放进主进程指针移动。

## 未测

- 没有指定 Antigravity 窗口，没有真实换肤、真实截图、真实首页/聊天识别。E01–E12 的通过是模拟宿主，状态仍是 2；远程精选仍是 3。
- 便携外壳 `Anti Face 0.4.0.exe` 没有双击自解压后再跑一遍。核对的是 win-unpacked 和 EXE 文件哈希。
- 线上精选服务不存在。远程用例是本机拒绝错误地址和坏响应。生产界面仍是「内置精选」和「远程源未配置」。

## 包

- 文件：`release/Anti Face 0.4.0.exe`
- 大小：101,629,009 字节
- SHA256：`bfe1518ba917aa60838ee28a0b593f3a2ee7d67261bcf24d6874e83029da30ec`
- 本次只改了 `release/SHA256SUMS.txt` 里的 0.4.0 一行。0.1.0 到 0.3.1 的 EXE 没有重新打包。
- 0.3.1 的文件哈希与旧文档一致：`1aac4f5aedf97a49c2aed9e775016d9b4b8dd4b557bded8058b80a79dca3071e`。已补进 `release/SHA256SUMS.txt`。0.1.0 到 0.3.1 的 EXE 都还在。
