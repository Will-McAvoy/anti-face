const { randomUUID } = require('node:crypto');
const { appError } = require('./errors.cjs');
const ranges = require('../shared/appearance-ranges.json');

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

class PreviewSession {
  constructor(deps = {}) {
    this.apply = deps.apply || (async () => ({ ok: true }));
    this.restore = deps.restore || (async () => ({ ok: true }));
    this.show = deps.show || (async () => ({ ok: true }));
    this.debounceMs = deps.debounceMs ?? ranges.previewDebounceMs;
    this.schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
    this.clear = deps.clear || (id => clearTimeout(id));
    this.targets = new Map();
    this.activeTargetId = null;
  }

  _entry(targetId) {
    if (!this.targets.has(targetId)) {
      this.targets.set(targetId, {
        targetId,
        phase: 'idle',
        generation: 0,
        revision: 0,
        actualRevision: 0,
        actualGeneration: 0,
        sessionId: null,
        baseline: null,
        committed: null,
        draft: null,
        actual: null,
        pending: null,
        timer: null,
        inflight: null,
        message: '未试穿',
        comparing: false,
        lastApplyResult: null,
        lastError: null
      });
    }
    return this.targets.get(targetId);
  }

  isCurrent(targetId, generation) {
    const entry = this.targets.get(targetId);
    return !!entry && entry.generation === generation && (entry.phase === 'active' || entry.phase === 'comparing' || entry.phase === 'committing');
  }

  state(targetId) {
    const entry = targetId ? this.targets.get(targetId) : null;
    if (!entry) return { phase: 'idle', message: '未试穿', targetId: targetId || null, ok: true };
    return {
      targetId,
      phase: entry.phase,
      sessionId: entry.sessionId,
      revision: entry.revision,
      actualRevision: entry.actualRevision,
      actualGeneration: entry.actualGeneration,
      generation: entry.generation,
      message: entry.message,
      comparing: entry.comparing,
      pending: !!entry.pending,
      ok: entry.phase !== 'suspended' && !entry.lastError,
      lastError: entry.lastError || null
    };
  }

  async begin(targetId, baseline, draft) {
    if (!targetId) throw appError('INVALID_ARGUMENT', '需要选择一个窗口');
    const entry = this._entry(targetId);
    if (entry.phase === 'active' || entry.phase === 'comparing') {
      throw appError('PREVIEW_CONFLICT', '这个窗口已经在试穿');
    }
    entry.phase = 'starting';
    entry.generation += 1;
    entry.sessionId = randomUUID();
    entry.baseline = clone(baseline);
    entry.committed = clone(baseline.kind === 'theme' ? baseline.document : null);
    entry.draft = clone(draft);
    entry.actual = null;
    entry.actualRevision = 0;
    entry.actualGeneration = 0;
    entry.pending = null;
    entry.lastApplyResult = null;
    entry.lastError = null;
    entry.message = '正在开始试穿';
    const generation = entry.generation;
    let result;
    try {
      result = await this.apply({
        targetId,
        document: entry.draft,
        generation,
        revision: entry.revision,
        source: 'editor',
        isCurrent: () => this.isCurrent(targetId, generation) || (this.targets.get(targetId)?.generation === generation && this.targets.get(targetId)?.phase === 'starting')
      });
    } catch (error) {
      result = { ok: false, code: error?.code || 'HOST_UNAVAILABLE', message: error?.message || '无法开始试穿' };
    }
    if (entry.generation !== generation) return this.state(targetId);
    entry.lastApplyResult = result;
    if (!result?.ok) {
      entry.phase = 'suspended';
      entry.lastError = result?.message || '无法开始试穿';
      entry.message = entry.lastError;
      throw appError(result?.code || 'HOST_UNAVAILABLE', entry.message);
    }
    entry.phase = 'active';
    entry.actual = clone(entry.draft);
    entry.actualRevision = entry.revision;
    entry.actualGeneration = generation;
    entry.lastError = null;
    entry.message = '实时试穿会暂时修改当前反重力窗口；保存以保留，取消以恢复。';
    this.activeTargetId = targetId;
    return this.state(targetId);
  }

