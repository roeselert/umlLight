// Project <-> repository synchronisation on top of the GitHub client.
// One JSON file per project, in whichever repository the project points at —
// the global settings only provide the default target. Conflicts are detected
// per project via the blob sha seen at the last sync, never merged silently.

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
  .replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
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

/** Stored link, with migration from the older { repo: "owner/name" } shape. */
export function linkOf(project) {
  const raw = store.getGitState(project.id);
  if (!raw) return null;
  if (!raw.owner && typeof raw.repo === 'string' && raw.repo.includes('/')) {
    const { owner, repo } = gh.parseRepoFull(raw.repo);
    return { ...raw, owner, repo };
  }
  return raw;
}

/** Repository coordinates for a project: its own link, else the defaults. */
export function targetFor(project) {
  const state = linkOf(project);
  return gh.normalizeTarget(state
    ? { owner: state.owner, repo: state.repo, branch: state.branch, api: state.api, path: state.path }
    : {});
}

export function defaultPath(project, target = gh.defaultTarget()) {
  const file = `${slug(project.name)}.json`;
  return target.path ? `${target.path}/${file}` : file;
}

const fileContent = (project) => store.exportProject(project.id);

function parseProjectFile(text) {
  const data = JSON.parse(text);
  const p = data.project || (data.projects ? data.projects[0] : data);
  if (!p || !p.name) throw new Error('Datei enthält kein umlLight-Projekt.');
  return p;
}

async function branchOf(target, state) {
  return state?.branch || target.branch || (await gh.defaultBranch(target));
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
  const target = targetFor(project);
  const hash = await fingerprint(project);
  const localChanged = hash !== state.syncedHash;
  const branch = await branchOf(target, state);
  const remote = await gh.statFile(target, state.path, branch);
  if (!remote) return { status: STATUS.REMOTE_MISSING, state, target, localChanged, remoteChanged: true };
  const remoteChanged = remote.sha !== state.blobSha;
  let s = STATUS.SYNCED;
  if (localChanged && remoteChanged) s = STATUS.DIVERGED;
  else if (localChanged) s = STATUS.LOCAL;
  else if (remoteChanged) s = STATUS.REMOTE;
  return { status: s, state, target, localChanged, remoteChanged, remoteSha: remote.sha };
}

/** Point a project at a repository/path without transferring anything yet. */
export async function link(project, overrides = {}) {
  const target = gh.normalizeTarget(overrides);
  const branch = overrides.branch || target.branch || (await gh.defaultBranch(target));
  return store.setGitState(project.id, {
    owner: target.owner,
    repo: target.repo,
    api: target.api,
    branch,
    path: overrides.path || defaultPath(project, target),
    blobSha: null,
    commitSha: null,
    syncedHash: null,
    syncedAt: null,
    lastPr: null,
  });
}

export const unlink = (project) => store.clearGitState(project.id);

/** Move a project to a different repository/branch/path (next push creates it). */
export const retarget = (project, overrides) => link(project, overrides);

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
  if (!state) state = await link(project, {});
  const target = targetFor(project);
  const branch = await branchOf(target, state);
  const path = state.path;

  if (!opts.force) {
    const remote = await gh.statFile(target, path, branch);
    if (remote && state.blobSha && remote.sha !== state.blobSha) {
      const err = new Error('Die Datei im Repository wurde seit der letzten Synchronisation geändert.');
      err.code = 'diverged';
      throw err;
    }
    if (remote && !state.blobSha) {
      const err = new Error('Unter diesem Pfad existiert bereits eine Datei im Repository.');
      err.code = 'exists';
      throw err;
    }
  }

  const { commit, blobs } = await gh.commitFiles(target, {
    branch,
    message: opts.message || commitMessage(project, state.blobSha ? 'aktualisiert' : 'hinzugefügt'),
    files: [{ path, content: fileContent(project) }],
  });
  store.setGitState(project.id, {
    owner: target.owner,
    repo: target.repo,
    api: target.api,
    branch,
    path,
    blobSha: blobs[path],
    commitSha: commit.sha,
    syncedHash: await fingerprint(project),
    syncedAt: new Date().toISOString(),
  });
  return commit;
}

/** Replace the local project with the version on the branch. */
export async function pull(project) {
  const state = linkOf(project);
  if (!state) throw new Error('Projekt ist nicht mit einem Repository verknüpft.');
  const target = targetFor(project);
  const branch = await branchOf(target, state);
  const file = await gh.getFile(target, state.path, branch);
  if (!file) throw new Error(`Datei nicht gefunden: ${state.path}`);
  const updated = store.replaceProject(project.id, parseProjectFile(file.text));
  store.setGitState(project.id, {
    branch,
    blobSha: file.sha,
    syncedHash: await fingerprint(updated),
    syncedAt: new Date().toISOString(),
  });
  return updated;
}

/** Push to a new branch and open a pull request against the tracked branch. */
export async function pushAsPullRequest(project, opts = {}) {
  store.flush();
  let state = linkOf(project);
  if (!state) state = await link(project, {});
  const target = targetFor(project);
  const baseBranch = await branchOf(target, state);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const newBranch = opts.branch || `umllight/${slug(project.name)}-${stamp}`;
  const message = opts.message || commitMessage(project);
  const { commit } = await gh.commitOnNewBranch(target, {
    baseBranch,
    newBranch,
    message,
    files: [{ path: state.path, content: fileContent(project) }],
  });
  const pr = await gh.createPullRequest(
    target,
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
  const target = targetFor(project);
  const branch = await branchOf(target, state);
  const commits = await gh.listCommits(target, state.path, branch, limit);
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
  if (!state) throw new Error('Projekt ist nicht mit einem Repository verknüpft.');
  const text = await gh.getFileAtCommit(targetFor(project), state.path, commitSha);
  if (!text) throw new Error('In diesem Commit existiert die Datei nicht.');
  const updated = store.replaceProject(project.id, parseProjectFile(text));
  store.setGitState(project.id, { syncedHash: null }); // differs from the branch head on purpose
  return updated;
}

/** JSON files in a repository directory, flagged when already linked locally. */
export async function listRemoteProjects(overrides = {}) {
  const target = gh.normalizeTarget(overrides);
  const branch = target.branch || (await gh.defaultBranch(target));
  const entries = await gh.listDir(target, target.path, branch);
  const linked = new Set(Object.values(store.allGitStates())
    .filter(Boolean)
    .map((s) => `${s.owner || ''}/${s.repo || ''}:${s.path}`));
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.json'))
    .map((e) => ({
      name: e.name.replace(/\.json$/, ''),
      path: e.path,
      sha: e.sha,
      target,
      branch,
      linked: linked.has(`${target.owner}/${target.repo}:${e.path}`),
    }));
}

export async function importRemote(entry) {
  const target = entry.target || gh.defaultTarget();
  const branch = entry.branch || target.branch || (await gh.defaultBranch(target));
  const file = await gh.getFile(target, entry.path, branch);
  if (!file) throw new Error(`Datei nicht gefunden: ${entry.path}`);
  const added = store.addProject(parseProjectFile(file.text));
  store.setGitState(added.id, {
    owner: target.owner,
    repo: target.repo,
    api: target.api,
    branch,
    path: entry.path,
    blobSha: file.sha,
    syncedHash: await fingerprint(added),
    syncedAt: new Date().toISOString(),
  });
  return added;
}
