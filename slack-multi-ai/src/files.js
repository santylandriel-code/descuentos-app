import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import XLSX from 'xlsx';

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 150_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SHEET_EXTS = new Set(['xlsx', 'xlsm', 'xls', 'ods', 'csv']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx',
  'py', 'java', 'kt', 'swift', 'sql', 'yml', 'yaml', 'sh', 'log', 'ini', 'toml', 'env',
]);

// Los archivos se descargan una sola vez aunque aparezcan en muchos mensajes del hilo.
const cache = new Map();
const CACHE_SIZE = 200;

/**
 * Convierte un archivo de Slack en "partes" neutrales que después cada IA traduce
 * a su propio formato: { type: 'text' | 'image' | 'pdf', ... }.
 */
export function fileToParts(file, token) {
  if (!cache.has(file.id)) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    const name = file.name || file.title || 'archivo';
    cache.set(file.id, convert(file, name, token).catch((err) => [note(`No se pudo leer "${name}": ${err.message}`)]));
  }
  return cache.get(file.id);
}

async function convert(file, name, token) {
  const url = file.url_private_download || file.url_private;
  if (!url) return [note(`El archivo "${name}" no está disponible (puede estar oculto por el plan de Slack).`)];
  if (file.size > MAX_BYTES) return [note(`El archivo "${name}" es demasiado grande (máx. 30 MB).`)];

  const buf = await download(url, token);
  const mime = file.mimetype || '';
  const ext = (file.filetype || name.split('.').pop() || '').toLowerCase();

  if (IMAGE_TYPES.has(mime)) {
    if (buf.length > MAX_IMAGE_BYTES) return [note(`La imagen "${name}" pesa más de 5 MB; mandala más liviana.`)];
    return [note(`Imagen adjunta: ${name}`), { type: 'image', mime, data: buf.toString('base64') }];
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    let text = '';
    try {
      text = (await pdfParse(buf)).text;
    } catch {
      // Claude igual lo lee en forma nativa; ChatGPT/Grok reciben el aviso.
    }
    return [{ type: 'pdf', name, data: buf.toString('base64'), text: truncate(text) }];
  }
  if (ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return [textFile(name, value)];
  }
  if (SHEET_EXTS.has(ext)) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheets = wb.SheetNames.map((s) => `## Hoja: ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`);
    return [textFile(name, sheets.join('\n\n'))];
  }
  if (mime.startsWith('text/') || TEXT_EXTS.has(ext)) {
    return [textFile(name, buf.toString('utf8'))];
  }
  return [note(`Archivo "${name}" (${mime || ext}) no soportado todavía: mandalo como PDF, Word, Excel, imagen o texto.`)];
}

async function download(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Slack respondió ${res.status}`);
  // Sin el permiso files:read Slack devuelve la página de login en vez del archivo.
  if ((res.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Slack no dejó descargarlo (¿falta el permiso files:read?)');
  }
  return Buffer.from(await res.arrayBuffer());
}

function textFile(name, text) {
  return { type: 'text', text: `Contenido del archivo "${name}":\n${truncate(text)}` };
}

function note(text) {
  return { type: 'text', text: `[${text}]` };
}

function truncate(text) {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[… recortado]` : text;
}
