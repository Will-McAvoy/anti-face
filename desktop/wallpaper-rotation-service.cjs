const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { appError } = require('../core/errors.cjs');
const {
  validateRotationConfig,
  selectNextCandidate,
  computeNextRotationTime
} = require('../core/wallpaper-rotation-policy.cjs');

const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_SCANNED_FILES = 2000;
const MAX_WALK_DEPTH = 6;

/**
 * 校验文件夹安全路径
 */
function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 快速检查图片魔数
 */
function isImageMagic(buffer) {
  if (!buffer || buffer.length < 8) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
  // WEBP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return true;
    }
  }
  return false;
}

class WallpaperRotationService {
  constructor(studio, deps = {}) {
    this.studio = studio;
    this.fs = deps.fs || fs;
    this.now = deps.now || (() => Date.now());
    this.setTimeout = deps.setTimeout || global.setTimeout;
    this.clearTimeout = deps.clearTimeout || global.clearTimeout;
    this.rng = deps.rng || Math.random;

    this.config = validateRotationConfig(deps.config || {});
    this.timer = null;
    this.lastRotationTime = 0;
    this.manualPaused = false;
    this.isScanning = false;
    this.isRotating = false;
    this.operationEpoch = 0;

    // 候选池缓存
    this.candidates = [];
    this.currentIndex = -1;
    this.shuffleState = { remaining: [], lastItem: null };

    // 运行时目标覆盖映射: targetId -> { assetId, filename, filePath, appliedAt }
    this.targetOverrides = new Map();
    // 跟踪每个 targetId 前一个持有的 assetId 用于释放租约
    this.activeLeases = new Map(); // targetId -> assetId
  }

  async init(savedConfig = {}) {
    this.config = validateRotationConfig(savedConfig);
    if (this.config.enabled && this.config.folderRef) {
      await this.scanFolder().catch(() => {});
      this.scheduleNext();
    }
  }

  setConfig(newConfig) {
    this.operationEpoch++;
    const validated = validateRotationConfig(newConfig);
    const folderChanged = validated.folderRef !== this.config.folderRef;
    const recursiveChanged = validated.recursive !== this.config.recursive;
    this.config = validated;

    if (folderChanged || recursiveChanged) {
      this.candidates = [];
      this.currentIndex = -1;
      this.shuffleState = { remaining: [], lastItem: null };
      if (this.config.enabled && this.config.folderRef) {
        void this.scanFolder().then(() => this.scheduleNext());
      }
    } else if (this.config.enabled) {
      this.scheduleNext();
    } else {
      this.stopTimer();
    }
    return this.config;
  }

  getOverride(targetId) {
    if (!targetId) return null;
    return this.targetOverrides.get(targetId) || null;
  }

  pause() {
    this.operationEpoch++;
    this.manualPaused = true;
    this.stopTimer();
    return this.getStatus();
  }

  resume() {
    this.manualPaused = false;
    if (this.config.enabled) {
      this.scheduleNext();
    }
    return this.getStatus();
  }

