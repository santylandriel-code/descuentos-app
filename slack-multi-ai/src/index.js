import 'dotenv/config';
import bolt from '@slack/bolt';
import { AIS, parseTrigger } from './ais.js';
import { ERROR_PREFIX, PLACEHOLDER, loadTimeline, toConversation } from './history.js';
import { findProject, systemPrompt } from './projects.js';

const { App, LogLevel } = bolt;
const CHUNK = 10_000; // el bloque "markdown" de Slack admite hasta 12.000 caracteres

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

  const targets = trigger.targets || project.defaultAIs;
  const threadTs = event.thread_ts || event.ts;

  // Primero aparecen los "pensando…" de cada IA, después se lee el hilo una sola vez.
  const placeholders = await Promise.all(targets.map((id) => client.chat.postMessage({
    channel: event.channel,
    thread_ts: threadTs,
    text: PLACEHOLDER,
    username: AIS[id].name,
    icon_emoji: AIS[id].icon,
  })));

  let timeline;
  try {
    timeline = await loadTimeline({
      client, channel: event.channel, threadTs, uptoTs: event.ts, botId, botUserId, token: process.env.SLACK_BOT_TOKEN,
    });
  } catch (err) {
    logger.error(err);
    await Promise.all(placeholders.map((p) => client.chat.update({
      channel: event.channel, ts: p.ts, text: `${ERROR_PREFIX} No pude leer el hilo: ${err.message}`,
    })));
    return;
  }

  await Promise.all(targets.map(async (id, i) => {
    const ai = AIS[id];
    const placeholder = placeholders[i];
    try {
      if (!process.env[ai.keyVar]) throw new Error(`falta configurar ${ai.keyVar} en el .env`);
      const answer = await ai.ask(systemPrompt(project, ai), toConversation(timeline, id));
      await publish(client, event.channel, threadTs, placeholder.ts, ai, answer || '(respuesta vacía)');
    } catch (err) {
      logger.error(`${ai.name}:`, err);
      await client.chat.update({
        channel: event.channel, ts: placeholder.ts, text: `${ERROR_PREFIX} ${ai.name} no pudo responder: ${err.message}`,
      });
    }
  }));
});

async function publish(client, channel, threadTs, placeholderTs, ai, answer) {
  const chunks = splitText(answer, CHUNK);
  for (const [i, chunk] of chunks.entries()) {
    const message = { channel, text: chunk, blocks: [{ type: 'markdown', text: chunk }] };
    if (i === 0) {
      await client.chat.update({ ...message, ts: placeholderTs });
    } else {
      await client.chat.postMessage({ ...message, thread_ts: threadTs, username: ai.name, icon_emoji: ai.icon });
    }
  }
}

function splitText(text, size) {
  const chunks = [];
  let rest = text;
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
console.log(`⚡ Bot listo en ${auth.team}. ${ready.join(' · ')}`);
