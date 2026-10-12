# 第四轮测试报告

日期：2026-10-04。机器：Windows 10.0.19045，本机 Node 跑 `node --test`。没有修改 Windows 系统时间，也没有改系统深浅色。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run build` | 0 | `tsc --noEmit` 通过，Vite 产出 `dist/assets/index-DH6RU_qh.js` |
| `node --test tests/*.test.cjs` | 0 | 79 项通过，0 失败 |
| `node scripts/smoke-round4.cjs` | 0 | 默认试穿关闭、区域页、另存/复制/收藏、坏主题包提示、迷你窗打开后关闭 |
| `npm run test:desktop` | 0 | 原桌面回归、旧配置迁移、无 preload 说明都通过 |
| `node scripts/smoke-packed.cjs` | 0 | `release/win-unpacked/Anti Face.exe`：四个面板、非法主题拒绝、历史默认关闭、模拟数据不残留、125 行导出，并看到 v0.3.0、试穿入口和自动切换默认关闭 |
| 启动 `release/Anti Face 0.3.0.exe` | 进程出现 | 新进程 PID 16200，确认外壳已拉起后结束。没有对自解压窗口做点击遍历 |

真实宿主：本轮没有对正在使用的 Antigravity 注入主题，也没有刷新或强杀。区域选择器和壁纸文字隔离因此标为「真实环境待验证」。computed style 只证明生成的 CSS 在独立页面上让侧栏变量成为 60%，输入框圆角为 4px，壁纸层 `pointer-events` 为 `none`。

打包：`release/Anti Face 0.3.0.exe`，101,572,521 字节。SHA256 `447d61ead3c1a5103fa543eb28bf2e2d38b8917304f67b40132d6cc6e0eae6f7`。`signAndEditExecutable` 为 false，这里不把产物说成已签名。没有上传 Release。

新增运行时依赖：pngjs 7.0.0（MIT）、jpeg-js 0.4.4（BSD-3-Clause）、@jsquash/webp 1.4.0（Apache-2.0）。它们被列进 `build.files`，WebP 的 wasm 从 asar 解开。
