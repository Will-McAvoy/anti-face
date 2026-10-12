function arbitrateDecision({ previewing = false, manualHold = false, project = null, scheduleDecision = { action: 'none', reason: 'off', themeId: null } } = {}) {
  if (previewing) {
    return {
      action: 'defer',
      reason: 'preview',
      themeId: null,
      source: 'preview',
      pending: scheduleDecision.themeId || project?.themeId || null
    };
  }
  if (manualHold) {
    return { action: 'none', reason: 'manual-hold', themeId: null, source: 'manual', pending: project?.themeId || scheduleDecision.themeId || null };
  }
  if (project?.dangling) {
    return { action: 'none', reason: 'binding-dangling', themeId: null, source: 'project', code: 'BINDING_DANGLING' };
  }
  if (project && project.enabled !== false && project.reliable && project.themeId) {
    return { action: 'apply', reason: 'project', themeId: project.themeId, source: 'project', bindingId: project.bindingId || null };
  }
  return { ...scheduleDecision, source: scheduleDecision.source || scheduleDecision.reason || 'schedule' };
}

module.exports = { arbitrateDecision };
