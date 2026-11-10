import * as p from '@clack/prompts';
import pc from 'picocolors';
import fs from 'node:fs';
import { loadConfig, saveConfig, loadServerState, LOG_PATH } from '../config/store.js';
import { ServerManager } from '../server/manager.js';
import { OmniRouteProvider } from '../providers/omniroute.js';
import { ClaudePatcher } from '../patcher/patcher.js';
import { ClaudeLauncher } from '../launcher.js';
import { DependencyManager } from '../system/deps.js';
import { BackendType, ServerMode, PatchMode, ProviderConnection } from '../types.js';

export class OmniClaudeTUI {
  static async start(): Promise<void> {
    console.clear();
    p.intro(
      pc.bgMagenta(pc.black(' OMNICLAUDE ')) +
        ' ' +
        pc.bold(pc.white('Claude Code + OmniRoute Singleton Manager'))
    );

    // Verify dependencies before proceeding
    await DependencyManager.ensurePrerequisites(true);

    while (true) {
      await this.renderStatusBar();

      const action = await p.select({
        message: 'What would you like to do?',
        options: [
          { value: 'launch', label: '🚀 Launch Claude Code', hint: 'Select provider and model' },
          { value: 'providers', label: '⚡ Manage Providers & Models', hint: 'Enable/disable logins & free providers' },
          { value: 'server', label: '🔌 OmniRoute Server Manager', hint: 'Singleton lifecycle & Autostart' },
          { value: 'patch', label: '🧩 Global Claude Patching', hint: 'Redirect "claude" command to OmniRoute' },
          { value: 'doctor', label: '🏥 System Doctor', hint: 'Verify and install dependencies' },
          { value: 'exit', label: '🚪 Exit' },
        ],
      });

      if (p.isCancel(action) || action === 'exit') {
        p.outro(pc.dim('Goodbye!'));
        process.exit(0);
      }

      switch (action) {
        case 'launch':
          await this.handleLaunchFlow();
          break;
        case 'providers':
          await this.handleProvidersFlow();
          break;
        case 'server':
          await this.handleServerFlow();
          break;
        case 'patch':
          await this.handlePatchFlow();
          break;
        case 'doctor':
          await this.handleDoctorFlow();
          break;
      }
    }
  }

  static async renderStatusBar(): Promise<void> {
    const config = loadConfig();
    const isRunning = await ServerManager.isPortListening(config.omniPort);
    const state = loadServerState();
    const patchStatus = ClaudePatcher.getStatus();
    const freeEnabled = await OmniRouteProvider.isFreeProvidersEnabled();

    const serverBadge = isRunning
      ? pc.green(`● Online (:${config.omniPort})`)
      : pc.red(`○ Offline (:${config.omniPort})`);

    const modeBadge =
      config.serverMode === 'service'
        ? pc.cyan('⚡ Always-On')
        : pc.yellow(`⏱️ On-Demand (${state.activeSessions.length} active)`);

    const patchBadge = patchStatus.isPatched
      ? pc.magenta(`🧩 Patched [${patchStatus.mode}]`)
      : pc.dim('⚪ Unpatched');

    const freeBadge = freeEnabled
      ? pc.blue('🎁 Free Providers: ON')
      : pc.dim('🚫 Free Providers: OFF');

    const lastModelBadge = config.lastModel ? pc.dim(`[Last: ${config.lastModel}]`) : '';

    p.note(
      `${serverBadge}  |  ${modeBadge}  |  ${patchBadge}  |  ${freeBadge}  ${lastModelBadge}`,
      'System Status'
    );
  }

  /**
   * Flow to launch Claude Code with model and backend selection
   */
  static async handleLaunchFlow(): Promise<void> {
    const backend = (await p.select({
      message: '⚡ Select backend:',
      options: [
        {
          value: 'omniroute',
          label: '🌌 OmniRoute',
          hint: 'Smart multi-provider AI Router with full catalog & fallbacks',
        },
        {
          value: 'anthropic',
          label: '🌐 Official Anthropic Cloud',
          hint: 'Standard direct connection',
        },
      ],
    })) as BackendType;

    if (p.isCancel(backend)) return;

    if (backend === 'anthropic') {
      p.log.info(pc.cyan('Launching Claude Code with official Anthropic backend...'));
      await ClaudeLauncher.launch({ backend: 'anthropic' });
      return;
    }

    // OmniRoute Flow
    await this.handleOmniRouteLaunch();
  }

