const fs = require('node:fs/promises');
const path = require('node:path');
const { inspectHost } = require('../desktop/host.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const root = path.join(__dirname, '..');

(async () => {
  const evidencePath = path.join(root, 'artifacts', 'round4', 'host-verification.json');
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  let host;
  try {
    host = await inspectHost();
  } catch (error) {
    await fs.writeFile(evidencePath, JSON.stringify({ status: '未验证', reason: error.message }, null, 2));
    console.log('UNVERIFIED: ' + error.message);
    return;
  }
  if (!host.installed) {
    await fs.writeFile(evidencePath, JSON.stringify({ status: '未验证', reason: '未安装 Antigravity' }, null, 2));
    console.log('UNVERIFIED: Antigravity 未安装');
    return;
  }
  const service = new ThemeService();
  try {
    const inspected = await service.inspect();
    if (!['ready', 'applied'].includes(inspected.state)) {
      await fs.writeFile(evidencePath, JSON.stringify({ status: '未验证', reason: inspected.message, hostVersion: host.version }, null, 2));
      console.log('UNVERIFIED: ' + inspected.message);
      return;
    }
    const client = service.targets.get(service.focusId).client;
    const before = await client.evaluate("(() => ({ owned: !!document.getElementById('anti-face-runtime-theme-v1'), styles: document.querySelectorAll('style').length }))()");
    const document = documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { ...DEFAULT_APPEARANCE, blur: 0, opacity: 88, radius: 14, wallpaper: null } });
    document.regions.sidebar = { opacity: 60 };
    document.regions.composer = { radius: 6 };
    document.typography = { chatFontSize: 18, lineHeight: 1.6, contentWidth: 720 };
    document.wallpaper = { ...document.wallpaper, legacyDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=', blur: 8 };
    await service.applyDocument(document, service.focusId, { assetUrl: document.wallpaper.legacyDataUrl });
    const sample = await client.evaluate(`(() => {
      const side = document.querySelector('[data-testid="conversation-list-sidebar"]');
      const composer = document.querySelector('[data-testid="agent-input-box"]');
      const bodyStyle = getComputedStyle(document.body);
      const before = getComputedStyle(document.body, '::before');
      const title = document.querySelector('[data-testid="title-menu-bar"]');
      const chat = document.querySelector('.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0');
      const editor = document.querySelector('[data-testid="install-editor"]');
      return {
        sidebar: side ? getComputedStyle(side).getPropertyValue('--af-sidebar-opacity').trim() : null,
        sidebarFont: side ? getComputedStyle(side).fontSize : null,
        chatFont: chat ? getComputedStyle(chat).fontSize : null,
        chatLine: chat ? getComputedStyle(chat).lineHeight : null,
        chatMaxWidth: chat ? getComputedStyle(chat).maxWidth : null,
        composerFont: composer ? getComputedStyle(composer).fontSize : null,
        editorFont: editor ? getComputedStyle(editor).fontSize : null,
        composerRadius: composer ? getComputedStyle(composer).borderTopLeftRadius : null,
        composerOpacity: composer ? getComputedStyle(composer).getPropertyValue('--af-composer-opacity').trim() : null,
        bodyFilter: bodyStyle.filter,
        titleFilter: title ? getComputedStyle(title).filter : null,
        beforeFilter: before.filter,
        beforePointer: before.pointerEvents,
        owned: document.querySelectorAll('#anti-face-runtime-theme-v1').length
      };
    })()`);
    await service.restore(service.focusId);
    const after = await client.evaluate("(() => ({ owned: !!document.getElementById('anti-face-runtime-theme-v1'), styles: document.querySelectorAll('style').length }))()");
    const checks = {
      sidebarOpacity: sample.sidebar === '60%',
      composerRadius: sample.composerRadius === '6px',
      textNotBlurred: sample.bodyFilter === 'none' && sample.titleFilter === 'none',
      wallpaperLayer: typeof sample.beforeFilter === 'string' && sample.beforeFilter.includes('blur'),
      wallpaperIgnoresPointer: sample.beforePointer === 'none',
      singleStyle: sample.owned === 1,
      chatFont: sample.chatFont === '18px',
      chatNotOnSidebar: sample.sidebarFont !== '18px',
      chatNotOnInput: sample.composerFont !== '18px',
      contentWidth: typeof sample.chatMaxWidth === 'string' && sample.chatMaxWidth.includes('720px'),
      restored: after.owned === before.owned
    };
    const evidence = {
      status: Object.values(checks).every(Boolean) ? '已核对' : '部分核对',
      hostVersion: host.version,
      checks,
      sample,
      restored: after,
      note: '只改了当前焦点窗口，检查后已恢复。没有读取对话内容。输入框使用 data-testid=agent-input-box。'
    };
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    if (evidence.status !== '已核对') process.exitCode = 1;
  } finally {
    await service.restore().catch(() => {});
    await service.dispose();
  }
})().catch(async error => {
  console.error(error);
  process.exitCode = 1;
});