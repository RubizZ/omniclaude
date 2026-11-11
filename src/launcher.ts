import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig, saveConfig } from './config/store.js';
import { ServerManager } from './server/manager.js';
import { OmniRouteProvider } from './providers/omniroute.js';
import { DependencyManager } from './system/deps.js';
import { CLAUDE_SETTINGS_PATH } from './patcher/patcher.js';
import { BackendType } from './types.js';

export interface LaunchOptions {
  backend: BackendType;
  model?: string;
  args?: string[];
}

export class ClaudeLauncher {
  static async launch(options: LaunchOptions): Promise<void> {
    const config = loadConfig();
    const env: NodeJS.ProcessEnv = { ...process.env };
    const myPid = process.pid;

    // Snapshot existing Claude settings so we can restore them when this session ends.
    // This ensures that models selected during omniclaude sessions do not permanently bleed
    // into standard standalone "claude" executions.
    let hadModelKey = false;
    let previousModel: string | undefined = undefined;
    let previousEnvModel: string | undefined = undefined;

    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if ('model' in parsed) {
          hadModelKey = true;
          previousModel = parsed.model;
        }
        if (parsed.env && 'ANTHROPIC_MODEL' in parsed.env) {
          previousEnvModel = parsed.env.ANTHROPIC_MODEL;
        }
      } catch {}
    }

    if (options.backend === 'anthropic') {
      delete env.ANTHROPIC_BASE_URL;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_MODEL;
    } else {
      // OmniRoute backend
      const port = config.omniPort;
      const apiKey = await OmniRouteProvider.ensureApiKey(port);

      await ServerManager.ensureRunning(port);
      await ServerManager.registerSession(myPid);

      env.OMNI_ROUTE_API_KEY = apiKey;
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
      env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
      if (options.model && options.model !== 'auto') {
        env.ANTHROPIC_MODEL = options.model;
        saveConfig({ lastModel: options.model, defaultBackend: 'omniroute' });
      } else if (options.model === 'auto') {
        delete env.ANTHROPIC_MODEL;
        saveConfig({ lastModel: 'auto', defaultBackend: 'omniroute' });
      }
      env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';
      env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1';
      env.EXPOSE_CC_DISCOVERY_ALIASES = config.exposeDiscoveryAliases !== false ? 'true' : 'false';
    }

    const claudeBin = DependencyManager.findClaudeExecutable();
    const isScript = claudeBin.endsWith('.cmd') || claudeBin.endsWith('.bat');
    const claudeArgs = options.args ? [...options.args] : [];

    // If a specific model was chosen in omniclaude, pre-select it for this session via --model
    if (options.backend === 'omniroute' && options.model && options.model !== 'auto') {
      if (!claudeArgs.includes('--model') && !claudeArgs.some((a) => a.startsWith('--model='))) {
        claudeArgs.unshift('--model', options.model);
      }
    }

    // Setup cleanup handler on exit
    const cleanup = async () => {
      if (options.backend === 'omniroute') {
        await ServerManager.handleSessionExit(myPid);
      }

      // Restore ~/.claude/settings.json so normal 'claude' CLI runs don't inherit omniclaude's session model
      if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        try {
          const currentContent = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
          const currentSettings = JSON.parse(currentContent);
          let changed = false;

          // Restore or delete root "model" key
          if (hadModelKey) {
            if (currentSettings.model !== previousModel) {
              currentSettings.model = previousModel;
              changed = true;
            }
          } else {
            if ('model' in currentSettings) {
              delete currentSettings.model;
              changed = true;
            }
          }

          // Restore or delete "env.ANTHROPIC_MODEL"
          if (currentSettings.env) {
            if (previousEnvModel !== undefined) {
              if (currentSettings.env.ANTHROPIC_MODEL !== previousEnvModel) {
                currentSettings.env.ANTHROPIC_MODEL = previousEnvModel;
                changed = true;
              }
            } else {
              if ('ANTHROPIC_MODEL' in currentSettings.env) {
                delete currentSettings.env.ANTHROPIC_MODEL;
                changed = true;
              }
            }
          }

          if (changed) {
            fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
          }
        } catch {}
      }
    };

    process.on('SIGINT', async () => {
      await cleanup();
      process.exit(130);
    });

    process.on('SIGTERM', async () => {
      await cleanup();
      process.exit(143);
    });

    // Launch Claude in interactive foreground
    await new Promise<void>((resolve, reject) => {
      const child = spawn(claudeBin, claudeArgs, {
        stdio: 'inherit',
        env,
        shell: isScript,
      });

      child.on('error', (err: Error) => {
        cleanup().then(() => reject(err));
      });

      child.on('exit', async (code: number | null) => {
        await cleanup();
        if (code !== 0 && code !== null) {
          process.exitCode = code;
        }
        resolve();
      });
    });
  }
}
