import { Command } from 'commander';
import { OmniClaudeTUI } from './tui/app.js';
import { ServerManager } from './server/manager.js';
import { ClaudeLauncher } from './launcher.js';
import { ClaudePatcher } from './patcher/patcher.js';
import { OmniRouteProvider } from './providers/omniroute.js';
import { loadConfig, saveConfig, loadServerState } from './config/store.js';
import { DependencyManager } from './system/deps.js';
import { BackendType, PatchMode, ServerMode } from './types.js';

const program = new Command();

program
  .name('omniclaude')
  .description('Cross-platform CLI & TUI manager for Claude Code and OmniRoute')
  .version('1.0.0');

// Default action: if no command passed, open TUI
program.action(async () => {
  await OmniClaudeTUI.start();
});

// Launch command
program
  .command('launch [claudeArgs...]')
  .description('Directly launch Claude Code pointed at chosen backend')
  .option('-b, --backend <backend>', 'Backend to use (omniroute, anthropic)', 'omniroute')
  .option('-m, --model <model>', 'Specific model identifier (e.g. auto, claude-3-7-sonnet)')
  .action(async (claudeArgs, options) => {
    await DependencyManager.ensurePrerequisites(true);
    const backend = options.backend as BackendType;
    await ClaudeLauncher.launch({
      backend,
      model: options.model,
      args: claudeArgs,
    });
  });

// Doctor command to diagnose and install prerequisites
program
  .command('doctor')
  .description('Check and install required dependencies (Node.js, Claude Code, OmniRoute)')
  .option('--fix', 'Automatically install missing dependencies without prompting')
  .action(async (opts) => {
    const { nodeOk, nodeVer, deps } = DependencyManager.checkAll();
    console.log(`Node.js: ${nodeOk ? `OK (${nodeVer})` : `REQUIRED >= 18 (${nodeVer})`}`);
    for (const dep of deps) {
      const status = dep.installed ? `INSTALLED (${dep.version || 'OK'})` : 'NOT INSTALLED';
      console.log(`${dep.name} (${dep.command}): ${status}`);
    }

    const missing = deps.filter((d) => !d.installed);
    if (missing.length > 0) {
      if (opts.fix) {
        for (const m of missing) {
          console.log(`Installing ${m.packageName}...`);
          DependencyManager.installPackage(m.packageName);
        }
      } else {
        await DependencyManager.ensurePrerequisites(true);
      }
    } else {
      console.log('All dependencies are installed.');
    }
  });

// Server management
const serverCmd = program.command('server').description('Manage OmniRoute singleton server');

serverCmd
  .command('start')
  .description('Start OmniRoute daemon')
  .option('-p, --port <port>', 'Port number')
  .action(async (opts) => {
    const port = opts.port ? Number(opts.port) : undefined;
    const res = await ServerManager.startServer(port);
    console.log(res.message);
    if (!res.success) process.exit(1);
  });

serverCmd
  .command('stop')
  .description('Stop OmniRoute daemon')
  .action(async () => {
    const res = await ServerManager.stopServer();
    console.log(res.message);
  });

serverCmd
  .command('restart')
  .description('Restart OmniRoute daemon')
  .action(async () => {
    const res = await ServerManager.restart();
    console.log(res.message);
  });

serverCmd
  .command('status')
  .description('Check OmniRoute server status')
  .action(async () => {
    const config = loadConfig();
    const isRunning = await ServerManager.isPortListening(config.omniPort);
    const state = loadServerState();
    console.log(`Port: ${config.omniPort}`);
    console.log(`Status: ${isRunning ? 'ONLINE' : 'OFFLINE'}`);
    console.log(`Mode: ${config.serverMode}`);
    console.log(`Active Sessions: ${state.activeSessions.length}`);
    if (state.serverPid) console.log(`PID: ${state.serverPid}`);
  });

serverCmd
  .command('ensure-running')
  .description('Ensure server is up; starts it if not listening')
  .option('-q, --quiet', 'Suppress output')
  .action(async (opts) => {
    const ok = await ServerManager.ensureRunning();
    if (!opts.quiet) {
      console.log(ok ? 'Server is running.' : 'Failed to start server.');
    }
  });

