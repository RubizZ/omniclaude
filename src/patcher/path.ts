import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SHIM_DIR } from '../config/store.js';

export class PathManager {
  /**
   * Check if the shim directory is currently in the active PATH
   */
  static isShimInPath(): boolean {
    const currentPath = process.env.PATH || '';
    const delimiter = path.delimiter; // ';' on Windows, ':' on POSIX
    const entries = currentPath.split(delimiter).map((p) => path.normalize(p).toLowerCase());
    const target = path.normalize(SHIM_DIR).toLowerCase();
    return entries.includes(target);
  }

  /**
   * Add SHIM_DIR to PATH permanently across shells and Windows user registry
   */
  static addToPath(): { success: boolean; message: string; modifiedFiles: string[] } {
    const isWin = process.platform === 'win32';
    const modifiedFiles: string[] = [];

    // Always update current process.env.PATH
    if (!this.isShimInPath()) {
      process.env.PATH = `${SHIM_DIR}${path.delimiter}${process.env.PATH}`;
    }

    if (isWin) {
      try {
        // Query current User Path from Windows Registry
        const raw = execSync('reg query "HKCU\\Environment" /v Path', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });

        const match = raw.match(/Path\s+REG_\w+\s+(.*)/i);
        let userPath = match ? match[1].trim() : '';

        const entries = userPath.split(';').map((p) => p.trim());
        const target = path.normalize(SHIM_DIR);

        if (!entries.some((p) => p.toLowerCase() === target.toLowerCase())) {
          // Prepend target to user PATH so it takes priority over default claude
          const newPath = `${target};${userPath}`;
          execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, {
            stdio: 'ignore',
            windowsHide: true,
          });
          modifiedFiles.push('Windows Registry (HKCU\\Environment\\Path)');
        }
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to add to PATH in Windows Registry: ${err.message}`,
          modifiedFiles,
        };
      }
    } else {
      // Linux / macOS / WSL
      const shellFiles = [path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')];
      const exportLine = `export PATH="$HOME/.omniclaude/bin:$PATH" # Added by omniclaude`;

      for (const file of shellFiles) {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf-8');
          if (!content.includes('.omniclaude/bin')) {
            fs.appendFileSync(file, `\n${exportLine}\n`, 'utf-8');
            modifiedFiles.push(file);
          }
        }
      }
    }

    return {
      success: true,
      message: `Added "${SHIM_DIR}" to permanent PATH.`,
      modifiedFiles,
    };
  }

  /**
   * Remove SHIM_DIR from Windows user registry and shell rc files
   */
  static removeFromPath(): { success: boolean; modifiedFiles: string[] } {
    const isWin = process.platform === 'win32';
    const modifiedFiles: string[] = [];

    if (isWin) {
      try {
        const raw = execSync('reg query "HKCU\\Environment" /v Path', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });

        const match = raw.match(/Path\s+REG_\w+\s+(.*)/i);
        if (match) {
          const userPath = match[1].trim();
          const target = path.normalize(SHIM_DIR).toLowerCase();
          const filtered = userPath
            .split(';')
            .filter((p) => p.trim().toLowerCase() !== target)
            .join(';');

          if (filtered !== userPath) {
            execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${filtered}" /f`, {
              stdio: 'ignore',
              windowsHide: true,
            });
            modifiedFiles.push('Windows Registry (HKCU\\Environment\\Path)');
          }
        }
      } catch {}
    } else {
      const shellFiles = [path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')];
      for (const file of shellFiles) {
        if (fs.existsSync(file)) {
          let content = fs.readFileSync(file, 'utf-8');
          if (content.includes('.omniclaude/bin')) {
            content = content
              .split('\n')
              .filter((l) => !l.includes('.omniclaude/bin'))
              .join('\n');
            fs.writeFileSync(file, content, 'utf-8');
            modifiedFiles.push(file);
          }
        }
      }
    }

    return { success: true, modifiedFiles };
  }
}
