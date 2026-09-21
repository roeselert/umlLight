// Markdown export: turns a project (or all projects) into a readable
// specification document, optionally with PlantUML sources and rendered
// image links.

import { h, modal, toast, copyText, download } from './ui.js';
import { diagramUrl } from './plantuml.js';
import {
  useCaseUml, useCaseScenarioUml, deploymentUml, dataModelUml, viewModelUml, ACTIVITY_TEMPLATE,
} from './generators.js';
import { openApiText, avroText } from './schemas.js';

const clean = (s) => String(s ?? '').trim();
const slug = (s) => String(s || 'projekt').replace(/[^\w.-]+/g, '_');
// GitHub-compatible heading anchor: lowercase, punctuation dropped,
// whitespace turned into hyphens (umlauts are kept as-is).
const anchor = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');

export const DEFAULT_OPTIONS = {
  vision: true, usecases: true, deployment: true, datamodel: true, viewmodel: true, schemas: true,
  source: true, images: false, toc: true, scenarios: true,
};

async function diagramBlock(title, uml, opts) {
  const out = [];
  if (opts.images) {
    try {
      out.push(`![${title}](${await diagramUrl(uml, 'svg')})`, '');
    } catch {
      /* encoding failed — fall through to the source block */
    }
  }
  if (opts.source || !opts.images) out.push('```plantuml', uml, '```', '');
  return out;
}

