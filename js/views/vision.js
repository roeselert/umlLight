// Product vision: goals, non-goals and constraints of the application.

import { h, clear, field, textInput, textArea } from '../ui.js';
import * as store from '../store.js';

function listEditor(items, onChange, placeholder) {
  const wrap = h('div', { class: 'stack' });
  const rebuild = () => {
    clear(wrap);
    items.forEach((val, i) => {
      wrap.appendChild(h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        h('input', {
          type: 'text', value: val, placeholder,
          oninput: (e) => { items[i] = e.target.value; onChange(); },
        }),
        h('button', {
          class: 'btn small ghost', title: 'Entfernen',
          onclick: () => { items.splice(i, 1); onChange(); rebuild(); },
        }, '✕')));
    });
    wrap.appendChild(h('button', {
      class: 'btn small', onclick: () => { items.push(''); onChange(); rebuild(); },
    }, '+ Hinzufügen'));
  };
  rebuild();
  return wrap;
}

export function renderVision(main, ctx) {
  clear(main);
  main.classList.add('main-narrow');
  const p = ctx.project;
  const v = p.vision;
  // mutate the model immediately, batch the write to localStorage
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'Produktvision'),
      h('p', { class: 'hint' }, 'Wofür gibt es die Anwendung? Die Vision ist der Bezugspunkt für alle weiteren Modelle.'))));

  // --- project meta
  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Projekt'),
    field('Name', textInput(p.name, (val) => save((prj) => { prj.name = val; ctx.refreshChrome(val); }))),
    field('Kurzbeschreibung', textArea(p.summary, (val) => save((prj) => { prj.summary = val; }),
      { rows: 2, placeholder: 'Ein bis zwei Sätze, worum es geht.' }))));

  // --- goals
  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Ziele'),
    h('p', { class: 'hint' }, 'Messbare Ergebnisse, an denen der Erfolg der Anwendung gemessen wird.'),
    listEditor(v.goals, () => save(() => {}), 'z. B. Spezifikation in < 1 Tag erstellbar')));

  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Nicht-Ziele'),
    h('p', { class: 'hint' }, 'Was die Anwendung bewusst nicht leistet — schützt vor Scope Creep.'),
    listEditor(v.nonGoals, () => save(() => {}), 'z. B. keine Code-Generierung')));

  main.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Rahmenbedingungen'),
    textArea(v.constraints, (val) => save((prj) => { prj.vision.constraints = val; }),
      { rows: 4, placeholder: 'Technische, rechtliche oder organisatorische Randbedingungen.' })));
}
