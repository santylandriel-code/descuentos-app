import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JUDGE, parseTrigger } from '../src/ais.js';
import { toConversation, withInstruction } from '../src/history.js';

const ALL = ['claude', 'chatgpt', 'grok'];

test('parseTrigger: una IA, varias o todas', () => {
  assert.deepEqual(parseTrigger('claude: hola'), { targets: ['claude'], text: 'hola' });
  assert.deepEqual(parseTrigger('Grok, ¿qué opinás?'), { targets: ['grok'], text: '¿qué opinás?' });
  assert.deepEqual(parseTrigger('Claude y GPT: compará'), { targets: ['claude', 'chatgpt'], text: 'compará' });
  assert.deepEqual(parseTrigger('claude, grok: dale').targets, ['claude', 'grok']);
  assert.deepEqual(parseTrigger('todas: decidan').targets, ALL);
  assert.deepEqual(parseTrigger('las 3: decidan').targets, ALL);
});

test('parseTrigger: mención al bot', () => {
  assert.deepEqual(parseTrigger('<@U1> resumí esto', 'U1'), { targets: null, text: 'resumí esto' });
  assert.deepEqual(parseTrigger('<@U1> grok: hola', 'U1'), { targets: ['grok'], text: 'hola' });
});

test('parseTrigger: charla normal no dispara nada', () => {
  assert.equal(parseTrigger('Claude dijo algo interesante'), null);
  assert.equal(parseTrigger('mañana vamos a la obra'), null);
  assert.equal(parseTrigger(''), null);
});

test('toConversation: cada IA ve a las otras como contexto', () => {
  const timeline = [
    { from: 'user', targets: ALL, parts: [{ type: 'text', text: '¿A o B?' }] },
    { from: 'claude', parts: [{ type: 'text', text: 'A' }] },
    { from: 'grok', parts: [{ type: 'text', text: 'B' }] },
    { from: 'user', targets: ['claude'], parts: [{ type: 'text', text: '¿y lo de Grok?' }] },
  ];
  const forClaude = toConversation(timeline, 'claude');
  assert.deepEqual(forClaude.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(forClaude[2].parts.map((p) => p.text).join(' '), /\[Respuesta de Grok\] B/);

  const forGpt = toConversation(timeline, 'chatgpt');
  assert.equal(forGpt.length, 1);
  assert.match(forGpt[0].parts.map((p) => p.text).join(' '), /dirigido a Claude/);
});

test('parseTrigger: modo decidir', () => {
  assert.deepEqual(parseTrigger('decidir: ¿A o B?'), { mode: 'decide', targets: null, text: '¿A o B?' });
  assert.equal(parseTrigger('Decidí, qué hacemos').mode, 'decide');
  assert.equal(parseTrigger('<@U1> decidir ¿A o B?', 'U1').mode, 'decide');
  assert.equal(parseTrigger('decidimos mañana'), null);
});

test('toConversation: el Juez ve a todas como contexto y la instrucción va al final', () => {
  const timeline = [
    { from: 'user', targets: null, parts: [{ type: 'text', text: '¿A o B?' }] },
    { from: 'claude', parts: [{ type: 'text', text: 'A' }] },
    { from: 'grok', parts: [{ type: 'text', text: 'B' }] },
  ];
  const conv = withInstruction(toConversation(timeline, JUDGE.id), 'decidí');
  assert.equal(conv.length, 1);
  assert.equal(conv[0].role, 'user');
  const all = conv[0].parts.map((p) => p.text).join(' ');
  assert.match(all, /\[Respuesta de Claude\] A .*\[Respuesta de Grok\] B decidí/);

  const later = toConversation([...timeline, { from: 'judge', parts: [{ type: 'text', text: 'Gana A' }] }], 'grok');
  assert.match(later.at(-1).parts.map((p) => p.text).join(' '), /\[Decisión del Juez\] Gana A/);
});