  updateDraft(targetId, document, meta = {}) {
    const entry = this._entry(targetId);
    if (entry.phase !== 'active' && entry.phase !== 'comparing') {
      throw appError('PREVIEW_CONFLICT', '还没有开始实时试穿');
    }
    if (this.activeTargetId && this.activeTargetId !== targetId) {
      this._dropPending(this.activeTargetId);
    }
    entry.revision += 1;
    entry.draft = clone(document);
    entry.pending = { document: clone(document), revision: entry.revision, source: meta.source || 'editor' };
    if (entry.timer) this.clear(entry.timer);
    const delay = meta.immediate ? 0 : this.debounceMs;
    entry.timer = this.schedule(() => {
      entry.timer = null;
      void this.flush(targetId);
    }, delay);
    return this.state(targetId);
  }

  _dropPending(targetId) {
    const entry = this.targets.get(targetId);
    if (!entry) return;
    entry.generation += 1;
    entry.pending = null;
    if (entry.timer) this.clear(entry.timer);
    entry.timer = null;
  }

  focus(targetId) {
    if (this.activeTargetId && this.activeTargetId !== targetId) this._dropPending(this.activeTargetId);
    this.activeTargetId = targetId;
  }

  async flush(targetId) {
    const entry = this._entry(targetId);
    if (entry.timer) {
      this.clear(entry.timer);
      entry.timer = null;
    }
    if (entry.inflight) {
      await entry.inflight.catch(() => {});
    }
    if (entry.pending) {
      entry.inflight = this._drain(targetId).finally(() => {
        entry.inflight = null;
      });
      return await entry.inflight;
    }
    return {
      ok: !entry.lastError && entry.actualRevision === entry.revision && entry.actualGeneration === entry.generation,
      revision: entry.actualRevision,
      generation: entry.actualGeneration,
      error: entry.lastError
    };
  }

  async _drain(targetId) {
    const entry = this._entry(targetId);
    let outcome = { ok: true, revision: entry.actualRevision };
    while (entry.pending && (entry.phase === 'active' || entry.phase === 'committing')) {
      const job = entry.pending;
      entry.pending = null;
      const generation = entry.generation;
      let result;
      try {
        result = await this.apply({
          targetId,
          document: job.document,
          revision: job.revision,
          generation,
          source: job.source,
          isCurrent: () => this.isCurrent(targetId, generation)
        });
      } catch (error) {
        result = { ok: false, code: error?.code || 'APPLY_FAILED', message: error?.message || '应用异常' };
      }
      entry.lastApplyResult = result;
      if (!this.isCurrent(targetId, generation) && entry.phase !== 'committing') {
        return { ok: false, stale: true, revision: entry.actualRevision };
      }
      if (entry.generation !== generation) {
        return { ok: false, stale: true, revision: entry.actualRevision };
      }
      if (result?.ok) {
        if (job.revision >= entry.actualRevision) {
          entry.actual = clone(job.document);
          entry.actualRevision = job.revision;
          entry.actualGeneration = generation;
          entry.lastError = null;
          entry.message = '试穿已更新当前窗口';
        }
        outcome = { ok: true, revision: job.revision, result };
      } else {
        entry.lastError = result?.message || '试穿应用失败';
        entry.message = entry.lastError;
        outcome = { ok: false, error: entry.lastError, result };
        break;
      }
    }
    return outcome;
  }

