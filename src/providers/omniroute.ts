import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import open from 'open';
import { loadConfig, saveConfig } from '../config/store.js';
import { ServerManager } from '../server/manager.js';
import { DependencyManager } from '../system/deps.js';
import { OmniModel, ProviderGroup } from '../types.js';

export const OMNIROUTE_DIR = path.join(os.homedir(), '.omniroute');
export const OMNIROUTE_ENV_PATH = path.join(OMNIROUTE_DIR, '.env');

export class OmniRouteProvider {
  /**
   * Check if EXPOSE_CC_DISCOVERY_ALIASES is enabled in OmniRoute
   */
  static getDiscoveryAliases(): boolean {
    const config = loadConfig();
    if (config.exposeDiscoveryAliases !== undefined) {
      return config.exposeDiscoveryAliases;
    }

    if (fs.existsSync(OMNIROUTE_ENV_PATH)) {
      try {
        const content = fs.readFileSync(OMNIROUTE_ENV_PATH, 'utf-8');
        const match = content.match(/^EXPOSE_CC_DISCOVERY_ALIASES\s*=\s*(.*)$/m);
        if (match) {
          return match[1].trim().toLowerCase() === 'true';
        }
      } catch {}
    }

    return true; // default true
  }

  /**
   * Enable or disable EXPOSE_CC_DISCOVERY_ALIASES in OmniRoute's .env file and config
   */
  static setDiscoveryAliases(enable: boolean): void {
    saveConfig({ exposeDiscoveryAliases: enable });

    try {
      if (!fs.existsSync(OMNIROUTE_DIR)) {
        fs.mkdirSync(OMNIROUTE_DIR, { recursive: true });
      }

      let content = '';
      if (fs.existsSync(OMNIROUTE_ENV_PATH)) {
        content = fs.readFileSync(OMNIROUTE_ENV_PATH, 'utf-8');
      }

      const val = enable ? 'true' : 'false';
      if (/^EXPOSE_CC_DISCOVERY_ALIASES\s*=/m.test(content)) {
        content = content.replace(/^EXPOSE_CC_DISCOVERY_ALIASES\s*=.*$/m, `EXPOSE_CC_DISCOVERY_ALIASES=${val}`);
      } else {
        content += (content.endsWith('\n') || content === '' ? '' : '\n') + `EXPOSE_CC_DISCOVERY_ALIASES=${val}\n`;
      }

      fs.writeFileSync(OMNIROUTE_ENV_PATH, content, 'utf-8');
    } catch {}
  }
  /**
   * Ensure a valid API Key exists for OmniRoute, registering a new one if missing or rejected
   */
  static async ensureApiKey(port?: number): Promise<string> {
    const config = loadConfig();
    const serverPort = port || config.omniPort;

    // Server must be running to test or create an API key
    await ServerManager.ensureRunning(serverPort);

    // If a key is configured, verify it works against /v1/models
    if (config.omniApiKey && config.omniApiKey.trim() !== '') {
      try {
        const testRes = await fetch(`http://127.0.0.1:${serverPort}/v1/models`, {
          headers: { Authorization: `Bearer ${config.omniApiKey}` },
        });
        if (testRes.status === 200) {
          return config.omniApiKey;
        }
      } catch {}
    }

    // Key is either missing or rejected (401), generate a real one via omniroute CLI
    const tempFile = path.join(os.tmpdir(), `omni-key-${Date.now()}.json`);
    try {
      fs.writeFileSync(tempFile, JSON.stringify({ name: 'omniclaude' }), 'utf-8');
      const omniExe = DependencyManager.findOmnirouteExecutable();
      const isWin = process.platform === 'win32';
      const cmd = isWin ? `"${omniExe}"` : omniExe;

      const output = execSync(`${cmd} api api-keys post-api-keys --body @"${tempFile}"`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });

      const match = output.match(/sk-[a-f0-9]{16}-[a-f0-9]{6}-[a-f0-9]{8}/);
      if (match && match[0]) {
        saveConfig({ omniApiKey: match[0] });
        return match[0];
      }
    } catch {} finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
    }

    // Fallback: check environment
    return config.omniApiKey || 'unused';
  }

  /**
   * Fetch all models and organize by provider categories (Paid, Free, Combos, Other)
   */
  static async fetchCatalog(port?: number, apiKey?: string): Promise<{
    paidProviders: ProviderGroup[];
    freeProviders: ProviderGroup[];
    otherProviders: ProviderGroup[];
    comboModels: string[];
    allProviders: ProviderGroup[];
  }> {
    const config = loadConfig();
    const serverPort = port || config.omniPort;
    let key = apiKey || (await this.ensureApiKey(serverPort));

    await ServerManager.ensureRunning(serverPort);

    let modelsData: OmniModel[] = [];
    try {
      let res = await fetch(`http://127.0.0.1:${serverPort}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });

      // If 401 Unauthorized, key expired or invalid; regenerate and retry once
      if (res.status === 401) {
        saveConfig({ omniApiKey: '' });
        key = await this.ensureApiKey(serverPort);
        res = await fetch(`http://127.0.0.1:${serverPort}/v1/models`, {
          headers: { Authorization: `Bearer ${key}` },
        });
      }

      if (res.ok) {
        const json: any = await res.json();
        modelsData = json.data || [];
      }
    } catch {}

    // Fetch manifest for provider types
    let manifestData: any[] = [];
    try {
      const manifestRes = await fetch(`http://127.0.0.1:${serverPort}/api/v1/provider-plugin-manifest`);
      if (manifestRes.ok) {
        const json: any = await manifestRes.json();
        manifestData = Array.isArray(json) ? json : [];
      }
    } catch {}

    // Fetch configured provider connections (Antigravity, Gemini, OpenAI, etc.)
    let configuredProviders: any[] = [];
    try {
      const omniExe = DependencyManager.findOmnirouteExecutable();
      const isWin = process.platform === 'win32';
      const cmd = isWin ? `"${omniExe}"` : omniExe;
      const raw = execSync(`${cmd} api providers get-api-providers-client`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const match = raw.match(/\[\s*\{.*\}\s*\]/s);
      if (match) {
        configuredProviders = JSON.parse(match[0]);
      }
    } catch {}

    // Group models by owned_by
    const providerMap = new Map<string, string[]>();
    for (const m of modelsData) {
      if (!m.id || !m.owned_by) continue;
      // Filter out duplicate aliases starting with claude/
      if (m.id.startsWith('claude/')) continue;

      const prov = m.owned_by;
      if (!providerMap.has(prov)) {
        providerMap.set(prov, []);
      }
      providerMap.get(prov)!.push(m.id);
    }

    // Sort models inside each provider
    for (const [_, modelList] of providerMap.entries()) {
      modelList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }

    const paidProviders: ProviderGroup[] = [];
    const freeProviders: ProviderGroup[] = [];
    const otherProviders: ProviderGroup[] = [];
    let comboModels: string[] = [];

    for (const [prov, models] of providerMap.entries()) {
      if (prov === 'combo') {
        comboModels = models;
        continue;
      }

      const conf = configuredProviders.find(
        (c) => c.provider?.toLowerCase() === prov.toLowerCase()
      );
      const plugin = manifestData.find(
        (p) => p.id?.toLowerCase() === prov.toLowerCase()
      );

      const authType = conf?.authType || plugin?.auth?.type;

      const isFree =
        authType === 'none' ||
        prov.toLowerCase().includes('free') ||
        prov.toLowerCase().includes('ollama');

      const isPaid =
        authType === 'apikey' ||
        authType === 'oauth' ||
        prov.toLowerCase() === 'antigravity' ||
        Boolean(conf);

      let displayName = plugin?.name || prov;
      if (conf?.name) {
        displayName = `${prov} (${conf.name})`;
      } else if (conf?.providerSpecificData?.plan) {
        displayName = `${prov} (${conf.providerSpecificData.plan})`;
      }

      const group: ProviderGroup = {
        id: prov,
        name: displayName,
        type: isFree ? 'free' : isPaid ? 'paid' : 'other',
        models,
      };

      if (isPaid) {
        paidProviders.push(group);
      } else if (isFree) {
        freeProviders.push(group);
      } else {
        otherProviders.push(group);
      }
    }

    // Sort providers alphabetically
    paidProviders.sort((a, b) => a.id.localeCompare(b.id));
    freeProviders.sort((a, b) => a.id.localeCompare(b.id));
    otherProviders.sort((a, b) => a.id.localeCompare(b.id));

    return {
      paidProviders,
      freeProviders,
      otherProviders,
      comboModels,
      allProviders: [...paidProviders, ...freeProviders, ...otherProviders],
    };
  }

  /**
   * Open OmniRoute web dashboard to manage and add providers
   */
  static async openDashboard(path = '/dashboard/providers', port?: number): Promise<void> {
    const config = loadConfig();
    const serverPort = port || config.omniPort;
    await ServerManager.ensureRunning(serverPort);
    const url = `http://127.0.0.1:${serverPort}${path}`;
    await open(url);
  }
}
