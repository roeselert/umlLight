// App shell: hash router, sidebar, settings, service-worker registration.

import { h, clear, field, textInput, select, modal, toast, download } from './ui.js';
import * as store from './store.js';
import { renderProjects } from './views/projects.js';
import { renderOverview } from './views/overview.js';
import { renderVision } from './views/vision.js';
import { renderUseCases } from './views/usecases.js';
import { renderDeployment } from './views/deployment.js';
import { renderDataModel } from './views/datamodel.js';
import { renderViewModel } from './views/viewmodel.js';

const SECTIONS = [
  ['overview', 'Übersicht', '◎', 'Übersicht'],
  ['vision', 'Produktvision', '★', 'Vision'],
  ['usecases', 'Use Cases', '⬡', 'Use Cases'],
  ['deployment', 'Deployment', '▤', 'Deploy'],
  ['datamodel', 'Datenmodell', '▦', 'Daten'],
  ['viewmodel', 'Views & Abläufe', '▣', 'Views'],
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
const tabbar = document.getElementById('tabbar');
const scrim = document.getElementById('scrim');
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

/** Bottom navigation, shown on small screens while a project is open. */
function renderTabbar(state) {
  clear(tabbar);
  if (state.route !== 'project' || !store.getProject(state.projectId)) {
    tabbar.hidden = true;
    document.body.classList.remove('has-tabbar');
    return;
  }
  tabbar.hidden = false;
  document.body.classList.add('has-tabbar');
  for (const [key, label, ico, short] of SECTIONS) {
    tabbar.appendChild(h('a', {
      class: `tab-link ${state.section === key ? 'active' : ''}`,
      href: `#/p/${state.projectId}/${key}`,
      'aria-label': label,
      'aria-current': state.section === key ? 'page' : null,
    }, h('span', { class: 'ico' }, ico), h('span', { class: 'lbl' }, short)));
  }
}

function closeDrawer() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
}

