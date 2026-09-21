// Project <-> repository synchronisation on top of the GitHub client.
// One JSON file per project; conflicts are detected per project via the blob
// sha we saw at the last sync, never merged silently.

import * as store from './store.js';
import * as gh from './github.js';

export const STATUS = {
  UNLINKED: 'unlinked',
  SYNCED: 'synced',
  LOCAL: 'local',
  REMOTE: 'remote',
  DIVERGED: 'diverged',
  REMOTE_MISSING: 'remote-missing',
};

export const STATUS_LABEL = {
  [STATUS.UNLINKED]: 'nicht verknüpft',
  [STATUS.SYNCED]: 'synchron',
  [STATUS.LOCAL]: 'lokal geändert',
  [STATUS.REMOTE]: 'entfernt geändert',
  [STATUS.DIVERGED]: 'divergiert',
  [STATUS.REMOTE_MISSING]: 'im Repository entfernt',
};

export const slug = (name) => String(name || 'projekt')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue').replace(/ß/g, 'ss')
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64) || 'projekt';

/** Content hash of a project, ignoring the volatile updatedAt field. */
export async function fingerprint(project) {
  const src = store.projectFingerprintSource(project);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const linkOf = (project) => store.getGitState(project.id);

export function defaultPath(project) {
  const c = gh.config();
  const file = `${slug(project.name)}.json`;
  return c.path ? `${c.path}/${file}` : file;
}

const fileContent = (project) => store.exportProject(project.id);

function parseProjectFile(text) {
  const data = JSON.parse(text);
  const p = data.project || (data.projects ? data.projects[0] : data);
  if (!p || !p.name) throw new Error('Datei enthält kein umlLight-Projekt.');
  return p;
}

async function branchOf(state) {
  return state?.branch || gh.config().branch || (await gh.defaultBranch());
}

/** Local-only status — no network. */
export async function quickStatus(project) {
  const state = linkOf(project);
  if (!state) return { status: STATUS.UNLINKED, state: null };
  const hash = await fingerprint(project);
  return {
    status: hash === state.syncedHash ? STATUS.SYNCED : STATUS.LOCAL,
    state,
    localChanged: hash !== state.syncedHash,
  };
}

/** Full status including the remote blob sha. */
export async function status(project) {
  const state = linkOf(project);
  if (!state) return { status: STATUS.UNLINKED, state: null };
  const hash = await fingerprint(project);
  const localChanged = hash !== state.syncedHash;
  const branch = await branchOf(state);
  const remote = await gh.statFile(state.path, branch);
  if (!remote) {
    return { status: STATUS.REMOTE_MISSING, state, localChanged, remoteChanged: true };
  }
  const remoteChanged = remote.sha !== state.blobSha;
  let s = STATUS.SYNCED;
  if (localChanged && remoteChanged) s = STATUS.DIVERGED;
  else if (localChanged) s = STATUS.LOCAL;
  else if (remoteChanged) s = STATUS.REMOTE;
  return { status: s, state, localChanged, remoteChanged, remoteSha: remote.sha };
}

/** Link a project to a repository path without transferring anything yet. */
export async function link(project, { path, branch } = {}) {
  const b = branch || gh.config().branch || (await gh.defaultBranch());
  return store.setGitState(project.id, {
    repo: gh.repoKey(),
    branch: b,
    path: path || defaultPath(project),
    blobSha: null,
    commitSha: null,
    syncedHash: null,
    syncedAt: null,
  });
}

export const unlink = (project) => store.clearGitState(project.id);

export function commitMessage(project, verb = 'aktualisiert') {
  return `umlLight: ${project.name} ${verb}`;
}

/**
 * Commit the project file to the tracked branch.
 * @param {{message?: string, force?: boolean}} opts force skips the remote-change guard
 */
export async function push(project, opts = {}) {
  store.flush();
  let state = linkOf(project);
  if (!state) state = await link(project);
  const branch = await branchOf(state);
  const path = state.path;

  if (!opts.force) {
    const remote = await gh.statFile(path, branch);
    const exists = !!remote;
    if (exists && state.blobSha && remote.sha !== state.blobSha) {
      const err = new Error('Die Datei im Repository wurde seit der letzten Synchronisation geändert.');
      err.code = 'diverged';
      throw err;
    }
    if (exists && !state.blobSha) {
      const err = new Error('Unter diesem Pfad existiert bereits eine Datei im Repository.');
      err.code = 'exists';
      throw err;
    }
  }

  const content = fileContent(project);
  const { commit, blobs } = await gh.commitFiles({
    branch,
    message: opts.message || commitMessage(project, state.blobSha ? 'aktualisiert' : 'hinzugefügt'),
    files: [{ path, content }],
  });
  const hash = await fingerprint(project);
  store.setGitState(project.id, {
    repo: gh.repoKey(),
    branch,
    path,
    blobSha: blobs[path],
    commitSha: commit.sha,
    syncedHash: hash,
    syncedAt: new Date().toISOString(),
  });
  return commit;
}

/** Replace the local project with the version on the branch. */
export async function pull(project) {
  const state = linkOf(project);
  if (!state) throw new Error('Projekt ist nicht mit dem Repository verknüpft.');
  const branch = await branchOf(state);
  const file = await gh.getFile(state.path, branch);
  if (!file) throw new Error(`Datei nicht gefunden: ${state.path}`);
  const incoming = parseProjectFile(file.text);
  const updated = store.replaceProject(project.id, incoming);
  const hash = await fingerprint(updated);
  store.setGitState(project.id, {
    repo: gh.repoKey(),
    branch,
    blobSha: file.sha,
    syncedHash: hash,
    syncedAt: new Date().toISOString(),
  });
  return updated;
}

/** Push to a new branch and open a pull request against the tracked branch. */
export async function pushAsPullRequest(project, opts = {}) {
  store.flush();
  let state = linkOf(project);
  if (!state) state = await link(project);
  const baseBranch = await branchOf(state);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const newBranch = opts.branch || `umllight/${slug(project.name)}-${stamp}`;
  const message = opts.message || commitMessage(project);
  const { commit } = await gh.commitOnNewBranch({
    baseBranch,
    newBranch,
    message,
    files: [{ path: state.path, content: fileContent(project) }],
  });
  const pr = await gh.createPullRequest(
    newBranch,
    baseBranch,
    opts.title || message,
    opts.body || `Automatisch erzeugt von umlLight.\n\nProjekt: **${project.name}**\nDatei: \`${state.path}\``,
  );
  store.setGitState(project.id, { lastPr: { number: pr.number, url: pr.html_url, branch: newBranch } });
  return { pr, commit, branch: newBranch };
}

export async function history(project, limit = 20) {
  const state = linkOf(project);
  if (!state) return [];
  const branch = await branchOf(state);
  const commits = await gh.listCommits(state.path, branch, limit);
  return (commits || []).map((c) => ({
    sha: c.sha,
    message: (c.commit?.message || '').split('\n')[0],
    date: c.commit?.author?.date || c.commit?.committer?.date,
    author: c.author?.login || c.commit?.author?.name || 'unbekannt',
    url: c.html_url,
  }));
}

/** Load the version from a commit into the local project (not pushed yet). */
export async function restore(project, commitSha) {
  const state = linkOf(project);
  if (!state) throw new Error('Projekt ist nicht mit dem Repository verknüpft.');
  const text = await gh.getFileAtCommit(state.path, commitSha);
  if (!text) throw new Error('In diesem Commit existiert die Datei nicht.');
  const updated = store.replaceProject(project.id, parseProjectFile(text));
  // The local copy now differs from the branch head on purpose.
  store.setGitState(project.id, { syncedHash: null });
  return updated;
}

/** JSON files in the configured directory that are not linked locally yet. */
export async function listRemoteProjects() {
  const c = gh.config();
  const branch = c.branch || (await gh.defaultBranch());
  const entries = await gh.listDir(c.path, branch);
  const linkedPaths = new Set(Object.values(store.allGitStates()).map((s) => s?.path).filter(Boolean));
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
    .map((e) => ({ name: e.name.replace(/\.json$/, ''), path: e.path, sha: e.sha, linked: linkedPaths.has(e.path) }));
}

export async function importRemote(entry) {
  const c = gh.config();
  const branch = c.branch || (await gh.defaultBranch());
  const file = await gh.getFile(entry.path, branch);
  if (!file) throw new Error(`Datei nicht gefunden: ${entry.path}`);
  const added = store.addProject(parseProjectFile(file.text));
  const hash = await fingerprint(added);
  store.setGitState(added.id, {
    repo: gh.repoKey(),
    branch,
    path: entry.path,
    blobSha: file.sha,
    syncedHash: hash,
    syncedAt: new Date().toISOString(),
  });
  return added;
}
