// Project list: create, import, export, duplicate, delete.

import { h, clear, toast, confirmDialog, promptDialog, download, pickFile } from '../ui.js';
import { openExportDialog } from '../export.js';
import * as gh from '../github.js';
import * as sync from '../gitsync.js';
import { openGitDialog, openImportDialog, statusChip } from '../gitpanel.js';
import * as store from '../store.js';

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ''; }
};

function counts(p) {
  return [
    `${(p.useCases.useCases || []).length} UC`,
    `${(p.dataModel.entities || []).length} Entitäten`,
    `${(p.deployment.nodes || []).length} Knoten`,
    `${(p.robustness.boundaries || []).length} Boundaries`,
  ].join(' · ');
}

/** Local-only sync state — the list must not fire network requests per row. */
function gitChip(project) {
  const holder = h('span', {});
  sync.quickStatus(project)
    .then(({ status }) => holder.appendChild(statusChip(status)))
    .catch(() => {});
  return holder;
}

export function renderProjects(main, ctx) {
  clear(main);
  main.classList.add('main-narrow');
  const list = store.projects();

  const newProject = async () => {
    const name = await promptDialog('Neues Projekt', 'Projektname', '', 'Anlegen');
    if (!name) return;
    const p = store.createProject(name);
    ctx.navigate(`#/p/${p.id}/vision`);
  };

  const importProject = async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      const added = store.importJson(await file.text());
      toast(`${added.length} Projekt(e) importiert`);
      ctx.rerender();
    } catch (err) {
      toast(`Import fehlgeschlagen: ${err.message}`, 'err');
    }
  };

  const gitReady = gh.isConfigured();

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'Projekte'),
      h('p', { class: 'hint' }, 'Jedes Projekt beschreibt eine Anwendung: Vision, Use Cases, Deployment, Datenmodell und View-Modell. Alles wird lokal im Browser gespeichert.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: importProject }, 'Importieren'),
      gitReady ? h('button', { class: 'btn', onclick: () => openImportDialog(() => ctx.rerender()) }, 'Aus Repository') : null,
      list.length ? h('button', { class: 'btn', onclick: () => openExportDialog(list) }, 'Markdown') : null,
      list.length ? h('button', { class: 'btn', onclick: () => { store.flush(); download('umllight-backup.json', store.exportAll()); } }, 'Backup') : null,
      h('button', { class: 'btn primary', onclick: newProject }, '+ Neues Projekt'))));

  if (!list.length) {
    main.appendChild(h('div', { class: 'empty' },
      h('p', {}, 'Noch keine Projekte.'),
      h('button', { class: 'btn primary', onclick: newProject }, 'Erstes Projekt anlegen')));
    return;
  }

  const grid = h('div', {});
  for (const p of [...list].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
    grid.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, h('a', { href: `#/p/${p.id}/vision` }, p.name)),
        gitReady ? gitChip(p) : null,
        h('span', { class: 'chip' }, `geändert ${fmtDate(p.updatedAt)}`)),
      p.summary ? h('p', { class: 'hint', style: { marginBottom: '8px' } }, p.summary) : null,
      h('p', { class: 'hint' }, counts(p)),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn small', href: `#/p/${p.id}/vision` }, 'Öffnen'),
        gitReady ? h('button', { class: 'btn small', onclick: () => openGitDialog(p, () => ctx.rerender()) }, 'Sync') : null,
        h('button', { class: 'btn small', onclick: () => openExportDialog(p) }, 'Markdown'),
        h('button', { class: 'btn small', onclick: () => { store.flush(); download(`${p.name.replace(/[^\w.-]+/g, '_')}.json`, store.exportProject(p.id)); } }, 'JSON'),
        h('button', { class: 'btn small', onclick: () => { store.duplicateProject(p.id); ctx.rerender(); } }, 'Duplizieren'),
        h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (await confirmDialog('Projekt löschen?', `„${p.name}" wird dauerhaft entfernt. Vorher exportieren?`)) {
              store.deleteProject(p.id);
              toast('Projekt gelöscht');
              ctx.rerender();
            }
          },
        }, 'Löschen'))));
  }
  main.appendChild(grid);
}
