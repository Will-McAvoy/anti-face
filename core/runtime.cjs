const { regionSelectors } = require('./regions.cjs');
const STYLE_ID = 'anti-face-runtime-theme-v1';
const LEASE_MS = 35000;
const SELECTORS = ['#root', '[data-testid="title-menu-bar"]', '[data-testid="conversation-list-sidebar"]'];
const REGION_SELECTORS = regionSelectors();
const VARIABLES = ['--background', '--foreground', '--sidebar', '--card'];
function probeExpression() {
  return `(() => { const style = document.getElementById(${JSON.stringify(STYLE_ID)}); const computed = getComputedStyle(document.documentElement); return {
    title: document.title,
    selectors: Object.fromEntries(${JSON.stringify(SELECTORS)}.map(s => [s, !!document.querySelector(s)])),
    regions: Object.fromEntries(${JSON.stringify(REGION_SELECTORS)}.map(s => [s, !!document.querySelector(s)])),
    variables: Object.fromEntries(${JSON.stringify(VARIABLES)}.map(s => [s, !!computed.getPropertyValue(s).trim()])),
    supportsBackdropFilter: CSS.supports('backdrop-filter', 'blur(1px)'),
    sessionId: style?.dataset.antiFaceOwner || null,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 }
  }; })()`;
}
function applyExpression(css, owner) {
  return `(() => {
    const id = ${JSON.stringify(STYLE_ID)}, owner = ${JSON.stringify(owner)};
    let style = document.getElementById(id);
    if (style && style.dataset.antiFaceOwner !== owner) throw new Error('另一个 Anti Face 会话正在使用此窗口');
    if (!style) {
      style = document.createElement('style'); style.id = id; style.dataset.antiFaceOwner = owner;
      document.head.appendChild(style);
      const timer = setInterval(() => {
        if (!style.isConnected) { clearInterval(timer); return; }
        if (Date.now() > Number(style.dataset.antiFaceExpires)) { style.remove(); clearInterval(timer); }
      }, 1000);
    }
    style.dataset.antiFaceExpires = String(Date.now() + ${LEASE_MS});
    style.textContent = ${JSON.stringify(css)};
    return { sessionId: owner, rules: style.sheet?.cssRules.length || 0 };
  })()`;
}
function heartbeatExpression(owner) {
  return `(() => { const s = document.getElementById(${JSON.stringify(STYLE_ID)}); if (!s || s.dataset.antiFaceOwner !== ${JSON.stringify(owner)}) return false; s.dataset.antiFaceExpires = String(Date.now() + ${LEASE_MS}); return true; })()`;
}
function setStyleExpression(css, owner) {
  return `(() => { const s = document.getElementById(${JSON.stringify(STYLE_ID)}); if (!s || s.dataset.antiFaceOwner !== ${JSON.stringify(owner)}) return false; s.dataset.antiFaceExpires = String(Date.now() + ${LEASE_MS}); s.textContent = ${JSON.stringify(css)}; return true; })()`;
}
function restoreExpression(owner) {
  return `(() => { const s = document.getElementById(${JSON.stringify(STYLE_ID)}); if (!s) return true; if (s.dataset.antiFaceOwner !== ${JSON.stringify(owner)}) return false; s.remove(); return true; })()`;
}
function readStyleOwnerExpression() {
  return `(() => { const s = document.getElementById(${JSON.stringify(STYLE_ID)}); return s ? (s.dataset.antiFaceOwner || '') : ''; })()`;
}
function compatibleProbe(probe) {
  return !!probe && /(?:^| - )Antigravity$/.test(probe.title) && probe.supportsBackdropFilter === true &&
    SELECTORS.every(s => probe.selectors?.[s] === true) && VARIABLES.every(s => probe.variables?.[s] === true);
}
module.exports = { STYLE_ID, LEASE_MS, SELECTORS, REGION_SELECTORS, VARIABLES, probeExpression, applyExpression, setStyleExpression, heartbeatExpression, restoreExpression, readStyleOwnerExpression, compatibleProbe };
