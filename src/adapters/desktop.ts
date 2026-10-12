import type { ThemeAdapter } from './contracts';
export const desktopAdapter: ThemeAdapter = {
  id: 'antigravity-desktop-v2',
  inspect: targetId => window.antiFace!.inspect(targetId),
  status: targetId => window.antiFace!.status(targetId),
  apply: (value, targetId) => window.antiFace!.apply(value, targetId),
  restore: targetId => window.antiFace!.restore(targetId),
};
