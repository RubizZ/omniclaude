import * as p from '@clack/prompts';
import pc from 'picocolors';
import fs from 'node:fs';
import { loadConfig, saveConfig, loadServerState, LOG_PATH } from '../config/store.js';
import { ServerManager } from '../server/manager.js';
import { OmniRouteProvider } from '../providers/omniroute.js';
import { ClaudePatcher } from '../patcher/patcher.js';
import { ClaudeLauncher } from '../launcher.js';
import { RoutaticProvider, ROUTATIC_DEFAULT_MODELS } from '../providers/routatic.js';
import { BackendType, ServerMode, PatchMode } from '../types.js';

export class OmniClaudeTUI {
  static async start(): Promise<void> {
    console.clear();
    p.intro(
      pc.bgMagenta(pc.black(' OMNICLAUDE ')) +
        ' ' +
        pc.bold(pc.white('Claude Code + OmniRoute Singleton Manager'))
    );

    while (true) {
      await this.renderStatusBar();

      const action = await p.select({
        message: '¿Qué deseas hacer?',
        options: [
          { value: 'launch', label: '🚀 Lanzar Claude Code', hint: 'Selecciona proveedor y modelo' },
          { value: 'server', label: '⚡ Administrador del Servidor OmniRoute', hint: 'Singleton & Autostart' },
          { value: 'patch', label: '🧩 Parchear Claude Globalmente', hint: 'Usa OmniRoute al escribir "claude"' },
          { value: 'providers', label: '🔑 Proveedores y Dashboard', hint: 'Añadir API keys y abrir portal web' },
          { value: 'exit', label: '🚪 Salir' },
        ],
      });

      if (p.isCancel(action) || action === 'exit') {
        p.outro(pc.dim('¡Hasta luego!'));
        process.exit(0);
      }

      switch (action) {
        case 'launch':
          await this.handleLaunchFlow();
          break;
        case 'server':
          await this.handleServerFlow();
          break;
        case 'patch':
          await this.handlePatchFlow();
          break;
        case 'providers':
          await this.handleProvidersFlow();
          break;
      }
    }
  }

  static async renderStatusBar(): Promise<void> {
    const config = loadConfig();
    const isRunning = await ServerManager.isPortListening(config.omniPort);
    const state = loadServerState();
    const patchStatus = ClaudePatcher.getStatus();

    const serverBadge = isRunning
      ? pc.green(`● Online (:${config.omniPort})`)
      : pc.red(`○ Offline (:${config.omniPort})`);

    const modeBadge =
      config.serverMode === 'service'
        ? pc.cyan('⚡ Always-On (Autostart)')
        : pc.yellow(`⏱️ On-Demand (${state.activeSessions.length} activas)`);

    const patchBadge = patchStatus.isPatched
      ? pc.magenta(`🧩 Parcheado [${patchStatus.mode}]`)
      : pc.dim('⚪ Sin parchear');

    const lastModelBadge = config.lastModel ? pc.blue(`[Último: ${config.lastModel}]`) : '';

    p.note(
      `${serverBadge}  |  ${modeBadge}  |  ${patchBadge}  ${lastModelBadge}`,
      'Estado del Sistema'
    );
  }

  /**
   * Flow to launch Claude Code with model and backend selection
   */
  static async handleLaunchFlow(): Promise<void> {
    const config = loadConfig();

    const backend = (await p.select({
      message: '⚡ Selecciona el backend:',
      options: [
        {
          value: 'omniroute',
          label: '🌌 Omni Route',
          hint: 'Smart AI Router con fallbacks y catálogo completo',
        },
        {
          value: 'routatic',
          label: '🔀 Routatic Proxy',
          hint: 'Proxy OpenCode Go en puerto ' + config.routaticPort,
        },
        {
          value: 'anthropic',
          label: '🌐 Oficial (Anthropic Cloud)',
          hint: 'Conexión directa estándar',
        },
      ],
    })) as BackendType;

    if (p.isCancel(backend)) return;

    if (backend === 'anthropic') {
      p.log.info(pc.cyan('Lanzando Claude Code con el backend oficial...'));
      await ClaudeLauncher.launch({ backend: 'anthropic' });
      return;
    }

    if (backend === 'routatic') {
      const selectedModel = await p.select({
        message: '🧠 Selecciona el modelo para Routatic:',
        options: ROUTATIC_DEFAULT_MODELS.map((m) => ({ value: m, label: m })),
      });
      if (p.isCancel(selectedModel)) return;

      p.log.info(pc.cyan(`Lanzando Claude Code vía Routatic Proxy (${selectedModel})...`));
      await ClaudeLauncher.launch({ backend: 'routatic', model: String(selectedModel) });
      return;
    }

    // OmniRoute Flow
    await this.handleOmniRouteLaunch();
  }

