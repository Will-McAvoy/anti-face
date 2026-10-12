function classifyScene(probe) {
  if (!probe || typeof probe !== 'object') return { scene: 'unknown', evidence: 'missing' };
  const transcript = probe.hasTranscript === true;
  const conversation = probe.hasConversation === true;
  const route = probe.routeHint === 'home' || probe.routeHint === 'chat' ? probe.routeHint : '';
  if (route === 'chat' || transcript) return { scene: 'chat', evidence: transcript ? 'transcript' : 'route' };
  if (route === 'home' || (conversation && !transcript)) return { scene: 'home', evidence: route === 'home' ? 'route' : 'conversation-only' };
  return { scene: 'unknown', evidence: 'insufficient' };
}

function createSceneState() {
  return { committed: 'unknown', pending: null, pendingSince: null, lastSwitchAt: null };
}

function stepScene(state, input, config = {}) {
  const stableMs = config.stableMs ?? 500;
  const minIntervalMs = config.minIntervalMs ?? 500;
  const now = input.now;
  const sample = input.scene === 'home' || input.scene === 'chat' || input.scene === 'unknown' ? input.scene : 'unknown';
  const next = {
    committed: state.committed,
    pending: state.pending,
    pendingSince: state.pendingSince,
    lastSwitchAt: state.lastSwitchAt
  };
  if (sample === next.committed) {
    next.pending = null;
    next.pendingSince = null;
    return { state: next, changed: false, scene: next.committed };
  }
  if (next.pending !== sample) {
    next.pending = sample;
    next.pendingSince = now;
    return { state: next, changed: false, scene: next.committed };
  }
  if (now - next.pendingSince < stableMs) {
    return { state: next, changed: false, scene: next.committed };
  }
  if (next.lastSwitchAt != null && now - next.lastSwitchAt < minIntervalMs) {
    return { state: next, changed: false, scene: next.committed };
  }
  next.committed = sample;
  next.lastSwitchAt = now;
  next.pending = null;
  next.pendingSince = null;
  return { state: next, changed: true, scene: next.committed };
}

module.exports = { classifyScene, createSceneState, stepScene };
