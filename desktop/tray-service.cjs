function decideWindowClose({ closeToTray, quitting, previewActive }) {
  if (quitting) return 'quit';
  if (previewActive) return 'prompt';
  if (!closeToTray) return 'quit';
  return 'hide';
}

function buildTrayMenu(state) {
  const favorites = state.favorites || [];
  const items = [
    { id: 'theme', label: `当前主题：${state.themeName || '未应用'}`, enabled: false },
    { id: 'host', label: `宿主：${state.hostLabel || '未连接'}`, enabled: false },
    { type: 'separator' }
  ];
  if (!favorites.length) {
    items.push({ id: 'empty', label: '还没有收藏主题', enabled: false });
    items.push({ id: 'open-library', label: '打开主题库' });
  } else {
    for (const theme of favorites) items.push({ id: `favorite:${theme.id}`, label: theme.name });
  }
  items.push(
    { type: 'separator' },
    { id: 'switcher', label: '快速主题切换…' },
    { id: 'pause', label: state.automationPaused ? '恢复自动切换' : '暂停自动切换' },
    { id: 'restore', label: '恢复当前窗口' },
    { id: 'restore-all', label: '恢复所有窗口原貌' },
    { id: 'mini', label: '显示迷你窗' },
    { id: 'show', label: '打开主窗口' },
    { type: 'separator' },
    { id: 'quit', label: '退出并恢复外观' }
  );
  return items;
}

class TrayService {
  constructor(deps = {}) {
    this.Tray = deps.Tray || null;
    this.Menu = deps.Menu || null;
    this.icon = deps.icon;
    this.onAction = deps.onAction || (() => {});
    this.tray = null;
    this.lastMenu = [];
  }

  start(state) {
    if (!this.Tray || this.tray) return;
    this.tray = new this.Tray(this.icon);
    this.tray.on?.('click', () => this.onAction('show'));
    this.tray.on?.('double-click', () => this.onAction('show'));
    this.render(state);
  }

  render(state) {
    this.lastMenu = buildTrayMenu(state || {});
    if (!this.tray || !this.Menu) return this.lastMenu;
    const template = this.lastMenu.map(item => item.type === 'separator' ? { type: 'separator' } : {
      label: item.label,
      enabled: item.enabled !== false,
      click: () => this.onAction(item.id)
    });
    this.tray.setContextMenu(this.Menu.buildFromTemplate(template));
    this.tray.setToolTip?.('Anti Face');
    return this.lastMenu;
  }

  stop() {
    this.tray?.destroy?.();
    this.tray = null;
  }
}

module.exports = { TrayService, buildTrayMenu, decideWindowClose };
