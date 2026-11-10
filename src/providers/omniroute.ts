import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import open from 'open';
import { loadConfig, saveConfig } from '../config/store.js';
import { ServerManager } from '../server/manager.js';
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
   * Ensure a valid API Key exists for OmniRoute, registering a new one if missing
   */
  static async ensureApiKey(port?: number): Promise<string> {
    const config = loadConfig();
    const serverPort = port || config.omniPort;

    if (config.omniApiKey && config.omniApiKey.trim() !== '') {
      return config.omniApiKey;
    }

    // Server must be running to create an API key
    await ServerManager.ensureRunning(serverPort);

    // Try generating via omniroute CLI command
    try {
      const tempAdmin = `sk-admin-${Math.random().toString(36).substring(2, 10)}`;
      const output = execSync(
        `omniroute api api-keys post-api-keys --api-key "${tempAdmin}" --body "{\\"name\\": \\"omniclaude\\"}"`,
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      );

      const match = output.match(/sk-[a-f0-9]{16}-[a-f0-9]{6}-[a-f0-9]{8}/);
      if (match && match[0]) {
        saveConfig({ omniApiKey: match[0] });
        return match[0];
      }
    } catch {}

    // Fallback: check environment or default key format
    const fallbackKey = `sk-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
    saveConfig({ omniApiKey: fallbackKey });
    return fallbackKey;
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
    const key = apiKey || (await this.ensureApiKey(serverPort));

    await ServerManager.ensureRunning(serverPort);

    let modelsData: OmniModel[] = [];
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const json: any = await res.json();
        modelsData = json.data || [];
      }
    } catch {}

    // Fetch manifest for provider types (auth type: none = free, apikey/oauth = paid)
    let manifestData: any[] = [];
    try {
      const manifestRes = await fetch(`http://127.0.0.1:${serverPort}/api/v1/provider-plugin-manifest`);
      if (manifestRes.ok) {
        const json: any = await manifestRes.json();
        manifestData = Array.isArray(json) ? json : [];
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

      const plugin = manifestData.find((p) => p.id === prov);
      const authType = plugin?.auth?.type;

      const isFree =
        authType === 'none' ||
        prov.toLowerCase().includes('free') ||
        prov.toLowerCase().includes('ollama');

      const isPaid = authType === 'apikey' || authType === 'oauth';

      const group: ProviderGroup = {
        id: prov,
        name: plugin?.name || prov,
        type: isFree ? 'free' : isPaid ? 'paid' : 'other',
        models,
      };

      if (isFree) {
        freeProviders.push(group);
      } else if (isPaid) {
        paidProviders.push(group);
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
