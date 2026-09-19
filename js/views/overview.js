// Project overview: completeness at a glance, all diagrams, spec export.

import { h, clear, download, copyText } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { useCaseUml, deploymentUml, dataModelUml, viewModelUml, projectMarkdown, ACTIVITY_TEMPLATE } from '../generators.js';

const slug = (s) => String(s || 'projekt').replace(/[^\w.-]+/g, '_');

function statusRow(label, done, detail, href) {
  return h('tr', {},
    h('td', {}, h('a', { href }, label)),
    h('td', {}, h('span', { class: `chip ${done ? 'on' : ''}` }, done ? 'erfasst' : 'offen')),
    h('td', { class: 'hint', style: { margin: 0 } }, detail));
}

export function renderOverview(main, ctx) {
  clear(main);
  const p = ctx.project;
  const base = `#/p/${p.id}`;

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, p.name),
      h('p', { class: 'hint' }, p.summary || 'Übersicht über die Spezifikation dieser Anwendung.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => download(`${slug(p.name)}-spezifikation.md`, projectMarkdown(p), 'text/markdown') }, 'Markdown exportieren'),
      h('button', { class: 'btn', onclick: () => copyText(projectMarkdown(p)) }, 'Markdown kopieren'),
      h('button', { class: 'btn', onclick: () => download(`${slug(p.name)}.json`, store.exportProject(p.id)) }, 'JSON exportieren'))));

  const ucCount = (p.useCases.useCases || []).length;
  const vision = p.vision || {};
  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Stand der Spezifikation'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' }, h('tbody', {},
      statusRow('Produktvision', !!(vision.statement || vision.productName),
        `${(vision.goals || []).filter(Boolean).length} Ziele`, `${base}/vision`),
      statusRow('Use-Case-Modell', ucCount > 0,
        `${(p.useCases.actors || []).length} Akteure · ${ucCount} Use Cases`, `${base}/usecases`),
      statusRow('Deployment', p.deployment.mode === 'text' ? !!p.deployment.text.trim() : (p.deployment.nodes || []).length > 0,
        p.deployment.mode === 'text' ? 'Textbeschreibung' : `${(p.deployment.nodes || []).length} Knoten · ${(p.deployment.links || []).length} Verbindungen`,
        `${base}/deployment`),
      statusRow('Datenmodell', (p.dataModel.entities || []).length > 0,
        `${(p.dataModel.entities || []).length} Entitäten · ${(p.dataModel.relations || []).length} Beziehungen`, `${base}/datamodel`),
      statusRow('View-Modell', (p.viewModel.views || []).length > 0,
        `${(p.viewModel.views || []).length} Views · ${(p.viewModel.activities || []).length} Abläufe`, `${base}/viewmodel`))))));

  const panels = [
    ['Use-Case-Diagramm', () => p.useCases.custom || useCaseUml(p.useCases, p.name), `${slug(p.name)}-usecases`],
    ...(p.deployment.mode === 'text' ? [] : [['Deployment-Diagramm', () => p.deployment.custom || deploymentUml(p.deployment, p.name), `${slug(p.name)}-deployment`]]),
    ['Datenmodell', () => p.dataModel.custom || dataModelUml(p.dataModel, p.name), `${slug(p.name)}-datamodel`],
    ['Navigationsdiagramm', () => p.viewModel.custom || viewModelUml(p.viewModel, p.name), `${slug(p.name)}-viewmodel`],
    ...(p.viewModel.activities || []).map((a) => [`Ablauf: ${a.name}`, () => a.uml || ACTIVITY_TEMPLATE, `${slug(p.name)}-${slug(a.name)}`]),
  ];
  for (const [title, generate, fileName] of panels) {
    main.appendChild(diagramPanel({ title, generate, fileName }));
  }
}
