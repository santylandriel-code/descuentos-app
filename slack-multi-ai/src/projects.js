import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIS } from './ais.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const channelNames = new Map();

/**
 * Devuelve el proyecto asociado a un canal, o null si el canal no es de ningún proyecto.
 * projects.json y contexto/*.md se releen en cada mensaje: se pueden editar sin reiniciar.
 */
export async function findProject(client, channelId) {
  const config = JSON.parse(readFileSync(join(ROOT, 'projects.json'), 'utf8'));

  if (!channelNames.has(channelId)) {
    const { channel } = await client.conversations.info({ channel: channelId });
    channelNames.set(channelId, channel.name);
  }
  const channelName = channelNames.get(channelId);

  const project = config.projects.find((p) => {
    const ch = p.channel.replace(/^#/, '');
    return ch === channelId || ch === channelName;
  });
  if (!project) return null;

  const contextFile = join(ROOT, 'contexto', `${channelName}.md`);
  const extra = existsSync(contextFile) ? readFileSync(contextFile, 'utf8') : '';

  return {
    ...project,
    context: [project.context, extra].filter(Boolean).join('\n\n'),
    defaultAIs: (project.defaultAIs || config.defaultAIs || Object.keys(AIS)).filter((id) => AIS[id]),
  };
}

export function systemPrompt(project, ai) {
  const others = Object.values(AIS).filter((a) => a.id !== ai.id).map((a) => a.name).join(' y ');
  return `Sos ${ai.name}. Trabajás junto con ${others} en un canal de Slack dedicado al proyecto "${project.name}". \
El usuario les escribe a una, a varias o a las tres IAs a la vez para comparar opiniones y tomar decisiones.

- En el historial, lo que dijeron las otras IAs aparece marcado como "[Respuesta de ...]". Podés usarlo: coincidir, \
discrepar con argumentos o complementar. Nunca te hagas pasar por otra IA.
${commonRules(project)}`;
}

export function judgePrompt(project) {
  return `Sos el Juez del canal de Slack del proyecto "${project.name}". Claude, ChatGPT y Grok propusieron opciones \
y se verificaron entre ellas; en el historial aparecen como "[Respuesta de ...]". Tu trabajo es decidir cuál es la \
mejor opción para el usuario.

- Sé imparcial: no favorezcas a ninguna IA, tampoco a la del mismo proveedor que vos.
- Valorá exactitud, respaldo en los documentos, riesgos, costo y qué tan realizable es. Podés combinar ideas de varias.
- Si las verificaciones encontraron errores en una propuesta, tenelos en cuenta.
- Respondé con este formato:
  **Decisión:** la opción elegida, en una o dos líneas.
  **Por qué:** de 3 a 5 puntos.
  **Coincidencias y diferencias:** en qué estuvieron de acuerdo las IAs y en qué no.
  **Riesgos a vigilar:** lo que podría salir mal.
  **Próximo paso:** una acción concreta.
  **Confianza:** alta, media o baja, y qué información la subiría.
${commonRules(project)}`;
}

export const REVIEW_INSTRUCTION = `[Ronda de verificación] Revisá críticamente las respuestas de las otras IAs en este \
hilo y también la tuya: errores, datos dudosos o sin respaldo, riesgos y lo que falte. Si después de leerlas cambiás \
de opinión, decilo. Máximo 12 líneas. Terminá con "**Mi voto:** ..." diciendo qué propuesta elegirías y por qué en una línea.`;

export const JUDGE_INSTRUCTION = '[Decisión] Con todo lo anterior, tomá la decisión final.';

function commonRules(project) {
  const today = new Date().toLocaleDateString('es-AR', { dateStyle: 'full', timeZone: 'America/Argentina/Buenos_Aires' });
  return `- Respondé en español rioplatense, salvo que te pidan otro idioma.
- Escribí en Markdown simple (se muestra en Slack): títulos cortos, negritas, listas. Evitá tablas grandes.
- Si te pasan documentos (PDF, Excel, Word, imágenes), basate en su contenido y decí de dónde sale cada dato.
- Si te falta información para decidir, decilo y preguntá.

Hoy es ${today}.

Contexto del proyecto:
${project.context || '(sin contexto cargado)'}`;
}
