// AI assistant backed by the Hugging Face Inference API (OpenAI-compatible
// chat-completions route). Endpoint, model, token and system prompt are all
// configurable in the settings; the token never leaves the browser except as
// the Authorization header of the configured endpoint.

import { getSettings, DEFAULT_SYSTEM_PROMPT, DEFAULT_SCHEMA_PROMPT } from './store.js';

export const isConfigured = () => {
  const s = getSettings();
  return !!(s.aiEnabled && s.aiToken && s.aiEndpoint && s.aiModel);
};

export const systemPrompt = () => (getSettings().aiSystemPrompt || DEFAULT_SYSTEM_PROMPT);
export const schemaPrompt = () => (getSettings().aiSchemaSystemPrompt || DEFAULT_SCHEMA_PROMPT);

function friendlyError(status, body) {
  const detail = String(body || '').slice(0, 300);
  if (status === 401 || status === 403) return 'Zugriff verweigert — Hugging-Face-Token prüfen (Rolle „read" genügt).';
  if (status === 404) return `Modell nicht gefunden: ${getSettings().aiModel}. Anderen Modellnamen in den Einstellungen eintragen.`;
  if (status === 429) return 'Rate-Limit erreicht — später erneut versuchen oder ein anderes Modell wählen.';
  if (status === 503) return 'Modell wird gerade geladen (503). In ein paar Sekunden erneut versuchen.';
  return `Anfrage fehlgeschlagen (HTTP ${status})${detail ? `: ${detail}` : ''}`;
}

/**
 * Send a chat completion. Streams tokens through onDelta when the server
 * supports server-sent events, otherwise falls back to the full response.
 * @returns {Promise<string>} the complete assistant message
 */
export async function complete({ messages, onDelta, signal }) {
  const s = getSettings();
  if (!s.aiToken) throw new Error('Kein Hugging-Face-Token hinterlegt (Einstellungen → KI-Assistent).');

  const res = await fetch(s.aiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.aiToken}`,
    },
    signal,
    body: JSON.stringify({
      model: s.aiModel,
      messages,
      temperature: Number(s.aiTemperature) || 0,
      max_tokens: Number(s.aiMaxTokens) || 1200,
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(friendlyError(res.status, await res.text().catch(() => '')));

  const type = res.headers.get('content-type') || '';
  if (!res.body || !type.includes('event-stream')) {
    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('Leere Antwort vom Modell.');
    if (onDelta) onDelta(text, text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta, full);
        }
      } catch {
        /* partial or keep-alive chunk — ignore */
      }
    }
  }
  if (!full.trim()) throw new Error('Leere Antwort vom Modell.');
  return full;
}

/** Pull the PlantUML block out of a model answer. */
export function extractPlantUml(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:plantuml|puml|uml)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const block = candidate.match(/@start[a-z]*[\s\S]*?@end[a-z]*/i);
  if (block) return block[0].trim();
  const any = raw.match(/@start[a-z]*[\s\S]*?@end[a-z]*/i);
  return any ? any[0].trim() : null;
}

/** Pull a fenced code block (or the raw text) out of a model answer. */
export function extractCode(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```[a-z0-9+-]*\s*\n([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  return body || null;
}

/** Compact, token-friendly description of the project for grounding. */
export function projectContext(project, section) {
  if (!project) return '';
  const L = [`Projekt: ${project.name}`];
  if (project.summary) L.push(`Kurzbeschreibung: ${project.summary}`);
  const v = project.vision || {};
  const goals = (v.goals || []).filter(Boolean);
  if (goals.length) L.push(`Ziele: ${goals.join('; ')}`);

  if (section === 'usecases' || section === 'all') {
    const actors = (project.useCases.actors || []).map((a) => a.name).filter(Boolean);
    if (actors.length) L.push(`Akteure: ${actors.join(', ')}`);
    const ucs = (project.useCases.useCases || []).map((c) => c.name).filter(Boolean);
    if (ucs.length) L.push(`Use Cases: ${ucs.join(', ')}`);
  }
  if (section === 'deployment' || section === 'all') {
    const nodes = (project.deployment.nodes || []).map((n) => `${n.name}${n.tech ? ` (${n.tech})` : ''}`);
    if (nodes.length) L.push(`Deployment-Knoten: ${nodes.join(', ')}`);
    if (project.deployment.text) L.push(`Deployment-Beschreibung: ${project.deployment.text}`);
  }
  if (section === 'datamodel' || section === 'all') {
    const ents = (project.dataModel.entities || [])
      .map((e) => `${e.name}(${(e.attributes || []).map((a) => a.name).filter(Boolean).join(', ')})`);
    if (ents.length) L.push(`Entitäten: ${ents.join(' | ')}`);
  }
  if (section === 'robustness' || section === 'all') {
    const rb = project.robustness || {};
    const comp = (id) => (rb.components || []).find((c) => c.id === id)?.name;
    const named = (list) => list.filter((x) => x.name).map((x) => (comp(x.componentId) ? `${x.name} [${comp(x.componentId)}]` : x.name));
    const comps = (rb.components || []).map((c) => c.name).filter(Boolean);
    if (comps.length) L.push(`Business-Komponenten: ${comps.join(', ')}`);
    const bnd = named(rb.boundaries || []);
    if (bnd.length) L.push(`Boundaries: ${bnd.join(', ')}`);
    const ctl = named(rb.controls || []);
    if (ctl.length) L.push(`Controls: ${ctl.join(', ')}`);
    if (section === 'robustness') {
      const ents = named(project.dataModel.entities || []);
      if (ents.length) L.push(`Entitäten: ${ents.join(', ')}`);
      const actors = (project.useCases.actors || []).map((a) => a.name).filter(Boolean);
      if (actors.length) L.push(`Akteure: ${actors.join(', ')}`);
    }
  }
  return L.join('\n');
}

/** Build the message list for a diagram or schema request. */
export function buildMessages({ instruction, currentSource, context, diagramTitle, system, sourceLabel }) {
  const parts = [];
  if (context) parts.push(`Kontext des Projekts:\n${context}`);
  if (diagramTitle) parts.push(`Artefakt: ${diagramTitle}`);
  if (currentSource) parts.push(`${sourceLabel || 'Aktuelle PlantUML-Quelle'}:\n${currentSource}`);
  parts.push(`Aufgabe:\n${instruction}`);
  return [
    { role: 'system', content: system || systemPrompt() },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
