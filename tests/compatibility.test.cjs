const test = require("node:test");
const assert = require("node:assert/strict");
const { checkCompatibility } = require("../core/compatibility.cjs");
const host = { installed: true, version: "2.19.1.0", fingerprint: "sha256-a" };
const manifest = {
  adapters: [
    {
      id: "test",
      platform: process.platform,
      status: "ready",
      verifiedHosts: [host],
    },
  ],
};
test("only the exact tested host identity may be applied", () => {
  assert.equal(checkCompatibility(host, manifest).allowed, true);
  assert.equal(
    checkCompatibility({ ...host, fingerprint: "changed" }, manifest).allowed,
    false,
  );
});
test("updates suspend a previously attached session", () => {
  assert.equal(
    checkCompatibility({ ...host, version: "2.20.0" }, manifest, host).reason,
    "host-updated",
  );
});
test("missing identity and empty support manifest fail closed", () => {
  assert.equal(
    checkCompatibility({ ...host, fingerprint: null }, manifest).allowed,
    false,
  );
  assert.equal(checkCompatibility(host, { adapters: [] }).reason, "untested");
});
test("a planned adapter cannot pass verification", () => {
  const planned = {
    adapters: [{ ...manifest.adapters[0], status: "planned" }],
  };
  assert.equal(checkCompatibility(host, planned).allowed, false);
});
