# README 展示图说明

README 中的图片使用项目自己的组件、主题与内置壁纸生成，不依赖外部图片服务。

## 图片来源

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `media/home-before-after.png` | 同一首页场景的基础配置与极光玻璃配置 | `src/components/Preview.tsx` 与 `src/styles/preview.css` |
| `media/chat-before-after.png` | 同一对话场景的深色配置与浅色阅读配置 | 同一预览组件，调整主题和排版参数 |
| `media/theme-gallery.png` | 极光玻璃、珍珠白、樱花、午夜蓝四种主题 | `shared/themes.json` 与内置壁纸 `03.png`、`13.png` |
| `media/studio.png` | 实际运行的工作室主题选择区（局部截图） | Vite 生产构建的应用界面，浏览器预览模式 |

前三张展示内置示意场景，不是目标客户端截图。图中的「换肤前」指石墨主题的无壁纸、不透明、无模糊、无圆角配置，不表示 Antigravity 的出厂外观。两侧使用相同内容与场景尺寸。各图注明了预览来源，实际效果以目标客户端为准。

## 展示配置

- 石墨基础配置：不透明度 100%，模糊 0 px，圆角 0 px，无壁纸。
- 极光玻璃：视觉优先预设，不透明度 64%，模糊 24 px，圆角 24 px，内置壁纸 `assets/catalog/wallpapers/03.png`。
- 珍珠白：不透明度 96%，模糊 0 px，圆角 10 px，无壁纸。对话阅读图额外使用 16 px 字号、1.75 倍行距、480 px 内容宽度。
- 樱花：平衡预设，不透明度 75%，模糊 12 px，圆角 16 px，内置壁纸 `assets/catalog/wallpapers/13.png`。
- 午夜蓝：平衡预设，无壁纸。

展示脚本仅在图片外添加标题、标签和说明，不修改预览组件的样式。工作室图通过实际界面按钮选择极光玻璃与视觉优先预设后截取主题选择区；图片标明浏览器预览模式，完整界面截图保留在本地生成目录。

## 重新生成

在仓库根目录运行：

```powershell
npm ci
npx playwright install chromium
node scripts/capture-readme.mjs
```

脚本仅监听本机的随机端口，用独立无头浏览器渲染；不读取用户桌面配置，不连接 Antigravity，也不改变任何宿主窗口。

输出图片写入 `docs/media/`；生成报告、临时生产构建与原始工作室截图写入被 Git 忽略的 `artifacts/readme/`，不覆盖开发目录的 `dist/`。脚本会检查左右场景文本一致、预览数量、主题选中状态、图片加载以及浏览器错误。

本页只记录展示素材的来源与复现方法。项目功能、版本和验证记录见 [STATUS.md](STATUS.md)。
