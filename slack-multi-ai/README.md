# Equipo IA en Slack (Claude + ChatGPT + Grok)

Un bot de Slack que pone a **Claude, ChatGPT y Grok** en cada canal de proyecto.
Les escribís a una, a dos o a las tres, ven lo que dijeron las otras y te ayudan a decidir.

| Canal de Slack           | Proyecto                  |
|--------------------------|---------------------------|
| `#bacacay-control-obra`  | Bacacay – Control de obra |
| `#ezequiel-app`          | Ezequiel – App            |
| `#landar`                | Landar                    |

## Cómo se usa

En el canal del proyecto escribí:

| Mensaje                          | Quién responde              |
|----------------------------------|-----------------------------|
| `claude: revisá este presupuesto`| Claude                      |
| `gpt: ...` o `chatgpt: ...`      | ChatGPT                     |
| `grok, ...`                      | Grok                        |
| `claude y grok: ...`             | Claude y Grok               |
| `todas: ...` o `las 3: ...`      | Las tres                    |
| `@IA ...`                        | Las IAs por defecto (las 3) |

- Cada IA contesta **en un hilo**, con su nombre e ícono. Seguí hablando en ese hilo
  y todas tienen la conversación completa, **incluidas las respuestas de las otras**:
  `claude: ¿qué opinás de lo que dijo Grok?` funciona.
- Mensajes sin prefijo no disparan nada, así podés charlar con personas en el mismo canal.
- **Documentos**: adjuntalos en el mensaje (o antes, en el mismo hilo). Soporta PDF,
  Word (.docx), Excel (.xlsx/.xls/.csv), imágenes (PNG/JPG/WebP/GIF) y texto/código.
- Cada canal está separado: un proyecto no ve lo de otro.

## Instalación (una sola vez, ~20 minutos)

### 1. Crear la app de Slack
1. Entrá a <https://api.slack.com/apps> → **Create New App** → **From an app manifest**.
2. Elegí tu workspace y pegá el contenido de [`slack-app-manifest.yml`](slack-app-manifest.yml).
3. **Install to Workspace** → copiá el *Bot User OAuth Token* (`xoxb-...`).
4. En **Basic Information → App-Level Tokens** → *Generate Token* con el scope
   `connections:write` → copiá el token (`xapp-...`).

### 2. Conseguir las API keys
Las suscripciones (Claude Pro, ChatGPT Plus, SuperGrok) **no sirven** para esto: hacen
falta API keys, que se pagan por uso.
- Claude: <https://console.anthropic.com> → API Keys
- ChatGPT: <https://platform.openai.com/api-keys>
- Grok: <https://console.x.ai>

Si falta alguna, el bot funciona igual con las otras y avisa cuál no está configurada.

### 3. Configurar y arrancar
```bash
cd slack-multi-ai
cp .env.example .env     # completá los tokens y API keys
npm install
npm start
```
Tenés que ver: `⚡ Bot listo en ... Claude ✓ · ChatGPT ✓ · Grok ✓`

### 4. Canales
Creá los tres canales en Slack (pueden ser privados) y en cada uno escribí
`/invite @IA`.

Para agregar o cambiar proyectos editá [`projects.json`](projects.json). Para darle a las
IAs contexto fijo de un proyecto (datos clave, decisiones, personas), creá
`contexto/<nombre-del-canal>.md`. Ambos se releen en cada mensaje.

## Dónde dejarlo corriendo

Usa *Socket Mode*, así que **no necesita URL pública ni dominio**. Opciones:
- Tu compu (`npm start`): funciona mientras esté prendida.
- Un servidor siempre prendido: [Railway](https://railway.app), [Render](https://render.com)
  (tipo *Background Worker*) o [Fly.io](https://fly.io). Subí esta carpeta, cargá las
  variables del `.env` en su panel y el comando de inicio es `npm start`.

Netlify no sirve para esto porque no mantiene procesos corriendo.

## Modelos
Se cambian en el `.env` sin tocar código: `CLAUDE_MODEL`, `OPENAI_MODEL`, `XAI_MODEL`.

## Tests
```bash
npm test
```