  static async handleOmniRouteLaunch(): Promise<void> {
    const config = loadConfig();
    const spinner = p.spinner();

    spinner.start('Connecting to OmniRoute and fetching model catalog...');
    let catalog;
    try {
      catalog = await OmniRouteProvider.fetchCatalog(config.omniPort);
      spinner.stop(pc.green('Model catalog loaded successfully.'));
    } catch (e: any) {
      spinner.stop(pc.red(`Failed to connect to OmniRoute: ${e.message}`));
      return;
    }

    // Build provider selection list
    const options: { value: string; label: string; hint?: string }[] = [
      { value: 'auto', label: '⚡ auto', hint: 'Smart automatic selection by OmniRoute' },
    ];

    if (catalog.comboModels.length > 0) {
      options.push({ value: 'combo', label: '🔀 Combos', hint: `${catalog.comboModels.length} configured combos` });
    }

    if (catalog.paidProviders.length > 0) {
      options.push({
        value: '__header_paid__',
        label: pc.bold('--- 💰 Configured / Paid (API Key / OAuth) ---'),
      });
      for (const prov of catalog.paidProviders) {
        options.push({
          value: `prov:${prov.id}`,
          label: `  ${prov.name}`,
          hint: `${prov.models.length} models`,
        });
      }
    }

    if (catalog.freeProviders.length > 0) {
      options.push({
        value: '__header_free__',
        label: pc.bold('--- 🎁 Free (No-Auth / Public) ---'),
      });
      for (const prov of catalog.freeProviders) {
        options.push({
          value: `prov:${prov.id}`,
          label: `  ${prov.name}`,
          hint: `${prov.models.length} models`,
        });
      }
    }

    if (catalog.otherProviders.length > 0) {
      options.push({
        value: '__header_other__',
        label: pc.bold('--- ❓ Other Providers ---'),
      });
      for (const prov of catalog.otherProviders) {
        options.push({
          value: `prov:${prov.id}`,
          label: `  ${prov.name}`,
          hint: `${prov.models.length} models`,
        });
      }
    }

    options.push({
      value: '__manage__',
      label: '➕ Manage Providers...',
      hint: 'Configure logins and filters',
    });

    const chosen = await p.select({
      message: '🧠 Select provider:',
      options: options.map((opt) => ({
        ...opt,
        disabled: opt.value.startsWith('__header_'),
      })),
    });

    if (p.isCancel(chosen)) return;

    if (chosen === '__manage__') {
      await this.handleProvidersFlow();
      return this.handleOmniRouteLaunch();
    }

    if (chosen === 'auto') {
      p.log.info(pc.magenta('Launching Claude Code via OmniRoute (auto)...'));
      await ClaudeLauncher.launch({ backend: 'omniroute', model: 'auto' });
      return;
    }

    let modelOptions: string[] = [];
    if (chosen === 'combo') {
      modelOptions = catalog.comboModels;
    } else if (typeof chosen === 'string' && chosen.startsWith('prov:')) {
      const provId = chosen.replace('prov:', '');
      const group = catalog.allProviders.find((g) => g.id === provId);
      modelOptions = group?.models || [];
    }

    if (modelOptions.length === 0) {
      p.log.warn('No models found for this selection. Falling back to auto.');
      await ClaudeLauncher.launch({ backend: 'omniroute', model: 'auto' });
      return;
    }

    const selectedModel = await p.select({
      message: '🧠 Select specific model:',
      options: modelOptions.map((m) => ({ value: m, label: m })),
    });

    if (p.isCancel(selectedModel)) return;

    p.log.info(pc.magenta(`Launching Claude Code via OmniRoute (${selectedModel})...`));
    await ClaudeLauncher.launch({ backend: 'omniroute', model: String(selectedModel) });
  }

