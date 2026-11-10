# 🌌 OmniClaude

> **CLI & TUI Manager multiplataforma para Claude Code y OmniRoute.**  
> Administra el ciclo de vida del servidor OmniRoute como un Singleton (con Reference Counting de sesiones o modo servicio Always-On), permite seleccionar modelos de proveedores de pago, gratuitos y combos en una interfaz TUI interactiva y ofrece parcheo universal de Claude Code.

---

## 🚀 Instalación Global

Puedes instalarlo o vincularlo globalmente con npm:

```bash
# Desde el directorio del proyecto
npm run build
npm install -g .

# O mediante npm link para desarrollo activo
npm link
```

Una vez instalado, el comando `omniclaude` estará disponible globalmente en tu terminal (Linux, WSL, macOS y Windows PowerShell / CMD).

---

## 🎮 Uso Principal (TUI Interactiva)

Ejecuta simplemente:

```bash
omniclaude
```

Se abrirá la interfaz interactiva en consola mostrando:
- **Estado en tiempo real**: Si OmniRoute está online u offline, puerto, sesiones activas y estado de parcheo.
- **🚀 Lanzar Claude Code**: Selector con autocompletado y categorías:
  - ⚡ *auto*
  - 🔀 *Combos*
  - 💰 *De Pago* (Anthropic, OpenAI, DeepSeek, etc.)
  - 🆓 *Gratis*
  - ➕ *Añadir proveedores...* (abre el panel web y recarga la lista)
- **⚡ Administrador del Servidor OmniRoute**: Iniciar, detener, reiniciar, ver logs o alternar entre modo **Always-On** y **On-Demand**.
- **🧩 Parchear Claude Globalmente**: Redirigir el comando `claude` estándar hacia OmniRoute.
- **🔑 Proveedores & Dashboard**: Abrir la interfaz web de gestión (`http://localhost:20128/dashboard/providers`) y actualizar API keys.

---

## ⚡ Ciclo de Vida del Servidor (Singleton & Reference Counting)

OmniClaude resuelve el conflicto de múltiples instancias mediante un registro atómico de sesiones en `~/.omniclaude/state.json`:

1. **Modo `on-demand` (Por defecto)**:
   - Al lanzar una sesión con `omniclaude launch`, comprueba si el puerto 20128 está abierto. Si no lo está, levanta OmniRoute automáticamente en segundo plano.
   - Registra el PID de la sesión.
   - Si abres una segunda o tercera terminal, se conectan al mismo servidor existente sin colisiones.
   - Al cerrar la última sesión abierta, OmniClaude apaga el servidor limpiamente.
2. **Modo `service` (Always-On)**:
   - Registra OmniRoute en el arranque del sistema (mediante `omniroute autostart enable` / servicio systemd de usuario).
   - El servidor permanece siempre encendido y nunca se apaga al cerrar terminales.

Para cambiar el modo por CLI:
```bash
omniclaude server mode service    # Siempre encendido
omniclaude server mode on-demand  # Solo mientras haya sesiones abiertas
```

---

## 🧩 Parcheo Global de `claude`

Para que al escribir directamente `claude` en cualquier consola se conecte a OmniRoute:

### Opción 1: Configuración Nativa (Recomendada)
Escribe la configuración directamente en `~/.claude/settings.json` sin tocar binarios:
```bash
omniclaude patch --mode settings
```

### Opción 2: Wrapper Inteligente en PATH
Genera un shim en `~/.omniclaude/bin/claude` que auto-despierta OmniRoute en <50ms si estaba apagado antes de delegar en el ejecutable real de Claude:
```bash
omniclaude patch --mode wrapper
```

### Restaurar Claude oficial
```bash
omniclaude unpatch
```

---

## 💻 Comandos CLI Directos

| Comando | Descripción |
| :--- | :--- |
| `omniclaude` | Abre la interfaz TUI completa |
| `omniclaude launch` | Lanza Claude Code apuntando a OmniRoute |
| `omniclaude launch -m gemini-2.5-pro` | Lanza directamente con un modelo específico |
| `omniclaude launch -b anthropic` | Lanza con la nube oficial de Anthropic |
| `omniclaude server start` | Inicia el servidor OmniRoute en segundo plano |
| `omniclaude server stop` | Detiene el servidor |
| `omniclaude server restart` | Reinicia el servidor |
| `omniclaude server status` | Muestra el estado del servidor, puerto y sesiones |
| `omniclaude patch` | Aplica el parcheo global a Claude |
| `omniclaude unpatch` | Elimina el parche y restaura Claude Code |
| `omniclaude open` | Abre el dashboard web de OmniRoute en el navegador |
| `omniclaude config get` | Muestra la configuración actual de OmniClaude |
| `omniclaude config set <key> <val>` | Modifica un parámetro de configuración |

---

## 📂 Archivos y Directorios de Configuración

- **Configuración persistente**: `~/.omniclaude/config.json`
- **Registro de sesiones**: `~/.omniclaude/state.json`
- **Logs del servidor**: `~/.omniclaude/server.log`
- **Directorio de shims**: `~/.omniclaude/bin/`