  stopTimer() {
    if (this.timer) {
      this.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.stopTimer();
  }

  /**
   * 扫描指定文件夹并验证候选图片文件
   */
  async scanFolder() {
    if (!this.config.folderRef) {
      this.candidates = [];
      return [];
    }

    const folder = path.resolve(this.config.folderRef);

    // 安全检查：不得位于 userData 内部
    if (this.studio?.userData && isPathInside(path.resolve(this.studio.userData), folder)) {
      throw appError('INVALID_ARGUMENT', '壁纸轮换文件夹不能位于程序内部数据目录中');
    }

    // 检查目录是否存在
    try {
      const stat = await this.fs.stat(folder);
      if (!stat.isDirectory()) {
        throw appError('INVALID_ARGUMENT', '所选路径不是一个有效目录');
      }
    } catch (err) {
      this.candidates = [];
      throw appError('NOT_FOUND', `无法访问壁纸文件夹: ${err.message}`);
    }

    this.isScanning = true;
    const found = [];

    const walk = async (currentDir, depth) => {
      if (found.length >= MAX_SCANNED_FILES) return;
      if (depth > MAX_WALK_DEPTH) return;

      let entries = [];
      try {
        entries = await this.fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (found.length >= MAX_SCANNED_FILES) break;
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (this.config.recursive && !entry.name.startsWith('.')) {
            await walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ALLOWED_EXTS.has(ext)) {
            found.push(fullPath);
          }
        }
      }
    };

    try {
      await walk(folder, 0);
      found.sort();
      this.candidates = found;
      // 重置轮换状态
      this.currentIndex = -1;
      this.shuffleState = { remaining: [], lastItem: null };
      return this.candidates;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 计算当前暂停原因
   */
  getPauseReason(targetId = this.studio?.selectedTargetId) {
    if (!this.config.enabled) return 'disabled';
    if (this.manualPaused) return 'manual-paused';
    if (this.studio?.safeMode) return 'safe-mode';
    if (this.studio?.migrationActive) return 'migration';
    if (this.studio?.previewActive && this.studio.previewActive()) return 'previewing';
    if (targetId && this.studio?.round5?.getTargetState(targetId)?.manualHold) return 'manual-hold';
    if (!this.config.folderRef) return 'no-folder';
    if (this.candidates.length === 0) return 'folder-empty';
    return null;
  }

  getStatus(targetId = this.studio?.selectedTargetId) {
    const pauseReason = this.getPauseReason(targetId);
    const override = targetId ? this.targetOverrides.get(targetId) : null;
    return {
      enabled: this.config.enabled,
      folderRef: this.config.folderRef,
      order: this.config.order,
      intervalSeconds: this.config.intervalSeconds,
      recursive: this.config.recursive,
      candidateCount: this.candidates.length,
      currentIndex: this.currentIndex,
      currentFilename: override ? override.filename : (this.currentIndex >= 0 && this.candidates[this.currentIndex] ? path.basename(this.candidates[this.currentIndex]) : null),
      paused: !!pauseReason,
      pauseReason,
      nextRotationAt: this.timer ? (this.lastRotationTime + this.config.intervalSeconds * 1000) : null
    };
  }

  scheduleNext() {
    this.stopTimer();
    if (!this.config.enabled || this.manualPaused) return;

    const now = this.now();
    const nextTime = computeNextRotationTime(this.lastRotationTime, this.config.intervalSeconds, now);
    const delay = Math.max(0, nextTime - now);

    this.timer = this.setTimeout(() => {
      void this._onTimerTick();
    }, delay);
  }

  async _onTimerTick() {
    this.timer = null;
    this.lastRotationTime = this.now();

    try {
      const targetId = this.studio?.selectedTargetId;
      const pauseReason = this.getPauseReason(targetId);
      if (!pauseReason && targetId) {
        await this.rotate(targetId);
      }
    } catch {
      // 容错并继续调度
    } finally {
      this.scheduleNext();
    }
  }

  /**
   * 手动或自动推进到下一张壁纸
   */
  async rotate(targetId = this.studio?.selectedTargetId) {
    if (!targetId) throw appError('INVALID_ARGUMENT', '未选择目标窗口');
    if (this.studio?.safeMode) throw appError('SAFE_MODE', '安全模式下禁止壁纸轮换');
    if (this.studio?.migrationActive) throw appError('MIGRATION_ACTIVE', '迁移恢复期间禁止壁纸轮换');

    const targetState = this.studio.round5?.getTargetState(targetId, false);
    const initialDoc = targetState?.activeDocument;
    if (!initialDoc) {
      return { ok: false, code: 'NO_DOCUMENT', message: '没有可用的主题文档' };
    }
    if (targetState?.manualHold) {
      return { ok: false, code: 'MANUAL_HOLD', message: '目标窗口处于手动持有状态，已暂停轮换' };
    }

    const initialInstanceId = targetState?.instanceId;
    const initialGeneration = targetState?.operationGeneration;
    const operationEpoch = this.operationEpoch;
    const isCurrent = () => {
      if (this.operationEpoch !== operationEpoch) return false;
      if (this.studio?.safeMode || this.studio?.migrationActive) return false;
      const current = this.studio.round5?.getTargetState(targetId, false);
      if (!current) return false;
      if (current.manualHold) return false;
      if (current.operationGeneration !== initialGeneration || current.activeDocument !== initialDoc) return false;
      if (targetState?.activeDocument && !current.activeDocument) return false;
      if (initialInstanceId && current.instanceId && current.instanceId !== initialInstanceId) return false;
      return true;
    };

    if (this.candidates.length === 0) {
      await this.scanFolder();
      if (this.candidates.length === 0) {
        throw appError('NOT_FOUND', '文件夹中没有符合格式要求的图片');
      }
    }

    if (this.isRotating) return null;
    this.isRotating = true;

    const prevIndex = this.currentIndex;
    const prevShuffle = { ...this.shuffleState };

    try {
      // 选择下一张候选
      let attempts = 0;
      let nextCandidate = null;
      let buffer = null;
      let candidateIndex = prevIndex;
      let candidateShuffle = prevShuffle;

      let tempIndex = prevIndex;
      let tempShuffle = prevShuffle;

      while (attempts < Math.min(this.candidates.length, 5)) {
        attempts++;
        const selection = selectNextCandidate(
          this.candidates,
          tempIndex,
          this.config.order,
          tempShuffle,
          { rng: this.rng }
        );
        tempIndex = selection.nextIndex;
        tempShuffle = selection.nextShuffleState;
        const candidatePath = selection.nextItem;

        if (!candidatePath) break;

        try {
          const fileBuf = await this.fs.readFile(candidatePath);
          if (isImageMagic(fileBuf)) {
            nextCandidate = candidatePath;
            buffer = fileBuf;
            candidateIndex = tempIndex;
            candidateShuffle = tempShuffle;
            break;
          }
        } catch {
          // 文件无法读取，继续尝试下一张
        }
      }

      if (!nextCandidate || !buffer) {
        throw appError('INVALID_IMAGE', '没有读取到可用的有效图片文件');
      }

      if (!isCurrent()) {
        return { ok: false, code: 'STALE', message: '轮换已取消（目标状态变更或已恢复）' };
      }

      // 导入 AssetStore
      if (!this.studio?.assets) throw appError('STATE_ERROR', '资产服务不可用');
      const importRes = await this.studio.assets.importImage(buffer);
      if (!importRes || !importRes.record) {
        throw appError('ASSET_INVALID', '壁纸解码与资产导入失败');
      }

      const newAssetId = importRes.record.id;
      const leaseRef = `rotation-pending:${targetId}:${randomUUID()}`;

      // 预先建立临时新租约
      await this.studio.assets.addRef(newAssetId, leaseRef);

      if (!isCurrent()) {
        await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
        return { ok: false, code: 'STALE', message: '轮换已取消（目标状态变更或已恢复）' };
      }

      const filename = path.basename(nextCandidate);
      const overrideRecord = {
        assetId: newAssetId,
        filename,
        filePath: nextCandidate,
        appliedAt: this.now()
      };

      // 注入目标并校验
      let applyRes;
      try {
        applyRes = await this._applyOverrideToTarget(targetId, overrideRecord, isCurrent);
      } catch (error) {
        await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
        throw error;
      }

      if (!isCurrent() || applyRes?.stale || applyRes?.state === 'cancelled') {
        await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
        return { ok: false, code: 'STALE', message: '轮换已取消（目标状态变更或已恢复）' };
      }

      const isApplied = applyRes?.state === 'applied' && applyRes?.verification?.status !== 'failed';
      if (!isApplied) {
        await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
        return {
          ok: false,
          code: 'APPLY_FAILED',
          message: applyRes?.message || '壁纸应用失败或验证不通过',
          status: applyRes
        };
      }

      // 全部通过后原子提交状态与租约
      const committedRef = `rotation:${targetId}`;
      const oldAssetId = this.activeLeases.get(targetId);
      try {
        await this.studio.assets.addRef(newAssetId, committedRef);
      } catch (error) {
        await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
        throw error;
      }
      if (!isCurrent()) {
        if (oldAssetId !== newAssetId) await this.studio.assets.release(newAssetId, committedRef).catch(() => {});
        await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
        return { ok: false, code: 'STALE', message: '轮换提交已取消' };
      }
      this.currentIndex = candidateIndex;
      this.shuffleState = candidateShuffle;
      this.targetOverrides.set(targetId, overrideRecord);

      if (oldAssetId && oldAssetId !== newAssetId) {
        await this.studio.assets.release(oldAssetId, committedRef).catch(() => {});
      }
      await this.studio.assets.release(newAssetId, leaseRef).catch(() => {});
      this.activeLeases.set(targetId, newAssetId);
      this.lastRotationTime = this.now();

      // 清理无引用的旧资产
      void this.studio.assets.gc().catch(() => {});

      return {
        ok: true,
        assetId: newAssetId,
        filename,
        currentIndex: this.currentIndex
      };
    } finally {
      this.isRotating = false;
    }
  }

  /**
   * 将当前轮换覆盖注入到目标窗口运行时
   */
  async _applyOverrideToTarget(targetId, override, isCurrent) {
    if (!this.studio?.theme) return { ok: false, code: 'NO_THEME_SERVICE' };
    const targetState = this.studio.round5?.getTargetState(targetId, false);
    const currentDoc = targetState?.activeDocument;
    if (!currentDoc) return { ok: false, code: 'NO_ACTIVE_DOC' };
    if (!isCurrent || !isCurrent()) return { ok: false, code: 'STALE' };

    const prepared = this.studio.round5
      ? await this.studio.round5.decorateApply(currentDoc, targetId, {
          source: 'rotation',
          verify: true,
          isCurrent,
          context: { wallpaperOverride: override }
        })
      : null;

    if (!isCurrent || !isCurrent() || prepared?.stale) {
      return { ok: false, code: 'STALE' };
    }

    return await this.studio.theme.applyDocument(currentDoc, targetId, { ...prepared, isCurrent });
  }

  /**
   * 将当前轮换的壁纸显式保存到主题持久化文档中（作为正式主题版本）
   */
  async saveCurrentToTheme(targetId = this.studio?.selectedTargetId) {
    if (!targetId) throw appError('INVALID_ARGUMENT', '未选择目标窗口');
    const override = this.targetOverrides.get(targetId);
    if (!override || !override.assetId) {
      throw appError('INVALID_STATE', '当前没有正在生效的轮换壁纸');
    }

    const targetState = this.studio.round5?.getTargetState(targetId, false);
    const baseDoc = targetState?.activeDocument || this.studio.document;
    if (!baseDoc) throw appError('INVALID_STATE', '当前没有可保存的主题');

    const updatedDoc = JSON.parse(JSON.stringify(baseDoc));
    updatedDoc.wallpaper = {
      ...updatedDoc.wallpaper,
      assetId: override.assetId,
      legacyDataUrl: null
    };

    // 保存文档并写入版本历史
    await this.studio.saveDocument(updatedDoc);
    if (this.studio.round5) {
      this.studio.round5.setActiveDocument(targetId, updatedDoc);
      const rem = await this.studio.round5.remember(updatedDoc, {
        source: 'rotation-save',
        themeId: updatedDoc.id,
        documentSaved: true,
        applied: true
      });
      if (rem && rem.ok === false) {
        return {
          ok: false,
          revisionSaved: false,
          code: rem.code || 'SAVE_FAILED',
          message: rem.message || '历史写入失败'
        };
      }
    }

    // 转换为永久外观租约并释放轮换临时租约
    if (this.studio.assets) {
      await this.studio.assets.addRef(override.assetId, 'appearance');
      await this.studio.assets.release(override.assetId, `rotation:${targetId}`).catch(() => {});
      this.activeLeases.delete(targetId);
    }

    return {
      ok: true,
      revisionSaved: true,
      assetId: override.assetId,
      document: updatedDoc
    };
  }

  /**
   * 目标窗口关闭或注销时清理该目标的轮换覆盖与租约
   */
  dropTarget(targetId) {
    if (!targetId) return;
    this.operationEpoch++;
    const oldAssetId = this.activeLeases.get(targetId);
    if (oldAssetId && this.studio?.assets) {
      void this.studio.assets.release(oldAssetId, `rotation:${targetId}`).catch(() => {});
    }
    this.activeLeases.delete(targetId);
    this.targetOverrides.delete(targetId);
  }

  stop() {
    this.operationEpoch++;
    this.stopTimer();
    // 释放所有轮换租约
    if (this.studio?.assets) {
      for (const [targetId, assetId] of this.activeLeases.entries()) {
        void this.studio.assets.release(assetId, `rotation:${targetId}`).catch(() => {});
      }
    }
    this.activeLeases.clear();
    this.targetOverrides.clear();
  }
}

module.exports = {
  WallpaperRotationService,
  isImageMagic,
  isPathInside
};
