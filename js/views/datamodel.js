// Entities of the robustness model: attributes plus typed relations, drawn as
// an ER-style class diagram. Rendered as the "Entitäten" tab of the
// robustness page.

import { h, clear, field, textInput, textArea, select, listItem, makeSortable, withId,
  confirmDialog, debounce, toast, syncTitle, moveActions, gridTable } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { dataModelUml } from '../generators.js';
import { componentName } from '../robustness.js';

const TYPES = ['String', 'Text', 'Integer', 'Decimal', 'Boolean', 'Date', 'DateTime', 'UUID', 'Enum', 'JSON', 'Blob'];
const KEYS = [['', '—'], ['pk', 'PK'], ['fk', 'FK']];
const REL_TYPES = [
  ['1-n', '1 : n'], ['n-1', 'n : 1'], ['1-1', '1 : 1'], ['n-m', 'n : m'],
  ['0-1', '0..1 : 0..1'], ['0-n', '0..1 : 0..n'], ['inherit', 'Vererbung'],
  ['compose', 'Komposition'], ['aggregate', 'Aggregation'],
];

/**
 * @param {HTMLElement} main   container to append to
 * @param {object} ctx
 * @param {() => void} [onChange]  called after changes that affect other diagrams
 */
export function renderEntityEditor(main, ctx, onChange = () => {}) {
  const p = ctx.project;
  const dm = p.dataModel;
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
  // mutate the model immediately, batch the write to localStorage
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  let diagram;
  const refresh = () => { if (diagram) diagram.refresh(); onChange(); };
  const patchAndDraw = (fn) => { patch(fn); refresh(); };
  const redrawSoon = debounce(() => refresh(), 700);
  const componentOpts = () => [['', '— keine —'],
    ...(p.robustness.components || []).map((c) => [c.id, c.name || 'Komponente'])];

  diagram = diagramPanel({
    title: 'Datenmodell-Diagramm',
    project: p,
    section: 'datamodel',
    fileName: `${p.name}-datamodel`,
    generate: () => dataModelUml(dm, p.name, p.robustness.components),
    getCustom: () => dm.custom,
    setCustom: (val) => patch((prj) => { prj.dataModel.custom = val; }),
  });
  main.appendChild(diagram);

  // -------------------------------------------------------- attributes
  const attributeTable = (e) => {
    const wrap = h('div', { class: 'table-wrap' });
    const rebuild = () => {
      clear(wrap);
      e.attributes ||= [];
      const rows = e.attributes.map((a, i) => [
        textInput(a.name, (val) => { a.name = val; save(() => {}); redrawSoon(); }, { placeholder: 'name' }),
        h('input', {
          type: 'text', value: a.type || '', list: 'dm-types', placeholder: 'Typ',
          oninput: (ev) => { a.type = ev.target.value; save(() => {}); redrawSoon(); },
        }),
        select(a.key || '', KEYS, (val) => { a.key = val; patchAndDraw(() => {}); }),
        h('label', { class: 'row', style: { gap: '6px' } }, h('input', {
          type: 'checkbox', checked: !!a.required, style: { width: 'auto' },
          onchange: (ev) => { a.required = ev.target.checked; patchAndDraw(() => {}); },
        }), h('span', { class: 'only-narrow-inline hint', style: { margin: 0 } }, 'Pflichtfeld')),
        h('button', {
          class: 'btn small ghost',
          onclick: () => { e.attributes.splice(i, 1); patchAndDraw(() => {}); rebuild(); },
        }, '✕ Entfernen'),
      ]);
      wrap.appendChild(gridTable(['Attribut', 'Typ', 'Schlüssel', 'Pflicht', ''], rows));
      wrap.appendChild(h('button', {
        class: 'btn small', style: { marginTop: '8px' },
        onclick: () => {
          e.attributes.push({ name: '', type: 'String', key: e.attributes.length ? '' : 'pk', required: false });
          patch(() => {});
          rebuild();
        },
      }, '+ Attribut'));
    };
    rebuild();
    return wrap;
  };

  // ---------------------------------------------------------- entities
  const entWrap = h('div', {});
  const renderEntities = () => {
    clear(entWrap);
    if (!dm.entities.length) entWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Entitäten.'));
    for (const e of dm.entities) {
      entWrap.appendChild(withId(listItem({
        title: e.name || 'Entität',
        meta: [componentName(p, e.componentId), `${(e.attributes || []).length} Attribute`].filter(Boolean).join(' · '),
        actions: [...moveActions(dm.entities, e.id, () => { patchAndDraw(() => {}); renderEntities(); }), h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Entität löschen?', `„${e.name}" und ihre Beziehungen werden entfernt.`))) return;
            patchAndDraw((prj) => {
              prj.dataModel.entities = prj.dataModel.entities.filter((x) => x.id !== e.id);
              prj.dataModel.relations = prj.dataModel.relations.filter((r) => r.from !== e.id && r.to !== e.id);
              prj.robustness.links = prj.robustness.links.filter((l) => l.from !== e.id && l.to !== e.id);
            });
            renderEntities();
            renderRelations();
          },
        }, 'Löschen')],
        body: () => h('div', {},
          h('div', { class: 'grid-2' },
            field('Name', textInput(e.name, function (val) { e.name = val; syncTitle(this, val, 'Entität'); save(() => {}); redrawSoon(); })),
            field('Stereotyp', textInput(e.stereotype, (val) => { e.stereotype = val; save(() => {}); redrawSoon(); },
              { placeholder: 'z. B. Aggregate Root, Value Object' }))),
          field('Business-Komponente', select(e.componentId || '', componentOpts(),
            (val) => { e.componentId = val; patchAndDraw(() => {}); })),
          field('Beschreibung', textArea(e.description, (val) => { e.description = val; save(() => {}); }, { rows: 2 })),
          h('h3', {}, 'Attribute'),
          attributeTable(e)),
      }), e.id));
    }
  };

  main.appendChild(h('datalist', { id: 'dm-types' }, TYPES.map((t) => h('option', { value: t }))));
  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Entitäten'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          patchAndDraw((prj) => prj.dataModel.entities.push({
            id: store.uid('ent'), name: 'NeueEntität', stereotype: '', description: '',
            // like boundaries and controls: new entities join the component in focus
            componentId: prj.robustness.components.some((c) => c.id === ctx.robustFocus) ? ctx.robustFocus : '',
            attributes: [{ name: 'id', type: 'UUID', key: 'pk', required: true }],
          }));
          renderEntities();
          renderRelations();
        },
      }, '+ Entität')),
    entWrap));
  renderEntities();
  makeSortable(entWrap, (ids) => patchAndDraw((prj) =>
    prj.dataModel.entities.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id))));

  // --------------------------------------------------------- relations
  const relWrap = h('div', { class: 'table-wrap' });
  const renderRelations = () => {
    clear(relWrap);
    if (!dm.entities.length) { relWrap.appendChild(h('div', { class: 'empty' }, 'Zuerst Entitäten anlegen.')); return; }
    if (!dm.relations.length) { relWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Beziehungen.')); return; }
    const opts = dm.entities.map((e) => [e.id, e.name || 'Entität']);
    relWrap.appendChild(gridTable(['Von', 'Beziehung', 'Nach', 'Bezeichnung', ''],
      dm.relations.map((r, i) => [
        select(r.from, opts, (val) => { r.from = val; patchAndDraw(() => {}); }),
        select(r.type || '1-n', REL_TYPES, (val) => { r.type = val; patchAndDraw(() => {}); }),
        select(r.to, opts, (val) => { r.to = val; patchAndDraw(() => {}); }),
        textInput(r.label, (val) => { r.label = val; save(() => {}); redrawSoon(); }, { placeholder: 'z. B. besitzt' }),
        h('button', {
          class: 'btn small ghost',
          onclick: () => { patchAndDraw((prj) => prj.dataModel.relations.splice(i, 1)); renderRelations(); },
        }, '✕ Entfernen'),
      ])));
  };

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Beziehungen'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          if (!dm.entities.length) { toast('Zuerst eine Entität anlegen', 'err'); return; }
          patchAndDraw((prj) => prj.dataModel.relations.push({
            from: dm.entities[0].id, to: dm.entities[Math.min(1, dm.entities.length - 1)].id, type: '1-n', label: '',
          }));
          renderRelations();
        },
      }, '+ Beziehung')),
    relWrap));
  renderRelations();
}
