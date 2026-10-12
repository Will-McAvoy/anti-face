# 第四轮验收矩阵

状态只用这四档：已实现且验证；已实现，真实环境待验证；当前来源不支持，已完成明确降级；未完成。

| ID | 需求 | 代码位置 | 自动化结果 | 真实验证 | 状态 | 剩余问题 |
| --- | --- | --- | --- | --- | --- | --- |
| F1.1 | 区域覆盖和继承 | `core/regions.cjs` `core/theme-css.cjs` `src/components/AppearancePanel.tsx` | T02 T03，computed style | Antigravity 2.19.1.0：侧栏变量 60%，输入框圆角 6px、不透明度仍是 88%，随后已恢复 | 已实现且验证 | 聊天正文没有稳定的 test id，字号规则只挂在明确的消息选择器上 |
| F1.2 | 排版和宽度 | `core/theme-css.cjs` 聊天列 `.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0` | 字号、行距、宽度有界面 | 宿主上聊天列 18px、行距 28.8px、最大宽度含 720px；侧栏和输入框仍是 16px。检查后已恢复 | 已实现且验证 | 编辑器节点保持 16px |
| F2.1 | 试穿保存和取消 | `core/preview-session.cjs` `desktop/main.cjs` `src/App.tsx` | T05 T06 T07 T11 T12 | 真实窗口点了继续编辑、取消试穿并隐藏、保存并隐藏。取消后窗口隐藏，保存后可以再恢复原样 | 已实现且验证 | 没有开托盘时，未试穿的关闭仍是退出 |
| F2.2 | 撤销、重做、对比 | `core/appearance-history.cjs` `src/App.tsx` | T08 T09 T10 | 底部有撤销和重做；输入框里的 Ctrl+Z 不拦截 | 已实现，真实环境待验证 | 没有在宿主上把撤销后的样式再读一次 |
| F3.1 | 壁纸变换 | `core/theme-css.cjs` | computed style | 宿主上 `body` 和标题栏 `filter` 为 none，壁纸层 `blur(8px)` 且 `pointer-events: none`，检查后已恢复 | 已实现且验证 | 用的是 1×1 测试图，不是用户自己的壁纸 |
| F3.2 | 资源和取色 | `desktop/asset-store.cjs` `src/components/AppearancePanel.tsx` | T13–T15 | 真实窗口点了提取强调色，并点了一个色块；保存的强调色和按钮一致 | 已实现且验证 | 取色是估计，不会自动改整套皮肤 |
| F4.1 | 主题库和导入导出 | `desktop/theme-library.cjs` `src/components/ThemeLibrary.tsx` | T16 T17，冒烟另存、复制、收藏 | 收藏可以上移下移 | 已实现且验证 | 缩略图是色条 |
| F4.2 | 定时和系统规则 | `desktop/automation-service.cjs` `desktop/main.cjs` | T18–T22，深浅色只应用一次 | 短暂切换了 Windows 应用深浅色，界面从当前外观变成相反外观，然后已改回原来的注册表值 | 已实现且验证 | 没有兼容宿主时只记录期望 |
| F5.1 | 托盘和退出 | `desktop/tray-service.cjs` `src/App.tsx` | 默认关闭；试穿未保存会弹出三个选择 | 真实托盘菜单没有点击 | 已实现，真实环境待验证 | 关闭到托盘仍默认关闭 |
| F5.2 | 快捷键 | `src/components/NotificationSettings.tsx` | T23 T24 | 四个动作都能填写，界面显示已注册或未注册 | 已实现，真实环境待验证 | 默认不注册。冲突文案来自注册结果 |
| F5.3 | 迷你窗 | `desktop/mini-window.cjs` `core/ipc-policy.cjs` | T29 T30，冒烟能打开再关闭 | 冒烟窗口不是多显示器热插拔 | 已实现且验证 | 位置夹取用注入的显示器矩形做了单元测试 |
| F5.4 | 声音和通知 | `core/notification-policy.cjs` `desktop/notification-service.cjs` | T25–T28 | 自动化只用规则，没有播真实声音 | 当前来源不支持，已完成明确降级 | 日志不能把单步结束当成任务完成，完成提醒不会自动响 |
