// Model -> PlantUML source generators. Every diagram can be overridden by a
// hand-written source stored in `section.custom`.

import { participants } from './robustness.js';

const esc = (s) => String(s ?? '').replace(/"/g, "'").replace(/\r?\n/g, '\\n').trim();
const alias = (id) => String(id || '').replace(/[^A-Za-z0-9_]/g, '_') || 'x';
const clean = (s) => String(s ?? '').trim();

const HEADER = (extra = []) => [
  '@startuml',
  'skinparam defaultFontName SansSerif',
  'skinparam shadowing false',
  'skinparam roundCorner 8',
  ...extra,
];

// ---------------------------------------------------------------- use cases
export function useCaseUml(uc, projectName = 'System') {
  const actors = uc.actors || [];
  const cases = uc.useCases || [];
  const systemName = clean(uc.systemName) || projectName;
  const out = HEADER(['left to right direction', 'skinparam packageStyle rectangle']);

  if (!actors.length && !cases.length) {
    out.push('note as N', '  Noch keine Akteure oder Use Cases erfasst.', 'end note', '@enduml');
    return out.join('\n');
  }

  for (const a of actors) {
    const keyword = a.type === 'system' ? 'actor' : 'actor';
    out.push(`${keyword} "${esc(a.name) || 'Akteur'}" as ${alias(a.id)}${a.type === 'system' ? ' <<System>>' : ''}`);
  }
  out.push(`rectangle "${esc(systemName)}" {`);
  for (const c of cases) {
    const stereo = c.priority && c.priority !== 'normal' ? ` <<${esc(c.priority)}>>` : '';
    out.push(`  usecase "${esc(c.name) || 'Use Case'}" as ${alias(c.id)}${stereo}`);
  }
  out.push('}');

  for (const c of cases) {
    for (const actorId of c.actorIds || []) {
      if (actors.some((a) => a.id === actorId)) out.push(`${alias(actorId)} --> ${alias(c.id)}`);
    }
    for (const inc of c.includes || []) {
      if (cases.some((x) => x.id === inc)) out.push(`${alias(c.id)} ..> ${alias(inc)} : <<include>>`);
    }
    for (const ext of c.extends || []) {
      if (cases.some((x) => x.id === ext)) out.push(`${alias(c.id)} ..> ${alias(ext)} : <<extend>>`);
    }
  }
  out.push('@enduml');
  return out.join('\n');
}

/** One activity-style flow per use case (main scenario + alternatives). */
export function useCaseScenarioUml(c, actors = []) {
  const actorNames = (c.actorIds || [])
    .map((id) => actors.find((a) => a.id === id)?.name)
    .filter(Boolean).join(', ');
  const out = HEADER();
  out.push(`title ${esc(c.name) || 'Use Case'}`);
  if (actorNames) out.push(`caption Akteure: ${esc(actorNames)}`);
  out.push('start');
  const steps = (c.steps || []).filter((s) => clean(s.text));
  if (!steps.length) out.push(':Noch keine Schritte definiert;');
  for (const s of steps) {
    if (s.kind === 'decision') {
      out.push(`if (${esc(s.text)}?) then (ja)`);
      out.push(`  :${esc(s.yes) || 'weiter'};`);
      out.push('else (nein)');
      out.push(`  :${esc(s.no) || 'abbrechen'};`);
      out.push('endif');
    } else {
      out.push(`:${esc(s.text)};`);
    }
  }
  out.push('stop', '@enduml');
  return out.join('\n');
}

// --------------------------------------------------------------- deployment
const DEPLOY_KEYWORDS = {
  node: 'node', device: 'node', cloud: 'cloud', database: 'database',
  component: 'component', queue: 'queue', folder: 'folder', artifact: 'artifact',
  actor: 'actor', frame: 'frame',
};

export function deploymentUml(dep, projectName = 'System') {
  const nodes = dep.nodes || [];
  const out = HEADER(['skinparam linetype ortho']);
  out.push(`title Deployment — ${esc(projectName)}`);
  if (!nodes.length) {
    out.push('note as N', '  Noch keine Knoten erfasst.', 'end note', '@enduml');
    return out.join('\n');
  }

  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parentId && nodes.some((x) => x.id === n.parentId) ? n.parentId : '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }

  const seen = new Set();
  const emit = (node, indent) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const kw = DEPLOY_KEYWORDS[node.kind] || 'node';
    const stereo = clean(node.tech) ? ` <<${esc(node.tech)}>>` : '';
    const children = byParent.get(node.id) || [];
    const arts = (node.artifacts || []).filter((a) => clean(a));
    const pad = ' '.repeat(indent);
    if (children.length || arts.length) {
      out.push(`${pad}${kw} "${esc(node.name) || 'Knoten'}" as ${alias(node.id)}${stereo} {`);
      for (const a of arts) out.push(`${pad}  artifact "${esc(a)}"`);
      for (const ch of children) emit(ch, indent + 2);
      out.push(`${pad}}`);
    } else {
      out.push(`${pad}${kw} "${esc(node.name) || 'Knoten'}" as ${alias(node.id)}${stereo}`);
    }
  };
  for (const root of byParent.get('') || []) emit(root, 0);
  for (const n of nodes) emit(n, 0); // orphans from broken parent links

  for (const l of dep.links || []) {
    if (!nodes.some((n) => n.id === l.from) || !nodes.some((n) => n.id === l.to)) continue;
    const arrow = l.style === 'dashed' ? '..>' : (l.style === 'arrow' ? '-->' : '--');
    const label = clean(l.label) ? ` : ${esc(l.label)}` : '';
    out.push(`${alias(l.from)} ${arrow} ${alias(l.to)}${label}`);
  }
  out.push('@enduml');
  return out.join('\n');
}