  static async handleOmniRouteLaunch(): Promise<void> {
    const config = loadConfig();
    const spinner = p.spinner();

    spinner.start('Conectando con OmniRoute y obteniendo catálogo de modelos...');
    let catalog;
    try {
      catalog = await OmniRouteProvider.fetchCatalog(config.omniPort);
      spinner.stop(pc.green('Catálogo obtenido con éxito.'));
    } catch (e: any) {
      spinner.stop(pc.red(`Error al conectar con OmniRoute: ${e.message}`));
      return;
    }

    // Build provider selection list
    const options: { value: string; label: string; hint?: string }[] = [
      { value: 'auto', label: '⚡ auto', hint: 'Selección automática inteligente de OmniRoute' },
    ];

    if (catalog.comboModels.length > 0) {
      options.push({ value: 'combo', label: '🔀 Combos', hint: `${catalog.comboModels.length} combos definidos` });
    }

    if (catalog.paidProviders.length > 0) {
      options.push({
        value: '__header_paid__',
        label: pc.bold('--- 💰 De Pago (API Key / OAuth) ---'),
      });
      for (const prov of catalog.paidProviders) {
        options.push({
          value: `prov:${prov.id}`,
          label: `  ${prov.name}`,
          hint: `${prov.models.length} modelos`,
        });
      }
    }

    if (catalog.freeProviders.length > 0) {
      options.push({
        value: '__header_free__',
        label: pc.bold('--- 🆓 Gratis ---'),
      });
      for (const prov of catalog.freeProviders) {
        options.push({
          value: `prov:${prov.id}`,
          label: `  ${prov.name}`,
          hint: `${prov.models.length} modelos`,
        });
      }
    }

    if (catalog.otherProviders.length > 0) {
      options.push({
        value: '__header_other__',
        label: pc.bold('--- ❓ Otros ---'),
      });
      for (const prov of catalog.otherProviders) {
        options.push({
          value: `prov:${prov.id}`,
          label: `  ${prov.name}`,
          hint: `${prov.models.length} modelos`,
        });
      }
    }

    options.push({
      value: '__manage__',
      label: '➕ Añadir más proveedores...',
      hint: 'Abre el portal web de OmniRoute',
    });

    const chosen = await p.select({
      message: '🧠 Selecciona el proveedor:',
      options: options.map((opt) => ({
        ...opt,
        disabled: opt.value.startsWith('__header_'),
      })),
    });

    if (p.isCancel(chosen)) return;

    if (chosen === '__manage__') {
      p.log.info(pc.cyan('Abriendo panel de OmniRoute en tu navegador...'));
      await OmniRouteProvider.openDashboard('/dashboard/providers');
      await p.confirm({ message: 'Presiona Enter cuando hayas configurado tus proveedores para recargar.' });
      return this.handleOmniRouteLaunch();
    }

    if (chosen === 'auto') {
      p.log.info(pc.magenta('Lanzando Claude Code vía OmniRoute (auto)...'));
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
      p.log.warn('No se encontraron modelos para esta selección. Usando auto.');
      await ClaudeLauncher.launch({ backend: 'omniroute', model: 'auto' });
      return;
    }

    const selectedModel = await p.select({
      message: '🧠 Selecciona el modelo específico:',
      options: modelOptions.map((m) => ({ value: m, label: m })),
    });

    if (p.isCancel(selectedModel)) return;

    p.log.info(pc.magenta(`Lanzando Claude Code vía OmniRoute (${selectedModel})...`));
    await ClaudeLauncher.launch({ backend: 'omniroute', model: String(selectedModel) });
  }

