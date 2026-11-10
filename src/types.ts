export type BackendType = 'omniroute' | 'routatic' | 'anthropic';
export type ServerMode = 'service' | 'on-demand';
export type PatchMode = 'settings' | 'wrapper';

export interface OmniClaudeConfig {
  omniPort: number;
  omniApiKey: string;
  routaticPort: number;
  routaticApiKey: string;
  serverMode: ServerMode;
  defaultBackend: BackendType;
  lastModel?: string;
  lastProvider?: string;
  patched: boolean;
  patchMode?: PatchMode;
}

export interface SessionInfo {
  pid: number;
  startedAt: string;
}

export interface ServerState {
  serverPid?: number;
  port: number;
  activeSessions: SessionInfo[];
}

export interface OmniModel {
  id: string;
  owned_by: string;
  name?: string;
}

export interface ProviderGroup {
  id: string;
  name: string;
  type: 'paid' | 'free' | 'other' | 'combo';
  models: string[];
}