// --------------------------------------------------------------- data model
const REL_ARROWS = {
  '1-1': '||--||', '1-n': '||--o{', 'n-1': '}o--||', 'n-m': '}o--o{',
  '0-1': '|o--o|', '0-n': '|o--o{', inherit: '<|--', compose: '*--', aggregate: 'o--',
};

export function dataModelUml(dm, projectName = 'Datenmodell') {
  const entities = dm.entities || [];
  const out = HEADER(['hide circle', 'skinparam linetype ortho']);
  out.push(`title Datenmodell — ${esc(projectName)}`);
  if (!entities.length) {
    out.push('note as N', '  Noch keine Entitäten erfasst.', 'end note', '@enduml');
    return out.join('\n');
  }
  for (const e of entities) {
    const stereo = clean(e.stereotype) ? ` <<${esc(e.stereotype)}>>` : '';
    const attrs = (e.attributes || []).filter((a) => clean(a.name));
    out.push(`entity "${esc(e.name) || 'Entität'}" as ${alias(e.id)}${stereo} {`);
    const keys = attrs.filter((a) => a.key === 'pk');
    const rest = attrs.filter((a) => a.key !== 'pk');
    const line = (a) => {
      const req = a.required || a.key === 'pk' ? '* ' : '';
      const type = clean(a.type) ? ` : ${esc(a.type)}` : '';
      const mark = a.key === 'pk' ? ' <<PK>>' : (a.key === 'fk' ? ' <<FK>>' : '');
      return `  ${req}${esc(a.name)}${type}${mark}`;
    };
    for (const a of keys) out.push(line(a));
    if (keys.length && rest.length) out.push('  --');
    for (const a of rest) out.push(line(a));
    if (!attrs.length) out.push('  (keine Attribute)');
    out.push('}');
  }
  for (const r of dm.relations || []) {
    if (!entities.some((e) => e.id === r.from) || !entities.some((e) => e.id === r.to)) continue;
    const arrow = REL_ARROWS[r.type] || '||--o{';
    const label = clean(r.label) ? ` : ${esc(r.label)}` : '';
    out.push(`${alias(r.from)} ${arrow} ${alias(r.to)}${label}`);
  }
  out.push('@enduml');
  return out.join('\n');
}

// ------------------------------------------------------- robustness (BCE)
const BCE_KEYWORDS = { actor: 'actor', boundary: 'boundary', control: 'control', entity: 'entity' };

