// Model -> PlantUML source generators. Every diagram can be overridden by a
// hand-written source stored in `section.custom`.

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

// --------------------------------------------------------------- view model
export function viewModelUml(vm, projectName = 'View-Modell') {
  const views = vm.views || [];
  const out = HEADER(['skinparam state { BackgroundColor<<start>> #E8F1FF }']);
  out.push(`title View-Modell — ${esc(projectName)}`);
  if (!views.length) {
    out.push('note as N', '  Noch keine Views erfasst.', 'end note', '@enduml');
    return out.join('\n');
  }
  for (const v of views) {
    out.push(`state "${esc(v.name) || 'View'}" as ${alias(v.id)}${v.start ? ' <<start>>' : ''}`);
    const els = (v.elements || []).filter((e) => clean(e));
    if (els.length) out.push(`${alias(v.id)} : ${els.map(esc).join('\\n')}`);
  }
  const starts = views.filter((v) => v.start);
  for (const s of (starts.length ? starts : views.slice(0, 1))) out.push(`[*] --> ${alias(s.id)}`);
  for (const l of vm.links || []) {
    if (!views.some((v) => v.id === l.from) || !views.some((v) => v.id === l.to)) continue;
    const label = clean(l.label) ? ` : ${esc(l.label)}` : '';
    out.push(`${alias(l.from)} --> ${alias(l.to)}${label}`);
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

// ------------------------------------------------------------- spec export
export function projectMarkdown(p) {
  const L = [];
  const v = p.vision || {};
  L.push(`# ${p.name}`, '');
  if (clean(p.summary)) L.push(p.summary, '');

  L.push('## 1. Produktvision', '');
  if (clean(v.statement)) L.push(clean(v.statement), '');
  const vt = [
    ['Für', v.forWhom], ['die', v.who], ['die/das', v.problem], ['ist', v.productName],
    ['ein/e', v.category], ['das/die', v.keyBenefit], ['anders als', v.alternative],
    ['bietet unser Produkt', v.differentiator],
  ].filter(([, val]) => clean(val));
  if (vt.length) {
    L.push('| Aspekt | Inhalt |', '| --- | --- |');
    for (const [k, val] of vt) L.push(`| ${k} | ${clean(val).replace(/\n/g, ' ')} |`);
    L.push('');
  }
  if ((v.goals || []).length) { L.push('**Ziele**', ''); for (const g of v.goals) L.push(`- ${g}`); L.push(''); }
  if ((v.nonGoals || []).length) { L.push('**Nicht-Ziele**', ''); for (const g of v.nonGoals) L.push(`- ${g}`); L.push(''); }
  if (clean(v.constraints)) L.push('**Rahmenbedingungen**', '', clean(v.constraints), '');

  L.push('## 2. Use-Case-Modell', '');
  for (const a of p.useCases.actors || []) L.push(`- **${a.name}**${clean(a.description) ? ` — ${a.description}` : ''}`);
  if ((p.useCases.actors || []).length) L.push('');
  for (const c of p.useCases.useCases || []) {
    L.push(`### UC: ${c.name}`, '');
    const actorNames = (c.actorIds || []).map((id) => (p.useCases.actors || []).find((a) => a.id === id)?.name).filter(Boolean);
    if (actorNames.length) L.push(`*Akteure:* ${actorNames.join(', ')}`, '');
    if (clean(c.description)) L.push(c.description, '');
    if (clean(c.precondition)) L.push(`*Vorbedingung:* ${c.precondition}`, '');
    if (clean(c.result)) L.push(`*Ergebnis:* ${c.result}`, '');
    const steps = (c.steps || []).filter((s) => clean(s.text));
    if (steps.length) {
      L.push('**Ablauf**', '');
      steps.forEach((s, i) => L.push(`${i + 1}. ${s.kind === 'decision' ? `Entscheidung: ${s.text} → ja: ${s.yes || '-'} / nein: ${s.no || '-'}` : s.text}`));
      L.push('');
    }
  }
  L.push('```plantuml', p.useCases.custom || useCaseUml(p.useCases, p.name), '```', '');

  L.push('## 3. Deployment', '');
  if (p.deployment.mode === 'text') {
    L.push(clean(p.deployment.text) || '_Keine Beschreibung._', '');
  } else {
    for (const n of p.deployment.nodes || []) {
      L.push(`- **${n.name}** (${n.kind}${clean(n.tech) ? `, ${n.tech}` : ''})${clean(n.description) ? ` — ${n.description}` : ''}`);
    }
    L.push('', '```plantuml', p.deployment.custom || deploymentUml(p.deployment, p.name), '```', '');
    if (clean(p.deployment.text)) L.push(clean(p.deployment.text), '');
  }

  L.push('## 4. Datenmodell', '');
  for (const e of p.dataModel.entities || []) {
    L.push(`### ${e.name}`, '');
    if (clean(e.description)) L.push(e.description, '');
    const attrs = (e.attributes || []).filter((a) => clean(a.name));
    if (attrs.length) {
      L.push('| Attribut | Typ | Schlüssel | Pflicht |', '| --- | --- | --- | --- |');
      for (const a of attrs) L.push(`| ${a.name} | ${a.type || ''} | ${a.key || ''} | ${a.required ? 'ja' : ''} |`);
      L.push('');
    }
  }
  L.push('```plantuml', p.dataModel.custom || dataModelUml(p.dataModel, p.name), '```', '');

  L.push('## 5. View-Modell & Abläufe', '');
  for (const v2 of p.viewModel.views || []) {
    L.push(`### ${v2.name}${v2.start ? ' (Einstieg)' : ''}`, '');
    if (clean(v2.description)) L.push(v2.description, '');
    const els = (v2.elements || []).filter(clean);
    if (els.length) { for (const e of els) L.push(`- ${e}`); L.push(''); }
  }
  L.push('```plantuml', p.viewModel.custom || viewModelUml(p.viewModel, p.name), '```', '');
  for (const act of p.viewModel.activities || []) {
    L.push(`### Ablauf: ${act.name}`, '');
    if (clean(act.description)) L.push(act.description, '');
    L.push('```plantuml', act.uml || ACTIVITY_TEMPLATE, '```', '');
  }
  return L.join('\n');
}
