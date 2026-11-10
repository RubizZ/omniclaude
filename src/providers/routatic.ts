import { spawn } from 'node:child_process';
import { loadConfig, saveConfig, LOG_PATH } from '../config/store.js';
import { ServerManager } from '../server/manager.js';
import fs from 'node:fs';

export const ROUTATIC_DEFAULT_MODELS = [
  'default',
  'complex',
  'fast',
  'think',
  'long_context',
  'glm-5.2',
  'kimi-k3',
  'kimi-k2.7-code',
  'qwen3.7-plus',
  'qwen3.7-max',
];

export class RoutaticProvider {
  static async ensureRunning(port?: number): Promise<boolean> {
    const config = loadConfig();
    const targetPort = port || config.routaticPort;

    if (await ServerManager.isPortListening(targetPort)) {
      return true;
    }

    const logFd = fs.openSync(LOG_PATH, 'a');
    try {
      const child = spawn('routatic-proxy', ['serve', '--port', String(targetPort)], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        shell: process.platform === 'win32',
      });
      child.unref();

      for (let i = 0; i < 20; i++) {
        if (await ServerManager.isPortListening(targetPort)) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    } catch {
      return false;
    }
  }
}