  /**
   * Flow to manage Providers, Logins, and Free Models
   */
  static async handleProvidersFlow(): Promise<void> {
    while (true) {
      const config = loadConfig();
      const connections = await OmniRouteProvider.listConfiguredConnections();
      const freeEnabled = await OmniRouteProvider.isFreeProvidersEnabled();

      const options: { value: string; label: string; hint?: string }[] = [
        {
          value: 'toggle_free',
          label: freeEnabled
            ? `🎁 Free Providers: ${pc.green('ENABLED')} (Click to Disable)`
            : `🎁 Free Providers: ${pc.red('DISABLED')} (Click to Enable)`,
          hint: freeEnabled
            ? 'Free/noauth models are visible in model list'
            : 'All free/noauth models are hidden to keep list clean',
        },
      ];

      if (connections.length > 0) {
        options.push({
          value: '__header_conns__',
          label: pc.bold('--- Configured Provider Logins (Click to Toggle) ---'),
        });

        for (const conn of connections) {
          const badge = conn.isActive
            ? pc.green('● ACTIVE')
            : pc.red('○ INACTIVE');
          options.push({
            value: `toggle_conn:${conn.id}`,
            label: `  ${conn.provider} (${conn.name}) [${badge}]`,
            hint: `Type: ${conn.authType} | Status: ${conn.testStatus || 'unknown'}`,
          });
        }
      }

      options.push({
        value: '__header_tools__',
        label: pc.bold('--- Tools & Settings ---'),
      });

      options.push({
        value: 'toggle_discovery',
        label: `🔀 Expose in Claude Code (/model): ${config.exposeDiscoveryAliases !== false ? pc.green('ENABLED') : pc.red('DISABLED')}`,
        hint: 'Allows non-Claude models to appear in Claude Code\'s native /model picker',
      });

      options.push({
        value: 'open_dashboard',
        label: '🌐 Open OmniRoute Web Dashboard',
        hint: 'Add new API keys, OAuth logins, and view analytics',
      });

      options.push({
        value: 'set_api_key',
        label: '🔑 Set OmniRoute Client API Key',
        hint: `Current: ${config.omniApiKey ? config.omniApiKey.substring(0, 12) + '...' : '(none)'}`,
      });

      options.push({ value: 'back', label: '⬅️ Back to Main Menu' });

      const action = await p.select({
        message: '⚡ Provider & Model Manager:',
        options: options.map((opt) => ({
          ...opt,
          disabled: opt.value.startsWith('__header_'),
        })),
      });

      if (p.isCancel(action) || action === 'back') return;

      if (action === 'toggle_free') {
        const spinner = p.spinner();
        const newState = !freeEnabled;
        spinner.start(`${newState ? 'Enabling' : 'Disabling'} free providers...`);
        const res = await OmniRouteProvider.setFreeProvidersEnabled(newState);
        spinner.stop(res.message);
      } else if (typeof action === 'string' && action.startsWith('toggle_conn:')) {
        const connId = action.replace('toggle_conn:', '');
        const spinner = p.spinner();
        spinner.start('Updating provider connection status...');
        const res = await OmniRouteProvider.toggleConnection(connId);
        spinner.stop(res.message);
      } else if (action === 'toggle_discovery') {
        const current = config.exposeDiscoveryAliases !== false;
        const newState = !current;
        OmniRouteProvider.setDiscoveryAliases(newState);
        p.log.success(
          newState
            ? pc.green('✅ OmniRoute models exposed in Claude Code (/model).')
            : pc.yellow('❌ OmniRoute models hidden from Claude Code.')
        );
      } else if (action === 'open_dashboard') {
        p.log.info('Opening OmniRoute web dashboard...');
        await OmniRouteProvider.openDashboard('/dashboard/providers');
      } else if (action === 'set_api_key') {
        const key = await p.text({
          message: 'Enter OmniRoute API Key (sk-...):',
          defaultValue: config.omniApiKey,
        });
        if (!p.isCancel(key) && key) {
          saveConfig({ omniApiKey: key.trim() });
          p.log.success('API Key saved successfully.');
        }
      }
    }
  }

