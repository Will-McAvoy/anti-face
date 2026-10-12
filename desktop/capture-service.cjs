const { randomUUID } = require('node:crypto');

const MAX_GROUPS = 4;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_EDGE = 2000;

class CaptureService {
  constructor(deps = {}) {
    this.groups = [];
    this.bytes = 0;
    this.timeoutMs = deps.timeoutMs ?? 4000;
    this.filesWritten = [];
    this.targetGenerations = new Map();
    this.clearEpoch = 0;
    this.maskDepth = new Map();
    this.inflight = new Set();
  }

  ensureGeneration(targetId) {
    if (!targetId) return 1;
    if (!this.targetGenerations.has(targetId)) this.targetGenerations.set(targetId, 1);
    return this.targetGenerations.get(targetId);
  }

  getGeneration(targetId) {
    if (!targetId) return 1;
    return this.targetGenerations.get(targetId) || 1;
  }

  bumpGeneration(targetId) {
    if (!targetId) return 1;
    const next = this.getGeneration(targetId) + 1;
    this.targetGenerations.set(targetId, next);
    return next;
  }

  _evict() {
    while (this.groups.length > MAX_GROUPS || this.bytes > MAX_BYTES) {
      const removed = this.groups.shift();
      if (!removed) break;
      this.bytes -= (removed.before?.bytes || 0) + (removed.after?.bytes || 0);
    }
    if (this.bytes < 0) this.bytes = 0;
  }

  invalidate(targetId) {
    if (!targetId) {
      for (const id of this.targetGenerations.keys()) this.bumpGeneration(id);
      return;
    }
    this.bumpGeneration(targetId);
  }

  clear(targetId) {
    this.clearEpoch += 1;
    if (!targetId) {
      for (const id of this.targetGenerations.keys()) this.bumpGeneration(id);
      this.groups = [];
      this.bytes = 0;
      this.maskDepth.clear();
      return;
    }
    this.bumpGeneration(targetId);
    this.groups = this.groups.filter(group => group.targetId !== targetId);
    this.bytes = this.groups.reduce((sum, group) => sum + (group.before?.bytes || 0) + (group.after?.bytes || 0), 0);
    this.maskDepth.delete(targetId);
  }

  latestOpenBefore(targetId) {
    for (let index = this.groups.length - 1; index >= 0; index -= 1) {
      const group = this.groups[index];
      if (group.targetId === targetId && group.before && !group.after) return group.id;
    }
    return null;
  }

  list(targetId) {
    return this.groups.filter(group => !targetId || group.targetId === targetId).map(group => ({
      id: group.id,
      targetId: group.targetId,
      viewport: group.viewport,
      clip: group.clip,
      dpr: group.dpr,
      navigationId: group.navigationId,
      instanceId: group.instanceId,
      comparable: group.comparable,
      incompatibility: group.incompatibility || null,
      before: group.before ? { bytes: group.before.bytes, width: group.before.width, height: group.before.height, at: group.before.at } : null,
      after: group.after ? { bytes: group.after.bytes, width: group.after.width, height: group.after.height, at: group.after.at } : null
    }));
  }

  image(groupId, phase) {
    const group = this.groups.find(item => item.id === groupId);
    if (!group) return null;
    return phase === 'after' ? group.after : group.before;
  }

  async _mask(request, enabled) {
    if (!request.hideSensitive || !request.client?.mask) return false;
    const key = request.targetId || 'default';
    const depth = this.maskDepth.get(key) || 0;
    if (enabled) {
      this.maskDepth.set(key, depth + 1);
      if (depth === 0) await request.client.mask(true);
      return true;
    }
    const next = depth - 1;
    if (next <= 0) {
      this.maskDepth.delete(key);
      await request.client.mask(false);
    } else {
      this.maskDepth.set(key, next);
    }
    return false;
  }

