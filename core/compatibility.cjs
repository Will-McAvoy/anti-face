function checkCompatibility(host, manifest, previous = null) {
  if (!host.installed) return { allowed: false, reason: "not-installed" };
  if (!host.version || !host.fingerprint)
    return { allowed: false, reason: "missing-identity" };
  if (
    previous &&
    (previous.version !== host.version ||
      previous.fingerprint !== host.fingerprint)
  ) {
    return { allowed: false, reason: "host-updated" };
  }
  const adapter = manifest.adapters.find(
    (item) =>
      item.platform === process.platform &&
      item.status === "ready" &&
      item.verifiedHosts.some(
        (entry) =>
          entry.version === host.version &&
          entry.fingerprint === host.fingerprint,
      ),
  );
  return adapter
    ? { allowed: true, reason: "verified", adapterId: adapter.id }
    : { allowed: false, reason: "untested" };
}
module.exports = { checkCompatibility };
