// View model: screens/views with navigation plus free-form activity diagrams.

import { h, clear, field, textInput, textArea, select, listItem, makeSortable, withId,
  confirmDialog, debounce, toast, syncTitle } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { viewModelUml, ACTIVITY_TEMPLATE } from '../generators.js';

export function renderViewModel(main, ctx) {
  clear(main);
  const p = ctx.project;
  const vm = p.viewModel;
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
  // mutate the model immediately, batch the write to localStorage
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  let navDiagram;
  const refresh = () => navDiagram && navDiagram.refresh();
  const patchAndDraw = (fn) => { patch(fn); refresh(); };
  const redrawSoon = debounce(() => refresh(), 700);

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'View-Modell & Abläufe'),
      h('p', { class: 'hint' }, 'Views/Masken mit ihren Elementen und der Navigation dazwischen, plus Aktivitätsdiagramme für einzelne Abläufe.'))));

  navDiagram = diagramPanel({
    title: 'Navigationsdiagramm',
    fileName: `${p.name}-viewmodel`,
    generate: () => viewModelUml(vm, p.name),
    getCustom: () => vm.custom,
    setCustom: (val) => patch((prj) => { prj.viewModel.custom = val; }),
  });
  main.appendChild(navDiagram);

  // -------------------------------------------------------------- views
  const elementsEditor = (v) => {
    const wrap = h('div', { class: 'stack' });
    const rebuild = () => {
      clear(wrap);
      v.elements ||= [];
      v.elements.forEach((el, i) => wrap.appendChild(h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        textInput(el, (val) => { v.elements[i] = val; save(() => {}); redrawSoon(); },
          { placeholder: 'z. B. Liste der Projekte, Button „Speichern"' }),
        h('button', { class: 'btn small ghost', onclick: () => { v.elements.splice(i, 1); patchAndDraw(() => {}); rebuild(); } }, '✕'))));
      wrap.appendChild(h('button', {
        class: 'btn small', onclick: () => { v.elements.push(''); patch(() => {}); rebuild(); },
      }, '+ Element'));
    };
    rebuild();
    return wrap;
  };

  const viewsWrap = h('div', {});
  const renderViews = () => {
    clear(viewsWrap);
    if (!vm.views.length) viewsWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Views.'));
    for (const v of vm.views) {
      viewsWrap.appendChild(withId(listItem({
        title: v.name || 'View',
        meta: v.start ? 'Einstieg' : `${(v.elements || []).length} Elemente`,
        actions: [h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('View löschen?', `„${v.name}" und zugehörige Übergänge werden entfernt.`))) return;
            patchAndDraw((prj) => {
              prj.viewModel.views = prj.viewModel.views.filter((x) => x.id !== v.id);
              prj.viewModel.links = prj.viewModel.links.filter((l) => l.from !== v.id && l.to !== v.id);
            });
            renderViews();
            renderLinks();
          },
        }, 'Löschen')],
        body: () => h('div', {},
          h('div', { class: 'grid-2' },
            field('Name', textInput(v.name, function (val) { v.name = val; syncTitle(this, val, 'View'); save(() => {}); redrawSoon(); })),
            field('Typ', select(v.kind || 'screen',
              [['screen', 'Maske / Seite'], ['dialog', 'Dialog'], ['report', 'Auswertung'], ['external', 'Externe Ansicht']],
              (val) => { v.kind = val; patch(() => {}); }))),
          h('label', { class: 'row', style: { marginBottom: '12px' } },
            h('input', {
              type: 'checkbox', checked: !!v.start, style: { width: 'auto' },
              onchange: (e) => { v.start = e.target.checked; patchAndDraw(() => {}); renderViews(); },
            }),
            h('span', {}, 'Einstiegspunkt der Anwendung')),
          field('Beschreibung / Zweck', textArea(v.description, (val) => { v.description = val; save(() => {}); }, { rows: 2 })),
          h('h3', {}, 'Elemente'),
          elementsEditor(v)),
      }), v.id));
    }
  };

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Views'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          patchAndDraw((prj) => prj.viewModel.views.push({
            id: store.uid('viw'), name: 'Neue View', kind: 'screen', description: '',
            start: !prj.viewModel.views.length, elements: [],
          }));
          renderViews();
          renderLinks();
        },
      }, '+ View')),
    viewsWrap));
  renderViews();
  makeSortable(viewsWrap, (ids) => patchAndDraw((prj) =>
    prj.viewModel.views.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id))));

  // ---------------------------------------------------------- navigation
  const linksWrap = h('div', { class: 'table-wrap' });
  const renderLinks = () => {
    clear(linksWrap);
    if (!vm.views.length) { linksWrap.appendChild(h('div', { class: 'empty' }, 'Zuerst Views anlegen.')); return; }
    if (!vm.links.length) { linksWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Übergänge.')); return; }
    const opts = vm.views.map((v) => [v.id, v.name || 'View']);
    linksWrap.appendChild(h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Von', 'Nach', 'Auslöser', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, vm.links.map((l, i) => h('tr', {},
        h('td', {}, select(l.from, opts, (val) => { l.from = val; patchAndDraw(() => {}); })),
        h('td', {}, select(l.to, opts, (val) => { l.to = val; patchAndDraw(() => {}); })),
        h('td', {}, textInput(l.label, (val) => { l.label = val; save(() => {}); redrawSoon(); }, { placeholder: 'z. B. Klick auf „Öffnen"' })),
        h('td', {}, h('button', {
          class: 'btn small ghost',
          onclick: () => { patchAndDraw((prj) => prj.viewModel.links.splice(i, 1)); renderLinks(); },
        }, '✕')))))));
  };

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Navigation'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          if (!vm.views.length) { toast('Zuerst eine View anlegen', 'err'); return; }
          patchAndDraw((prj) => prj.viewModel.links.push({
            from: vm.views[0].id, to: vm.views[Math.min(1, vm.views.length - 1)].id, label: '',
          }));
          renderLinks();
        },
      }, '+ Übergang')),
    linksWrap));
  renderLinks();

  // ---------------------------------------------------------- activities
  const actWrap = h('div', {});
  const renderActivities = () => {
    clear(actWrap);
    if (!vm.activities.length) actWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Ablaufdiagramme.'));
    for (const act of vm.activities) {
      actWrap.appendChild(withId(listItem({
        title: act.name || 'Ablauf',
        actions: [h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Ablauf löschen?', `„${act.name}" wird entfernt.`))) return;
            patch((prj) => { prj.viewModel.activities = prj.viewModel.activities.filter((x) => x.id !== act.id); });
            renderActivities();
          },
        }, 'Löschen')],
        body: () => {
          const panel = diagramPanel({
            title: act.name || 'Ablauf',
            fileName: `${p.name}-${act.name || 'ablauf'}`,
            generate: () => act.uml || ACTIVITY_TEMPLATE,
            getCustom: () => act.uml ?? null,
            setCustom: (val) => patch(() => { act.uml = val === null ? ACTIVITY_TEMPLATE : val; }),
          });
          return h('div', {},
            field('Name', textInput(act.name, function (val) { act.name = val; syncTitle(this, val, 'Ablauf'); save(() => {}); })),
            field('Beschreibung', textArea(act.description, (val) => { act.description = val; save(() => {}); }, { rows: 2 })),
            h('p', { class: 'hint' }, 'Über „Quelle" lässt sich das Aktivitätsdiagramm direkt in PlantUML bearbeiten.'),
            panel);
        },
      }), act.id));
    }
  };

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Ablaufdiagramme'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          patch((prj) => prj.viewModel.activities.push({
            id: store.uid('act'), name: 'Neuer Ablauf', description: '', uml: ACTIVITY_TEMPLATE,
          }));
          renderActivities();
          toast('Ablauf mit Vorlage angelegt');
        },
      }, '+ Ablauf')),
    actWrap));
  renderActivities();
  makeSortable(actWrap, (ids) => patch((prj) =>
    prj.viewModel.activities.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id))));
}
