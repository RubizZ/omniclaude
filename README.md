# 🌌 OmniClaude

> **Cross-platform CLI & Interactive TUI Manager for Claude Code + OmniRoute.**  
> Manages the OmniRoute server lifecycle as a Singleton (with session reference counting or Always-On service mode), features a rich model catalog selector (Paid, Free, and Combos), includes a built-in Provider & Model Manager to enable/disable logins and toggle free models, and provides zero-friction global patching for Claude Code.

---

## 🚀 Installation

Install globally via npm:

```bash
npm install -g omniclaude
```

Or run directly without installation:

```bash
npx omniclaude
```

`omniclaude` is cross-platform and works seamlessly on **Linux**, **WSL (Ubuntu/Debian)**, **macOS**, and **Windows (PowerShell / CMD)**.

---

## 🎮 Interactive Terminal UI (TUI)

Simply run:

```bash
omniclaude
```

This launches the interactive dashboard displaying:
- **Live System Status Bar**: OmniRoute online/offline status, port, active session count, patching mode, and free providers filter state.
- **🚀 Launch Claude Code**: Interactive model picker categorized into:
  - ⚡ *auto* (smart automatic routing by OmniRoute)
  - 🔀 *Combos* (multi-model fallback and consensus pipelines)
  - 💰 *Configured / Paid* (OAuth & API-Key providers: Antigravity, OpenAI, Gemini, etc.)
  - 🎁 *Free* (No-auth and public community models)
- **⚡ Manage Providers & Models**: Toggle individual provider logins on/off and enable or disable all free providers with a single click.
- **🔌 OmniRoute Server Manager**: Start, stop, restart, view logs, or toggle between **Always-On** and **On-Demand** server modes.
- **🧩 Global Claude Patching**: Configure the standard `claude` command to automatically point to OmniRoute.
- **🏥 System Doctor**: Pre-flight diagnostics and automatic installer for prerequisites (Node 18+, Claude Code, OmniRoute).

---

## ⚡ Provider & Model Management

OmniRoute supports dozens of providers, but having hundreds of unused free models can clutter Claude Code's model selector. OmniClaude gives you total control:

### 1. Toggle Individual Provider Logins
Enable or disable specific provider connections (OAuth or API Keys such as Antigravity, OpenAI, Gemini) directly from the TUI or CLI without deleting your credentials:
```bash
omniclaude providers list
omniclaude providers toggle antigravity --disable
omniclaude providers toggle antigravity --enable
```

### 2. Toggle All Free Providers at Once
Hide or expose all no-auth and public community models (e.g. AI Horde, DuckDuckGo, Auggie, Cloudflare Playground) with a single command:
```bash
omniclaude providers free disable   # Hides all 400+ free models from your catalog
omniclaude providers free enable    # Restores access to all free community models
```

### 3. Expose Models in Native Claude Code (`/model`)
OmniClaude automatically manages `EXPOSE_CC_DISCOVERY_ALIASES=true`. Non-Claude models (Gemini, GPT, DeepSeek, etc.) are mirrored under a `claude/` prefix so they appear in Claude Code's native `/model` picker.

---

## ⚡ Singleton Server Lifecycle & Reference Counting

OmniClaude prevents port collision and resource waste by tracking active sessions atomically in `~/.omniclaude/state.json`:

1. **`on-demand` Mode (Default)**:
   - When you launch a session with `omniclaude launch`, it checks if OmniRoute is running on port 20128. If offline, it starts it silently in the background.
   - Registers the PID of the Claude session.
   - If you open multiple terminals, all sessions connect to the same singleton instance without spawning duplicate processes.
   - When the last active session closes, OmniClaude shuts down the OmniRoute server cleanly.
2. **`service` Mode (Always-On)**:
   - Registers OmniRoute to start on boot (via `omniroute autostart enable` / system service).
   - The server stays running continuously and does not shut down when terminal windows close.

Switch modes via CLI:
```bash
omniclaude server mode service    # Always-On
omniclaude server mode on-demand  # Shuts down with the last session
```

---

## 🧩 Zero-Friction Global Patching

Redirect the standard `claude` command across your entire system:

### Option 1: Native Settings Mode (Recommended)
Injects configuration directly into `~/.claude/settings.json` and adds an official `SessionStart` hook so Claude automatically ensures OmniRoute is alive on boot:
```bash
omniclaude patch --mode settings
```

### Option 2: Smart PATH Wrapper Mode
Creates an intelligent wrapper shim at `~/.omniclaude/bin/claude` that automatically adds itself to your permanent `PATH` (Windows Registry `HKCU\Environment\Path` and `.bashrc`/`.zshrc` on Linux/WSL):
```bash
omniclaude patch --mode wrapper
```

### Revert to Standard Claude Code
```bash
omniclaude unpatch
```

---

## 💻 CLI Commands Reference

| Command | Description |
| :--- | :--- |
| `omniclaude` | Open interactive TUI |
| `omniclaude launch` | Launch Claude Code pointed to OmniRoute |
| `omniclaude launch -m <model>` | Launch directly with a specific model |
| `omniclaude launch -b anthropic` | Launch pointing to official Anthropic Cloud |
| `omniclaude providers list` | List configured provider connections and free providers status |
| `omniclaude providers toggle <id>` | Toggle provider login active/inactive |
| `omniclaude providers free <enable\|disable>` | Enable or disable all free providers |
| `omniclaude server start` | Start OmniRoute background daemon |
| `omniclaude server stop` | Stop OmniRoute daemon |
| `omniclaude server restart` | Restart OmniRoute daemon |
| `omniclaude server status` | Display server health, port, and active sessions |
| `omniclaude patch` | Apply global patch to Claude Code |
| `omniclaude unpatch` | Remove patch and restore official Claude |
| `omniclaude doctor` | Check and repair system dependencies |
| `omniclaude open` | Open OmniRoute web dashboard in browser |
| `omniclaude config get` | Show current OmniClaude configuration |
| `omniclaude config set <key> <val>` | Update a configuration setting |

---

## 📂 Configuration Files

- **OmniClaude Config**: `~/.omniclaude/config.json`
- **Session State**: `~/.omniclaude/state.json`
- **Server Logs**: `~/.omniclaude/server.log`
- **PATH Shims**: `~/.omniclaude/bin/`

---

## 📄 License

MIT © [Rubén Hidalgo](https://github.com/RubizZ)
