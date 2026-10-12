import type { ConnectionStatus, Settings } from '../types';
export type { AppliedSession, CapabilityProbe } from '../types';
export interface ThemeAdapter {
  readonly id: string;
  inspect(targetId?: string | null): Promise<ConnectionStatus>;
  status(targetId?: string | null): Promise<ConnectionStatus>;
  apply(settings: Settings, targetId?: string | null): Promise<ConnectionStatus>;
  restore(targetId?: string | null): Promise<ConnectionStatus>;
}
