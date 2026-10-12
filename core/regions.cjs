/**
 * 版本化区域选择器。只收录当前运行时探针已经依赖、或同样窄的 data-testid。
 * 未在真实窗口确认的选择器放在 candidates，命中才启用，不会单独宣称已应用。
 */
const REGION_MAP = Object.freeze({
  schemaVersion: 1,
  adapterId: 'antigravity-desktop-v2',
  regions: Object.freeze({
    sidebar: Object.freeze({
      label: '侧边栏',
      required: Object.freeze(['[data-testid="conversation-list-sidebar"]', '.bg-sidebar'])
    }),
    chat: Object.freeze({
      label: '聊天内容区',
      required: Object.freeze(['.h-screen.w-screen.bg-background'])
    }),
    composer: Object.freeze({
      label: '输入框',
      required: Object.freeze(['[data-testid="agent-input-box"]'])
    }),
    card: Object.freeze({
      label: '卡片与消息',
      required: Object.freeze(['.bg-card'])
    })
  })
});

const REGION_IDS = Object.freeze(['global', 'sidebar', 'chat', 'composer', 'card']);

function regionSelectors() {
  const list = [];
  for (const region of Object.values(REGION_MAP.regions)) {
    for (const selector of region.required) list.push(selector);
  }
  return list;
}

module.exports = { REGION_MAP, REGION_IDS, regionSelectors };
