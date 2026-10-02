import 'dotenv/config';
import bolt from '@slack/bolt';
import { AIS, JUDGE, judgeAI, parseTrigger } from './ais.js';
import { ERROR_PREFIX, PLACEHOLDER, loadTimeline, toConversation, withInstruction } from './history.js';
import { JUDGE_INSTRUCTION, REVIEW_INSTRUCTION, findProject, judgePrompt, systemPrompt } from './projects.js';

const { App, LogLevel } = bolt;
const CHUNK = 10_000; // el bloque "markdown" de Slack admite hasta 12.000 caracteres
const REVIEW_HEADING = '*Verificación*\n\n';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

let botId;
let botUserId;

app.event('message', async ({ event, client, logger }) => {
  if (event.bot_id || (event.subtype && event.subtype !== 'file_share' && event.subtype !== 'thread_broadcast')) return;

  const trigger = parseTrigger(event.text, botUserId);
  if (!trigger) return;

  const project = await findProject(client, event.channel);
  if (!project) {
    logger.info(`Mensaje para las IAs en un canal sin proyecto (${event.channel}); agregalo a projects.json.`);
    return;
  }

  const ctx = { client, logger, event, project, channel: event.channel, threadTs: event.thread_ts || event.ts };
  if (trigger.mode === 'decide') await decide(ctx);
  else await chat(ctx, trigger.targets || project.defaultAIs);
});

/** Las IAs pedidas contestan en paralelo. */
async function chat(ctx, targets) {
  const ais = targets.map((id) => AIS[id]);
  const placeholders = await Promise.all(ais.map((ai) => placeholder(ctx, ai)));
  const timeline = await readThread(ctx, placeholders);
  if (!timeline) return;

  await Promise.all(ais.map((ai, i) => answer(ctx, placeholders[i], ai, ai, {
    system: systemPrompt(ctx.project, ai),
    conversation: toConversation(timeline, ai.id),
  })));
}

/** Propuestas de cada IA → verificación cruzada → decisión del Juez. */
async function decide(ctx) {
  const ais = ctx.project.defaultAIs.map((id) => AIS[id]);
  const placeholders = await Promise.all(ais.map((ai) => placeholder(ctx, ai)));
  const timeline = await readThread(ctx, placeholders);
  if (!timeline) return;

  // 1. Propuestas
  const proposals = await Promise.all(ais.map((ai, i) => answer(ctx, placeholders[i], ai, ai, {
    system: systemPrompt(ctx.project, ai),
    conversation: toConversation(timeline, ai.id),
  })));
  const active = ais.filter((_, i) => proposals[i]);
  active.forEach((ai) => timeline.push({ from: ai.id, parts: [text(proposals[ais.indexOf(ai)])] }));
  if (!active.length) return;

  // 2. Cada IA revisa las respuestas de las otras
  if (active.length > 1) {
    const reviewPlaceholders = await Promise.all(active.map((ai) => placeholder(ctx, ai)));
    const reviews = await Promise.all(active.map((ai, i) => answer(ctx, reviewPlaceholders[i], ai, ai, {
      system: systemPrompt(ctx.project, ai),
      conversation: withInstruction(toConversation(timeline, ai.id), REVIEW_INSTRUCTION),
      heading: REVIEW_HEADING,
    })));
    active.forEach((ai, i) => reviews[i] && timeline.push({ from: ai.id, parts: [text(REVIEW_HEADING + reviews[i])] }));
  }

  // 3. El Juez decide
  await answer(ctx, await placeholder(ctx, JUDGE), JUDGE, judgeAI(), {
    system: judgePrompt(ctx.project),
    conversation: withInstruction(toConversation(timeline, JUDGE.id), JUDGE_INSTRUCTION),
  });
}

async function placeholder(ctx, who) {
  const res = await ctx.client.chat.postMessage({
    channel: ctx.channel, thread_ts: ctx.threadTs, text: PLACEHOLDER, username: who.name, icon_emoji: who.icon,
  });
  return res.ts;
}

async function readThread(ctx, placeholders) {
  try {
    return await loadTimeline({
      client: ctx.client,
      channel: ctx.channel,
      threadTs: ctx.threadTs,
      uptoTs: ctx.event.ts,
      botId,
      botUserId,
      token: process.env.SLACK_BOT_TOKEN,
    });
  } catch (err) {
    ctx.logger.error(err);
    await Promise.all(placeholders.map((ts) => ctx.client.chat.update({
      channel: ctx.channel, ts, text: `${ERROR_PREFIX} No pude leer el hilo: ${err.message}`,
    })));
    return null;
  }
}

/**
 * Le pregunta a `ai` y publica la respuesta como `who` en lugar del "pensando…".
 * Devuelve el texto, o null si falló (el error queda visible en Slack).
 */
async function answer(ctx, ts, who, ai, { system, conversation, heading = '' }) {
  try {
    if (!process.env[ai.keyVar]) throw new Error(`falta configurar ${ai.keyVar} en el .env`);
    const reply = (await ai.ask(system, conversation)) || '(respuesta vacía)';
    await publish(ctx, ts, who, heading + reply);
    return reply;
  } catch (err) {
    ctx.logger.error(`${who.name}:`, err);
    await ctx.client.chat.update({
      channel: ctx.channel, ts, text: `${ERROR_PREFIX} ${who.name} no pudo responder: ${err.message}`,
    });
    return null;
  }
}

async function publish(ctx, placeholderTs, who, content) {
  const chunks = splitText(content, CHUNK);
  for (const [i, chunk] of chunks.entries()) {
    const message = { channel: ctx.channel, text: chunk, blocks: [{ type: 'markdown', text: chunk }] };
    if (i === 0) {
      await ctx.client.chat.update({ ...message, ts: placeholderTs });
    } else {
      await ctx.client.chat.postMessage({ ...message, thread_ts: ctx.threadTs, username: who.name, icon_emoji: who.icon });
    }
  }
}

function text(value) {
  return { type: 'text', text: value };
}

function splitText(content, size) {
  const chunks = [];
  let rest = content;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  chunks.push(rest);
  return chunks;
}

const auth = await app.client.auth.test();
botId = auth.bot_id;
botUserId = auth.user_id;
await app.start();
const ready = Object.values(AIS).map((ai) => `${ai.name} ${process.env[ai.keyVar] ? '✓' : '✗ (sin API key)'}`);
console.log(`⚡ Bot listo en ${auth.team}. ${ready.join(' · ')} · Juez: ${judgeAI().name}`);
