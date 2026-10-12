const { REGION_MAP } = require('./regions.cjs');
const {
  CHAT_CONTENT_SELECTOR,
  WALLPAPER_SELECTOR,
  MASK_SELECTOR,
  RGB_TOLERANCE,
  ALPHA_TOLERANCE,
  BLUR_TOLERANCE,
  LENGTH_TOLERANCE,
  regionDescriptors
} = require('./style-contract.cjs');

const ALLOWED_SELECTORS = new Set([
  'body',
  'html',
  'body::before',
  'body::after',
  '[data-testid="agent-input-box"]',
  '[data-testid="conversation-turn"]',
  '[data-testid="conversation-list-sidebar"]',
  '.bg-sidebar',
  '.h-screen.w-screen.bg-background',
  '.bg-card',
  '#root',
  CHAT_CONTENT_SELECTOR
]);

function buildVerificationPlan(resolved, options = {}) {
  const checks = [
    { id: 'owned-style', required: true, kind: 'owned' },
    { id: 'body-color', required: true, kind: 'color', selector: 'body', property: 'color', expected: resolved.colors.foreground, tolerance: RGB_TOLERANCE },
    { id: 'body-filter', required: true, kind: 'keyword', selector: 'body', property: 'filter', expected: 'none' },
    { id: 'composer-reachable', required: false, kind: 'reachable', selector: '[data-testid="agent-input-box"]' }
  ];

  if (options.wallpaper) {
    checks.splice(3, 0, {
      id: 'wallpaper-pointer',
      required: true,
      kind: 'keyword',
      selector: WALLPAPER_SELECTOR,
      property: 'pointer-events',
      expected: 'none'
    }, {
      id: 'wallpaper-image',
      required: true,
      kind: 'image-load',
      selector: WALLPAPER_SELECTOR,
      property: 'background-image'
    });
    checks.push({
      id: 'wallpaper-blur',
      required: true,
      kind: 'filter-blur',
      selector: WALLPAPER_SELECTOR,
      property: 'filter',
      expected: `${Number(resolved.wallpaper?.blur || 0)}px`,
      expectedBlur: Number(resolved.wallpaper?.blur || 0),
      tolerance: BLUR_TOLERANCE
    });
    if (resolved.wallpaper?.maskStrength > 0) {
      checks.push({
        id: 'wallpaper-mask',
        required: false,
        kind: 'mask-opacity',
        selector: MASK_SELECTOR,
        property: 'opacity',
        expected: (resolved.wallpaper.maskStrength / 100).toFixed(2),
        expectedAlpha: resolved.wallpaper.maskStrength / 100,
        tolerance: ALPHA_TOLERANCE
      });
    }
  }

  for (const descriptor of regionDescriptors(resolved)) {
    checks.push({
      id: `region-${descriptor.id}-radius`,
      required: false,
      kind: 'region',
      regionId: descriptor.id,
      selector: descriptor.selector,
      property: 'border-top-left-radius',
      expected: `${descriptor.radius}px`,
      tolerance: LENGTH_TOLERANCE
    });
    checks.push({
      id: `region-${descriptor.id}-background`,
      required: false,
      kind: 'background-color',
      regionId: descriptor.id,
      selector: descriptor.selector,
      property: 'background-color',
      expected: descriptor.background,
      expectedColor: descriptor.background,
      tolerance: RGB_TOLERANCE,
      alphaTolerance: ALPHA_TOLERANCE
    });
  }

  if (resolved.typography?.chatFontSize) {
    checks.push({
      id: 'typography-font-size',
      required: false,
      kind: 'length',
      selector: CHAT_CONTENT_SELECTOR,
      property: 'font-size',
      expected: `${resolved.typography.chatFontSize}px`,
      tolerance: 1
    });
  }
  if (resolved.typography?.lineHeight != null) {
    checks.push({
      id: 'typography-line-height',
      required: false,
      kind: 'line-height',
      selector: CHAT_CONTENT_SELECTOR,
      property: 'line-height',
      expectedRatio: Number(resolved.typography.lineHeight),
      // Slider step is 0.1. 0.02 leaves room for subpixel rounding
      // (about 0.32px at 16px) and still rejects 1.5 versus 1.6.
      tolerance: 0.02
    });
  }

  for (const check of checks) {
    if (check.selector && !ALLOWED_SELECTORS.has(check.selector)) {
      throw new Error(`验证选择器不在允许列表中: ${check.selector}`);
    }
  }
  return { checks, contract: 'style-contract-v1' };
}

