import { spawn } from 'node:child_process';
import { loadConfig, saveConfig } from './config/store.js';
import { ServerManager } from './server/manager.js';
import { OmniRouteProvider } from './providers/omniroute.js';
import { RoutaticProvider } from './providers/routatic.js';
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

    if (options.backend === 'anthropic') {
      delete env.ANTHROPIC_BASE_URL;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_MODEL;
    } else if (options.backend === 'routatic') {
      const port = config.routaticPort;
      await RoutaticProvider.ensureRunning(port);

      env.ROUTATIC_PROXY_API_KEY = config.routaticApiKey || 'unused';
      env.ANTHROPIC_AUTH_TOKEN = 'unused';
      env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
      if (options.model) {
        env.ANTHROPIC_MODEL = options.model;
        saveConfig({ lastModel: options.model, defaultBackend: 'routatic' });
      }
      env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';
      env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1';
    } else {
      // OmniRoute backend
      const port = config.omniPort;
      const apiKey = await OmniRouteProvider.ensureApiKey(port);

      await ServerManager.ensureRunning(port);
      await ServerManager.registerSession(myPid);

      env.OMNI_ROUTE_API_KEY = apiKey;
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
      env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
      if (options.model) {
        env.ANTHROPIC_MODEL = options.model;
        saveConfig({ lastModel: options.model, defaultBackend: 'omniroute' });
      }
      env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1';
      env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1';
      env.EXPOSE_CC_DISCOVERY_ALIASES = 'true';
    }

    const isWin = process.platform === 'win32';
    const claudeBin = isWin ? 'claude.cmd' : 'claude';
    const claudeArgs = options.args || [];

    // Setup cleanup handler on exit
    const cleanup = async () => {
      if (options.backend === 'omniroute') {
        await ServerManager.handleSessionExit(myPid);
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
        shell: isWin,
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
