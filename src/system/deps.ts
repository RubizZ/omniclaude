import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';

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
        description: 'Frontend oficial de Claude Code de Anthropic',
      },
      {
        name: 'OmniRoute',
        command: 'omniroute',
        packageName: 'omniroute',
        installed: this.isCommandAvailable('omniroute'),
        version: this.getCommandVersion('omniroute') || undefined,
        description: 'Smart AI Router con fallbacks automáticos',
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
    } catch (e: any) {
      return false;
    }
  }

  /**
   * Check and optionally prompt to install missing dependencies
   */
  static async ensurePrerequisites(interactive = true): Promise<boolean> {
    const { nodeOk, nodeVer, deps } = this.checkAll();

    if (!nodeOk) {
      const msg = `Node.js 18+ es requerido (detectado: ${nodeVer}). Por favor actualiza Node.js.`;
      if (interactive) p.log.error(pc.red(msg));
      else console.error(msg);
      return false;
    }

    for (const dep of deps) {
      if (!dep.installed) {
        if (!interactive) {
          console.warn(`⚠️ ${dep.name} no está instalado (${dep.packageName}).`);
          continue;
        }

        p.log.warn(pc.yellow(`⚠️ ${dep.name} no está instalado en el sistema.`));

        const install = await p.confirm({
          message: `¿Deseas instalar ${dep.name} ahora globalmente? (npm install -g ${dep.packageName})`,
          initialValue: true,
        });

        if (p.isCancel(install) || !install) {
          p.log.warn(pc.dim(`Instalación de ${dep.name} omitida.`));
          continue;
        }

        const spinner = p.spinner();
        spinner.start(`Instalando ${dep.packageName} globalmente...`);
        const ok = this.installPackage(dep.packageName);

        if (ok) {
          spinner.stop(pc.green(`✅ ${dep.name} se instaló correctamente.`));
          dep.installed = true;
          dep.version = this.getCommandVersion(dep.command) || undefined;
        } else {
          spinner.stop(pc.red(`❌ Falló la instalación de ${dep.packageName}. Comprueba los permisos de npm.`));
        }
      }
    }

    return deps.every((d) => d.installed);
  }
}