function render() {
  const state = parseHash();
  main.classList.remove('main-narrow');
  renderSidebar(state);
  renderTabbar(state);
  closeDrawer();

  const ctx = {
    navigate,
    markSaved,
    rerender: render,
    refreshChrome: (name) => {
      const pname = topbarTitle.querySelector('.pname');
      if (pname) pname.textContent = name;
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
  clear(topbarTitle);
  topbarTitle.appendChild(h('span', { class: 'pname' }, project.name));
  topbarTitle.appendChild(h('span', { class: 'psec' }, ` · ${label}`));
  document.title = `${project.name} — umlLight`;
  ctx.project = project;
  ctx.section = state.section;
  RENDERERS[state.section](main, ctx);
  main.scrollTop = 0;
}

// ------------------------------------------------------------- settings
const AI_MODEL_SUGGESTIONS = [
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'meta-llama/Llama-3.3-70B-Instruct',
  'deepseek-ai/DeepSeek-V3-0324',
  'mistralai/Mistral-Small-24B-Instruct-2501',
];

function openSettings(focus) {
  modal((close) => {
    const s = store.getSettings();
    const set = (patch) => store.setSettings(patch);

    // ---- PlantUML
    const plantumlCard = h('div', { class: 'card' },
      h('h3', {}, 'PlantUML'),
      field('Server', textInput(s.server, (val) => set({ server: val.trim() }), { placeholder: store.DEFAULT_SERVER }),
        'Diagramme werden von diesem Server gerendert — eigene Instanz möglich, z. B. http://localhost:8080. Die Modelle selbst bleiben immer lokal.'),
      field('Bildformat', select(s.format, [['svg', 'SVG (scharf, skalierbar)'], ['png', 'PNG']],
        (val) => set({ format: val }))));

    // ---- AI assistant
    const tokenInput = h('input', {
      type: 'password', value: s.aiToken || '', placeholder: 'hf_…', autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => set({ aiToken: e.target.value.trim() }),
    });
    const promptArea = h('textarea', {
      class: 'code', rows: 7, spellcheck: 'false',
      oninput: (e) => set({ aiSystemPrompt: e.target.value }),
    }, s.aiSystemPrompt || store.DEFAULT_SYSTEM_PROMPT);
    const testOut = h('div', { class: 'hint', style: { margin: '6px 0 0' } });

    const testConnection = async (btn) => {
      btn.disabled = true;
      testOut.style.color = '';
      testOut.textContent = 'Teste Verbindung …';
      try {
        const { complete, extractPlantUml } = await import('./ai.js');
        const text = await complete({
          messages: [
            { role: 'system', content: store.getSettings().aiSystemPrompt || store.DEFAULT_SYSTEM_PROMPT },
            { role: 'user', content: 'Erzeuge ein minimales Beispieldiagramm mit zwei Elementen.' },
          ],
        });
        testOut.textContent = extractPlantUml(text)
          ? 'Verbindung ok — das Modell liefert gültigen PlantUML-Code.'
          : 'Verbindung ok, aber die Antwort enthielt keinen PlantUML-Block. System-Prompt oder Modell anpassen.';
      } catch (err) {
        testOut.style.color = 'var(--danger)';
        testOut.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };

    const aiCard = h('div', { class: 'card', id: 'aiSettings' },
      h('h3', {}, 'KI-Assistent'),
      h('p', { class: 'hint' },
        'Erzeugt und ändert Diagramme über die Hugging-Face-Inference-API. Token und Einstellungen bleiben im Browser; beim Generieren werden Anweisung, Diagrammquelle und (optional) Projektkontext an den Endpunkt gesendet.'),
      h('label', { class: 'row', style: { marginBottom: '12px', gap: '8px' } },
        h('input', {
          type: 'checkbox', checked: s.aiEnabled !== false, style: { width: 'auto' },
          onchange: (e) => set({ aiEnabled: e.target.checked }),
        }),
        h('span', {}, 'KI-Assistent aktivieren')),
      field('Zugriffstoken', h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        tokenInput,
        h('button', {
          class: 'btn small',
          onclick: (e) => {
            tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
            e.target.textContent = tokenInput.type === 'password' ? 'Zeigen' : 'Verbergen';
          },
        }, 'Zeigen')),
        'Auf huggingface.co unter Settings → Access Tokens anlegen (Rolle „read"). Wird unverschlüsselt im localStorage gespeichert — auf geteilten Geräten besser leer lassen.'),
      h('datalist', { id: 'ai-models' }, AI_MODEL_SUGGESTIONS.map((m) => h('option', { value: m }))),
      field('Modell', h('input', {
        type: 'text', value: s.aiModel || '', list: 'ai-models', spellcheck: 'false',
        oninput: (e) => set({ aiModel: e.target.value.trim() }),
      }), 'Beliebiges Chat-Modell der Inference-API, optional mit Provider-Suffix (z. B. …:together).'),
      field('Endpunkt', textInput(s.aiEndpoint, (val) => set({ aiEndpoint: val.trim() }),
        { placeholder: store.DEFAULT_AI_ENDPOINT, spellcheck: 'false' }),
        'OpenAI-kompatibler Chat-Completions-Endpunkt. Funktioniert auch mit eigenen Inference-Endpoints.'),
      field('System-Prompt', promptArea,
        'Legt fest, wie das Modell antwortet. Standard erzwingt reinen PlantUML-Code.'),
      h('div', { class: 'grid-2' },
        field('Temperatur', h('input', {
          type: 'number', min: '0', max: '2', step: '0.1', value: String(s.aiTemperature ?? 0.2),
          oninput: (e) => set({ aiTemperature: Number(e.target.value) }),
        })),
        field('Max. Tokens', h('input', {
          type: 'number', min: '128', max: '8192', step: '64', value: String(s.aiMaxTokens ?? 1200),
          oninput: (e) => set({ aiMaxTokens: Number(e.target.value) }),
        }))),
      h('label', { class: 'row', style: { marginBottom: '12px', gap: '8px' } },
        h('input', {
          type: 'checkbox', checked: s.aiSendContext !== false, style: { width: 'auto' },
          onchange: (e) => set({ aiSendContext: e.target.checked }),
        }),
        h('span', {}, 'Projektkontext standardmäßig mitsenden')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', onclick: (e) => testConnection(e.target) }, 'Verbindung testen'),
        h('button', {
          class: 'btn small ghost',
          onclick: () => { promptArea.value = store.DEFAULT_SYSTEM_PROMPT; set({ aiSystemPrompt: store.DEFAULT_SYSTEM_PROMPT }); toast('System-Prompt zurückgesetzt'); },
        }, 'Prompt zurücksetzen')),
      testOut);


    // ---- GitHub
    const gitTokenInput = h('input', {
      type: 'password', value: store.getGitToken(), placeholder: 'github_pat_… / ghp_…',
      autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => store.setGitToken(e.target.value.trim(), store.getSettings().gitTokenScope),
    });
    const ownerInput = textInput(s.gitOwner, (val) => set({ gitOwner: val.trim() }), { placeholder: 'benutzer-oder-organisation', spellcheck: 'false' });
    const repoInput = textInput(s.gitRepo, (val) => set({ gitRepo: val.trim() }), { placeholder: 'repository', spellcheck: 'false' });
    const branchInput = h('input', {
      type: 'text', value: s.gitBranch || '', list: 'git-branches', placeholder: 'leer = Standard-Branch', spellcheck: 'false',
      oninput: (e) => set({ gitBranch: e.target.value.trim() }),
    });
    const branchList = h('datalist', { id: 'git-branches' });
    const gitOut = h('div', { class: 'hint', style: { margin: '6px 0 0' } });

    const prefillFromUrl = () => {
      const host = location.hostname;
      const seg = location.pathname.split('/').filter(Boolean);
      if (!host.endsWith('.github.io')) { gitOut.textContent = 'Nur auf github.io-Adressen möglich.'; return; }
      const owner = host.split('.')[0];
      const repo = seg[0] || `${owner}.github.io`;
      ownerInput.value = owner;
      repoInput.value = repo;
      set({ gitOwner: owner, gitRepo: repo });
      gitOut.textContent = `Übernommen: ${owner}/${repo}`;
    };

    const checkRepo = async (btn) => {
      btn.disabled = true;
      gitOut.style.color = '';
      gitOut.textContent = 'Prüfe Repository …';
      try {
        const gh = await import('./github.js');
        const repo = await gh.getRepo();
        const branches = await gh.listBranches();
        clear(branchList);
        branches.forEach((b) => branchList.appendChild(h('option', { value: b })));
        const perms = repo.permissions || {};
        gitOut.textContent = `${repo.full_name} · Standard-Branch: ${repo.default_branch} · ${branches.length} Branches`
          + (perms.push === false ? ' · Achtung: kein Schreibzugriff mit diesem Token' : '');
      } catch (err) {
        gitOut.style.color = 'var(--danger)';
        gitOut.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };

    const gitCard = h('div', { class: 'card', id: 'gitSettings' },
      h('h3', {}, 'GitHub-Synchronisation'),
      h('p', { class: 'hint' },
        'Speichert je Projekt eine JSON-Datei im Repository und holt Änderungen wieder zurück. Benötigt einen feingranularen Token mit „Contents: read and write" (für Pull Requests zusätzlich „Pull requests: write").'),
      h('label', { class: 'row', style: { marginBottom: '12px', gap: '8px' } },
        h('input', {
          type: 'checkbox', checked: s.gitEnabled !== false, style: { width: 'auto' },
          onchange: (e) => set({ gitEnabled: e.target.checked }),
        }),
        h('span', {}, 'Synchronisation aktivieren')),
      field('Zugriffstoken', h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        gitTokenInput,
        h('button', {
          class: 'btn small',
          onclick: (e) => {
            gitTokenInput.type = gitTokenInput.type === 'password' ? 'text' : 'password';
            e.target.textContent = gitTokenInput.type === 'password' ? 'Zeigen' : 'Verbergen';
          },
        }, 'Zeigen'))),
      field('Token speichern', select(s.gitTokenScope || 'local',
        [['local', 'dauerhaft in diesem Browser'], ['session', 'nur für diese Sitzung']],
        (val) => { set({ gitTokenScope: val }); store.setGitToken(gitTokenInput.value.trim(), val); })),
      h('div', { class: 'grid-2' },
        field('Owner', ownerInput),
        field('Repository', repoInput)),
      h('div', { class: 'grid-2' },
        field('Branch', h('div', {}, branchInput, branchList), 'Nach „Repository prüfen" als Vorschlagsliste verfügbar.'),
        field('Verzeichnis', textInput(s.gitPath, (val) => set({ gitPath: val.trim() }), { placeholder: 'umllight', spellcheck: 'false' }))),
      h('div', { class: 'grid-2' },
        field('Commit-Autor (optional)', textInput(s.gitAuthorName, (val) => set({ gitAuthorName: val.trim() }))),
        field('E-Mail (optional)', textInput(s.gitAuthorEmail, (val) => set({ gitAuthorEmail: val.trim() }))))
      ,
      field('API-Basis', textInput(s.gitApiBase, (val) => set({ gitApiBase: val.trim() }),
        { placeholder: store.DEFAULT_GIT_API, spellcheck: 'false' }),
        'Für GitHub Enterprise, z. B. https://github.firma.de/api/v3'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', onclick: (e) => checkRepo(e.target) }, 'Repository prüfen'),
        h('button', { class: 'btn small ghost', onclick: prefillFromUrl }, 'Aus Adresse übernehmen')),
      gitOut);

    // ---- data
    const dataCard = h('div', { class: 'card' },
      h('h3', {}, 'Daten'),
      h('p', { class: 'hint' }, 'Alle Projekte liegen im localStorage dieses Browsers. Für Sicherung oder Umzug ein Backup exportieren.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn small',
          onclick: () => { store.flush(); download('umllight-backup.json', store.exportAll()); },
        }, 'Backup exportieren'),
        h('button', {
          class: 'btn small',
          onclick: () => { close(); navigate('#/projects'); toast('Import über „Importieren" in der Projektliste'); },
        }, 'Import öffnen')));

    const box = h('div', {},
      h('h2', {}, 'Einstellungen'),
      plantumlCard,
      aiCard,
      gitCard,
      dataCard,
      h('p', { class: 'hint', style: { marginTop: '14px' } },
        'umlLight ist eine statische PWA — Daten verlassen den Browser nur beim Rendern von Diagrammen und bei KI-Anfragen.'),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn primary', onclick: () => { close(); render(); } }, 'Fertig')));

    const focusTarget = { ai: aiCard, git: gitCard }[focus];
    if (focusTarget) setTimeout(() => focusTarget.scrollIntoView({ block: 'start' }), 60);
    return box;
  });
}

// ------------------------------------------------------------------ wire
document.getElementById('settingsBtn').addEventListener('click', () => openSettings());
document.addEventListener('umllight:settings', (e) => openSettings(e.detail?.focus));
document.getElementById('navToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  scrim.hidden = !open;
});
scrim.addEventListener('click', closeDrawer);
main.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
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