/** @returns {Promise<string>} the Markdown document */
export async function buildMarkdown(p, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const L = [];
  const heads = [];
  const push = (...lines) => L.push(...lines);
  const section = (num, title) => {
    heads.push(`${num}. ${title}`);
    push(`## ${num}. ${title}`, '');
  };

  push(`# ${p.name}`, '');
  if (clean(p.summary)) push(p.summary, '');
  push(`*Stand: ${new Date(p.updatedAt || Date.now()).toLocaleDateString('de-DE')}*`, '');

  const tocIndex = L.length;
  let n = 0;

  if (opts.vision) {
    const v = p.vision || {};
    section(++n, 'Produktvision');
    const goals = (v.goals || []).filter(clean);
    if (goals.length) { push('**Ziele**', ''); goals.forEach((g) => push(`- ${g}`)); push(''); }
    const nonGoals = (v.nonGoals || []).filter(clean);
    if (nonGoals.length) { push('**Nicht-Ziele**', ''); nonGoals.forEach((g) => push(`- ${g}`)); push(''); }
    if (clean(v.constraints)) push('**Rahmenbedingungen**', '', clean(v.constraints), '');
  }

  if (opts.usecases) {
    section(++n, 'Use-Case-Modell');
    const actors = p.useCases.actors || [];
    if (actors.length) {
      push('**Akteure**', '');
      for (const a of actors) push(`- **${a.name}**${a.type === 'system' ? ' *(Fremdsystem)*' : ''}${clean(a.description) ? ` — ${a.description}` : ''}`);
      push('');
    }
    push(...await diagramBlock('Use-Case-Diagramm', p.useCases.custom || useCaseUml(p.useCases, p.name), opts));
    for (const c of p.useCases.useCases || []) {
      push(`### ${c.name}`, '');
      const meta = [];
      const actorNames = (c.actorIds || []).map((id) => actors.find((a) => a.id === id)?.name).filter(Boolean);
      if (actorNames.length) meta.push(`**Akteure:** ${actorNames.join(', ')}`);
      if (c.priority && c.priority !== 'normal') meta.push(`**Priorität:** ${c.priority}`);
      if (clean(c.trigger)) meta.push(`**Auslöser:** ${c.trigger}`);
      if (clean(c.precondition)) meta.push(`**Vorbedingung:** ${c.precondition}`);
      if (clean(c.result)) meta.push(`**Ergebnis:** ${c.result}`);
      if (meta.length) push(meta.join('  \n'), '');
      if (clean(c.description)) push(c.description, '');
      const steps = (c.steps || []).filter((s) => clean(s.text));
      if (steps.length) {
        push('**Ablauf**', '');
        steps.forEach((s, i) => push(s.kind === 'decision'
          ? `${i + 1}. Entscheidung *${s.text}*: ja → ${s.yes || '—'}; nein → ${s.no || '—'}`
          : `${i + 1}. ${s.text}`));
        push('');
      }
      if (opts.scenarios && (steps.length || c.customUml)) {
        push(...await diagramBlock(`Ablauf ${c.name}`, c.customUml || useCaseScenarioUml(c, actors), opts));
      }
    }
  }

  if (opts.deployment) {
    section(++n, 'Deployment');
    if (p.deployment.mode === 'text') {
      push(clean(p.deployment.text) || '_Keine Beschreibung erfasst._', '');
    } else {
      const nodes = p.deployment.nodes || [];
      if (nodes.length) {
        push('| Knoten | Art | Technologie | Enthalten in | Beschreibung |', '| --- | --- | --- | --- | --- |');
        for (const nd of nodes) {
          const parent = nodes.find((x) => x.id === nd.parentId)?.name || '';
          push(`| ${nd.name} | ${nd.kind || 'node'} | ${clean(nd.tech)} | ${parent} | ${clean(nd.description).replace(/\n/g, ' ')} |`);
        }
        push('');
      }
      const links = (p.deployment.links || []).filter((l) => clean(l.label));
      if (links.length) {
        push('**Verbindungen**', '');
        for (const l of links) {
          const from = nodes.find((x) => x.id === l.from)?.name || '?';
          const to = nodes.find((x) => x.id === l.to)?.name || '?';
          push(`- ${from} → ${to}: ${l.label}`);
        }
        push('');
      }
      push(...await diagramBlock('Deployment-Diagramm', p.deployment.custom || deploymentUml(p.deployment, p.name), opts));
      if (clean(p.deployment.text)) push(clean(p.deployment.text), '');
    }
  }

  if (opts.datamodel) {
    section(++n, 'Datenmodell');
    for (const e of p.dataModel.entities || []) {
      push(`### ${e.name}${clean(e.stereotype) ? ` «${e.stereotype}»` : ''}`, '');
      if (clean(e.description)) push(e.description, '');
      const attrs = (e.attributes || []).filter((a) => clean(a.name));
      if (attrs.length) {
        push('| Attribut | Typ | Schlüssel | Pflicht |', '| --- | --- | --- | --- |');
        for (const a of attrs) push(`| ${a.name} | ${clean(a.type)} | ${(a.key || '').toUpperCase()} | ${a.required ? 'ja' : ''} |`);
        push('');
      }
    }
    const rels = p.dataModel.relations || [];
    if (rels.length) {
      push('**Beziehungen**', '');
      for (const r of rels) {
        const from = (p.dataModel.entities || []).find((x) => x.id === r.from)?.name || '?';
        const to = (p.dataModel.entities || []).find((x) => x.id === r.to)?.name || '?';
        push(`- ${from} ${r.type || '1-n'} ${to}${clean(r.label) ? ` — ${r.label}` : ''}`);
      }
      push('');
    }
    push(...await diagramBlock('Datenmodell', p.dataModel.custom || dataModelUml(p.dataModel, p.name), opts));
  }

  if (opts.viewmodel) {
    section(++n, 'View-Modell & Abläufe');
    for (const v of p.viewModel.views || []) {
      push(`### ${v.name}${v.start ? ' *(Einstieg)*' : ''}`, '');
      if (clean(v.description)) push(v.description, '');
      const els = (v.elements || []).filter(clean);
      if (els.length) { els.forEach((e) => push(`- ${e}`)); push(''); }
    }
    const links = p.viewModel.links || [];
    if (links.length) {
      push('**Navigation**', '');
      for (const l of links) {
        const from = (p.viewModel.views || []).find((x) => x.id === l.from)?.name || '?';
        const to = (p.viewModel.views || []).find((x) => x.id === l.to)?.name || '?';
        push(`- ${from} → ${to}${clean(l.label) ? `: ${l.label}` : ''}`);
      }
      push('');
    }
    push(...await diagramBlock('Navigationsdiagramm', p.viewModel.custom || viewModelUml(p.viewModel, p.name), opts));
    for (const act of p.viewModel.activities || []) {
      push(`### Ablauf: ${act.name}`, '');
      if (clean(act.description)) push(act.description, '');
      push(...await diagramBlock(act.name || 'Ablauf', act.uml || ACTIVITY_TEMPLATE, opts));
    }
  }

  if (opts.schemas && (p.dataModel.entities || []).length) {
    section(++n, 'API & Schemas');
    const sc = p.schemas || {};
    const openapi = sc.openapi?.custom ?? openApiText(p, sc.openapi || {});
    const avro = sc.avro?.custom ?? avroText(p, sc.avro || {});
    push('### OpenAPI', '', `\`\`\`${(sc.openapi?.format || 'yaml') === 'json' ? 'json' : 'yaml'}`, openapi, '```', '');
    push('### Avro', '', '```json', avro, '```', '');
  }

  if (opts.toc && heads.length > 1) {
    const toc = ['**Inhalt**', '', ...heads.map((t) => `- [${t}](#${anchor(t)})`), ''];
    L.splice(tocIndex, 0, ...toc);
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function buildBackupMarkdown(projects, options) {
  const parts = [];
  for (const p of projects) parts.push(await buildMarkdown(p, options));
  return parts.join('\n\n---\n\n');
}

/** Export dialog with section and format options. */
export function openExportDialog(projectOrList) {
  const many = Array.isArray(projectOrList);
  const projects = many ? projectOrList : [projectOrList];
  const opts = { ...DEFAULT_OPTIONS };

  return modal((close) => {
    const status = h('div', { class: 'hint', style: { margin: '10px 0 0' } });
    const toggle = (key, label) => h('label', { class: 'row', style: { gap: '8px', marginBottom: '6px' } },
      h('input', {
        type: 'checkbox', checked: opts[key], style: { width: 'auto' },
        onchange: (e) => { opts[key] = e.target.checked; },
      }),
      h('span', {}, label));

    const run = async (mode) => {
      status.style.color = '';
      status.textContent = 'Markdown wird erzeugt …';
      try {
        const md = many
          ? await buildBackupMarkdown(projects, opts)
          : await buildMarkdown(projects[0], opts);
        if (mode === 'copy') {
          await copyText(md);
          status.textContent = `${md.length.toLocaleString('de-DE')} Zeichen kopiert.`;
        } else {
          const name = many ? 'umllight-spezifikationen.md' : `${slug(projects[0].name)}-spezifikation.md`;
          download(name, md, 'text/markdown');
          status.textContent = `Gespeichert als ${name}.`;
          close();
        }
      } catch (err) {
        status.style.color = 'var(--danger)';
        status.textContent = err.message;
      }
    };

    return h('div', {},
      h('h2', {}, 'Markdown-Export'),
      h('p', { class: 'hint' }, many
        ? `${projects.length} Projekte in einem Dokument.`
        : `Spezifikation für „${projects[0].name}".`),
      h('h3', {}, 'Abschnitte'),
      toggle('vision', 'Produktvision'),
      toggle('usecases', 'Use-Case-Modell'),
      toggle('deployment', 'Deployment'),
      toggle('datamodel', 'Datenmodell'),
      toggle('viewmodel', 'View-Modell & Abläufe'),
      toggle('schemas', 'API & Schemas'),
      h('h3', { style: { marginTop: '14px' } }, 'Optionen'),
      toggle('toc', 'Inhaltsverzeichnis'),
      toggle('source', 'PlantUML-Quelltext einbetten'),
      toggle('images', 'Diagramme als Bild-Links (PlantUML-Server)'),
      toggle('scenarios', 'Ablaufdiagramme je Use Case'),
      status,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Abbrechen'),
        h('button', { class: 'btn', onclick: () => run('copy') }, 'Kopieren'),
        h('button', { class: 'btn primary', onclick: () => run('download') }, 'Herunterladen')));
  });
}

export { slug };