/**
 * Robustness diagram: actors, boundaries, controls and entities grouped by
 * business component. With `componentId` only that component is shown, plus
 * whatever it interacts with (drawn in its own component, for context).
 */
export function robustnessUml(project, { componentId = '' } = {}) {
  const rb = project.robustness || {};
  const components = rb.components || [];
  const all = participants(project);
  const byId = new Map(all.map((x) => [x.id, x]));
  const links = (rb.links || []).filter((l) => byId.has(l.from) && byId.has(l.to) && l.from !== l.to);

  let shown = all.filter((x) => x.kind !== 'actor');
  const focus = componentId ? components.find((c) => c.id === componentId) : null;
  if (focus) {
    const own = new Set(shown.filter((x) => x.componentId === focus.id).map((x) => x.id));
    const near = new Set(own);
    for (const l of links) {
      if (own.has(l.from)) near.add(l.to);
      if (own.has(l.to)) near.add(l.from);
    }
    shown = all.filter((x) => near.has(x.id));
  } else {
    // actors only appear when they interact with something
    const linked = new Set(links.flatMap((l) => [l.from, l.to]));
    shown = [...all.filter((x) => x.kind === 'actor' && linked.has(x.id)), ...shown];
  }
  const visible = new Set(shown.map((x) => x.id));

  const out = HEADER(['left to right direction', 'skinparam packageStyle rectangle']);
  // A hidden control keeps PlantUML on the description diagram even when only
  // entities are present (it would otherwise pick a class or sequence diagram).
  out.push('control "anchor" as _bce_anchor', 'remove _bce_anchor');
  out.push(`title Robustheitsdiagramm — ${esc(focus ? focus.name : project.name)}`);
  if (!shown.length) {
    out.push('note as N', focus ? '  Diese Komponente enthält noch keine Elemente.' : '  Noch keine Boundaries, Controls oder Entitäten erfasst.', 'end note', '@enduml');
    return out.join('\n');
  }

  const label = (x) => {
    let name = esc(x.name);
    if (x.kind === 'boundary' && x.ref?.kind === 'api') {
      const ops = (x.ref.operations || []).filter((o) => clean(o.path)).map((o) => `${clean(o.method).toUpperCase()} ${esc(o.path)}`);
      if (ops.length) name += `\\n${ops.slice(0, 4).join('\\n')}${ops.length > 4 ? '\\n…' : ''}`;
    }
    return name;
  };
  const stereo = (x) => {
    if (x.kind !== 'boundary') return '';
    return { api: ' <<API>>', external: ' <<Fremdsystem>>' }[x.ref?.kind] || '';
  };
  const emit = (x, pad) => out.push(`${pad}${BCE_KEYWORDS[x.kind]} "${label(x)}" as ${alias(x.id)}${stereo(x)}`);

  for (const x of shown.filter((y) => y.kind === 'actor')) emit(x, '');
  for (const c of components) {
    const members = shown.filter((x) => x.kind !== 'actor' && x.componentId === c.id);
    if (!members.length) continue;
    out.push(`package "${esc(c.name) || 'Komponente'}" as ${alias(c.id)} <<Business-Komponente>> {`);
    for (const x of members) emit(x, '  ');
    out.push('}');
  }
  for (const x of shown.filter((y) => y.kind !== 'actor' && !components.some((c) => c.id === y.componentId))) emit(x, '');

  for (const l of links) {
    if (!visible.has(l.from) || !visible.has(l.to)) continue;
    const text = clean(l.label) ? ` : ${esc(l.label)}` : '';
    out.push(`${alias(l.from)} --> ${alias(l.to)}${text}`);
  }
  out.push('@enduml');
  return out.join('\n');
}

export const ACTIVITY_TEMPLATE = `@startuml
start
:Nutzer öffnet die Ansicht;
if (Daten vorhanden?) then (ja)
  :Liste anzeigen;
else (nein)
  :Leerzustand anzeigen;
endif
:Aktion ausführen;
stop
@enduml`;
