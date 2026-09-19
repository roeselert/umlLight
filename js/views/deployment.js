// Deployment view: node/link model or plain textual description.

import { h, clear, field, textInput, textArea, select, listItem, makeSortable, withId,
  confirmDialog, debounce, toast, syncTitle, moveActions, gridTable } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { deploymentUml } from '../generators.js';

const KINDS = [
  ['node', 'Knoten / Server'], ['device', 'Gerät'], ['cloud', 'Cloud / Umgebung'],
  ['database', 'Datenbank'], ['component', 'Komponente'], ['queue', 'Queue / Bus'],
  ['folder', 'Bereich'], ['artifact', 'Artefakt'], ['actor', 'Externer Nutzer'], ['frame', 'Zone'],
];
const LINK_STYLES = [['line', 'Verbindung ──'], ['arrow', 'gerichtet ──▶'], ['dashed', 'lose ┄▶']];

export function renderDeployment(main, ctx) {
  clear(main);
  const p = ctx.project;
  const dep = p.deployment;
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
  // mutate the model immediately, batch the write to localStorage
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  let diagram = null;
  const refresh = () => diagram && diagram.refresh();
  const patchAndDraw = (fn) => { patch(fn); refresh(); };
  const redrawSoon = debounce(() => refresh(), 700);

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'Deployment'),
      h('p', { class: 'hint' }, 'Wo läuft was? Entweder als Modell mit Knoten und Verbindungen oder als reine Textbeschreibung.')),
    h('div', { class: 'btn-row' },
      h('button', {
        class: `btn small ${dep.mode !== 'text' ? 'primary' : ''}`,
        onclick: () => { patch((prj) => { prj.deployment.mode = 'model'; }); ctx.rerender(); },
      }, 'Modell'),
      h('button', {
        class: `btn small ${dep.mode === 'text' ? 'primary' : ''}`,
        onclick: () => { patch((prj) => { prj.deployment.mode = 'text'; }); ctx.rerender(); },
      }, 'Nur Text'))));

  if (dep.mode === 'text') {
    main.appendChild(h('div', { class: 'card' },
      h('h2', {}, 'Textuelle Beschreibung'),
      h('p', { class: 'hint' }, 'Umgebungen, Laufzeiten, Hosting, Schnittstellen, Betrieb.'),
      textArea(dep.text, (val) => save((prj) => { prj.deployment.text = val; }),
        { rows: 16, placeholder: 'z. B. Statisches Hosting über GitHub Pages; keine Serverkomponenten; Daten liegen im localStorage des Browsers …' })));
    return;
  }

  diagram = diagramPanel({
    title: 'Deployment-Diagramm',
    project: p,
    section: 'deployment',
    fileName: `${p.name}-deployment`,
    generate: () => deploymentUml(dep, p.name),
    getCustom: () => dep.custom,
    setCustom: (val) => patch((prj) => { prj.deployment.custom = val; }),
  });
  main.appendChild(diagram);

  // ----------------------------------------------------------- nodes
  const nodesWrap = h('div', {});
  const artifactsEditor = (n) => {
    const wrap = h('div', { class: 'stack' });
    const rebuild = () => {
      clear(wrap);
      n.artifacts ||= [];
      n.artifacts.forEach((a, i) => wrap.appendChild(h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        textInput(a, (val) => { n.artifacts[i] = val; save(() => {}); redrawSoon(); },
          { placeholder: 'z. B. app.js, container image, SPA-Bundle' }),
        h('button', { class: 'btn small ghost', onclick: () => { n.artifacts.splice(i, 1); patchAndDraw(() => {}); rebuild(); } }, '✕'))));
      wrap.appendChild(h('button', {
        class: 'btn small', onclick: () => { n.artifacts.push(''); patch(() => {}); rebuild(); },
      }, '+ Artefakt'));
    };
    rebuild();
    return wrap;
  };

  const renderNodes = () => {
    clear(nodesWrap);
    if (!dep.nodes.length) nodesWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Knoten.'));
    for (const n of dep.nodes) {
      const parents = [['', '— keiner —'], ...dep.nodes.filter((x) => x.id !== n.id).map((x) => [x.id, x.name || 'Knoten'])];
      nodesWrap.appendChild(withId(listItem({
        title: n.name || 'Knoten',
        meta: (KINDS.find(([k]) => k === n.kind) || [])[1] || 'Knoten',
        actions: [...moveActions(dep.nodes, n.id, () => { patchAndDraw(() => {}); renderNodes(); }), h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Knoten löschen?', `„${n.name}" und seine Verbindungen werden entfernt.`))) return;
            patchAndDraw((prj) => {
              prj.deployment.nodes = prj.deployment.nodes.filter((x) => x.id !== n.id);
              for (const o of prj.deployment.nodes) if (o.parentId === n.id) o.parentId = '';
              prj.deployment.links = prj.deployment.links.filter((l) => l.from !== n.id && l.to !== n.id);
            });
            renderNodes();
            renderLinks();
          },
        }, 'Löschen')],
        body: () => h('div', {},
          field('Name', textInput(n.name, function (val) { n.name = val; syncTitle(this, val, 'Knoten'); save(() => {}); redrawSoon(); })),
          h('div', { class: 'grid-2' },
            field('Art', select(n.kind || 'node', KINDS, (val) => { n.kind = val; patchAndDraw(() => {}); renderNodes(); })),
            field('Technologie (Stereotyp)', textInput(n.tech, (val) => { n.tech = val; save(() => {}); redrawSoon(); },
              { placeholder: 'z. B. Browser, Docker, PostgreSQL 16' }))),
          field('Enthalten in', select(n.parentId || '', parents, (val) => { n.parentId = val; patchAndDraw(() => {}); })),
          field('Beschreibung', textArea(n.description, (val) => { n.description = val; save(() => {}); }, { rows: 2 })),
          h('h3', {}, 'Artefakte'),
          artifactsEditor(n)),
      }), n.id));
    }
  };

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Knoten'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          patchAndDraw((prj) => prj.deployment.nodes.push({
            id: store.uid('nod'), name: 'Neuer Knoten', kind: 'node', tech: '', parentId: '', description: '', artifacts: [],
          }));
          renderNodes();
          renderLinks();
        },
      }, '+ Knoten')),
    nodesWrap));
  renderNodes();
  makeSortable(nodesWrap, (ids) => patchAndDraw((prj) =>
    prj.deployment.nodes.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id))));

  // ----------------------------------------------------------- links
  const linksWrap = h('div', { class: 'table-wrap' });
  const renderLinks = () => {
    clear(linksWrap);
    if (!dep.nodes.length) { linksWrap.appendChild(h('div', { class: 'empty' }, 'Zuerst Knoten anlegen.')); return; }
    if (!dep.links.length) { linksWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Verbindungen.')); return; }
    const opts = dep.nodes.map((n) => [n.id, n.name || 'Knoten']);
    const rows = dep.links.map((l, i) => [
      select(l.from, opts, (val) => { l.from = val; patchAndDraw(() => {}); }),
      select(l.style || 'line', LINK_STYLES, (val) => { l.style = val; patchAndDraw(() => {}); }),
      select(l.to, opts, (val) => { l.to = val; patchAndDraw(() => {}); }),
      textInput(l.label, (val) => { l.label = val; save(() => {}); redrawSoon(); }, { placeholder: 'z. B. HTTPS' }),
      h('button', {
        class: 'btn small ghost',
        onclick: () => { patchAndDraw((prj) => prj.deployment.links.splice(i, 1)); renderLinks(); },
      }, '✕ Entfernen'),
    ]);
    linksWrap.appendChild(gridTable(['Von', 'Art', 'Nach', 'Bezeichnung', ''], rows));
  };

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Verbindungen'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          if (!dep.nodes.length) { toast('Zuerst einen Knoten anlegen', 'err'); return; }
          patchAndDraw((prj) => prj.deployment.links.push({
            from: dep.nodes[0].id, to: dep.nodes[Math.min(1, dep.nodes.length - 1)].id, style: 'line', label: '',
          }));
          renderLinks();
        },
      }, '+ Verbindung')),
    linksWrap));
  renderLinks();

  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Ergänzende Beschreibung'),
    textArea(dep.text, (val) => save((prj) => { prj.deployment.text = val; }),
      { rows: 5, placeholder: 'Betrieb, Skalierung, Umgebungen, Deployment-Prozess …' })));
}