  /**
   * Flow to manage OmniRoute server (start, stop, autostart mode)
   */
  static async handleServerFlow(): Promise<void> {
    const config = loadConfig();
    const isRunning = await ServerManager.isPortListening(config.omniPort);
    const state = loadServerState();

    const action = await p.select({
      message: '⚡ Gestión de Servidor OmniRoute:',
      options: [
        {
          value: 'toggle_run',
          label: isRunning ? '🛑 Detener servidor' : '▶️ Iniciar servidor',
          hint: isRunning ? `PID: ${state.serverPid || 'desconocido'}` : 'Iniciar en segundo plano',
        },
        {
          value: 'restart',
          label: '🔄 Reiniciar servidor',
          hint: 'Detiene e inicia nuevamente el servicio',
        },
        {
          value: 'toggle_mode',
          label: `⚙️ Cambiar Modo: Actualmente ${config.serverMode === 'service' ? 'Always-On' : 'On-Demand'}`,
          hint:
            config.serverMode === 'service'
              ? 'Cambiar a On-Demand (se apaga al cerrar Claude)'
              : 'Cambiar a Always-On (inicia con el PC)',
        },
        {
          value: 'view_log',
          label: '📋 Ver últimos registros (Log)',
          hint: LOG_PATH,
        },
        { value: 'back', label: '⬅️ Volver' },
      ],
    });

    if (p.isCancel(action) || action === 'back') return;

    if (action === 'toggle_run') {
      const spinner = p.spinner();
      if (isRunning) {
        spinner.start('Deteniendo OmniRoute...');
        const res = await ServerManager.stopServer();
        spinner.stop(res.message);
      } else {
        spinner.start('Iniciando OmniRoute...');
        const res = await ServerManager.startServer();
        spinner.stop(res.message);
      }
    } else if (action === 'restart') {
      const spinner = p.spinner();
      spinner.start('Reiniciando servidor...');
      await ServerManager.stopServer();
      const res = await ServerManager.startServer();
      spinner.stop(res.message);
    } else if (action === 'toggle_mode') {
      const newMode: ServerMode = config.serverMode === 'service' ? 'on-demand' : 'service';
      const spinner = p.spinner();
      spinner.start(`Configurando modo ${newMode}...`);
      const res = await ServerManager.setServerMode(newMode);
      spinner.stop(res.message);
    } else if (action === 'view_log') {
      if (fs.existsSync(LOG_PATH)) {
        const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n').slice(-20).join('\n');
        p.note(lines || 'Log vacío', `Últimas 20 líneas de ${LOG_PATH}`);
      } else {
        p.log.warn('Aún no existe archivo de log.');
      }
    }
  }

  /**
   * Flow to patch or unpatch Claude Code
   */
  static async handlePatchFlow(): Promise<void> {
    const status = ClaudePatcher.getStatus();

    if (status.isPatched) {
      p.log.success(pc.green(`Claude está actualmente parcheado: ${status.details}`));

      const choice = await p.select({
        message: 'Opciones de parcheo:',
        options: [
          { value: 'unpatch', label: '❌ Desparchear (Restaurar configuración oficial de Claude)' },
          { value: 'change_mode', label: '🔄 Cambiar modo de parcheo (Settings ⟷ Wrapper)' },
          { value: 'back', label: '⬅️ Volver' },
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
      message: '¿Cómo deseas parchear Claude Code?',
      options: [
        {
          value: 'settings',
          label: '📁 Configuración Nativa (~/.claude/settings.json)',
          hint: 'Recomendado. No invasivo, 100% multiplataforma',
        },
        {
          value: 'wrapper',
          label: '⚡ Wrapper Inteligente en PATH (~/.omniclaude/bin/claude)',
          hint: 'Auto-despierta OmniRoute si está apagado antes de ejecutar Claude',
        },
        { value: 'back', label: '⬅️ Volver' },
      ],
    })) as PatchMode | 'back';

    if (p.isCancel(method) || method === 'back') return;

    const res = await ClaudePatcher.patch(method);
    p.log.success(res.message);
  }

  /**
   * Flow to manage API keys and open web dashboards
   */
  static async handleProvidersFlow(): Promise<void> {
    const config = loadConfig();

    const action = await p.select({
      message: '🔑 Proveedores y API Keys:',
      options: [
        {
          value: 'open_portal',
          label: '🌐 Abrir Dashboard de OmniRoute en Navegador',
          hint: 'Configura tus modelos y suscripciones visualmente',
        },
        {
          value: 'set_omni_key',
          label: '🔑 Modificar API Key de OmniRoute',
          hint: `Actual: ${config.omniApiKey ? config.omniApiKey.substring(0, 12) + '...' : '(ninguna)'}`,
        },
        {
          value: 'set_routatic_key',
          label: '🔑 Modificar API Key de Routatic',
          hint: `Actual: ${config.routaticApiKey ? config.routaticApiKey.substring(0, 8) + '...' : '(ninguna)'}`,
        },
        { value: 'back', label: '⬅️ Volver' },
      ],
    });

    if (p.isCancel(action) || action === 'back') return;

    if (action === 'open_portal') {
      p.log.info('Abriendo dashboard...');
      await OmniRouteProvider.openDashboard('/dashboard/providers');
    } else if (action === 'set_omni_key') {
      const key = await p.text({
        message: 'Introduce tu clave de API de OmniRoute (sk-...):',
        defaultValue: config.omniApiKey,
      });
      if (!p.isCancel(key) && key) {
        saveConfig({ omniApiKey: key.trim() });
        p.log.success('API Key guardada con éxito.');
      }
    } else if (action === 'set_routatic_key') {
      const key = await p.text({
        message: 'Introduce tu clave de Routatic Proxy:',
        defaultValue: config.routaticApiKey,
      });
      if (!p.isCancel(key) && key) {
        saveConfig({ routaticApiKey: key.trim() });
        p.log.success('API Key guardada con éxito.');
      }
    }
  }
}
