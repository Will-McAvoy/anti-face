# OneDrive 冲突文件恢复与处理报告

**记录时间**：2026-10-03  
**执行环境**：Windows 11, Node v24.19.0, npm 11.17.0

## 1. 背景与现状

在检查项目时，发现项目中存在大量因 OneDrive 同步产生的冲突副本文件（后缀包含 `-DESKTOP-83ARC0U`）。
其中 `src/types-DESKTOP-83ARC0U.ts` 中的全局声明与主文件 `src/types.ts` 冲突，导致 `npm run build` 中的 TypeScript 阶段报 `TS2717: Subsequent property declarations must have the same type` 阻断编译。

## 2. 逐组比较与结论

通过对 16 个冲突副本与对应主文件逐一比对哈希、大小与内容：

| 冲突文件相对路径 | 大小 (bytes) | 对应主文件 | 主文件大小 (bytes) | 比较结论与处置 |
|---|---|---|---|---|
| `artifacts/studio-DESKTOP-83ARC0U.png` | 542,053 | `artifacts/studio.png` | 476,107 | 旧屏幕截图，主文件为最新冒烟产物。移至备份。 |
| `desktop/host-DESKTOP-83ARC0U.cjs` | 2,031 | `desktop/host.cjs` | 3,491 | 旧脚手架版本，缺少端口归属检验与 rawFs 读取；主文件功能完备。移至备份。 |
| `desktop/main-DESKTOP-83ARC0U.cjs` | 2,758 | `desktop/main.cjs` | 5,135 | 旧脚手架版本，缺少设置 IPC 与退出清理；主文件已包含全部逻辑。移至备份。 |
| `desktop/preload-DESKTOP-83ARC0U.cjs` | 232 | `desktop/preload.cjs` | 717 | 旧脚手架版本，仅有 2 个旧接口；主文件包含完整白名单。移至备份。 |
| `dist/index-DESKTOP-83ARC0U.html` | 670 | `dist/index.html` | 608 | 旧构建产物。移至备份。 |
| `docs/ARCHITECTURE-DESKTOP-83ARC0U.md` | 2,949 | `docs/ARCHITECTURE.md` | 3,650 | 旧版架构草稿，已在主文档中更新扩充。移至备份。 |
| `node_modules/.package-lock-DESKTOP-83ARC0U.json` | 143,025 | `node_modules/.package-lock.json` | 143,551 | 旧依赖锁快照。移至备份。 |
| `package-DESKTOP-83ARC0U.json` | 1,380 | `package.json` | 1,526 | 旧版配置，缺少宿主验证脚本；主文件已包含。移至备份。 |
| `package-lock-DESKTOP-83ARC0U.json` | 168,492 | `package-lock.json` | 169,252 | 旧版 lockfile。移至备份。 |
| `README-DESKTOP-83ARC0U.md` | 3,044 | `README.md` | 5,557 | 旧版自述文档，主文件已为完整版。移至备份。 |
| `src/adapters/contracts-DESKTOP-83ARC0U.ts` | 803 | `src/adapters/contracts.ts` | 357 | 旧版合同接口，已被主文件与 types 重构替代。移至备份。 |
| `src/App-DESKTOP-83ARC0U.tsx` | 19,890 | `src/App.tsx` | 13,271 | 单体旧版组件，主文件已拆分为模块化组件并正常工作。移至备份。 |
| `src/main-DESKTOP-83ARC0U.tsx` | 234 | `src/main.tsx` | 312 | 旧入口，主文件增加了全局 ErrorBoundary。移至备份。 |
| `src/styles-DESKTOP-83ARC0U.css` | 15,430 | `src/styles.css` | 14,786 | 旧样式，主文件已调整模块化导入。移至备份。 |
| `src/themes-DESKTOP-83ARC0U.ts` | 3,687 | `src/themes.ts` | 125 | 旧硬编码主题列表，主文件已改为从 shared/themes.json 加载单一数据源。移至备份。 |
| `src/types-DESKTOP-83ARC0U.ts` | 730 | `src/types.ts` | 1,734 | 旧类型定义，重复声明 Window.antiFace 阻断 TypeScript 编译。移至备份。 |

## 3. 归档与备份位置

所有 16 个冲突文件已完整移至独立隔离归档目录：
`.backups/conflict-archive-2026-10-03/`

该目录满足：
1. 不在 `tsconfig.json` 的 `include: ["src"]` 范围内；
2. 不在 `package.json` 的 `build.files` 打包列表内；
3. 包含完整清单文件 `.backups/conflict-archive-2026-10-03/archive-manifest.json`，内含原始路径、大小、SHA256、归档路径与比对结论。

## 4. 恢复方法

如需恢复任何被归档的冲突副本文件，可直接从 `.backups/conflict-archive-2026-10-03/` 复制回原目录，或使用 `archive-manifest.json` 中的映射信息进行逆向还原。

## 5. 处理后验证

1. `npm run check`：
   - `tsc --noEmit` 零错误通过。
   - `vite build` 成功生成生产产物。
   - 14 项已有 Node 单元测试全部通过 (14/14 pass)。
2. `npm run test:desktop`：
   - 基于刚生成的全新 `dist` 运行 Playwright 桌面冒烟测试，完整通过。
