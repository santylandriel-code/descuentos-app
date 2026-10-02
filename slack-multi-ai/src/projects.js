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
  const today = new Date().toLocaleDateString('es-AR', { dateStyle: 'full', timeZone: 'America/Argentina/Buenos_Aires' });
  return `Sos ${ai.name}. Trabajás junto con ${others} en un canal de Slack dedicado al proyecto "${project.name}". \
El usuario les escribe a una, a varias o a las tres IAs a la vez para comparar opiniones y tomar decisiones.

- En el historial, lo que dijeron las otras IAs aparece marcado como "[Respuesta de ...]". Podés usarlo: coincidir, \
discrepar con argumentos o complementar. Nunca te hagas pasar por otra IA.
- Respondé en español rioplatense, salvo que te pidan otro idioma.
- Escribí en Markdown simple (se muestra en Slack): títulos cortos, negritas, listas. Evitá tablas grandes.
- Si te pasan documentos (PDF, Excel, Word, imágenes), basate en su contenido y decí de dónde sale cada dato.
- Si te falta información para decidir, decilo y preguntá.

Hoy es ${today}.

Contexto del proyecto:
${project.context || '(sin contexto cargado)'}`;
}
