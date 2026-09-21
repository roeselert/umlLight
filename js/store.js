// Persistence layer: projects live in localStorage as one JSON document.

const KEY = 'umllight.db.v1';
const SETTINGS_KEY = 'umllight.settings.v1';
const GIT_TOKEN_KEY = 'umllight.gittoken.v1';
const GIT_STATE_KEY = 'umllight.gitstate.v1';
export const SCHEMA_VERSION = 1;

export const DEFAULT_SERVER = 'https://www.plantuml.com/plantuml';
export const DEFAULT_GIT_API = 'https://api.github.com';
export const DEFAULT_AI_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'Qwen/Qwen2.5-Coder-32B-Instruct';
export const DEFAULT_SYSTEM_PROMPT = `Du bist ein Assistent für UML-Modellierung und gibst ausschließlich PlantUML-Code zurück.

Regeln:
- Antworte mit genau einem PlantUML-Block, der mit @startuml beginnt und mit @enduml endet.
- Kein Fließtext, keine Erklärungen, keine Markdown-Codefences außerhalb des Blocks.
- Verwende die Sprache des Nutzers für Beschriftungen.
- Behalte vorhandene Elemente und Aliase bei, wenn eine bestehende Quelle mitgeliefert wird, und ändere nur das Verlangte.
- Halte die Syntax gültig und sparsam: keine erfundenen Direktiven, keine Bilder, keine !include-Anweisungen.`;

let db = null;
const listeners = new Set();

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function emptyDb() {
  return { version: SCHEMA_VERSION, projects: [] };
}

export function emptyProject(name = 'Neues Projekt') {
  const now = new Date().toISOString();
  return {
    id: uid('prj'),
    name,
    summary: '',
    createdAt: now,
    updatedAt: now,
    vision: {
      forWhom: '', who: '', problem: '', productName: '', category: '',
      keyBenefit: '', alternative: '', differentiator: '',
      statement: '', goals: [], nonGoals: [], constraints: '',
    },
    useCases: { actors: [], useCases: [], systemName: '', custom: null },
    deployment: { mode: 'model', text: '', nodes: [], links: [], custom: null },
    dataModel: { entities: [], relations: [], custom: null },
    viewModel: { views: [], links: [], activities: [], custom: null },
  };
}

/** Fill in anything a stored project is missing (forward compatible loading). */
function normalizeProject(p) {
  const base = emptyProject(p.name || 'Projekt');
  const merged = {
    ...base, ...p,
    vision: { ...base.vision, ...(p.vision || {}) },
    useCases: { ...base.useCases, ...(p.useCases || {}) },
    deployment: { ...base.deployment, ...(p.deployment || {}) },
    dataModel: { ...base.dataModel, ...(p.dataModel || {}) },
    viewModel: { ...base.viewModel, ...(p.viewModel || {}) },
  };
  merged.id = p.id || base.id;
  for (const arr of ['goals', 'nonGoals']) if (!Array.isArray(merged.vision[arr])) merged.vision[arr] = [];
  merged.useCases.actors ||= [];
  merged.useCases.useCases ||= [];
  merged.deployment.nodes ||= [];
  merged.deployment.links ||= [];
  merged.dataModel.entities ||= [];
  merged.dataModel.relations ||= [];
  merged.viewModel.views ||= [];
  merged.viewModel.links ||= [];
  merged.viewModel.activities ||= [];
  return merged;
}

export function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    db = raw ? JSON.parse(raw) : emptyDb();
  } catch {
    db = emptyDb();
  }
  if (!db || typeof db !== 'object' || !Array.isArray(db.projects)) db = emptyDb();
  db.projects = db.projects.map(normalizeProject);
  db.version = SCHEMA_VERSION;
  return db;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    console.error(err);
    return false;
  }
  listeners.forEach((fn) => fn(db));
  return true;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const projects = () => load().projects;

export const getProject = (id) => projects().find((p) => p.id === id) || null;

export function createProject(name) {
  const p = emptyProject(name);
  load().projects.push(p);
  save();
  return p;
}

export function addProject(project) {
  const p = normalizeProject(project);
  if (projects().some((x) => x.id === p.id)) p.id = uid('prj');
  load().projects.push(p);
  save();
  return p;
}

export function deleteProject(id) {
  const d = load();
  d.projects = d.projects.filter((p) => p.id !== id);
  save();
}

