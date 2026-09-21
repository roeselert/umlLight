// Thin GitHub REST client. Runs entirely in the browser — api.github.com sends
// permissive CORS headers — and only ever sends the token to the configured API
// base (github.com or a GitHub Enterprise host).
//
// Every call takes an explicit *target* (repository coordinates), so projects
// can live in different repositories, none of which has to be the repository
// the app itself is served from.

import { getSettings, getGitToken, DEFAULT_GIT_API } from './store.js';

export class GitError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitError';
    this.status = status;
    this.body = body;
  }
}

/** Repository coordinates from the global settings. */
export function defaultTarget() {
  const s = getSettings();
  return {
    api: (s.gitApiBase || DEFAULT_GIT_API).trim().replace(/\/+$/, ''),
    owner: (s.gitOwner || '').trim(),
    repo: (s.gitRepo || '').trim(),
    branch: (s.gitBranch || '').trim(),
    path: (s.gitPath || '').trim().replace(/^\/+|\/+$/g, ''),
    author: (s.gitAuthorName || '').trim(),
    email: (s.gitAuthorEmail || '').trim(),
  };
}

export function normalizeTarget(t = {}) {
  const d = defaultTarget();
  const merged = { ...d, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
  merged.api = String(merged.api || DEFAULT_GIT_API).trim().replace(/\/+$/, '');
  merged.path = String(merged.path || '').replace(/^\/+|\/+$/g, '');
  return merged;
}

export const targetLabel = (t) => `${t.owner}/${t.repo}`;

/** "owner/repo" string <-> target fields. */
export function parseRepoFull(text) {
  const [owner = '', repo = ''] = String(text || '').trim().replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').split('/');
  return { owner: owner.trim(), repo: repo.trim() };
}

export function isConfigured(t = defaultTarget()) {
  return !!(getSettings().gitEnabled && getGitToken() && t.owner && t.repo);
}

/** True when the target is the repository this app is served from. */
export function isSelfRepo(t) {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return false;
  const owner = host.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
  return t.owner.toLowerCase() === owner.toLowerCase() && t.repo.toLowerCase() === seg.toLowerCase();
}

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

async function request(t, path, { method = 'GET', body, signal } = {}) {
  const token = getGitToken();
  if (!token) throw new GitError('Kein GitHub-Token hinterlegt (Einstellungen → Daten-Repository).', 0);
  const url = path.startsWith('http') ? path : `${t.api}${path}`;
  const res = await fetch(url, {
    method,
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) throw new GitError(describe(res.status, json, path), res.status, json);
  return json;
}

const base = (t) => `/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`;
const encodePath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

// ---------- encoding helpers ----------
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

// ---------- repository ----------
export const getRepo = (t) => request(t, base(t));

export async function listBranches(t) {
  const list = await request(t, `${base(t)}/branches?per_page=100`);
  return (list || []).map((b) => b.name);
}

/** Repositories the token can see — used to pick a data repository. */
export async function listMyRepos(t = defaultTarget()) {
  const list = await request(t, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return (list || []).map((r) => ({ full: r.full_name, push: r.permissions?.push !== false, private: r.private }));
}

export async function defaultBranch(t) {
  if (t.branch) return t.branch;
  const repo = await getRepo(t);
  return repo.default_branch;
}

// ---------- reading ----------
export async function getFile(t, path, ref) {
  try {
    const data = await request(t, `${base(t)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    if (data.content) return { text: fromBase64(data.content), sha: data.sha };
    const blob = await request(t, `${base(t)}/git/blobs/${data.sha}`); // >1 MB files come without content
    return { text: fromBase64(blob.content), sha: data.sha };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function statFile(t, path, ref) {
  try {
    const data = await request(t, `${base(t)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return { sha: data.sha, size: data.size };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function listDir(t, path, ref) {
  try {
    const data = await request(t, `${base(t)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export function listCommits(t, path, ref, perPage = 20) {
  const q = new URLSearchParams({ path, sha: ref, per_page: String(perPage) });
  return request(t, `${base(t)}/commits?${q}`);
}

export async function getFileAtCommit(t, path, sha) {
  const found = await getFile(t, path, sha);
  return found ? found.text : null;
}

// ---------- writing (git data API: one atomic commit for many files) ----------
export const getRef = (t, branch) => request(t, `${base(t)}/git/ref/heads/${encodePath(branch)}`);
export const getCommit = (t, sha) => request(t, `${base(t)}/git/commits/${sha}`);

export const createBlob = (t, text) =>
  request(t, `${base(t)}/git/blobs`, { method: 'POST', body: { content: toBase64(text), encoding: 'base64' } });

export const createTree = (t, baseTree, tree) =>
  request(t, `${base(t)}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree } });

export function createCommit(t, message, treeSha, parents) {
  const body = { message, tree: treeSha, parents };
  if (t.author && t.email) body.author = { name: t.author, email: t.email, date: new Date().toISOString() };
  return request(t, `${base(t)}/git/commits`, { method: 'POST', body });
}

export const updateRef = (t, branch, sha, force = false) =>
  request(t, `${base(t)}/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: { sha, force } });

export const createRef = (t, branch, sha) =>
  request(t, `${base(t)}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } });

export const createPullRequest = (t, head, baseBranch, title, body) =>
  request(t, `${base(t)}/pulls`, { method: 'POST', body: { head, base: baseBranch, title, body } });

/**
 * Commit a set of files in one commit.
 * @param {{path: string, content: string|null}[]} files  content null deletes the file
 */
export async function commitFiles(t, { branch, message, files, expectedHead }) {
  const ref = await getRef(t, branch);
  const headSha = ref.object.sha;
  if (expectedHead && expectedHead !== headSha) {
    throw new GitError('Der Branch wurde zwischenzeitlich geändert.', 409, { head: headSha });
  }
  const headCommit = await getCommit(t, headSha);

  const blobs = {};
  const tree = [];
  for (const f of files) {
    if (f.content === null) {
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
    } else {
      const blob = await createBlob(t, f.content);
      blobs[f.path] = blob.sha;
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  const newTree = await createTree(t, headCommit.tree.sha, tree);
  const commit = await createCommit(t, message, newTree.sha, [headSha]);
  await updateRef(t, branch, commit.sha);
  return { commit, blobs };
}

/** Same commit, but on a fresh branch (for the pull-request flow). */
export async function commitOnNewBranch(t, { baseBranch, newBranch, message, files }) {
  const ref = await getRef(t, baseBranch);
  await createRef(t, newBranch, ref.object.sha);
  return commitFiles(t, { branch: newBranch, message, files });
}
