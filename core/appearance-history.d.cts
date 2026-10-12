export class AppearanceHistory {
  constructor(document: unknown);
  push(document: unknown, label?: string, options?: { keyAdjustField?: string }): unknown;
  beginGesture(label?: string): void;
  endGesture(): unknown;
  cancelGesture(): unknown;
  revertToBaseline(): unknown;
  undo(): unknown;
  redo(): unknown;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly nextUndoLabel: string;
  readonly nextRedoLabel: string;
  snapshot(): unknown;
  referencedAssetIds(): Set<string>;
}