  /**
   * Flow to manage OmniRoute server (start, stop, autostart mode)
   */
  static async handleServerFlow(): Promise<void> {
    const config = loadConfig();
    const isRunning = await ServerManager.isPortListening(config.omniPort);
    const state = loadServerState();

    const action = await p.select({
      message: '⚡ OmniRoute Server Management:',
      options: [
        {
          value: 'toggle_run',
          label: isRunning ? '🛑 Stop Server' : '▶️ Start Server',
          hint: isRunning ? `PID: ${state.serverPid || 'unknown'}` : 'Start background daemon',
        },
        {
          value: 'restart',
          label: '🔄 Restart Server',
          hint: 'Stops and starts the service cleanly',
        },
        {
          value: 'toggle_mode',
          label: `⚙️ Switch Mode: Currently ${config.serverMode === 'service' ? 'Always-On' : 'On-Demand'}`,
          hint:
            config.serverMode === 'service'
              ? 'Switch to On-Demand (stops when last Claude session closes)'
              : 'Switch to Always-On (starts at system boot)',
        },
        {
          value: 'view_log',
          label: '📋 View Recent Server Logs',
          hint: LOG_PATH,
        },
        { value: 'back', label: '⬅️ Back' },
      ],
    });

    if (p.isCancel(action) || action === 'back') return;

    if (action === 'toggle_run') {
      const spinner = p.spinner();
      if (isRunning) {
        spinner.start('Stopping OmniRoute...');
        const res = await ServerManager.stopServer();
        spinner.stop(res.message);
      } else {
        spinner.start('Starting OmniRoute...');
        const res = await ServerManager.startServer();
        spinner.stop(res.message);
      }
    } else if (action === 'restart') {
      const spinner = p.spinner();
      spinner.start('Restarting OmniRoute...');
      const res = await ServerManager.restart();
      spinner.stop(res.message);
    } else if (action === 'toggle_mode') {
      const newMode: ServerMode = config.serverMode === 'service' ? 'on-demand' : 'service';
      const spinner = p.spinner();
      spinner.start(`Setting mode to ${newMode}...`);
      const res = await ServerManager.setServerMode(newMode);
      spinner.stop(res.message);
    } else if (action === 'view_log') {
      if (fs.existsSync(LOG_PATH)) {
        const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n').slice(-25).join('\n');
        p.note(lines || 'Log file is empty.', `Last 25 lines of ${LOG_PATH}`);
      } else {
        p.log.warn('No log file created yet.');
      }
    }
  }

  /**
   * Flow to patch or unpatch Claude Code
   */
  static async handlePatchFlow(): Promise<void> {
    const status = ClaudePatcher.getStatus();

    if (status.isPatched) {
      p.log.success(pc.green(`Claude Code is currently patched: ${status.details}`));

      const choice = await p.select({
        message: 'Patching options:',
        options: [
          { value: 'unpatch', label: '❌ Unpatch (Restore official Claude Code configuration)' },
          { value: 'change_mode', label: '🔄 Switch Mode (Settings ⟷ Wrapper)' },
          { value: 'back', label: '⬅️ Back' },
        ],
      });

      if (p.isCancel(choice) || choice === 'back') return;

      if (choice === 'unpatch') {
        const res = await ClaudePatcher.unpatch();
        p.log.info(res.message);
        return;
      }
    }

    const method = (await p.select({
      message: 'Choose patching method:',
      options: [
        {
          value: 'settings',
          label: '📁 Native Settings (~/.claude/settings.json)',
          hint: 'Recommended. Non-invasive, auto-activates Always-On + SessionStart hook',
        },
        {
          value: 'wrapper',
          label: '⚡ Smart PATH Wrapper (~/.omniclaude/bin/claude)',
          hint: 'Auto-added to PATH, silently ensures OmniRoute is alive',
        },
        { value: 'back', label: '⬅️ Back' },
      ],
    })) as PatchMode | 'back';

    if (p.isCancel(method) || method === 'back') return;

    const res = await ClaudePatcher.patch(method);
    p.log.success(res.message);
  }

  /**
   * Flow to diagnose and repair dependencies
   */
  static async handleDoctorFlow(): Promise<void> {
    const { nodeOk, nodeVer, deps } = DependencyManager.checkAll();

    const lines: string[] = [
      `Node.js: ${nodeOk ? pc.green(`OK (${nodeVer})`) : pc.red(`REQUIRED >= 18 (${nodeVer})`)}`,
    ];

    for (const dep of deps) {
      const status = dep.installed
        ? pc.green(`Installed (${dep.version || 'OK'})`)
        : pc.red(`Not installed (run npm i -g ${dep.packageName})`);
      lines.push(`${dep.name} [${dep.command}]: ${status}`);
    }

    p.note(lines.join('\n'), 'System Diagnostics (Doctor)');

    const missing = deps.filter((d) => !d.installed);
    if (missing.length > 0) {
      await DependencyManager.ensurePrerequisites(true);
    } else {
      await p.confirm({ message: 'All dependencies are installed and ready. Press Enter to return.' });
    }
  }
}
