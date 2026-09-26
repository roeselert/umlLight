// Project overview: completeness at a glance, all diagrams, spec export.

import { h, clear, download, gridTable } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { useCaseUml, deploymentUml, dataModelUml, robustnessUml, ACTIVITY_TEMPLATE } from '../generators.js';
import { openExportDialog } from '../export.js';
import * as gh from '../github.js';
import * as sync from '../gitsync.js';
import { openGitDialog, statusChip } from '../gitpanel.js';

const slug = (s) => String(s || 'projekt').replace(/[^\w.-]+/g, '_');

function statusRow(label, done, detail, href) {
  return [
    h('a', { href }, label),
    h('span', { class: `chip ${done ? 'on' : ''}` }, done ? 'erfasst' : 'offen'),
    h('span', { class: 'hint', style: { margin: 0 } }, detail),
  ];
}

function schemaDetail(p) {
  const s = p.schemas || {};
  const parts = [];
  parts.push(s.openapi?.custom ? 'OpenAPI: eigene Fassung' : 'OpenAPI: generiert');
  parts.push(s.avro?.custom ? 'Avro: eigene Fassung' : 'Avro: generiert');
  return parts.join(' · ');
}

function gitCard(p, ctx) {
  const state = sync.linkOf(p);
  const target = sync.targetFor(p);
  const chipHolder = h('span', {});
  const detail = h('span', { class: 'hint', style: { margin: 0 } },
    state ? `${gh.targetLabel(target)} · ${state.branch || 'Standard-Branch'} · ${state.path}`
      : `${gh.targetLabel(target)} · noch nicht verknüpft`);
  sync.quickStatus(p).then(({ status }) => chipHolder.appendChild(statusChip(status))).catch(() => {});
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Repository'),
      chipHolder),
    h('div', { class: 'row' },
      detail,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => openGitDialog(p, () => ctx.rerender()) },
        state ? 'Synchronisieren' : 'Verknüpfen')));
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
      h('button', { class: 'btn primary', onclick: () => openExportDialog(p) }, 'Markdown exportieren'),
      h('button', { class: 'btn', onclick: () => download(`${slug(p.name)}.json`, store.exportProject(p.id)) }, 'JSON exportieren'),
      gh.isConfigured(sync.targetFor(p)) ? h('button', { class: 'btn', onclick: () => openGitDialog(p, () => ctx.rerender()) }, 'Mit Repository synchronisieren') : null)));

  if (gh.isConfigured(sync.targetFor(p))) main.appendChild(gitCard(p, ctx));

  const ucCount = (p.useCases.useCases || []).length;
  const rb = p.robustness;
  const entities = p.dataModel.entities || [];
  const vision = p.vision || {};
  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Stand der Spezifikation'),
    h('div', { class: 'table-wrap' }, gridTable(['Bereich', 'Status', 'Umfang'], [
      statusRow('Produktvision', (vision.goals || []).filter(Boolean).length > 0 || !!(p.summary || '').trim(),
        `${(vision.goals || []).filter(Boolean).length} Ziele · ${(vision.nonGoals || []).filter(Boolean).length} Nicht-Ziele`, `${base}/vision`),
      statusRow('Use-Case-Modell', ucCount > 0,
        `${(p.useCases.actors || []).length} Akteure · ${ucCount} Use Cases · ${(p.useCases.activities || []).length} Abläufe`, `${base}/usecases`),
      statusRow('Robustheitsmodell', rb.boundaries.length + rb.controls.length + entities.length > 0,
        `${rb.components.length} Komponenten · ${rb.boundaries.length} Boundaries · ${rb.controls.length} Controls · ${entities.length} Entitäten · ${rb.links.length} Interaktionen`,
        `${base}/robustness`),
      statusRow('API & Schemas', entities.length > 0,
        schemaDetail(p), `${base}/schemas`),
      statusRow('Deployment', p.deployment.mode === 'text' ? !!p.deployment.text.trim() : (p.deployment.nodes || []).length > 0,
        p.deployment.mode === 'text' ? 'Textbeschreibung' : `${(p.deployment.nodes || []).length} Knoten · ${(p.deployment.links || []).length} Verbindungen`,
        `${base}/deployment`)]))));

  const panels = [
    ['Use-Case-Diagramm', () => p.useCases.custom || useCaseUml(p.useCases, p.name), `${slug(p.name)}-usecases`],
    ['Robustheitsdiagramm', () => rb.custom || robustnessUml(p), `${slug(p.name)}-robustheit`],
    ['Datenmodell', () => p.dataModel.custom || dataModelUml(p.dataModel, p.name, p.robustness.components), `${slug(p.name)}-datamodel`],
    ...(p.useCases.activities || []).map((a) => [`Ablauf: ${a.name}`, () => a.uml || ACTIVITY_TEMPLATE, `${slug(p.name)}-${slug(a.name)}`]),
    ...(p.deployment.mode === 'text' ? [] : [['Deployment-Diagramm', () => p.deployment.custom || deploymentUml(p.deployment, p.name), `${slug(p.name)}-deployment`]]),
  ];
  for (const [title, generate, fileName] of panels) {
    main.appendChild(diagramPanel({ title, generate, fileName }));
  }
}
