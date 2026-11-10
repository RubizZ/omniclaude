import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OmniClaudeConfig, ServerState } from '../types.js';

export const CONFIG_DIR = path.join(os.homedir(), '.omniclaude');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const STATE_PATH = path.join(CONFIG_DIR, 'state.json');
export const SHIM_DIR = path.join(CONFIG_DIR, 'bin');
export const LOG_PATH = path.join(CONFIG_DIR, 'server.log');

export const DEFAULT_CONFIG: OmniClaudeConfig = {
  omniPort: 20128,
  omniApiKey: '',
  routaticPort: 3456,
  routaticApiKey: '',
  serverMode: 'on-demand',
  defaultBackend: 'omniroute',
  lastModel: 'auto',
  lastProvider: 'auto',
  patched: false,
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
  }
  if (!fs.existsSync(SHIM_DIR)) {
    fs.mkdirSync(SHIM_DIR, { recursive: true, mode: 0o755 });
  }
}

export function loadConfig(): OmniClaudeConfig {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: Partial<OmniClaudeConfig>): OmniClaudeConfig {
  ensureConfigDir();
  let current: OmniClaudeConfig = { ...DEFAULT_CONFIG };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      current = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
    } catch {}
  }
  const merged = { ...current, ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function loadServerState(): ServerState {
  ensureConfigDir();
  const config = loadConfig();
  if (!fs.existsSync(STATE_PATH)) {
    return { port: config.omniPort, activeSessions: [] };
  }
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { port: config.omniPort, activeSessions: [] };
  }
}

export function saveServerState(state: ServerState): void {
  ensureConfigDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}
