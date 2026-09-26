// Robustness model (boundary–control–entity), grouped by business components:
// boundaries are screens, APIs or external interfaces; controls carry the
// logic as free text; entities are the data model. Interactions between them
// make up the robustness diagram.

import { h, clear, field, textInput, textArea, select, listItem, makeSortable, withId,
  confirmDialog, debounce, toast, syncTitle, moveActions, gridTable } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { robustnessUml } from '../generators.js';
import {
  KINDS, BOUNDARY_KINDS, HTTP_METHODS, participants, ruleViolation, generatedOperations, opKey, componentName,
} from '../robustness.js';
import { renderEntityEditor } from './datamodel.js';

const TABS = [
  ['components', 'Komponenten'],
  ['boundaries', 'Boundaries'],
  ['controls', 'Controls'],
  ['entities', 'Entitäten'],
  ['links', 'Interaktionen'],
];

export function renderRobustness(main, ctx) {
  clear(main);
  const p = ctx.project;
  const rb = p.robustness;
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
  // mutate the model immediately, batch the write to localStorage
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  let tab = TABS.some(([k]) => k === ctx.robustTab) ? ctx.robustTab : 'components';
  let focus = rb.components.some((c) => c.id === ctx.robustFocus) ? ctx.robustFocus : '';
  // items stay expanded across re-renders of their list
  const expanded = new Set();

  let diagram;
  const refresh = () => diagram && diagram.refresh();
  const patchAndDraw = (fn) => { patch(fn); refresh(); };
  const redrawSoon = debounce(() => refresh(), 700);

  const componentOpts = () => [['', '— keine —'], ...rb.components.map((c) => [c.id, c.name || 'Komponente'])];

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'Robustheitsmodell'),
      h('p', { class: 'hint' },
        'Boundaries (Masken, APIs, Fremdsysteme), Controls (Logik) und Entitäten (Daten), gruppiert nach Business-Komponenten. Die Interaktionen dazwischen ergeben das Robustheitsdiagramm.'))));

  // ------------------------------------------------------------ diagram
  const filterWrap = h('div', {});
  const diagramWrap = h('div', {});
  const buildDiagram = () => {
    clear(filterWrap);
    if (rb.components.length) {
      filterWrap.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('span', { class: 'hint', style: { margin: 0 } }, 'Ansicht'),
        select(focus, [['', 'Alle Komponenten'], ...rb.components.map((c) => [c.id, c.name || 'Komponente'])],
          (val) => { focus = val; ctx.robustFocus = val; buildDiagram(); }, { style: { width: 'auto' } })));
    }
    clear(diagramWrap);
    const comp = rb.components.find((c) => c.id === focus);
    // the hand-written override belongs to the full diagram; component views
    // are always generated
    diagram = diagramPanel(comp ? {
      title: `Robustheitsdiagramm — ${comp.name || 'Komponente'}`,
      fileName: `${p.name}-robustheit-${comp.name || 'komponente'}`,
      generate: () => robustnessUml(p, { componentId: comp.id }),
    } : {
      title: 'Robustheitsdiagramm',
      project: p,
      section: 'robustness',
      fileName: `${p.name}-robustheit`,
      generate: () => robustnessUml(p),
      getCustom: () => rb.custom,
      setCustom: (val) => patch((prj) => { prj.robustness.custom = val; }),
    });
    diagramWrap.appendChild(diagram);
  };
  main.appendChild(filterWrap);
  main.appendChild(diagramWrap);
  buildDiagram();

  // --------------------------------------------------------------- tabs
  const tabBar = h('div', { class: 'tabs', style: { marginTop: '18px' } });
  const body = h('div', {});
  const counts = () => ({
    components: rb.components.length,
    boundaries: rb.boundaries.length,
    controls: rb.controls.length,
    entities: p.dataModel.entities.length,
    links: rb.links.length,
  });
  const renderTabBar = () => {
    clear(tabBar);
    const n = counts();
    for (const [key, label] of TABS) {
      tabBar.appendChild(h('button', {
        class: `tab ${tab === key ? 'active' : ''}`,
        onclick: () => { tab = key; ctx.robustTab = key; renderTabBar(); renderBody(); },
      }, label, h('span', { class: 'hint', style: { margin: '0 0 0 6px' } }, String(n[key]))));
    }
  };
  // structural change: redraw, update counts
  const changed = (fn) => { patchAndDraw(fn); renderTabBar(); };

  const renderBody = () => {
    clear(body);
    ({
      components: renderComponents,
      boundaries: renderBoundaries,
      controls: renderControls,
      entities: () => renderEntityEditor(body, ctx, () => { refresh(); renderTabBar(); }),
      links: renderLinks,
    })[tab]();
  };

  main.appendChild(tabBar);
  main.appendChild(body);

  const card = (title, addLabel, onAdd, content, hint) => h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, title),
      onAdd ? h('button', { class: 'btn small primary', onclick: onAdd }, addLabel) : null),
    hint ? h('p', { class: 'hint' }, hint) : null,
    content);

  const deleteAction = (label, what, run) => h('button', {
    class: 'btn small danger',
    onclick: async () => {
      if (!(await confirmDialog(`${label} löschen?`, what))) return;
      run();
    },
  }, 'Löschen');

  const item = (list, obj, opts, rerender) => withId(listItem({
    ...opts,
    open: expanded.has(obj.id),
    onToggle: (show) => { if (show) expanded.add(obj.id); else expanded.delete(obj.id); },
    actions: [...moveActions(list, obj.id, () => { patchAndDraw(() => {}); rerender(); }), ...(opts.actions || [])],
  }), obj.id);

  const sortable = (wrap, key) => makeSortable(wrap, (ids) => patchAndDraw((prj) =>
    prj.robustness[key].sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id))));

  const removeElement = (key, id) => changed((prj) => {
    prj.robustness[key] = prj.robustness[key].filter((x) => x.id !== id);
    prj.robustness.links = prj.robustness.links.filter((l) => l.from !== id && l.to !== id);
  });

  // --------------------------------------------------------- components
  function renderComponents() {
    const wrap = h('div', {});
    const members = (id) => participants(p).filter((x) => x.kind !== 'actor' && x.componentId === id);
    const rebuild = () => {
      clear(wrap);
      if (!rb.components.length) wrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Business-Komponenten.'));
      for (const c of rb.components) {
        const m = members(c.id);
        const tally = ['boundary', 'control', 'entity']
          .map((k) => `${m.filter((x) => x.kind === k).length} ${KINDS[k].short}`).join(' · ');
        wrap.appendChild(item(rb.components, c, {
          title: c.name || 'Komponente',
          meta: tally,
          actions: [deleteAction('Komponente', `„${c.name}" wird entfernt. Ihre Elemente bleiben erhalten und sind danach keiner Komponente zugeordnet.`, () => {
            changed((prj) => {
              prj.robustness.components = prj.robustness.components.filter((x) => x.id !== c.id);
              for (const x of [...prj.robustness.boundaries, ...prj.robustness.controls, ...prj.dataModel.entities]) {
                if (x.componentId === c.id) x.componentId = '';
              }
            });
            if (focus === c.id) { focus = ''; buildDiagram(); }
            rebuild();
          })],
          body: () => h('div', {},
            field('Name', textInput(c.name, function (val) { c.name = val; syncTitle(this, val, 'Komponente'); save(() => {}); redrawSoon(); })),
            field('Verantwortung / Beschreibung', textArea(c.description, (val) => { c.description = val; save(() => {}); }, { rows: 3 })),
            h('h3', {}, 'Elemente'),
            m.length
              ? h('div', { class: 'chips' }, m.map((x) => h('span', { class: 'chip' }, `${KINDS[x.kind].short} · ${x.name}`)))
              : h('p', { class: 'hint' }, 'Noch keine Elemente — Boundaries, Controls und Entitäten lassen sich in ihren Tabs zuordnen.'),
            h('div', { class: 'btn-row', style: { marginTop: '10px' } },
              h('button', {
                class: 'btn small',
                onclick: () => { focus = c.id; ctx.robustFocus = c.id; buildDiagram(); main.scrollTo({ top: 0, behavior: 'smooth' }); },
              }, 'Im Diagramm zeigen'))),
        }, rebuild));
      }
    };
    body.appendChild(card('Business-Komponenten', '+ Komponente', () => {
      const c = { id: store.uid('cmp'), name: 'Neue Komponente', description: '' };
      expanded.add(c.id);
      changed((prj) => prj.robustness.components.push(c));
      rebuild();
      buildDiagram();
    }, wrap, 'Fachliche Bausteine, die zusammengehörige Boundaries, Controls und Entitäten bündeln.'));
    rebuild();
    sortable(wrap, 'components');
  }

  // --------------------------------------------------------- boundaries
  function elementsEditor(b) {
    const wrap = h('div', { class: 'stack' });
    const rebuild = () => {
      clear(wrap);
      b.elements ||= [];
      b.elements.forEach((el, i) => wrap.appendChild(h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        textInput(el, (val) => { b.elements[i] = val; save(() => {}); },
          { placeholder: 'z. B. Liste der Aufträge, Button „Speichern"' }),
        h('button', { class: 'btn small ghost', onclick: () => { b.elements.splice(i, 1); patch(() => {}); rebuild(); } }, '✕'))));
      wrap.appendChild(h('button', {
        class: 'btn small', onclick: () => { b.elements.push(''); patch(() => {}); rebuild(); },
      }, '+ Element'));
    };
    rebuild();
    return wrap;
  }

  function operationsEditor(b) {
    const wrap = h('div', {});
    const generated = generatedOperations(p);
    const known = new Set(generated.map(opKey));
    const listId = `ops-${b.id}`;
    const rebuild = () => {
      clear(wrap);
      b.operations ||= [];
      if (b.operations.length) {
        wrap.appendChild(h('div', { class: 'table-wrap' }, gridTable(['Methode', 'Pfad', 'Zweck', 'OpenAPI', ''],
          b.operations.map((op, i) => {
            const chip = h('span', { class: 'chip' });
            const status = () => {
              const ok = known.has(opKey(op));
              chip.className = `chip ${ok ? 'on' : ''}`;
              chip.textContent = ok ? 'generiert' : 'wird ergänzt';
              chip.title = ok ? 'Durch die CRUD-Endpunkte des Datenmodells abgedeckt'
                : 'Wird als eigener Endpunkt in die OpenAPI-Spezifikation aufgenommen';
            };
            status();
            return [
              select(op.method || 'GET', HTTP_METHODS, (val) => { op.method = val; status(); patchAndDraw(() => {}); }),
              h('input', {
                type: 'text', value: op.path || '', list: listId, placeholder: '/auftraege/{id}', spellcheck: 'false',
                oninput: (e) => { op.path = e.target.value; status(); save(() => {}); redrawSoon(); },
              }),
              textInput(op.summary, (val) => { op.summary = val; save(() => {}); }, { placeholder: 'z. B. Auftrag freigeben' }),
              chip,
              h('button', { class: 'btn small ghost', onclick: () => { b.operations.splice(i, 1); patchAndDraw(() => {}); rebuild(); } }, '✕ Entfernen'),
            ];
          }))));
      } else {
        wrap.appendChild(h('p', { class: 'hint' }, 'Noch keine Operationen verknüpft.'));
      }
      const unused = generated.filter((g) => !b.operations.some((o) => opKey(o) === opKey(g)));
      wrap.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', {
          class: 'btn small',
          onclick: () => { b.operations.push({ method: 'GET', path: '', summary: '' }); patch(() => {}); rebuild(); },
        }, '+ Operation'),
        unused.length ? select('', [['', 'Aus generierter API übernehmen …'],
          ...unused.map((g) => [opKey(g), `${opKey(g)}${g.summary ? ` — ${g.summary}` : ''}`])], (val) => {
          const g = unused.find((x) => opKey(x) === val);
          if (!g) return;
          b.operations.push({ method: g.method, path: g.path, summary: g.summary });
          patchAndDraw(() => {});
          rebuild();
        }, { style: { width: 'auto', flex: '1 1 220px' } }) : null));
    };
    rebuild();
    return h('div', {},
      h('datalist', { id: listId }, [...new Set(generated.map((g) => g.path))].map((path) => h('option', { value: path }))),
      wrap);
  }

  function renderBoundaries() {
    const wrap = h('div', {});
    const rebuild = () => {
      clear(wrap);
      if (!rb.boundaries.length) wrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Boundaries.'));
      for (const b of rb.boundaries) {
        const kindLabel = BOUNDARY_KINDS.find(([k]) => k === b.kind)?.[1] || 'Boundary';
        const detail = b.kind === 'api' ? `${(b.operations || []).length} Operationen`
          : (b.kind === 'ui' ? `${(b.elements || []).length} Elemente` : '');
        wrap.appendChild(item(rb.boundaries, b, {
          title: b.name || 'Boundary',
          meta: [kindLabel, componentName(p, b.componentId), detail].filter(Boolean).join(' · '),
          actions: [deleteAction('Boundary', `„${b.name}" und ihre Interaktionen werden entfernt.`, () => {
            removeElement('boundaries', b.id);
            rebuild();
          })],
          body: () => h('div', {},
            h('div', { class: 'grid-2' },
              field('Name', textInput(b.name, function (val) { b.name = val; syncTitle(this, val, 'Boundary'); save(() => {}); redrawSoon(); })),
              field('Art', select(b.kind || 'ui', BOUNDARY_KINDS, (val) => { b.kind = val; patchAndDraw(() => {}); rebuild(); }))),
            field('Business-Komponente', select(b.componentId || '', componentOpts(),
              (val) => { b.componentId = val; patchAndDraw(() => {}); })),
            field('Beschreibung / Zweck', textArea(b.description, (val) => { b.description = val; save(() => {}); }, { rows: 2 })),
            b.kind === 'api' ? h('div', {},
              h('h3', {}, 'API-Operationen'),
              h('p', { class: 'hint' }, 'Endpunkte, über die diese Boundary angesprochen wird. Neue Endpunkte werden in die OpenAPI-Spezifikation übernommen.'),
              operationsEditor(b)) : null,
            b.kind === 'ui' ? h('div', {}, h('h3', {}, 'Elemente'), elementsEditor(b)) : null),
        }, rebuild));
      }
    };
    body.appendChild(card('Boundaries', '+ Boundary', () => {
      const b = {
        id: store.uid('bnd'), name: 'Neue Boundary', kind: 'ui', componentId: focus,
        description: '', elements: [], operations: [],
      };
      expanded.add(b.id);
      changed((prj) => prj.robustness.boundaries.push(b));
      rebuild();
    }, wrap, 'Schnittstellen nach außen: Masken und Dialoge, APIs oder Anbindungen an Fremdsysteme.'));
    rebuild();
    sortable(wrap, 'boundaries');
  }

  // ----------------------------------------------------------- controls
  function renderControls() {
    const wrap = h('div', {});
    const rebuild = () => {
      clear(wrap);
      if (!rb.controls.length) wrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Controls.'));
      for (const c of rb.controls) {
        wrap.appendChild(item(rb.controls, c, {
          title: c.name || 'Control',
          meta: [componentName(p, c.componentId), (c.spec || '').trim() ? '' : 'ohne Spezifikation'].filter(Boolean).join(' · '),
          actions: [deleteAction('Control', `„${c.name}" und seine Interaktionen werden entfernt.`, () => {
            removeElement('controls', c.id);
            rebuild();
          })],
          body: () => h('div', {},
            h('div', { class: 'grid-2' },
              field('Name', textInput(c.name, function (val) { c.name = val; syncTitle(this, val, 'Control'); save(() => {}); redrawSoon(); })),
              field('Business-Komponente', select(c.componentId || '', componentOpts(),
                (val) => { c.componentId = val; patchAndDraw(() => {}); }))),
            field('Spezifikation', textArea(c.spec, (val) => { c.spec = val; save(() => {}); }, {
              rows: 7, placeholder: 'Was prüft, berechnet oder steuert dieses Control? Regeln, Abläufe, Fehlerfälle …',
            }), 'Freitext — wird im Markdown-Export vollständig übernommen.')),
        }, rebuild));
      }
    };
    body.appendChild(card('Controls', '+ Control', () => {
      const c = { id: store.uid('ctl'), name: 'Neues Control', componentId: focus, spec: '' };
      expanded.add(c.id);
      changed((prj) => prj.robustness.controls.push(c));
      rebuild();
    }, wrap, 'Fachlogik zwischen Boundaries und Entitäten — frei als Text spezifiziert.'));
    rebuild();
    sortable(wrap, 'controls');
  }

  // --------------------------------------------------------------- links
  function participantSelect(value, onchange) {
    const all = participants(p);
    const el = h('select', { onchange: (e) => onchange(e.target.value) },
      Object.entries(KINDS).map(([kind, { label }]) => {
        const opts = all.filter((x) => x.kind === kind);
        if (!opts.length) return null;
        return h('optgroup', { label },
          opts.map((x) => {
            const comp = componentName(p, x.componentId);
            return h('option', { value: x.id, selected: x.id === value }, comp ? `${x.name} (${comp})` : x.name);
          }));
      }));
    if (!all.some((x) => x.id === value)) {
      el.insertBefore(h('option', { value, selected: true }, '— gelöscht —'), el.firstChild);
    }
    el.value = value ?? '';
    return el;
  }

  function renderLinks() {
    const wrap = h('div', { class: 'table-wrap' });
    const rebuild = () => {
      clear(wrap);
      const all = participants(p);
      if (all.filter((x) => x.kind !== 'actor').length < 2) {
        wrap.appendChild(h('div', { class: 'empty' }, 'Zuerst Boundaries, Controls oder Entitäten anlegen.'));
        return;
      }
      if (!rb.links.length) { wrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Interaktionen.')); return; }
      const kindOf = (id) => all.find((x) => x.id === id)?.kind;
      wrap.appendChild(gridTable(['Von', 'Nach', 'Bezeichnung', 'Regel', ''],
        rb.links.map((l, i) => {
          const rule = h('span', {});
          const check = () => {
            const why = ruleViolation(kindOf(l.from), kindOf(l.to));
            clear(rule);
            rule.appendChild(why
              ? h('span', { class: 'chip warn', title: why }, why)
              : h('span', { class: 'chip on' }, 'ok'));
          };
          check();
          return [
            participantSelect(l.from, (val) => { l.from = val; check(); patchAndDraw(() => {}); }),
            participantSelect(l.to, (val) => { l.to = val; check(); patchAndDraw(() => {}); }),
            textInput(l.label, (val) => { l.label = val; save(() => {}); redrawSoon(); }, { placeholder: 'z. B. absenden, liest' }),
            rule,
            h('button', {
              class: 'btn small ghost',
              onclick: () => { changed((prj) => prj.robustness.links.splice(i, 1)); rebuild(); },
            }, '✕ Entfernen'),
          ];
        })));
    };
    body.appendChild(card('Interaktionen', '+ Interaktion', () => {
      // start with the first pair the robustness rules allow
      const all = participants(p);
      const pairs = all.flatMap((a) => all.filter((b) => b !== a).map((b) => [a, b]));
      const [from, to] = pairs.find(([a, b]) => !ruleViolation(a.kind, b.kind)) || pairs[0] || [];
      if (!from) { toast('Zuerst Boundaries, Controls oder Entitäten anlegen', 'err'); return; }
      changed((prj) => prj.robustness.links.push({ from: from.id, to: to.id, label: '' }));
      rebuild();
    }, wrap, 'Regeln: Akteur ↔ Boundary, Boundary ↔ Control, Control ↔ Control/Entität. Verstöße werden markiert, aber nicht verhindert. Akteure kommen aus dem Use-Case-Modell.'));
    rebuild();
  }

  renderTabBar();
  renderBody();
}