function channel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseCssColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return { r: channel(value[0]), g: channel(value[1]), b: channel(value[2]), a: value[3] == null ? 1 : channel(value[3]) };
  }
  if (value && typeof value === 'object' && value.r != null) {
    return { r: channel(value.r), g: channel(value.g), b: channel(value.b), a: value.a == null ? 1 : channel(value.a) };
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1
    };
  }
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(text);
  if (srgb) {
    const alpha = srgb[4] == null ? 1 : (srgb[4].endsWith('%') ? Number(srgb[4].slice(0, -1)) / 100 : Number(srgb[4]));
    return {
      r: Math.round(Number(srgb[1]) * 255),
      g: Math.round(Number(srgb[2]) * 255),
      b: Math.round(Number(srgb[3]) * 255),
      a: alpha
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(text);
  if (!rgb) return null;
  const alpha = rgb[4] == null ? 1 : (rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]));
  return { r: channel(rgb[1]), g: channel(rgb[2]), b: channel(rgb[3]), a: alpha };
}

function colorsClose(expected, actual, tolerance = RGB_TOLERANCE, alphaTolerance = ALPHA_TOLERANCE) {
  const left = parseCssColor(expected);
  const right = parseCssColor(actual);
  if (!left || !right) return false;
  if ([left.r, left.g, left.b, left.a, right.r, right.g, right.b, right.a].some(item => item == null)) return false;
  return Math.abs(left.r - right.r) <= tolerance
    && Math.abs(left.g - right.g) <= tolerance
    && Math.abs(left.b - right.b) <= tolerance
    && Math.abs(left.a - right.a) <= alphaTolerance;
}

function lengthsClose(expected, actual, tolerance = LENGTH_TOLERANCE) {
  const parse = value => {
    if (typeof value === 'number') return value;
    const match = /^(-?[\d.]+)px$/.exec(String(value || '').trim());
    return match ? Number(match[1]) : null;
  };
  const left = parse(expected);
  const right = parse(actual);
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= tolerance;
}

function blurPx(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  if (!text || text === 'none') return null;
  const match = /blur\(\s*([\d.]+)px\s*\)/i.exec(text);
  return match ? Number(match[1]) : null;
}

function checkPassed(planItem, found) {
  if (!found || found.state === 'missing' || found.state === 'hidden' || found.state === 'unverifiable') return false;
  if (planItem.kind === 'owned') return found.rules > 0 && found.ownerMatch === true;
  if (planItem.kind === 'color') return colorsClose(planItem.expected, found.actual, planItem.tolerance ?? RGB_TOLERANCE, 0.01);
  if (planItem.kind === 'keyword') return String(found.actual || '').trim() === planItem.expected;
  if (planItem.kind === 'background-color') {
    return colorsClose(planItem.expectedColor || planItem.expected, found.actual, planItem.tolerance ?? RGB_TOLERANCE, planItem.alphaTolerance ?? ALPHA_TOLERANCE);
  }
  if (planItem.kind === 'image-load') return found.state === 'loaded' || found.actual?.loaded === true;
  if (planItem.kind === 'filter-blur') {
    const expected = planItem.expectedBlur != null ? Number(planItem.expectedBlur) : blurPx(planItem.expected);
    const actual = blurPx(found.actual);
    if (expected === 0) return actual == null || actual === 0 || (actual != null && actual <= (planItem.tolerance ?? BLUR_TOLERANCE));
    if (actual == null || expected == null) return false;
    return Math.abs(actual - expected) <= (planItem.tolerance ?? BLUR_TOLERANCE);
  }
  if (planItem.kind === 'mask-opacity') {
    const actual = parseFloat(found.actual);
    const expected = planItem.expectedAlpha != null ? Number(planItem.expectedAlpha) : parseFloat(planItem.expected);
    return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= (planItem.tolerance ?? ALPHA_TOLERANCE);
  }
  if (planItem.kind === 'number') {
    const actual = parseFloat(found.actual);
    const expected = parseFloat(planItem.expected);
    return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= (planItem.tolerance ?? 0.05);
  }
  if (planItem.kind === 'line-height') {
    const ratio = found.actual && typeof found.actual === 'object' ? Number(found.actual.ratio) : NaN;
    const expected = Number(planItem.expectedRatio);
    return Number.isFinite(ratio) && Number.isFinite(expected) && Math.abs(ratio - expected) <= (planItem.tolerance ?? 0.02);
  }
  if (planItem.kind === 'length') return lengthsClose(planItem.expected, found.actual, planItem.tolerance ?? 1);
  if (planItem.kind === 'reachable') return found.reachable === true;
  if (planItem.kind === 'region') return lengthsClose(planItem.expected, found.actual, planItem.tolerance ?? LENGTH_TOLERANCE);
  return false;
}

