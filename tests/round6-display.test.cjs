const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dipToPhysical,
  physicalToDip,
  cssToScreenshot,
  screenshotToCss,
  clampBoundsToWorkAreas,
  computeDisplayContextHash
} = require('../core/display-context.cjs');

test('F04: 4 套坐标模型单位转换与高分屏 (DPR 1.5, 2.0) 精度计算', () => {
  // DIP <-> Physical at 150% scaling
  const dipRect = { x: 100, y: 200, width: 800, height: 600 };
  const physical150 = dipToPhysical(dipRect, 1.5);
  assert.deepEqual(physical150, { x: 150, y: 300, width: 1200, height: 900, scale: 1.5 });

  const restoredDip = physicalToDip(physical150, 1.5);
  assert.deepEqual(restoredDip, { x: 100, y: 200, width: 800, height: 600, scale: 1.5 });

  // CSS <-> Screenshot at DPR 2.0 and clip.scale 1.0
  const cssClip = { x: 50, y: 80, width: 400, height: 300, scale: 1.0 };
  const shot = cssToScreenshot(cssClip, 2.0);
  assert.deepEqual(shot, { x: 100, y: 160, width: 800, height: 600, dpr: 2.0, scale: 1.0 });

  const restoredCss = screenshotToCss(shot, 2.0, 1.0);
  assert.deepEqual(restoredCss, { x: 50, y: 80, width: 400, height: 300, scale: 1.0 });
});

test('F04: 负坐标系多显示器支持（左侧/上方扩展屏）', () => {
  // 副屏在主屏左侧：x = -1920, y = 0, scaleFactor = 1.25
  const leftScreenRect = { x: -1920, y: -200, width: 1920, height: 1080 };
  const physicalLeft = dipToPhysical(leftScreenRect, 1.25);
  assert.equal(physicalLeft.x, -2400);
  assert.equal(physicalLeft.y, -250);
  assert.equal(physicalLeft.width, 2400);
  assert.equal(physicalLeft.height, 1350);

  const backDip = physicalToDip(physicalLeft, 1.25);
  assert.equal(backDip.x, -1920);
  assert.equal(backDip.y, -200);
  assert.equal(backDip.width, 1920);
  assert.equal(backDip.height, 1080);
});

test('F04: clampBoundsToWorkAreas 智能安全夹持与离线屏幕防跑飞', () => {
  const primaryArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const leftSecondaryArea = { x: -1920, y: 0, width: 1920, height: 1080 };
  const workAreas = [primaryArea, leftSecondaryArea];

  // 1. 在左副屏内的窗口，正常保留在副屏
  const windowOnLeft = { x: -1500, y: 100, width: 800, height: 600 };
  const clamped1 = clampBoundsToWorkAreas(windowOnLeft, workAreas, primaryArea);
  assert.equal(clamped1.x, -1500);
  assert.equal(clamped1.y, 100);

  // 2. 标题栏部分被拖出屏幕上方，安全夹持使标题栏不被削掉
  const windowTooHigh = { x: 200, y: -50, width: 800, height: 600 };
  const clamped2 = clampBoundsToWorkAreas(windowTooHigh, workAreas, primaryArea);
  assert.equal(clamped2.y, 0, '标题栏必须留在可见工作区内');

  // 3. 屏幕拔除（原本在右侧 3840 坐标的窗口彻底脱离所有工作区）
  const orphanedWindow = { x: 3840, y: 500, width: 800, height: 600 };
  const rescued = clampBoundsToWorkAreas(orphanedWindow, workAreas, primaryArea);
  // 应安全重置到主屏幕居中位置
  assert.ok(rescued.x >= primaryArea.x && rescued.x < primaryArea.x + primaryArea.width);
  assert.ok(rescued.y >= primaryArea.y && rescued.y < primaryArea.y + primaryArea.height);
  assert.equal(rescued.width, 800);
  assert.equal(rescued.height, 600);
});

test('F04: computeDisplayContextHash 视口与 DPR 变更指纹计算', () => {
  const h1 = computeDisplayContextHash({ width: 1920, height: 1080 }, 1.0);
  const h2 = computeDisplayContextHash({ width: 1920, height: 1080 }, 1.0);
  const h3 = computeDisplayContextHash({ width: 1920, height: 1080 }, 1.25);
  const h4 = computeDisplayContextHash({ width: 2560, height: 1440 }, 1.0);

  assert.equal(h1, h2, '相同视口与 DPR 具有相同指纹');
  assert.notEqual(h1, h3, 'DPR 变更产生不同指纹');
  assert.notEqual(h1, h4, '分辨率变更产生不同指纹');
  assert.equal(h1.length, 16);
});
