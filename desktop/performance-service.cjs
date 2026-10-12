const {
  defaultPerformancePrefs,
  validatePerformancePrefs,
  evaluatePerformanceState,
  BLUR_CAPS
} = require('../core/performance-policy.cjs');

class PerformanceService {
  constructor(studio, deps = {}) {
    this.studio = studio;
    this.powerMonitor = deps.powerMonitor || null;
    this.targetStates = new Map();
    this.prefs = validatePerformancePrefs(deps.prefs);
    this.active = false;
    this.timer = null;
    this.powerListener = null;
    this.lastError = null;
    this.lastStatus = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.powerListener = () => {
      void this.refresh({ powerEvent: true }).catch(error => {
        this.lastError = error.message;
      });
    };
    for (const event of ['on-battery', 'on-ac']) {
      this.powerMonitor?.on?.(event, this.powerListener);
    }
    this.timer = setInterval(() => {
      void this.refresh({ isTimer: true }).catch(error => {
        this.lastError = error.message;
      });
    }, 10000);
    this.timer.unref?.();
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const event of ['on-battery', 'on-ac']) {
      this.powerMonitor?.removeListener?.(event, this.powerListener);
    }
    this.powerListener = null;
    this.cancelPendingRetries();
  }

  cancelPendingRetries(targetId = null) {
    if (targetId) {
      const st = this.targetStates.get(targetId);
      if (st) {
        st.pending = false;
        st.retryAt = null;
        st.retryCount = 0;
      }
    } else {
      for (const st of this.targetStates.values()) {
        st.pending = false;
        st.retryAt = null;
        st.retryCount = 0;
      }
    }
  }

  async refresh(options = {}) {
    if (this.studio.safeMode || this.studio.migrationActive) {
      this.cancelPendingRetries();
      return;
    }

    const now = Date.now();
    let firstThrown = null;

    for (const [id, state] of this.studio.round5?.targetStates || []) {
      if (!state.activeDocument || state.disposed || state.visible === false || this.studio.preview?.state?.(id)?.phase !== 'idle') {
        continue;
      }
      if (state.performanceHold) {
        continue;
      }

      const st = this.getTargetState(id);
      if (st.inFlight) continue;

      if (options.isTimer && st.pending && st.retryAt && now < st.retryAt) {
        continue;
      }

      const intent = this.studio.round5.captureIntent(id);
      intent.automated = false;
      const isCurrent = () => !state.performanceHold && !this.studio.safeMode && !this.studio.migrationActive && this.studio.round5.intentCurrent(intent);

      const result = this.evaluate(id, { powerSource: this.getPowerSource(), powerEvent: true });
      if (!result || !isCurrent()) continue;

      const doc = state.activeDocument;
      const docId = doc?.id || 'doc';
      const docVer = doc?.updatedAt || '';
      const desiredTier = st.desiredTier || 'normal';
      const desiredKey = `${id}:${intent.instanceId}:${desiredTier}:${docId}:${docVer}`;
      st.desiredKey = desiredKey;

      const needsApply = (st.desiredKey !== st.confirmedKey) || st.pending;
      if (!needsApply) continue;

      st.inFlight = true;
      try {
        const assetUrl = await this.studio._assetUrl(doc);
        if (!isCurrent()) {
          st.inFlight = false;
          continue;
        }

        const blurCap = BLUR_CAPS[desiredTier] || 100;
        const prepared = await this.studio.round5.decorateApply(doc, id, {
          assetUrl,
          source: 'performance',
          isCurrent,
          verify: true,
          context: {
            performanceTier: desiredTier,
            performanceOverrides: desiredTier === 'normal' ? null : { maxBlur: blurCap }
          }
        });

        if (!isCurrent() || prepared?.stale) {
          st.inFlight = false;
          continue;
        }

        const status = await this.studio.theme.applyDocument(doc, id, prepared);
        if (!isCurrent()) {
          st.inFlight = false;
          continue;
        }

        const isSuccess = status && (status.state === 'applied' || status.ok === true || status.applied === true) && status.state !== 'failed' && status.state !== 'cancelled' && status.state !== 'stale';

        if (isSuccess) {
          st.confirmedTier = desiredTier;
          st.tier = desiredTier;
          st.confirmedKey = desiredKey;
          st.pending = false;
          st.retryCount = 0;
          st.retryAt = null;
          st.lastError = null;
          this.lastStatus = status;
          this.studio.onStudioChanged?.();
        } else {
          const code = status?.code || 'APPLY_FAILED';
          const message = status?.message || '应用未能成功生效';
          st.lastError = { code, message };
          st.retryCount = (st.retryCount || 0) + 1;
          if (st.retryCount <= 5) {
            st.pending = true;
            st.retryAt = now + (st.retryCount === 1 ? 1000 : st.retryCount === 2 ? 3000 : 10000);
          } else {
            st.pending = false;
          }
        }
      } catch (error) {
        if (!isCurrent()) {
          st.inFlight = false;
          continue;
        }
        const code = error.code || 'APPLY_ERROR';
        const message = error.message || String(error);
        st.lastError = { code, message };
        st.retryCount = (st.retryCount || 0) + 1;
        if (st.retryCount <= 5) {
          st.pending = true;
          st.retryAt = now + (st.retryCount === 1 ? 1000 : st.retryCount === 2 ? 3000 : 10000);
        } else {
          st.pending = false;
        }
        this.lastError = message;
        if (!firstThrown) firstThrown = error;
      } finally {
        st.inFlight = false;
      }
    }

    if (firstThrown) throw firstThrown;
  }

  getPowerSource() {
    if (this.powerMonitor && typeof this.powerMonitor.isOnBatteryPower === 'function') {
      try {
        return this.powerMonitor.isOnBatteryPower() ? 'battery' : 'ac';
      } catch {
        return 'unknown';
      }
    }
    return 'unknown';
  }

  getTargetState(targetId) {
    if (!targetId) return null;
    let st = this.targetStates.get(targetId);
    if (!st) {
      st = {
        targetId,
        tier: 'normal',
        desiredTier: 'normal',
        confirmedTier: 'normal',
        desiredKey: null,
        confirmedKey: null,
        pending: false,
        inFlight: false,
        retryCount: 0,
        retryAt: null,
        lastError: null,
        consecutivePoor: 0,
        consecutiveGood: 0,
        lastAdjustedAt: 0,
        reason: '初始正常'
      };
      this.targetStates.set(targetId, st);
    }
    return st;
  }

  resetTarget(targetId) {
    if (targetId) {
      this.targetStates.delete(targetId);
    }
  }

  resetAll() {
    this.targetStates.clear();
  }

  evaluate(targetId, sample = {}) {
    if (!targetId) return null;

    if (this.studio?.safeMode === true) {
      const st = this.getTargetState(targetId);
      st.desiredTier = 'normal';
      st.pending = false;
      st.retryCount = 0;
      st.retryAt = null;
      return { tier: 'normal', reason: '安全模式下性能自动策略关闭', overrides: {}, changed: st.confirmedTier !== 'normal' };
    }

    const state = this.getTargetState(targetId);
    const powerSource = sample.powerSource || this.getPowerSource();
    const effectiveSample = {
      ...sample,
      powerSource
    };

    const currentStateForEval = {
      tier: state.desiredTier || 'normal',
      consecutivePoor: state.consecutivePoor,
      consecutiveGood: state.consecutiveGood,
      lastAdjustedAt: state.lastAdjustedAt,
      reason: state.reason
    };

    const result = evaluatePerformanceState(currentStateForEval, effectiveSample, {
      prefs: this.prefs,
      now: Date.now()
    });

    if (this.prefs.mode === 'advisory') {
      result.changed = state.desiredTier !== 'normal';
      result.tier = 'normal';
      result.overrides = {};
      result.reason = this.getPowerSource() === 'battery' ? '电池供电，建议省电；未自动调整' : '仅建议，不自动调整';
    }

    state.desiredTier = result.tier;
    state.consecutivePoor = result.consecutivePoor;
    state.consecutiveGood = result.consecutiveGood;
    state.lastAdjustedAt = result.lastAdjustedAt;
    state.reason = result.reason;

    return result;
  }

  summary(targetId) {
    const st = targetId ? this.getTargetState(targetId) : null;
    const confirmed = st ? (st.confirmedTier || 'normal') : 'normal';
    const desired = st ? (st.desiredTier || 'normal') : 'normal';
    return {
      mode: this.prefs.mode,
      batteryAware: this.prefs.batteryAware,
      maxTier: this.prefs.maxTier,
      powerSource: this.getPowerSource(),
      tier: confirmed,
      desiredTier: desired,
      confirmedTier: confirmed,
      pending: st ? !!st.pending : false,
      inFlight: st ? !!st.inFlight : false,
      retryCount: st ? (st.retryCount || 0) : 0,
      lastError: st?.lastError || null,
      reason: st ? (st.pending && st.lastError ? `${st.reason} (待重试: ${st.lastError.message})` : st.reason) : '未连接或无目标'
    };
  }

  setPrefs(patch) {
    this.prefs = validatePerformancePrefs({ ...this.prefs, ...patch });
    for (const st of this.targetStates.values()) {
      st.lastAdjustedAt = 0;
    }
    return this.prefs;
  }
}

module.exports = { PerformanceService };
