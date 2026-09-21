// Thin GitHub REST client. Runs entirely in the browser — api.github.com sends
// permissive CORS headers — and only ever sends the token to the configured
// API base (github.com or a GitHub Enterprise host).

import { getSettings, getGitToken, DEFAULT_GIT_API } from './store.js';

export class GitError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitError';
    this.status = status;
    this.body = body;
  }
}

export function config() {
  const s = getSettings();
  return {
    api: (s.gitApiBase || DEFAULT_GIT_API).trim().replace(/\/+$/, ''),
    owner: (s.gitOwner || '').trim(),
    repo: (s.gitRepo || '').trim(),
    branch: (s.gitBranch || '').trim(),
    path: (s.gitPath || '').trim().replace(/^\/+|\/+$/g, ''),
    author: (s.gitAuthorName || '').trim(),
    email: (s.gitAuthorEmail || '').trim(),
    token: getGitToken(),
  };
}

export const isConfigured = () => {
  const c = config();
  return !!(getSettings().gitEnabled && c.token && c.owner && c.repo);
};

export const repoKey = () => {
  const c = config();
  return `${c.owner}/${c.repo}`;
};

function describe(status, body, path) {
  const msg = body?.message || '';
  if (status === 401) return 'Token ungültig oder abgelaufen — in den Einstellungen erneuern.';
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub-Rate-Limit erreicht. Später erneut versuchen.';
  if (status === 403) return `Keine Berechtigung für diese Aktion (${msg || path}). Token-Rechte prüfen: Contents read/write, für PRs zusätzlich Pull requests: write.`;
  if (status === 404) return `Nicht gefunden: ${path}. Repository, Branch, Pfad und Token-Zugriff prüfen.`;
  if (status === 409) return 'Konflikt — der Branch wurde zwischenzeitlich geändert.';
  if (status === 422) return `Anfrage abgelehnt: ${msg || 'unverarbeitbare Daten'}.`;
  return `GitHub-Fehler ${status}${msg ? `: ${msg}` : ''}`;
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const c = config();
  if (!c.token) throw new GitError('Kein GitHub-Token hinterlegt (Einstellungen → GitHub).', 0);
  const url = path.startsWith('http') ? path : `${c.api}${path}`;
  const res = await fetch(url, {
    method,
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${c.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) throw new GitError(describe(res.status, json, path), res.status, json);
  return json;
}

const base = () => {
  const c = config();
  return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
};

// ---------- encoding helpers ----------
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------- repository ----------
export const getRepo = () => request(base());

export async function listBranches() {
  const list = await request(`${base()}/branches?per_page=100`);
  return (list || []).map((b) => b.name);
}

export async function defaultBranch() {
  const c = config();
  if (c.branch) return c.branch;
  const repo = await getRepo();
  return repo.default_branch;
}

// ---------- reading ----------
/** @returns {Promise<{text: string, sha: string}|null>} null when absent */
export async function getFile(path, ref) {
  try {
    const data = await request(`${base()}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    if (data.content) return { text: fromBase64(data.content), sha: data.sha };
    // Files above 1 MB come back without content — fetch the blob instead.
    const blob = await request(`${base()}/git/blobs/${data.sha}`);
    return { text: fromBase64(blob.content), sha: data.sha };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Metadata only (cheap existence + sha check). */
export async function statFile(path, ref) {
  try {
    const data = await request(`${base()}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return { sha: data.sha, size: data.size };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function listDir(path, ref) {
  try {
    const data = await request(`${base()}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export function listCommits(path, ref, perPage = 20) {
  const q = new URLSearchParams({ path, sha: ref, per_page: String(perPage) });
  return request(`${base()}/commits?${q}`);
}

export async function getFileAtCommit(path, sha) {
  const found = await getFile(path, sha);
  return found ? found.text : null;
}

const encodePath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

// ---------- writing (git data API: one atomic commit for many files) ----------
export const getRef = (branch) => request(`${base()}/git/ref/heads/${encodePath(branch)}`);

export const getCommit = (sha) => request(`${base()}/git/commits/${sha}`);

export const createBlob = (text) =>
  request(`${base()}/git/blobs`, { method: 'POST', body: { content: toBase64(text), encoding: 'base64' } });

export const createTree = (baseTree, tree) =>
  request(`${base()}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree } });

export function createCommit(message, treeSha, parents) {
  const c = config();
  const body = { message, tree: treeSha, parents };
  if (c.author && c.email) {
    body.author = { name: c.author, email: c.email, date: new Date().toISOString() };
  }
  return request(`${base()}/git/commits`, { method: 'POST', body });
}

export const updateRef = (branch, sha, force = false) =>
  request(`${base()}/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: { sha, force } });

export const createRef = (branch, sha) =>
  request(`${base()}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } });

export const createPullRequest = (head, baseBranch, title, body) =>
  request(`${base()}/pulls`, { method: 'POST', body: { head, base: baseBranch, title, body } });

/**
 * Commit a set of files in one commit.
 * @param {{path: string, content: string|null}[]} files  content null deletes the file
 * @returns {Promise<{commit: object, blobs: Record<string,string>}>}
 */
export async function commitFiles({ branch, message, files, expectedHead }) {
  const ref = await getRef(branch);
  const headSha = ref.object.sha;
  if (expectedHead && expectedHead !== headSha) {
    throw new GitError('Der Branch wurde zwischenzeitlich geändert.', 409, { head: headSha });
  }
  const headCommit = await getCommit(headSha);

  const blobs = {};
  const tree = [];
  for (const f of files) {
    if (f.content === null) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
    } else {
      const blob = await createBlob(f.content);
      blobs[f.path] = blob.sha;
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  const newTree = await createTree(headCommit.tree.sha, tree);
  const commit = await createCommit(message, newTree.sha, [headSha]);
  await updateRef(branch, commit.sha);
  return { commit, blobs };
}

/** Same commit, but on a fresh branch (for the pull-request flow). */
export async function commitOnNewBranch({ baseBranch, newBranch, message, files }) {
  const ref = await getRef(baseBranch);
  await createRef(newBranch, ref.object.sha);
  const result = await commitFiles({ branch: newBranch, message, files });
  return result;
}
