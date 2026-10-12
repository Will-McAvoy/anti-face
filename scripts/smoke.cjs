const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForSelector(".theme-card");
    assert.equal(await page.locator(".theme-card").count(), 15);
    await page.getByRole("button", { name: "珍珠白 LIGHT" }).click();
    assert.equal((await page.locator(".tuning h3").innerText()).replace(/\s/g, ""), "珍珠白浅色");
    await page.getByRole("button", { name: "玻璃", exact: true }).click();
    assert.equal(await page.locator(".theme-card").count(), 7);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByPlaceholder("搜索主题").fill("不存在的主题");
    assert.equal(await page.locator(".theme-card").count(), 0);
    await page.getByPlaceholder("搜索主题").fill("");
    await page.getByRole("button", { name: "重置预览" }).click();
    assert.notEqual(await page.locator(".scene").evaluate(el => getComputedStyle(el).backgroundImage), "none");
    await page.getByLabel("磨砂模糊").fill("32");
    assert.match(
      await page.locator(".scene").getAttribute("style"),
      /--blur: 32px/,
    );
    const host = await page.evaluate(() => window.antiFace.inspectHost());
    assert.ok(["not-installed", "untested"].includes(host.compatibility));
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    await fs.mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/studio.png", fullPage: true });
    await page.getByRole("button", { name: "连接与兼容", exact: true }).click();
    await page.getByRole("button", { name: "检测本机 Antigravity" }).click();
    await page.waitForFunction(
      () => !document.querySelector(".compat-intro button").disabled,
    );
    await page.screenshot({
      path: "artifacts/compatibility.png",
      fullPage: true,
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      "PASS: 15 presets, filters, search, styling, desktop IPC, host detection, renderer isolation.",
    );
    console.log("Screenshots: " + path.resolve("artifacts"));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
