import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const env = process.env;

// Los clientes se crean recién cuando se usan, así una IA sin API key no rompe a las otras.
function lazy(factory) {
  let client;
  return () => (client ??= factory());
}

const anthropic = lazy(() => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
const openai = lazy(() => new OpenAI({ apiKey: env.OPENAI_API_KEY }));
const xai = lazy(() => new OpenAI({ apiKey: env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' }));

export const AIS = {
  claude: {
    id: 'claude',
    name: 'Claude',
    icon: ':large_orange_circle:',
    keyVar: 'ANTHROPIC_API_KEY',
    ask: askClaude,
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: ':large_green_circle:',
    keyVar: 'OPENAI_API_KEY',
    ask: (system, history) => askOpenAICompatible(openai(), env.OPENAI_MODEL || 'gpt-5', system, history),
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    icon: ':black_circle:',
    keyVar: 'XAI_API_KEY',
    ask: (system, history) => askOpenAICompatible(xai(), env.XAI_MODEL || 'grok-4', system, history),
  },
};

// El Juez no es una cuarta IA: es una de las tres (JUDGE_AI) con otro rol y otro nombre en Slack.
export const JUDGE = { id: 'judge', name: 'Juez', icon: ':scales:' };

export function judgeAI() {
  return AIS[env.JUDGE_AI] || AIS.claude;
}

export function aiByName(name) {
  return Object.values(AIS).find((ai) => ai.name === name);
}

// --- Cómo se le habla a cada IA en un mensaje ---------------------------------
// "claude: ...", "grok, ...", "claude y chatgpt: ...", "todas: ...", "las 3: ..."
// o mencionando al bot (@IA ...), que usa las IAs por defecto del proyecto.
// "decidir: ..." arranca una ronda de propuestas, verificación cruzada y decisión del Juez.

const NAME = String.raw`(?:claude|chatgpt|gpt|openai|grok|todas|todos|all|las\s*(?:3|tres))\b`;
const SEP = String.raw`\s*(?:,|\+|&|\sy\s|\se\s)\s*`;
const LIST = new RegExp(String.raw`^(${NAME}(?:${SEP}${NAME})*)\s*([:,])?`, 'i');

const DECIDE = /^(?:decid[ií]r?|decisi[oó]n)(?![\p{L}\d])\s*([:,])?/iu;
const ALIASES = { claude: 'claude', chatgpt: 'chatgpt', gpt: 'chatgpt', openai: 'chatgpt', grok: 'grok' };

export function parseTrigger(text, botUserId) {
  let rest = (text || '').trim();
  let mentioned = false;
  const mention = botUserId && `<@${botUserId}>`;
  if (mention && rest.startsWith(mention)) {
    rest = rest.slice(mention.length).trim();
    mentioned = true;
  }

  const decide = rest.match(DECIDE);
  if (decide && (decide[1] || mentioned)) {
    return { mode: 'decide', targets: null, text: rest.slice(decide[0].length).trim() };
  }

  const targets = new Set();
  const m = rest.match(LIST);
  if (m && (m[2] || mentioned)) {
    for (const [word] of m[1].matchAll(new RegExp(NAME, 'gi'))) {
      const key = ALIASES[word.toLowerCase()];
      if (key) targets.add(key);
      else Object.keys(AIS).forEach((k) => targets.add(k)); // todas / las 3
    }
    rest = rest.slice(m[0].length).trim();
  }

  if (!targets.size && !mentioned) return null;
  return { targets: targets.size ? [...targets] : null, text: rest };
}

// --- Proveedores ----------------------------------------------------------------

async function askClaude(system, history) {
  const stream = anthropic().messages.stream({
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 16000,
    system,
    messages: history.map((msg) => ({
      role: msg.role,
      content: msg.parts.flatMap((p) => toClaudeBlock(p, msg.role)),
    })),
  });
  const final = await stream.finalMessage();
  return final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function toClaudeBlock(part, role) {
  if (part.type === 'text') return part.text.trim() ? [{ type: 'text', text: part.text }] : [];
  if (role === 'assistant') return [];
  if (part.type === 'image') {
    return [{ type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } }];
  }
  if (part.type === 'pdf') {
    return [{
      type: 'document',
      title: part.name,
      source: { type: 'base64', media_type: 'application/pdf', data: part.data },
    }];
  }
  return [];
}

// ChatGPT y Grok usan la misma API (la de xAI es compatible con la de OpenAI).
async function askOpenAICompatible(client, model, system, history) {
  const messages = [{ role: 'system', content: system }];
  for (const msg of history) {
    if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n') });
    } else {
      messages.push({ role: 'user', content: msg.parts.flatMap(toOpenAIPart) });
    }
  }
  const res = await client.chat.completions.create({ model, messages });
  return (res.choices[0]?.message?.content || '').trim();
}

function toOpenAIPart(part) {
  if (part.type === 'text') return part.text.trim() ? [{ type: 'text', text: part.text }] : [];
  if (part.type === 'image') {
    return [{ type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } }];
  }
  if (part.type === 'pdf') {
    const text = part.text?.trim()
      ? part.text
      : '(No se pudo extraer texto: probablemente es un PDF escaneado.)';
    return [{ type: 'text', text: `Contenido del PDF "${part.name}":\n${text}` }];
  }
  return [];
}
