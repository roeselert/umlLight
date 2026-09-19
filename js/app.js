// App shell: hash router, sidebar, settings, service-worker registration.

import { h, clear, field, textInput, select, modal, toast } from './ui.js';
import * as store from './store.js';
import { renderProjects } from './views/projects.js';
import { renderOverview } from './views/overview.js';
import { renderVision } from './views/vision.js';
import { renderUseCases } from './views/usecases.js';
import { renderDeployment } from './views/deployment.js';
import { renderDataModel } from './views/datamodel.js';
import { renderViewModel } from './views/viewmodel.js';

const SECTIONS = [
  ['overview', 'Übersicht', '◎'],
  ['vision', 'Produktvision', '★'],
  ['usecases', 'Use Cases', '⬡'],
  ['deployment', 'Deployment', '▤'],
  ['datamodel', 'Datenmodell', '▦'],
  ['viewmodel', 'Views & Abläufe', '▣'],
];

const RENDERERS = {
  overview: renderOverview,
  vision: renderVision,
  usecases: renderUseCases,
  deployment: renderDeployment,
  datamodel: renderDataModel,
  viewmodel: renderViewModel,
};

const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');
const topbarTitle = document.getElementById('topbarTitle');
const saveState = document.getElementById('saveState');

let saveTimer = null;
function markSaved() {
  saveState.hidden = false;
  saveState.textContent = 'gespeichert';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveState.hidden = true; }, 1400);
}

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) {
    return { route: 'project', projectId: parts[1], section: RENDERERS[parts[2]] ? parts[2] : 'overview' };
  }
  return { route: 'projects' };
}

const navigate = (hash) => { location.hash = hash; };

function renderSidebar(state) {
  clear(sidebar);
  const projects = store.projects();

  if (state.route === 'project') {
    const p = store.getProject(state.projectId);
    if (p) {
      const group = h('div', { class: 'side-group' },
        h('p', { class: 'side-label' }, 'Projekt'),
        SECTIONS.map(([key, label, ico]) => h('a', {
          class: `side-link ${state.section === key ? 'active' : ''}`,
          href: `#/p/${p.id}/${key}`,
        }, h('span', { class: 'ico' }, ico), h('span', {}, label))));
      sidebar.appendChild(group);
    }
  }

  const list = h('div', { class: 'side-group' },
    h('p', { class: 'side-label' }, 'Projekte'),
    h('a', { class: `side-link ${state.route === 'projects' ? 'active' : ''}`, href: '#/projects' },
      h('span', { class: 'ico' }, '☰'), h('span', {}, 'Alle Projekte'),
      h('span', { class: 'sub' }, String(projects.length))),
    projects.slice(0, 12).map((p) => h('a', {
      class: `side-link ${state.projectId === p.id ? 'active' : ''}`,
      href: `#/p/${p.id}/overview`,
    }, h('span', { class: 'ico' }, '▸'), h('span', {}, p.name))));
  sidebar.appendChild(list);
}

function render() {
  const state = parseHash();
  main.classList.remove('main-narrow');
  renderSidebar(state);
  sidebar.classList.remove('open');

  const ctx = {
    navigate,
    markSaved,
    rerender: render,
    refreshChrome: (name) => {
      topbarTitle.textContent = name;
      renderSidebar(parseHash());
    },
  };

  if (state.route === 'projects') {
    topbarTitle.textContent = '';
    document.title = 'umlLight — Application Spec Designer';
    renderProjects(main, ctx);
    return;
  }

  const project = store.getProject(state.projectId);
  if (!project) {
    topbarTitle.textContent = '';
    clear(main);
    main.appendChild(h('div', { class: 'empty' },
      h('p', {}, 'Projekt nicht gefunden.'),
      h('a', { class: 'btn', href: '#/projects' }, 'Zur Projektliste')));
    return;
  }

  const label = SECTIONS.find(([k]) => k === state.section)?.[1] || '';
  topbarTitle.textContent = `${project.name} · ${label}`;
  document.title = `${project.name} — umlLight`;
  ctx.project = project;
  ctx.section = state.section;
  RENDERERS[state.section](main, ctx);
  main.scrollTop = 0;
}

// ------------------------------------------------------------- settings
function openSettings() {
  modal((close) => {
    const s = store.getSettings();
    const serverInput = textInput(s.server, (val) => store.setSettings({ server: val.trim() }),
      { placeholder: store.DEFAULT_SERVER });
    return h('div', {},
      h('h2', {}, 'Einstellungen'),
      field('PlantUML-Server', serverInput,
        'Diagramme werden von diesem Server gerendert. Eigene Instanz möglich (z. B. http://localhost:8080/plantuml). Die Modelle selbst bleiben immer lokal im Browser.'),
      field('Bildformat', select(s.format, [['svg', 'SVG (scharf, skalierbar)'], ['png', 'PNG']],
        (val) => store.setSettings({ format: val }))),
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('h3', {}, 'Daten'),
        h('p', { class: 'hint' }, 'Alle Projekte liegen im localStorage dieses Browsers. Für Sicherung oder Umzug ein Backup exportieren.'),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn small',
            onclick: () => {
              const blob = store.exportAll();
              const a = h('a', { href: URL.createObjectURL(new Blob([blob], { type: 'application/json' })), download: 'umllight-backup.json' });
              document.body.appendChild(a); a.click(); a.remove();
            },
          }, 'Backup exportieren'),
          h('button', {
            class: 'btn small',
            onclick: () => { close(); navigate('#/projects'); toast('Import über „Importieren" in der Projektliste'); },
          }, 'Import öffnen'))),
      h('p', { class: 'hint', style: { marginTop: '14px' } },
        'umlLight ist eine statische PWA — Quellcode und Daten verlassen den Browser nur beim Rendern der Diagramme.'),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn primary', onclick: () => { close(); render(); } }, 'Fertig')));
  });
}

// ------------------------------------------------------------------ wire
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('navToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  sidebar.classList.toggle('open');
});
main.addEventListener('click', () => sidebar.classList.remove('open'));
window.addEventListener('hashchange', render);
window.addEventListener('online', () => toast('Wieder online — Diagramme können gerendert werden'));
window.addEventListener('pagehide', () => store.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });

if (!location.hash) location.hash = '#/projects';
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch((err) => console.warn('Service Worker nicht registriert:', err));
  });
}