export function duplicateProject(id) {
  const src = getProject(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid('prj');
  copy.name = `${src.name} (Kopie)`;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  load().projects.push(copy);
  save();
  return copy;
}

/** Mutate a project and persist immediately. */
export function update(projectId, mutator) {
  const p = getProject(projectId);
  if (!p) return null;
  mutator(p);
  p.updatedAt = new Date().toISOString();
  save();
  return p;
}

let pendingSave = null;
/**
 * Mutate a project right away but batch the localStorage write. Used while
 * typing, so the in-memory model (and therefore every generated diagram) is
 * always current even if persistence lags a moment behind.
 */
export function updateSoon(projectId, mutator, delay = 400) {
  const p = getProject(projectId);
  if (!p) return null;
  mutator(p);
  p.updatedAt = new Date().toISOString();
  clearTimeout(pendingSave);
  pendingSave = setTimeout(() => { pendingSave = null; save(); }, delay);
  return p;
}

/** Flush a pending debounced write (e.g. before export or page hide). */
export function flush() {
  if (pendingSave) { clearTimeout(pendingSave); pendingSave = null; save(); }
}

/** Overwrite a project's content in place, keeping its local id. */
export function replaceProject(id, data) {
  const d = load();
  const idx = d.projects.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next = normalizeProject({ ...data, id });
  d.projects[idx] = next;
  save();
  return next;
}

export function exportProject(id) {
  const p = getProject(id);
  if (!p) return null;
  return JSON.stringify({ type: 'umllight.project', version: SCHEMA_VERSION, project: p }, null, 2);
}

export function exportAll() {
  return JSON.stringify({ type: 'umllight.backup', version: SCHEMA_VERSION, projects: projects() }, null, 2);
}

/** Accepts a single project export, a full backup, or a bare project object. */
export function importJson(text) {
  const data = JSON.parse(text);
  const list = data.projects || (data.project ? [data.project] : (data.name ? [data] : null));
  if (!list) throw new Error('Unbekanntes Dateiformat');
  return list.map((p) => addProject(p));
}

// ---------- settings ----------
const defaultSettings = {
  server: DEFAULT_SERVER,
  format: 'svg',
  autoRender: true,
  theme: 'auto',
  // --- AI assistant (Hugging Face Inference API, OpenAI-compatible route)
  aiEnabled: true,
  aiEndpoint: DEFAULT_AI_ENDPOINT,
  aiModel: DEFAULT_AI_MODEL,
  aiToken: '',
  aiSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  aiTemperature: 0.2,
  aiMaxTokens: 1200,
  aiSendContext: true,
  // --- GitHub synchronisation
  gitEnabled: true,
  gitApiBase: DEFAULT_GIT_API,
  gitOwner: '',
  gitRepo: '',
  gitBranch: '',
  gitPath: 'umllight',
  gitTokenScope: 'local',
  gitAuthorName: '',
  gitAuthorEmail: '',
};

export function getSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaultSettings };
  }
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ---------- GitHub token ----------
// Kept out of the settings blob so it can live in sessionStorage when the
// user does not want it to survive the tab.
export function getGitToken() {
  try {
    return sessionStorage.getItem(GIT_TOKEN_KEY) || localStorage.getItem(GIT_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setGitToken(token, scope = 'local') {
  try {
    sessionStorage.removeItem(GIT_TOKEN_KEY);
    localStorage.removeItem(GIT_TOKEN_KEY);
    if (token) (scope === 'session' ? sessionStorage : localStorage).setItem(GIT_TOKEN_KEY, token);
  } catch { /* storage blocked */ }
}

// ---------- per-project sync state ----------
// { [projectId]: { repo, branch, path, blobSha, commitSha, syncedHash, syncedAt } }
export function allGitStates() {
  try {
    return JSON.parse(localStorage.getItem(GIT_STATE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export const getGitState = (projectId) => allGitStates()[projectId] || null;

export function setGitState(projectId, patch) {
  const all = allGitStates();
  all[projectId] = patch === null ? undefined : { ...(all[projectId] || {}), ...patch };
  if (patch === null) delete all[projectId];
  localStorage.setItem(GIT_STATE_KEY, JSON.stringify(all));
  return all[projectId] || null;
}

export const clearGitState = (projectId) => setGitState(projectId, null);

/** Stable JSON of a project for change detection (volatile fields removed). */
export function projectFingerprintSource(project) {
  const copy = JSON.parse(JSON.stringify(project));
  delete copy.updatedAt;
  return JSON.stringify(copy);
}
