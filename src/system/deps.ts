import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig } from '../config/store.js';
import { OmniRouteProvider } from '../providers/omniroute.js';

export interface DepStatus {
  name: string;
  command: string;
  packageName: string;
  installed: boolean;
  version?: string;
  description: string;
}

export class DependencyManager {
  static isCommandAvailable(command: string): boolean {
    try {
      const isWin = process.platform === 'win32';
      const checkCmd = isWin ? `where ${command}` : `command -v ${command}`;
      execSync(checkCmd, { stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  static getCommandVersion(command: string): string | null {
    try {
      const isWin = process.platform === 'win32';
      const out = execSync(`${command} --version`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: isWin ? 'cmd.exe' : '/bin/sh',
        windowsHide: true,
      });
      return out.trim().split('\n')[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Find the real absolute path or executable command for Claude Code
   */
  static findClaudeExecutable(): string {
    const isWin = process.platform === 'win32';
    try {
      const checkCmd = isWin ? 'where.exe claude' : 'which claude';
      const out = execSync(checkCmd, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const lines = out
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      // Filter out any wrapper in ~/.omniclaude/bin to prevent infinite loops
      const real = lines.find((l) => !l.toLowerCase().includes('.omniclaude'));
      if (real) return real;
    } catch {}

    return 'claude';
  }

  /**
   * Find the real executable command for OmniRoute (.cmd on Windows)
   */
  static findOmnirouteExecutable(): string {
    const isWin = process.platform === 'win32';
    try {
      const checkCmd = isWin ? 'where.exe omniroute' : 'which omniroute';
      const out = execSync(checkCmd, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const lines = out
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (isWin) {
        const cmdFile = lines.find((l) => l.toLowerCase().endsWith('.cmd') || l.toLowerCase().endsWith('.bat'));
        if (cmdFile) return cmdFile;
      }
      if (lines[0]) return lines[0];
    } catch {}

    return isWin ? 'omniroute.cmd' : 'omniroute';
  }

  /**
   * Find the actual JS entrypoint file for OmniRoute (.mjs or .js)
   * Launching directly via process.execPath (node.exe) avoids cmd.exe window popups on Windows.
   */
  static findOmnirouteJsEntry(): string | null {
    try {
      const isWin = process.platform === 'win32';
      const omniExe = this.findOmnirouteExecutable();

      // 1. If omniExe itself is already a JS/MJS file
      if (omniExe.endsWith('.mjs') || omniExe.endsWith('.js')) {
        if (fs.existsSync(omniExe)) return omniExe;
      }

      // 2. Look relative to the directory of omniExe (e.g. npm global bin folder)
      if (path.isAbsolute(omniExe)) {
        const binDir = path.dirname(omniExe);
        const relCandidate = path.join(binDir, 'node_modules', 'omniroute', 'bin', 'omniroute.mjs');
        if (fs.existsSync(relCandidate)) return relCandidate;

        // If omniExe is a Windows batch file (.cmd / .bat), parse it to locate the target JS file
        if (isWin && (omniExe.toLowerCase().endsWith('.cmd') || omniExe.toLowerCase().endsWith('.bat'))) {
          try {
            const content = fs.readFileSync(omniExe, 'utf-8');
            const match = content.match(/"(%dp0%[^"]+\.m?js)"/i) || content.match(/["']([^"']+\.m?js)["']/i);
            if (match && match[1]) {
              const resolved = path.normalize(match[1].replace(/%dp0%/gi, binDir + path.sep));
              if (fs.existsSync(resolved)) return resolved;
            }
          } catch {}
        }
      }

      // 3. Check standard Windows AppData npm global directory
      if (isWin) {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const npmCandidate = path.join(appData, 'npm', 'node_modules', 'omniroute', 'bin', 'omniroute.mjs');
        if (fs.existsSync(npmCandidate)) return npmCandidate;
      }

      // 4. Try global npm root fallback
      try {
        const globalNpmRoot = execSync('npm root -g', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        }).trim();
        if (globalNpmRoot) {
          const globalCandidate = path.join(globalNpmRoot, 'omniroute', 'bin', 'omniroute.mjs');
          if (fs.existsSync(globalCandidate)) return globalCandidate;
        }
      } catch {}
    } catch {}

    return null;
  }

  static checkAll(): { nodeOk: boolean; nodeVer: string; deps: DepStatus[] } {
    const nodeVer = process.version;
    const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
    const nodeOk = major >= 18;

    const deps: DepStatus[] = [
      {
        name: 'Claude Code',
        command: 'claude',
        packageName: '@anthropic-ai/claude-code',
        installed: this.isCommandAvailable('claude'),
        version: this.getCommandVersion('claude') || undefined,
        description: 'Official Claude Code frontend by Anthropic',
      },
      {
        name: 'OmniRoute',
        command: 'omniroute',
        packageName: 'omniroute',
        installed: this.isCommandAvailable('omniroute'),
        version: this.getCommandVersion('omniroute') || undefined,
        description: 'Smart multi-provider AI Router with automatic fallbacks',
      },
    ];

    return { nodeOk, nodeVer, deps };
  }

  static installPackage(packageName: string): boolean {
    const isWin = process.platform === 'win32';
    try {
      execSync(`npm install -g ${packageName}`, {
        stdio: 'inherit',
        shell: isWin ? 'cmd.exe' : '/bin/sh',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check and optionally prompt to install missing dependencies
   */
  static async ensurePrerequisites(interactive = true): Promise<boolean> {
    const { nodeOk, nodeVer, deps } = this.checkAll();

    if (!nodeOk) {
      const msg = `Node.js 18+ is required (detected: ${nodeVer}). Please upgrade Node.js.`;
      if (interactive) p.log.error(pc.red(msg));
      else console.error(msg);
      return false;
    }

    for (const dep of deps) {
      if (!dep.installed) {
        if (!interactive) {
          console.warn(`⚠️ ${dep.name} is not installed (${dep.packageName}).`);
          continue;
        }

        p.log.warn(pc.yellow(`⚠️ ${dep.name} is not installed on the system.`));

        const install = await p.confirm({
          message: `Do you want to install ${dep.name} globally now? (npm install -g ${dep.packageName})`,
          initialValue: true,
        });

        if (p.isCancel(install) || !install) {
          p.log.warn(pc.dim(`Installation of ${dep.name} skipped.`));
          continue;
        }

        const spinner = p.spinner();
        spinner.start(`Installing ${dep.packageName} globally...`);
        const ok = this.installPackage(dep.packageName);

        if (ok) {
          spinner.stop(pc.green(`✅ ${dep.name} installed successfully.`));
          dep.installed = true;
          dep.version = this.getCommandVersion(dep.command) || undefined;

          // If omniroute was just installed, ensure STORAGE_ENCRYPTION_KEY is immediately initialized
          if (dep.packageName === 'omniroute') {
            OmniRouteProvider.ensureStorageEncryptionKey();
          }
        } else {
          spinner.stop(pc.red(`❌ Failed to install ${dep.packageName}. Check npm permissions.`));
        }
      }
    }

    // Ask about EXPOSE_CC_DISCOVERY_ALIASES if not configured yet
    const config = loadConfig();
    if (config.exposeDiscoveryAliases === undefined) {
      if (interactive) {
        const enableAliases = await p.confirm({
          message:
            'Do you want to expose OmniRoute models in Claude Code (EXPOSE_CC_DISCOVERY_ALIASES)?\n  (Allows non-Claude models to appear in Claude Code\'s native /model command)',
          initialValue: true,
        });

        const chosen = p.isCancel(enableAliases) ? true : Boolean(enableAliases);
        OmniRouteProvider.setDiscoveryAliases(chosen);
        if (chosen) {
          p.log.success(pc.green('✅ OmniRoute models enabled in Claude Code (/model).'));
        }
      } else {
        OmniRouteProvider.setDiscoveryAliases(true);
      }
    }

    return deps.every((d) => d.installed);
  }
}