function compareObservation(plan, observation) {
  if (!observation || observation.kind !== 'anti-face-verify' || !Array.isArray(observation.checks)) {
    return { status: 'unknown', checks: [], code: 'VERIFY_FAILED', message: '没有读到可核对的样式', unverified: [] };
  }
  const checks = plan.checks.map(item => {
    const found = observation.checks.find(entry => entry.id === item.id);
    if (!found || found.state === 'missing') {
      return { id: item.id, required: item.required, state: item.required ? 'failed' : 'not-applicable', actual: found?.reason || null, reason: found?.reason || 'missing' };
    }
    if (found.state === 'hidden') {
      return { id: item.id, required: item.required, state: 'not-applicable', actual: found.actual || null, reason: 'hidden' };
    }
    if (found.state === 'unverifiable') {
      return { id: item.id, required: item.required, state: 'unverifiable', actual: found.reason || found.actual || null, reason: found.reason || 'unverifiable' };
    }
    if (found.state === 'failed' && item.kind === 'image-load') {
      return { id: item.id, required: item.required, state: 'failed', actual: found.reason || found.actual || null, reason: found.reason || 'load-failed' };
    }
    const passed = checkPassed(item, found);
    return {
      id: item.id,
      required: item.required,
      state: passed ? 'passed' : 'failed',
      actual: found.actual ?? null,
      reason: passed ? null : (found.reason || 'mismatch')
    };
  });

  const requiredFailed = checks.some(item => item.required && item.state !== 'passed');
  const anyFailed = checks.some(item => item.state === 'failed');
  const optionalGap = checks.some(item => !item.required && (item.state === 'not-applicable' || item.state === 'unverifiable'));
  const unverified = checks.filter(item => item.state !== 'passed').map(item => item.id);

  let status = 'verified';
  if (requiredFailed || anyFailed) status = 'failed';
  else if (optionalGap) status = 'partial';

  return {
    status,
    checks,
    unverified,
    code: status === 'failed' ? 'VERIFY_FAILED' : status === 'partial' ? 'VERIFY_PARTIAL' : null,
    message: status === 'verified'
      ? '主题已核对生效'
      : status === 'partial'
        ? `主题部分生效，未验证项：${unverified.join(', ')}`
        : '主题没有按预期生效'
  };
}

