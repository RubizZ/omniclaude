import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { loadConfig, loadServerState, saveServerState, saveConfig, LOG_PATH } from '../config/store.js';
import { DependencyManager } from '../system/deps.js';
import { ServerMode } from '../types.js';

export class ServerManager {
  /**
   * Check if a TCP port is currently open and accepting connections
   */
  static async isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Test if the OmniRoute HTTP API is alive and responsive
   */
  static async isApiAlive(port: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // Even 401 Unauthorized means the server is running and responding
      return res.status === 200 || res.status === 401;
    } catch {
      return false;
    }
  }

  /**
   * Check if a process ID is currently active in the OS
   */
  static isPidAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      return e.code === 'EPERM'; // Exists but belongs to another user
    }
  }

  /**
   * Start OmniRoute in background as a detached singleton daemon
   */
  static async startServer(targetPort?: number): Promise<{ success: boolean; pid?: number; message?: string }> {
    const config = loadConfig();
    const port = targetPort || config.omniPort;

    // Check if already alive
    if (await this.isPortListening(port)) {
      return { success: true, message: `Server is already running on port ${port}` };
    }

    const logFd = fs.openSync(LOG_PATH, 'a');

    try {
      const isWin = process.platform === 'win32';
      const omniExe = DependencyManager.findOmnirouteExecutable();
      const cmd = isWin ? 'cmd.exe' : omniExe;
      const args = isWin
        ? ['/c', omniExe, 'serve', '--no-open', '--port', String(port)]
        : ['serve', '--no-open', '--port', String(port)];

      const exposeAliases = config.exposeDiscoveryAliases !== false ? 'true' : 'false';

      const child = spawn(cmd, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: {
          ...process.env,
          EXPOSE_CC_DISCOVERY_ALIASES: exposeAliases,
        },
      });

      const serverPid = child.pid;
      child.unref();

      // Wait for server to come online
      const start = Date.now();
      const timeoutMs = 25000;
      let online = false;

      while (Date.now() - start < timeoutMs) {
        if (await this.isPortListening(port)) {
          online = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      if (!online) {
        return {
          success: false,
          message: `Server process started (PID: ${serverPid}) but port ${port} did not respond within timeout. Check ${LOG_PATH}`,
        };
      }

      // Update state
      const state = loadServerState();
      state.serverPid = serverPid;
      state.port = port;
      saveServerState(state);

      return { success: true, pid: serverPid, message: `OmniRoute running on port ${port}` };
    } catch (err: any) {
      return { success: false, message: `Failed to launch omniroute: ${err.message}` };
    }
  }

  /**
   * Stop the OmniRoute server cleanly
   */
  static async stopServer(): Promise<{ success: boolean; message: string }> {
    const state = loadServerState();
    const config = loadConfig();
    const port = state.port || config.omniPort;

    // Try CLI stop first
    try {
      execSync('omniroute stop', { stdio: 'ignore', windowsHide: true });
    } catch {}

    // If serverPid was tracked, kill it
    if (state.serverPid && this.isPidAlive(state.serverPid)) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${state.serverPid}`, { stdio: 'ignore', windowsHide: true });
        } else {
          process.kill(state.serverPid, 'SIGTERM');
        }
      } catch {}
    }

    // Wait for port to close
    let closed = false;
    for (let i = 0; i < 15; i++) {
      if (!(await this.isPortListening(port))) {
        closed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    state.serverPid = undefined;
    state.activeSessions = [];
    saveServerState(state);

    if (closed) {
      return { success: true, message: `OmniRoute server stopped.` };
    } else {
      return { success: false, message: `OmniRoute is still listening on port ${port}.` };
    }
  }

  /**
   * Register a new active Claude Code session
   */
  static async registerSession(pid: number): Promise<void> {
    const state = loadServerState();

    // Clean up dead sessions
    const aliveSessions = state.activeSessions.filter((s) => this.isPidAlive(s.pid));

    if (!aliveSessions.some((s) => s.pid === pid)) {
      aliveSessions.push({
        pid,
        startedAt: new Date().toISOString(),
      });
    }

    state.activeSessions = aliveSessions;
    saveServerState(state);
  }

  /**
   * Unregister a finished session and report remaining sessions
   */
  static async unregisterSession(pid: number): Promise<{ remainingSessions: number }> {
    const state = loadServerState();

    // Remove current pid and filter out dead pids
    const aliveSessions = state.activeSessions.filter((s) => s.pid !== pid && this.isPidAlive(s.pid));

    state.activeSessions = aliveSessions;
    saveServerState(state);

    return { remainingSessions: aliveSessions.length };
  }

  /**
   * Ensure server is running. Used by launcher and CLI.
   */
  static async ensureRunning(targetPort?: number): Promise<boolean> {
    const config = loadConfig();
    const port = targetPort || config.omniPort;

    if (await this.isPortListening(port)) {
      return true;
    }

    const res = await this.startServer(port);
    return res.success;
  }

  /**
   * Clean up after session exits. If on-demand mode and no sessions left, shut down OmniRoute.
   */
  static async handleSessionExit(pid: number): Promise<void> {
    const config = loadConfig();
    const { remainingSessions } = await this.unregisterSession(pid);

    if (config.serverMode === 'on-demand' && remainingSessions === 0) {
      await this.stopServer();
    }
  }

  /**
   * Configure autostart mode (Service vs On-Demand)
   */
  static async setServerMode(mode: ServerMode): Promise<{ success: boolean; message: string }> {
    saveConfig({ serverMode: mode });

    try {
      if (mode === 'service') {
        execSync('omniroute autostart enable', { stdio: 'ignore', windowsHide: true });
        // Also ensure it is running right now
        await this.ensureRunning();
        return { success: true, message: 'Always-On mode enabled. OmniRoute will start at system boot.' };
      } else {
        try {
          execSync('omniroute autostart disable', { stdio: 'ignore', windowsHide: true });
        } catch {}
        return { success: true, message: 'On-Demand mode enabled. OmniRoute runs only while Claude is open.' };
      }
    } catch (e: any) {
      // In platforms without systemd, saving config is still preserved
      return {
        success: true,
        message: `Mode set to ${mode} (native autostart command notice: ${e.message})`,
      };
    }
  }
}