serverCmd
  .command('mode <mode>')
  .description('Set server lifecycle mode (service = Always-On, on-demand = Session counted)')
  .action(async (mode: string) => {
    if (mode !== 'service' && mode !== 'on-demand') {
      console.error('Invalid mode. Choose "service" or "on-demand".');
      process.exit(1);
    }
    const res = await ServerManager.setServerMode(mode as ServerMode);
    console.log(res.message);
  });

// Providers management
const providersCmd = program.command('providers').description('Manage configured provider logins and free providers');

providersCmd
  .command('list')
  .description('List configured provider logins and free providers status')
  .action(async () => {
    const conns = await OmniRouteProvider.listConfiguredConnections();
    const freeEnabled = await OmniRouteProvider.isFreeProvidersEnabled();

    console.log(`Free Providers: ${freeEnabled ? 'ENABLED (Visible)' : 'DISABLED (Hidden)'}\n`);

    if (conns.length === 0) {
      console.log('No configured provider logins found in OmniRoute.');
      console.log('Use "omniclaude open" to add logins in the web dashboard.');
      return;
    }

    console.log('Configured Provider Connections:');
    for (const c of conns) {
      const status = c.isActive ? 'ACTIVE' : 'INACTIVE';
      console.log(`  - [${status}] ${c.provider} (${c.name}) [ID: ${c.id}]`);
    }
  });

providersCmd
  .command('toggle <idOrName>')
  .description('Toggle or set a provider connection active/inactive')
  .option('--enable', 'Explicitly enable provider')
  .option('--disable', 'Explicitly disable provider')
  .action(async (idOrName, opts) => {
    let targetActive: boolean | undefined = undefined;
    if (opts.enable) targetActive = true;
    if (opts.disable) targetActive = false;

    const res = await OmniRouteProvider.toggleConnection(idOrName, targetActive);
    console.log(res.message);
    if (!res.success) process.exit(1);
  });

providersCmd
  .command('free <action>')
  .description('Enable or disable all free/no-auth providers (enable | disable)')
  .action(async (action: string) => {
    const act = action.toLowerCase();
    if (act !== 'enable' && act !== 'disable') {
      console.error('Invalid action. Use "enable" or "disable".');
      process.exit(1);
    }
    const enable = act === 'enable';
    const res = await OmniRouteProvider.setFreeProvidersEnabled(enable);
    console.log(res.message);
  });

// Patching command
program
  .command('patch')
  .description('Configure system so that running "claude" points to OmniRoute')
  .option('-m, --mode <mode>', 'Patching mechanism: "settings" or "wrapper"', 'settings')
  .option('--model <model>', 'Default model to set')
  .action(async (opts) => {
    const mode = opts.mode as PatchMode;
    const res = await ClaudePatcher.patch(mode, opts.model);
    console.log(res.message);
  });

program
  .command('unpatch')
  .description('Revert Claude Code to standard configuration')
  .action(async () => {
    const res = await ClaudePatcher.unpatch();
    console.log(res.message);
  });

// Open Dashboard
program
  .command('open [path]')
  .description('Open OmniRoute web dashboard')
  .action(async (subpath) => {
    await OmniRouteProvider.openDashboard(subpath || '/dashboard/providers');
  });

// Config helpers
const configCmd = program.command('config').description('Get or set omniclaude configuration values');

configCmd
  .command('get [key]')
  .description('Read config value')
  .action((key) => {
    const cfg = loadConfig() as any;
    if (key) {
      console.log(cfg[key] !== undefined ? cfg[key] : '');
    } else {
      console.log(JSON.stringify(cfg, null, 2));
    }
  });

configCmd
  .command('set <key> <value>')
  .description('Set config value')
  .action((key, value) => {
    let parsedVal: any = value;
    if (value === 'true') parsedVal = true;
    if (value === 'false') parsedVal = false;
    if (!isNaN(Number(value))) parsedVal = Number(value);

    saveConfig({ [key]: parsedVal });
    console.log(`Updated ${key} = ${parsedVal}`);
  });

program.parse(process.argv);
