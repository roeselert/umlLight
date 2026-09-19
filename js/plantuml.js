// PlantUML text -> server URL.
// Preferred: raw deflate (CompressionStream) + PlantUML's custom base64 alphabet.
// Fallback:  hex encoding with the "~h" prefix, which every PlantUML server understands.

import { getSettings } from './store.js';

function encode6bit(b) {
  if (b < 10) return String.fromCharCode(48 + b);
  b -= 10;
  if (b < 26) return String.fromCharCode(65 + b);
  b -= 26;
  if (b < 26) return String.fromCharCode(97 + b);
  b -= 26;
  if (b === 0) return '-';
  if (b === 1) return '_';
  return '?';
}

function append3bytes(b1, b2, b3) {
  return encode6bit((b1 >> 2) & 0x3f)
    + encode6bit((((b1 & 0x3) << 4) | ((b2 >> 4) & 0xf)) & 0x3f)
    + encode6bit((((b2 & 0xf) << 2) | ((b3 >> 6) & 0x3)) & 0x3f)
    + encode6bit(b3 & 0x3f);
}

function encode64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    if (i + 2 === bytes.length) out += append3bytes(bytes[i], bytes[i + 1], 0);
    else if (i + 1 === bytes.length) out += append3bytes(bytes[i], 0, 0);
    else out += append3bytes(bytes[i], bytes[i + 1], bytes[i + 2]);
  }
  return out;
}

function hexEncode(bytes) {
  let out = '~h';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Encode PlantUML source for use in a server URL path. */
export async function encodeSource(text) {
  const bytes = new TextEncoder().encode(text);
  const deflated = await deflate(bytes);
  return deflated ? encode64(deflated) : hexEncode(bytes);
}

export function serverBase() {
  const raw = (getSettings().server || '').trim().replace(/\/+$/, '');
  return raw || 'https://www.plantuml.com/plantuml';
}

/** Full URL for a diagram. format: svg | png | txt | pdf */
export async function diagramUrl(text, format = 'svg') {
  return `${serverBase()}/${format}/${await encodeSource(text)}`;
}

/** Editor deep link (plantuml.com style servers only). */
export async function editUrl(text) {
  return `${serverBase()}/uml/${await encodeSource(text)}`;
}

/** Fetch the rendered diagram as a Blob (may fail on servers without CORS headers). */
export async function fetchDiagram(text, format = 'svg') {
  const res = await fetch(await diagramUrl(text, format));
  if (!res.ok) throw new Error(`Server antwortete mit ${res.status}`);
  return res.blob();
}
