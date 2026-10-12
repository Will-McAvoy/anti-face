const { ThemeService } = require('../desktop/theme-service.cjs');
(async () => {
  const service = new ThemeService();
  try {
    const status = await service.inspect();
    if (!service.focusId) {
      console.log(JSON.stringify({ state: status.state, message: status.message }));
      return;
    }
    const client = service.targets.get(service.focusId).client;
    const found = await client.evaluate(`(() => {
      const ids = [...new Set([...document.querySelectorAll('[data-testid]')].map(node => node.getAttribute('data-testid')).filter(Boolean))];
      const classes = new Set();
      for (const node of document.querySelectorAll('[class]')) {
        const value = typeof node.className === 'string' ? node.className : '';
        for (const name of value.split(/\\s+/)) {
          if (/message|markdown|prose|chat|turn|assistant|bubble|conversation-panel|overflow-y/i.test(name)) classes.add(name);
        }
      }
      const sash = document.querySelector('[data-testid="sidebar-sash"]');
      const column = sash?.parentElement?.parentElement?.nextElementSibling || null;
      const scrolls = [...document.querySelectorAll('.overflow-y-auto')].slice(0, 6).map(node => ({
        test: node.getAttribute('data-testid'),
        className: typeof node.className === 'string' ? node.className.split(/\\s+/).slice(0, 5).join(' ') : '',
        inSidebar: !!node.closest('[data-testid="conversation-list-sidebar"]'),
        inInput: !!node.closest('[data-testid="agent-input-box"]')
      }));
      return {
        ids,
        scrolls,
        column: sketch(column)
      };
      function sketch(el, depth = 0) {
        if (!el || depth > 6) return null;
        return {
          tag: el.tagName,
          test: el.getAttribute('data-testid'),
          role: el.getAttribute('role'),
          className: typeof el.className === 'string' ? el.className.split(/\\s+/).slice(0, 4).join(' ') : '',
          children: [...el.children].slice(0, 6).map(child => sketch(child, depth + 1))
        };
      }
    })()`);
    console.log(JSON.stringify(found));
  } finally {
    await service.dispose();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });