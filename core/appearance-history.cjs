const ranges = require('../shared/appearance-ranges.json');
const { validateThemeDocument } = require('./theme-schema.cjs');

function cloneDocument(document) {
  if (!document) return null;
  return validateThemeDocument(JSON.parse(JSON.stringify(document)));
}

class AppearanceHistory {
  constructor(document, options = {}) {
    this.limit = options.limit || ranges.undoLimit || 50;
    this.byteLimit = options.byteLimit || ranges.undoBytes || (10 * 1024 * 1024);
    this.current = cloneDocument(document);
    this.baseline = cloneDocument(document);
    this.undoStack = [];
    this.redoStack = [];
    this.gesture = null;
    this.bytes = 0;
    this.lastKeyAdjust = { field: null, time: 0 };
    this.documentId = document?.id || 'default';
  }

  snapshot() {
    return cloneDocument(this.current);
  }

  _weight(document) {
    return JSON.stringify(document).length;
  }

  _trim() {
    while (this.undoStack.length > this.limit || this.bytes > this.byteLimit) {
      const removed = this.undoStack.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
    }
  }

  setBaseline(document) {
    this.baseline = cloneDocument(document);
  }

  revertToBaseline() {
    if (!this.baseline) return this.snapshot();
    return this.push(this.baseline, '恢复进入时状态');
  }

  beginGesture(label = 'edit') {
    if (this.gesture) return;
    this.gesture = { label, before: this.snapshot(), changed: false };
  }

  push(document, label = 'edit', options = {}) {
    const next = cloneDocument(document);
    if (!next) return this.snapshot();

    // 如果文档 ID 变了，应提示或隔离，避免旧主题 undo 污染新主题
    if (next.id && next.id !== this.documentId) {
      this.documentId = next.id;
      this.undoStack = [];
      this.redoStack = [];
      this.gesture = null;
      this.bytes = 0;
      this.current = next;
      this.baseline = cloneDocument(next);
      return this.snapshot();
    }

    if (JSON.stringify(next) === JSON.stringify(this.current)) return this.snapshot();

    if (this.gesture) {
      this.current = next;
      this.gesture.changed = true;
      this.gesture.label = label;
      return this.snapshot();
    }

    // 键盘连续调整合并策略 (例如 500ms 内对同一字段的连续微调合并为一步)
    const now = Date.now();
    if (options.keyAdjustField) {
      if (
        this.lastKeyAdjust.field === options.keyAdjustField &&
        now - this.lastKeyAdjust.time < 500 &&
        this.undoStack.length > 0
      ) {
        // 更新最后一条 undo 记录的 after
        const lastEntry = this.undoStack[this.undoStack.length - 1];
        this.bytes -= lastEntry.bytes;
        lastEntry.after = next;
        lastEntry.bytes = this._weight(next);
        this.bytes += lastEntry.bytes;
        this.current = next;
        this.lastKeyAdjust.time = now;
        return this.snapshot();
      }
      this.lastKeyAdjust = { field: options.keyAdjustField, time: now };
    } else {
      this.lastKeyAdjust = { field: null, time: 0 };
    }

    const entry = {
      before: this.snapshot(),
      after: next,
      label,
      bytes: this._weight(next)
    };

    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    this.redoStack = [];
    this.current = next;
    this._trim();
    return this.snapshot();
  }

  endGesture() {
    if (!this.gesture) return this.snapshot();
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture.changed) return this.snapshot();
    if (JSON.stringify(gesture.before) === JSON.stringify(this.current)) return this.snapshot();

    const entry = {
      before: gesture.before,
      after: this.snapshot(),
      label: gesture.label,
      bytes: this._weight(this.current)
    };

    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    this.redoStack = [];
    this._trim();
    return this.snapshot();
  }

  cancelGesture() {
    if (!this.gesture) return this.snapshot();
    this.current = this.gesture.before;
    this.gesture = null;
    return this.snapshot();
  }

  revertToBaseline() {
    this.endGesture();
    if (!this.baseline) return this.snapshot();
    if (JSON.stringify(this.current) === JSON.stringify(this.baseline)) return this.snapshot();

    const target = cloneDocument(this.baseline);
    const entry = {
      before: this.snapshot(),
      after: target,
      label: '恢复初始基线',
      bytes: this._weight(target)
    };

    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    this.redoStack = [];
    this.current = target;
    this._trim();
    return this.snapshot();
  }

  undo() {
    this.endGesture();
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.bytes -= entry.bytes;
    this.redoStack.push(entry);
    this.current = cloneDocument(entry.before);
    return this.snapshot();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    this.current = cloneDocument(entry.after);
    this._trim();
    return this.snapshot();
  }

  get canUndo() {
    return this.undoStack.length > 0 || !!this.gesture?.changed;
  }

  get canRedo() {
    return this.redoStack.length > 0 && !this.gesture;
  }

  get nextUndoLabel() {
    if (this.gesture?.changed) return `撤销：${this.gesture.label || '当前调整'}`;
    const last = this.undoStack[this.undoStack.length - 1];
    return last ? `撤销：${last.label}` : '撤销';
  }

  get nextRedoLabel() {
    const next = this.redoStack[this.redoStack.length - 1];
    return next ? `重做：${next.label}` : '重做';
  }

  /**
   * 收集当前历史（当前、基线、撤销栈、重做栈、在途手势）中引用的所有壁纸 assetId
   * 用于在资产修剪时保护被 undo/redo 持有的壁纸，防止撤销后缺图
   */
  referencedAssetIds() {
    const ids = new Set();
    const checkDoc = doc => {
      const assetId = doc?.wallpaper?.assetId;
      if (assetId) ids.add(assetId);
    };

    checkDoc(this.current);
    checkDoc(this.baseline);
    if (this.gesture?.before) checkDoc(this.gesture.before);

    for (const item of this.undoStack) {
      checkDoc(item.before);
      checkDoc(item.after);
    }
    for (const item of this.redoStack) {
      checkDoc(item.before);
      checkDoc(item.after);
    }

    return ids;
  }
}

module.exports = { AppearanceHistory };
