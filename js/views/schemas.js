// API & schemas: OpenAPI specification and Avro records generated from the
// data model, with hand-written overrides, download and AI assistance.

import { h, clear, field, textInput, select, toast, copyText, download } from '../ui.js';
import * as store from '../store.js';
import { avroText, openApiText, pascal } from '../schemas.js';
import { openAiDialog, SCHEMA_PROMPTS, extractCode } from '../aipanel.js';
import { schemaPrompt } from '../ai.js';

const slug = (s) => String(s || 'projekt').replace(/[^\w.-]+/g, '_');

export function renderSchemas(main, ctx) {
  clear(main);
  const p = ctx.project;
  const cfgAll = p.schemas;
  const entities = (p.dataModel.entities || []).filter((e) => (e.name || '').trim());
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  let tab = ctx.schemaTab || 'openapi';

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'API & Schemas'),
      h('p', { class: 'hint' }, 'OpenAPI-Spezifikation und Avro-Records, erzeugt aus dem Datenmodell. Jede Fassung lässt sich überschreiben und exportieren.'))));

  const tabs = h('div', { class: 'tabs' },
    [['openapi', 'OpenAPI'], ['avro', 'Avro']].map(([key, label]) => h('button', {
      class: `tab ${tab === key ? 'active' : ''}`,
      onclick: () => { ctx.schemaTab = key; renderSchemas(main, ctx); },
    }, label)));
  main.appendChild(tabs);

  if (!entities.length) {
    main.appendChild(h('div', { class: 'empty' },
      h('p', {}, 'Für Schemas werden Entitäten benötigt.'),
      h('a', { class: 'btn', href: `#/p/${p.id}/datamodel` }, 'Zum Datenmodell')));
    return;
  }

  const spec = tab === 'openapi' ? cfgAll.openapi : cfgAll.avro;
  const isCustom = spec.custom !== null && spec.custom !== undefined;

  // ---------------------------------------------------------- generation
  const generate = () => (tab === 'openapi'
    ? openApiText(p, cfgAll.openapi)
    : avroText(p, cfgAll.avro));
  const current = () => (isCustom ? spec.custom : generate());

  const output = h('textarea', {
    class: 'code', rows: 22, spellcheck: 'false', readonly: !isCustom,
    oninput: (e) => save(() => { spec.custom = e.target.value; }),
  }, current());

  const refreshOutput = () => { if (!isCustom) output.value = generate(); };

  const fileName = () => (tab === 'openapi'
    ? `${slug(p.name)}-openapi.${cfgAll.openapi.format === 'json' ? 'json' : 'yaml'}`
    : `${slug(p.name)}.avsc`);

  // ------------------------------------------------------------- options
  const optionsCard = h('div', { class: 'card' });
  if (tab === 'openapi') {
    const o = cfgAll.openapi;
    optionsCard.appendChild(h('h2', {}, 'Optionen'));
    optionsCard.appendChild(h('div', { class: 'grid-2' },
      field('Titel', textInput(o.title, (v) => { save(() => { o.title = v; }); refreshOutput(); }, { placeholder: `${p.name} API` })),
      field('Version', textInput(o.version, (v) => { save(() => { o.version = v; }); refreshOutput(); }, { placeholder: '1.0.0' }))));
    optionsCard.appendChild(field('Server-URL',
      textInput(o.server, (v) => { save(() => { o.server = v; }); refreshOutput(); }, { placeholder: 'https://api.example.com/v1', spellcheck: 'false' })));
    optionsCard.appendChild(h('div', { class: 'grid-2' },
      field('Authentifizierung', select(o.auth,
        [['none', 'keine'], ['bearer', 'Bearer-Token (JWT)'], ['apiKey', 'API-Key im Header'], ['oauth2', 'OAuth2 (Authorization Code)']],
        (v) => { patch(() => { o.auth = v; }); refreshOutput(); })),
      field('Format', select(o.format, [['yaml', 'YAML'], ['json', 'JSON']],
        (v) => { patch(() => { o.format = v; }); refreshOutput(); }))));
    optionsCard.appendChild(h('div', { class: 'grid-2' },
      field('Pfadform', select(o.pathStyle, [['plural', 'Plural (englisch): /orders'], ['singular', 'wie Entität: /auftrag']],
        (v) => { patch(() => { o.pathStyle = v; }); refreshOutput(); })),
      field('Endpunkte', select(o.includeCrud ? 'yes' : 'no', [['yes', 'CRUD je Entität'], ['no', 'nur Schemas']],
        (v) => { patch(() => { o.includeCrud = v === 'yes'; }); refreshOutput(); }))));
    optionsCard.appendChild(h('label', { class: 'row', style: { gap: '8px' } },
      h('input', {
        type: 'checkbox', checked: o.includeRefs !== false, style: { width: 'auto' },
        onchange: (e) => { patch(() => { o.includeRefs = e.target.checked; }); refreshOutput(); },
      }),
      h('span', {}, 'Beziehungen als Fremdschlüsselfelder aufnehmen')));
  } else {
    const a = cfgAll.avro;
    optionsCard.appendChild(h('h2', {}, 'Optionen'));
    optionsCard.appendChild(field('Namespace',
      textInput(a.namespace, (v) => { save(() => { a.namespace = v; }); refreshOutput(); },
        { placeholder: `umllight.${(p.name || 'projekt').toLowerCase().replace(/[^a-z0-9]/g, '')}`, spellcheck: 'false' }),
      'Voreinstellung wird aus dem Projektnamen abgeleitet.'));
    optionsCard.appendChild(h('label', { class: 'row', style: { gap: '8px' } },
      h('input', {
        type: 'checkbox', checked: a.includeRefs !== false, style: { width: 'auto' },
        onchange: (e) => { patch(() => { a.includeRefs = e.target.checked; }); refreshOutput(); },
      }),
      h('span', {}, 'Beziehungen als Referenzfelder aufnehmen')));
    optionsCard.appendChild(h('p', { class: 'hint', style: { marginTop: '10px', marginBottom: 0 } },
      `${entities.length} Record(s): ${entities.map((e) => pascal(e.name)).join(', ')}`));
  }
  main.appendChild(optionsCard);

  // -------------------------------------------------------------- output
  const bar = h('div', { class: 'diagram-bar' },
    h('span', { class: 'title' }, tab === 'openapi' ? 'OpenAPI 3.1' : 'Avro-Schema'),
    h('button', {
      class: 'btn small ai-btn',
      onclick: () => openAiDialog({
        title: tab === 'openapi' ? 'OpenAPI-Spezifikation (3.1)' : 'Avro-Schema (JSON)',
        section: 'datamodel',
        project: p,
        currentSource: current(),
        systemPrompt: schemaPrompt(),
        sourceLabel: tab === 'openapi' ? 'Aktuelle OpenAPI-Fassung' : 'Aktuelle Avro-Fassung',
        artefactLabel: tab === 'openapi' ? 'OpenAPI' : 'Avro',
        quickPrompts: SCHEMA_PROMPTS[tab],
        extract: extractCode,
        onApply: (text) => {
          patch(() => { spec.custom = text; });
          renderSchemas(main, ctx);
          toast('Vorschlag übernommen');
        },
        onOpenSettings: () => document.dispatchEvent(new CustomEvent('umllight:settings', { detail: { focus: 'ai' } })),
      }),
    }, '✨ KI'),
    h('button', { class: 'btn small', onclick: () => copyText(current()) }, 'Kopieren'),
    h('button', {
      class: 'btn small',
      onclick: () => download(fileName(), current(),
        fileName().endsWith('.yaml') ? 'text/yaml' : 'application/json'),
    }, 'Herunterladen'),
    isCustom
      ? h('button', {
        class: 'btn small',
        onclick: () => { patch(() => { spec.custom = null; }); renderSchemas(main, ctx); toast('Auf generierte Fassung zurückgesetzt'); },
      }, 'Zurücksetzen')
      : h('button', {
        class: 'btn small',
        onclick: () => { patch(() => { spec.custom = generate(); }); renderSchemas(main, ctx); toast('Fassung kann jetzt bearbeitet werden'); },
      }, 'Überschreiben'));

  main.appendChild(h('div', { class: 'diagram' },
    bar,
    h('div', { class: 'diagram-src' }, output),
    h('div', { class: 'row', style: { padding: '8px 10px', borderTop: '1px solid var(--line-soft)' } },
      h('span', { class: 'hint', style: { margin: 0 } },
        isCustom
          ? 'Eigene Fassung — Änderungen am Datenmodell wirken sich nicht mehr aus.'
          : 'Automatisch aus dem Datenmodell erzeugt (schreibgeschützt).'))));

  if (tab === 'avro') {
    main.appendChild(h('div', { class: 'card' },
      h('h2', {}, 'Einzelne Records'),
      h('p', { class: 'hint' }, 'Für Schema-Registries wird meist eine Datei je Record benötigt.'),
      h('div', { class: 'btn-row' },
        entities.map((e) => h('button', {
          class: 'btn small',
          onclick: () => {
            const all = JSON.parse(avroText(p, cfgAll.avro));
            const rec = all.find((r) => r.name === pascal(e.name));
            if (!rec) { toast('Record nicht gefunden', 'err'); return; }
            download(`${slug(pascal(e.name))}.avsc`, JSON.stringify(rec, null, 2), 'application/json');
          },
        }, `${pascal(e.name)}.avsc`)))));
  }
}