  async take(request) {
    const clip = normalizeClip(request.clip, request.viewport);
    if (!clip.ok) return clip;
    const requestId = request.requestId || randomUUID();
    const epoch = this.clearEpoch;
    this.ensureGeneration(request.targetId);
    const targetGen = this.getGeneration(request.targetId);
    const signature = captureSignature(request, clip.clip);
    const current = () => this.clearEpoch === epoch
      && this.getGeneration(request.targetId) === targetGen
      && (!request.isCurrent || request.isCurrent());
    if (!current()) return { ok: false, code: 'GENERATION_STALE', message: '截图开始前目标已经变了', retryable: true };
    if (!request.client) return { ok: false, code: 'CAPTURE_UNAVAILABLE', message: '当前窗口不能截图', retryable: true };
    this.inflight.add(requestId);
    let timer;
    let masked = false;
    try {
      if (request.hideSensitive && request.client.mask) {
        await this._mask(request, true);
        masked = true;
      }
      if (!current()) return { ok: false, code: 'GENERATION_STALE', message: '截图已取消', retryable: true };
      const shot = await Promise.race([
        request.client.captureScreenshot({ clip: clip.clip, hideSensitive: request.hideSensitive === true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('截图超时'), { code: 'CAPTURE_TIMEOUT' })), this.timeoutMs); })
      ]);
      if (!current()) return { ok: false, code: 'GENERATION_STALE', message: '截图返回时目标已经变了，结果已忽略', retryable: true };
      if (!shot?.png || !Buffer.isBuffer(shot.png)) return { ok: false, code: 'CAPTURE_UNAVAILABLE', message: '没有拿到图像', retryable: true };
      const record = {
        png: shot.png,
        bytes: shot.png.length,
        width: shot.width,
        height: shot.height,
        at: request.now || new Date().toISOString(),
        signature
      };
      let group = this.groups.find(item => item.id === request.groupId && item.targetId === request.targetId);
      if (!group) {
        group = {
          id: request.groupId,
          targetId: request.targetId,
          viewport: request.viewport || null,
          clip: clip.clip,
          dpr: signature.dpr,
          navigationId: signature.navigationId,
          instanceId: signature.instanceId,
          documentHash: request.documentHash || null,
          comparable: true,
          incompatibility: null,
          before: null,
          after: null
        };
        this.groups.push(group);
      }
      const targetPhase = request.phase === 'after' ? 'after' : 'before';
      const other = targetPhase === 'after' ? group.before : group.after;
      if (other) {
        const reason = incompatibility(other.signature, signature);
        group.comparable = !reason;
        group.incompatibility = reason;
      }
      const existing = group[targetPhase];
      if (existing) this.bytes -= existing.bytes;
      group[targetPhase] = record;
      group.clip = clip.clip;
      group.dpr = signature.dpr;
      this.bytes += record.bytes;
      if (!current()) {
        group[targetPhase] = existing || null;
        this.bytes -= record.bytes;
        if (existing) this.bytes += existing.bytes;
        return { ok: false, code: 'GENERATION_STALE', message: '截图结果已过期', retryable: true };
      }
      this._evict();
      return {
        ok: true,
        groupId: group.id,
        comparable: group.comparable,
        incompatibility: group.incompatibility,
        width: record.width,
        height: record.height,
        bytes: record.bytes,
        clip: group.clip,
        dpr: group.dpr
      };
    } catch (error) {
      if (!current()) return { ok: false, code: 'GENERATION_STALE', message: '截图已取消', retryable: true };
      return { ok: false, code: error.code || 'CAPTURE_UNAVAILABLE', message: error.code === 'CAPTURE_TIMEOUT' ? '截图超时，结果已忽略' : '截图失败', retryable: error.code === 'CAPTURE_TIMEOUT' };
    } finally {
      if (timer) clearTimeout(timer);
      this.inflight.delete(requestId);
      if (masked) await this._mask(request, false).catch(() => {});
    }
  }
}

function captureSignature(request, clip) {
  const viewport = request.viewport || {};
  return {
    clip: clip ? `${clip.x},${clip.y},${clip.width},${clip.height}` : 'full',
    dpr: Number(request.dpr || viewport.dpr || 1),
    width: viewport.width || null,
    height: viewport.height || null,
    navigationId: request.navigationId || null,
    instanceId: request.instanceId || null
  };
}

function incompatibility(left, right) {
  if (!left || !right) return null;
  if (left.clip !== right.clip) return 'clip';
  if (left.dpr !== right.dpr) return 'dpr';
  if (left.width !== right.width || left.height !== right.height) return 'viewport';
  if (left.navigationId && right.navigationId && left.navigationId !== right.navigationId) return 'navigation';
  if (left.instanceId && right.instanceId && left.instanceId !== right.instanceId) return 'instance';
  return null;
}

function normalizeClip(clip, viewport) {
  if (!clip) return { ok: true, clip: null };
  const width = Number(clip.width);
  const height = Number(clip.height);
  const x = Number(clip.x);
  const y = Number(clip.y);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: '截图区域无效', retryable: false };
  }
  if (width > MAX_EDGE || height > MAX_EDGE) return { ok: false, code: 'CAPTURE_UNAVAILABLE', message: '截图区域超过上限', retryable: false };
  if (viewport && (x + width > viewport.width + 1 || y + height > viewport.height + 1)) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: '截图区域超出窗口', retryable: false };
  }
  return { ok: true, clip: { x, y, width, height, scale: clip.scale === 2 ? 2 : 1 } };
}

module.exports = { CaptureService, normalizeClip, MAX_BYTES, MAX_GROUPS, incompatibility };
