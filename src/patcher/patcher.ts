import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveConfig, SHIM_DIR } from '../config/store.js';
import { DependencyManager } from '../system/deps.js';
import { ServerManager } from '../server/manager.js';
import { PathManager } from './path.js';
import { PatchMode } from '../types.js';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

export class ClaudePatcher {
  /**
   * Check if Claude is currently patched to point to OmniRoute
   */
  static getStatus(): { isPatched: boolean; mode?: PatchMode; details?: string } {
    const config = loadConfig();

    // Check settings.json
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        const json = JSON.parse(raw);
        if (json.env?.ANTHROPIC_BASE_URL && json.env.ANTHROPIC_BASE_URL.includes(String(config.omniPort))) {
          return {
            isPatched: true,
            mode: 'settings',
            details: `Active in ~/.claude/settings.json (Base URL: ${json.env.ANTHROPIC_BASE_URL})`,
          };
        }
      } catch {}
    }

    // Check wrapper shim
    const shimSh = path.join(SHIM_DIR, 'claude');
    const shimCmd = path.join(SHIM_DIR, 'claude.cmd');
    if (fs.existsSync(shimSh) || fs.existsSync(shimCmd)) {
      return {
        isPatched: true,
        mode: 'wrapper',
        details: `Active via PATH wrapper in ${SHIM_DIR}`,
      };
    }

    return { isPatched: false };
  }

  /**
   * Apply patch using either Settings mode or Wrapper mode
   */
  static async patch(mode: PatchMode = 'settings', targetModel?: string): Promise<{ success: boolean; message: string }> {
    const config = loadConfig();
    const port = config.omniPort;
    const apiKey = config.omniApiKey || 'unused';
    const model = targetModel || config.lastModel || 'auto';

    if (mode === 'settings') {
      // 1. Ensure directory exists
      if (!fs.existsSync(CLAUDE_DIR)) {
        fs.mkdirSync(CLAUDE_DIR, { recursive: true });
      }

      let settings: any = {};
      if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        try {
          settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
        } catch {
          settings = {};
        }
      }

      // Configure Environment
      settings.env = settings.env || {};
      settings.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
      settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
      settings.env.ANTHROPIC_MODEL = model;
      settings.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';
      settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1';
      settings.env.EXPOSE_CC_DISCOVERY_ALIASES = config.exposeDiscoveryAliases !== false ? 'true' : 'false';

      // 2. Add SessionStart hook so Claude automatically ensures OmniRoute is alive even if stopped
      settings.hooks = settings.hooks || {};
      settings.hooks.SessionStart = settings.hooks.SessionStart || [];
      const hookCmd = 'omniclaude server ensure-running --quiet';
      const alreadyHasHook = settings.hooks.SessionStart.some((entry: any) =>
        entry?.hooks?.some((h: any) => h.command?.includes('omniclaude server ensure-running'))
      );
      if (!alreadyHasHook) {
        settings.hooks.SessionStart.push({
          hooks: [
            {
              type: 'command',
              command: hookCmd,
              timeout: 10,
            },
          ],
        });
      }

      fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');

      // 3. Automatically switch to Always-On (service) mode if currently on-demand
      let modeNote = '';
      if (config.serverMode !== 'service') {
        await ServerManager.setServerMode('service');
        modeNote = '\n⚡ Always-On mode enabled so OmniRoute starts with the system.';
      }
      await ServerManager.ensureRunning(port);

      saveConfig({ patched: true, patchMode: 'settings', lastModel: model });
      return {
        success: true,
        message: `Claude Code configured in ~/.claude/settings.json (Model: ${model}).${modeNote}\n🛡️ Official hook (SessionStart) added to ensure the server is always running when Claude opens.`,
      };
    }

    if (mode === 'wrapper') {
      const realClaude = DependencyManager.findClaudeExecutable();

      // 1. Create bash shim for Linux/WSL/macOS
      const shimShPath = path.join(SHIM_DIR, 'claude');
      const bashScript = `#!/usr/bin/env bash
# OmniClaude Intelligent Shim
# Ensures OmniRoute is alive and injects configuration

export ANTHROPIC_BASE_URL="http://127.0.0.1:${port}"
export ANTHROPIC_AUTH_TOKEN="${apiKey}"
export ANTHROPIC_MODEL="${model}"
export CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
export EXPOSE_CC_DISCOVERY_ALIASES=true

# Ensure OmniRoute is running silently if needed
omniclaude server ensure-running --quiet 2>/dev/null || true

exec "${realClaude}" "$@"
`;

      fs.writeFileSync(shimShPath, bashScript, { mode: 0o755 });

      // 2. Create cmd/bat shim for Windows
      const shimCmdPath = path.join(SHIM_DIR, 'claude.cmd');
      const cmdScript = `@echo off
set ANTHROPIC_BASE_URL=http://127.0.0.1:${port}
set ANTHROPIC_AUTH_TOKEN=${apiKey}
set ANTHROPIC_MODEL=${model}
set CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
set EXPOSE_CC_DISCOVERY_ALIASES=true

where /q omniclaude
if %errorlevel% equ 0 (
  call omniclaude server ensure-running --quiet
)

"${realClaude}" %*
`;
      fs.writeFileSync(shimCmdPath, cmdScript, { mode: 0o755 });

      // 3. Automatically add SHIM_DIR to PATH
      const pathResult = PathManager.addToPath();

      saveConfig({ patched: true, patchMode: 'wrapper', lastModel: model });

      const modifiedNote = pathResult.modifiedFiles.length > 0
        ? `\n✅ Automatically added to PATH in: ${pathResult.modifiedFiles.join(', ')}`
        : '\nℹ️ Directory was already in your PATH.';

      const isWin = process.platform === 'win32';
      const winWarning = isWin
        ? '\n⚠️ Note for Windows: Native claude.exe takes precedence over .cmd wrappers in PowerShell/CMD due to PATHEXT and PATH resolution. Use "omniclaude patch --mode settings" if "claude" continues to launch unpatched in Windows shells.'
        : '';

      return {
        success: true,
        message: `Universal shim created at ${SHIM_DIR}.${modifiedNote}\n💡 Running 'claude' in an existing terminal may require opening a new terminal window to reload the PATH.${winWarning}`,
      };
    }

    return { success: false, message: `Unknown patch mode: ${mode}` };
  }

  /**
   * Remove patch and restore original Claude behavior
   */
  static async unpatch(): Promise<{ success: boolean; message: string }> {
    let modified = false;

    // 1. Clean settings.json
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        const settings = JSON.parse(raw);
        if (settings.env) {
          delete settings.env.ANTHROPIC_BASE_URL;
          delete settings.env.ANTHROPIC_AUTH_TOKEN;
          delete settings.env.ANTHROPIC_MODEL;
          delete settings.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT;
          delete settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY;
          delete settings.env.EXPOSE_CC_DISCOVERY_ALIASES;

          if (Object.keys(settings.env).length === 0) {
            delete settings.env;
          }
          modified = true;
        }

        // Clean SessionStart hooks
        if (settings.hooks?.SessionStart) {
          settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
            (entry: any) =>
              !entry?.hooks?.some((h: any) => h.command?.includes('omniclaude server ensure-running'))
          );
          if (settings.hooks.SessionStart.length === 0) {
            delete settings.hooks.SessionStart;
          }
          if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks;
          }
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
        }
      } catch {}
    }

    // 2. Remove shims
    const shimSh = path.join(SHIM_DIR, 'claude');
    const shimCmd = path.join(SHIM_DIR, 'claude.cmd');
    if (fs.existsSync(shimSh)) {
      fs.unlinkSync(shimSh);
      modified = true;
    }
    if (fs.existsSync(shimCmd)) {
      fs.unlinkSync(shimCmd);
      modified = true;
    }

    // 3. Remove from PATH
    PathManager.removeFromPath();

    saveConfig({ patched: false, patchMode: undefined });

    return {
      success: true,
      message: modified ? 'Claude Code patch removed. Reverted to official configuration.' : 'No active patch was found.',
    };
  }
}