function verifyExpression(plan, owner) {
  const safeChecks = plan.checks.map(item => ({
    id: item.id,
    kind: item.kind,
    selector: item.selector && ALLOWED_SELECTORS.has(item.selector) ? item.selector : null,
    property: item.property || null
  }));
  const payload = JSON.stringify({ owner, checks: safeChecks });
  return `(async () => {
    const plan = ${payload};
    const style = document.getElementById('anti-face-runtime-theme-v1');
    const normalizeColor = (value) => {
      if (!value || value === 'transparent') return [0, 0, 0, 0];
      const text = String(value).trim();
      const srgb = /^color\\(\\s*srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+%?))?\\s*\\)$/i.exec(text);
      if (srgb) {
        const alpha = srgb[4] == null ? 1 : (srgb[4].endsWith('%') ? parseFloat(srgb[4]) / 100 : parseFloat(srgb[4]));
        return [Math.round(parseFloat(srgb[1]) * 255), Math.round(parseFloat(srgb[2]) * 255), Math.round(parseFloat(srgb[3]) * 255), alpha];
      }
      const rgb = /^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+%?))?\\s*\\)$/i.exec(text);
      if (!rgb) return null;
      const alpha = rgb[4] == null ? 1 : (rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]));
      return [Math.round(parseFloat(rgb[1])), Math.round(parseFloat(rgb[2])), Math.round(parseFloat(rgb[3])), alpha];
    };
    const read = (selector, property) => {
      if (!selector) return { state: 'missing' };
      if (selector.endsWith('::before') || selector.endsWith('::after')) {
        const pseudo = selector.slice(selector.indexOf('::'));
        const host = document.querySelector(selector.slice(0, selector.indexOf('::'))) || document.body;
        const styleValue = getComputedStyle(host, pseudo);
        const raw = property ? styleValue.getPropertyValue(property) : '';
        const actual = property === 'background-color' ? (normalizeColor(raw) || raw.trim()) : (raw || '').trim();
        return { state: 'present', actual };
      }
      const element = document.querySelector(selector);
      if (!element) return { state: 'missing' };
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      const visible = box.width > 0 && box.height > 0 && computed.visibility !== 'hidden' && computed.display !== 'none';
      if (!visible) return { state: 'hidden', actual: null };
      const raw = property ? computed.getPropertyValue(property) : '';
      const actual = property === 'background-color' ? (normalizeColor(raw) || raw.trim()) : raw.trim();
      return { state: 'present', actual, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    };
    const probeImage = (background) => new Promise(resolve => {
      const match = /url\\((['"]?)(.*?)\\1\\)/.exec(String(background || ''));
      const url = match ? match[2] : '';
      if (!url || background === 'none') {
        resolve({ state: 'failed', reason: 'missing' });
        return;
      }
      const image = new Image();
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; resolve(value); };
      const timer = setTimeout(() => { image.src = ''; finish({ state: 'unverifiable', reason: 'timeout' }); }, 1200);
      image.onload = () => { clearTimeout(timer); finish({ state: 'loaded', actual: { loaded: true, width: image.naturalWidth, height: image.naturalHeight } }); };
      image.onerror = () => { clearTimeout(timer); finish({ state: 'failed', reason: 'decode-error' }); };
      image.src = url;
    });
    const checks = [];
    for (const item of plan.checks) {
      if (item.kind === 'owned') {
        checks.push({ id: item.id, state: style ? 'present' : 'missing', rules: style?.sheet?.cssRules?.length || 0, ownerMatch: !!style && style.dataset.antiFaceOwner === plan.owner });
        continue;
      }
      if (item.kind === 'reachable') {
        const element = item.selector ? document.querySelector(item.selector) : null;
        if (!element) { checks.push({ id: item.id, state: 'missing', reachable: false, reason: 'missing' }); continue; }
        const box = element.getBoundingClientRect();
        if (!(box.width > 0) || !(box.height > 0)) { checks.push({ id: item.id, state: 'hidden', reachable: false, reason: 'hidden' }); continue; }
        const hit = document.elementFromPoint(box.x + Math.min(box.width / 2, 8), box.y + Math.min(box.height / 2, 8));
        const reachable = !!hit && (hit === element || element.contains(hit));
        checks.push({ id: item.id, state: 'present', reachable, reason: reachable ? null : 'obstructed' });
        continue;
      }
      if (item.kind === 'image-load') {
        const sample = read(item.selector, 'background-image');
        if (sample.state !== 'present') { checks.push({ id: item.id, state: sample.state, reason: sample.state }); continue; }
        const probed = await probeImage(sample.actual);
        checks.push({ id: item.id, state: probed.state, actual: probed.actual || null, reason: probed.reason || null });
        continue;
      }
      if (item.kind === 'line-height') {
        if (!item.selector) { checks.push({ id: item.id, state: 'missing', reason: 'missing' }); continue; }
        const element = document.querySelector(item.selector);
        if (!element) { checks.push({ id: item.id, state: 'missing', reason: 'missing' }); continue; }
        const box = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        const visible = box.width > 0 && box.height > 0 && computed.visibility !== 'hidden' && computed.display !== 'none';
        if (!visible) { checks.push({ id: item.id, state: 'hidden', reason: 'hidden' }); continue; }
        const fontRaw = String(computed.fontSize || '').trim();
        const lineRaw = String(computed.lineHeight || '').trim();
        const fontSizePx = parseFloat(fontRaw);
        const lineHeightPx = parseFloat(lineRaw);
        if (!(fontSizePx > 0) || !/px$/i.test(fontRaw) || lineRaw === 'normal' || !/px$/i.test(lineRaw) || !(lineHeightPx > 0)) {
          checks.push({ id: item.id, state: 'unverifiable', actual: lineRaw || null, reason: 'unverifiable' });
          continue;
        }
        checks.push({ id: item.id, state: 'present', actual: { fontSizePx, lineHeightPx, ratio: lineHeightPx / fontSizePx } });
        continue;
      }
      const sample = read(item.selector, item.property);
      checks.push({ id: item.id, state: sample.state, actual: sample.actual ?? null });
    }
    return { kind: 'anti-face-verify', checks };
  })()`;
}

module.exports = {
  buildVerificationPlan,
  compareObservation,
  verifyExpression,
  parseCssColor,
  colorsClose,
  lengthsClose,
  blurPx,
  ALLOWED_SELECTORS,
  REGION_MAP
};
