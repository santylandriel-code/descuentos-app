import { AIS, JUDGE, aiByName, parseTrigger } from './ais.js';
import { fileToParts } from './files.js';

export const PLACEHOLDER = '_pensando…_';
export const ERROR_PREFIX = ':warning:';

/**
 * Lee el hilo completo de Slack (hasta el mensaje actual) y lo deja en una línea de
 * tiempo neutral: quién habló (usuario o qué IA), a quién le hablaba y qué adjuntó.
 * Así cada IA ve también lo que respondieron las otras.
 */
export async function loadTimeline({ client, channel, threadTs, uptoTs, botId, botUserId, token }) {
  const messages = [];
  let cursor;
  do {
    const res = await client.conversations.replies({ channel, ts: threadTs, cursor, limit: 200 });
    messages.push(...res.messages);
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);

  const timeline = [];
  for (const m of messages) {
    if (Number(m.ts) > Number(uptoTs)) continue;

    if (m.bot_id === botId) {
      const from = m.username === JUDGE.name ? JUDGE.id : aiByName(m.username)?.id;
      const text = m.text || '';
      if (!from || text === PLACEHOLDER || text.startsWith(ERROR_PREFIX)) continue;
      const prev = timeline.at(-1);
      // Las respuestas largas se parten en varios mensajes: se vuelven a unir.
      if (prev?.from === from) prev.parts.push({ type: 'text', text });
      else timeline.push({ from, parts: [{ type: 'text', text }] });
      continue;
    }
    if (m.bot_id || (m.subtype && m.subtype !== 'file_share' && m.subtype !== 'thread_broadcast')) continue;

    const trigger = parseTrigger(m.text, botUserId);
    const parts = [{ type: 'text', text: trigger ? trigger.text : m.text || '' }];
    for (const file of m.files || []) parts.push(...(await fileToParts(file, token)));
    timeline.push({ from: 'user', targets: trigger?.targets ?? null, parts });
  }
  return timeline;
}

/** Arma la conversación desde el punto de vista de una IA concreta. */
export function toConversation(timeline, aiId) {
  const conversation = [];
  for (const entry of timeline) {
    let role = 'user';
    let parts = entry.parts;
    if (entry.from === aiId) {
      role = 'assistant';
    } else if (entry.from !== 'user') {
      const label = entry.from === JUDGE.id ? 'Decisión del Juez' : `Respuesta de ${AIS[entry.from].name}`;
      parts = [{ type: 'text', text: `[${label}]` }, ...parts];
    } else if (entry.targets && !entry.targets.includes(aiId)) {
      const names = entry.targets.map((t) => AIS[t].name).join(' y ');
      parts = [{ type: 'text', text: `[Mensaje del usuario dirigido a ${names}]` }, ...parts];
    }

    const prev = conversation.at(-1);
    if (prev?.role === role) prev.parts.push(...parts);
    else conversation.push({ role, parts: [...parts] });
  }
  while (conversation[0]?.role === 'assistant') conversation.shift();
  return conversation;
}

/** Agrega una indicación del sistema como último mensaje del usuario. */
export function withInstruction(conversation, text) {
  const result = conversation.map((m) => ({ ...m, parts: [...m.parts] }));
  const last = result.at(-1);
  if (last?.role === 'user') last.parts.push({ type: 'text', text });
  else result.push({ role: 'user', parts: [{ type: 'text', text }] });
  return result;
}