  async commit(targetId, save) {
    const entry = this._entry(targetId);
    if (entry.phase !== 'active' && entry.phase !== 'comparing') throw appError('PREVIEW_CONFLICT', '没有可保存的试穿');
    const generation = entry.generation;
    const revision = entry.revision;

    // 比较中提交时，先恢复最新 draft 并确认
    if (entry.comparing) {
      await this.compare(targetId, false);
    }

    entry.phase = 'committing';
    entry.comparing = false;
    if (entry.timer) {
      this.clear(entry.timer);
      entry.timer = null;
    }

    const flushOutcome = await this.flush(targetId);
    if (entry.generation !== generation) return this.state(targetId);

    if (!flushOutcome.ok || entry.actualRevision !== revision || entry.actualGeneration !== generation || entry.lastError) {
      entry.phase = 'active';
      const msg = entry.lastError || flushOutcome.error || '试穿未成功应用到宿主，无法保存';
      throw appError('APPLY_FAILED', msg);
    }

    try {
      await save(clone(entry.draft), { revision, targetId });
    } catch (error) {
      entry.phase = 'active';
      entry.message = '已试穿但未保存';
      throw appError('SAVE_FAILED', error?.message || '已试穿但未保存');
    }
    if (entry.generation !== generation || entry.revision !== revision) {
      entry.phase = 'active';
      entry.message = '保存时草稿又变了，试穿仍保留';
      return this.state(targetId);
    }
    entry.committed = clone(entry.draft);
    entry.baseline = null;
    entry.phase = 'idle';
    entry.sessionId = null;
    entry.message = '试穿已保存';
    return this.state(targetId);
  }

  async cancel(targetId) {
    const entry = this._entry(targetId);
    if (entry.phase === 'idle') return this.state(targetId);
    entry.generation += 1;
    entry.pending = null;
    if (entry.timer) this.clear(entry.timer);
    entry.timer = null;
    entry.phase = 'cancelling';
    entry.comparing = false;
    if (entry.inflight) await entry.inflight.catch(() => {});
    const baseline = entry.baseline;
    let restored;
    try {
      restored = await this.restore({ targetId, baseline, generation: entry.generation });
    } catch (error) {
      restored = { ok: false, message: error.message };
    }
    if (!restored?.ok) {
      entry.phase = 'suspended';
      entry.message = '恢复待完成，无法确认';
      entry.lastError = entry.message;
      return this.state(targetId);
    }
    entry.draft = clone(baseline?.document || entry.committed);
    entry.actual = clone(entry.draft);
    entry.actualRevision = 0;
    entry.actualGeneration = entry.generation;
    entry.phase = 'idle';
    entry.sessionId = null;
    entry.baseline = null;
    entry.lastError = null;
    entry.message = baseline?.kind === 'original' ? '已恢复进入试穿前的宿主原样' : '已恢复进入试穿前的主题';
    return { ...this.state(targetId), restoredDocument: clone(entry.draft) };
  }

  async compare(targetId, holding) {
    const entry = this._entry(targetId);
    if (entry.phase !== 'active' && entry.phase !== 'comparing') throw appError('PREVIEW_CONFLICT', '没有正在试穿的窗口');
    if (holding) {
      entry.phase = 'comparing';
      entry.comparing = true;
      const shown = await this.show({ targetId, document: entry.baseline?.document || null, baseline: entry.baseline, mode: 'baseline' });
      if (!shown?.ok) {
        entry.message = '暂时无法显示试穿前的样子';
      } else {
        entry.message = '正在查看试穿前';
      }
      return this.state(targetId);
    }
    entry.comparing = false;
    entry.phase = 'active';
    const shown = await this.show({ targetId, document: entry.draft, baseline: entry.baseline, mode: 'draft' });
    entry.message = shown?.ok ? '已回到当前试穿' : '对比结束，但未能确认已回到试穿';
    return this.state(targetId);
  }

  async blur(targetId) {
    const entry = this.targets.get(targetId);
    if (!entry || entry.phase !== 'comparing') return this.state(targetId);
    return this.compare(targetId, false);
  }

  suspend(targetId, message) {
    const entry = this.targets.get(targetId);
    if (!entry || entry.phase === 'idle') return this.state(targetId);
    entry.generation += 1;
    entry.pending = null;
    if (entry.timer) this.clear(entry.timer);
    entry.phase = 'suspended';
    entry.message = message || '试穿已挂起，重新连接后请继续';
    entry.lastError = entry.message;
    return this.state(targetId);
  }
}

module.exports = { PreviewSession };
