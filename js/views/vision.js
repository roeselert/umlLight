// Product vision: elevator-pitch template, goals, non-goals, constraints.

import { h, clear, field, textInput, textArea, toast, copyText } from '../ui.js';
import * as store from '../store.js';

const TEMPLATE_FIELDS = [
  ['forWhom', 'Für (Zielgruppe)', 'z. B. Projektleitende im Anlagenbau'],
  ['who', 'die (Bedarf/Situation)', 'z. B. Anforderungen strukturiert festhalten müssen'],
  ['problem', 'das Problem (das gelöst wird)', 'z. B. Spezifikationen verteilt in Dokumenten und Chats liegen'],
  ['productName', 'ist (Produktname)', 'z. B. umlLight'],
  ['category', 'ein/e (Produktkategorie)', 'z. B. leichtgewichtige Spezifikations-PWA'],
  ['keyBenefit', 'das/die (Hauptnutzen)', 'z. B. Modelle und Diagramme an einem Ort hält'],
  ['alternative', 'anders als (Alternative)', 'z. B. schwergewichtige UML-Suiten'],
  ['differentiator', 'bietet unser Produkt (Alleinstellung)', 'z. B. Offline-fähig, ohne Installation, PlantUML als Quelle'],
];

function buildStatement(v) {
  const p = (s) => String(s || '').trim();
  if (!p(v.forWhom) && !p(v.productName)) return '';
  const clauses = [
    p(v.who) ? `die ${p(v.who)}` : null,
    p(v.problem) ? `und für die ${p(v.problem)}` : null,
  ].filter(Boolean);
  const lead = [`Für ${p(v.forWhom) || '…'}`, ...clauses].join(', ');
  let out = `${lead}${clauses.length ? ',' : ''} ist ${p(v.productName) || '…'} ein/e ${p(v.category) || '…'}`;
  out += p(v.keyBenefit) ? `, das/die ${p(v.keyBenefit)}.` : '.';
  if (p(v.alternative)) {
    out += ` Anders als ${p(v.alternative)}`;
    out += p(v.differentiator) ? ` bietet unser Produkt ${p(v.differentiator)}.` : '.';
  } else if (p(v.differentiator)) {
    out += ` Unser Produkt bietet ${p(v.differentiator)}.`;
  }
  return out;
}

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
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
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

  // --- elevator pitch
  const statementArea = textArea(v.statement, (val) => save((prj) => { prj.vision.statement = val; }),
    { rows: 4, placeholder: 'Visionssatz — frei formulierbar oder aus den Feldern unten erzeugen.' });

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Visionssatz'),
      h('button', {
        class: 'btn small',
        onclick: () => {
          const text = buildStatement(v);
          if (!text) { toast('Bitte zuerst die Felder unten ausfüllen', 'err'); return; }
          statementArea.value = text;
          patch((prj) => { prj.vision.statement = text; });
          toast('Visionssatz erzeugt');
        },
      }, 'Aus Feldern erzeugen'),
      h('button', { class: 'btn small ghost', onclick: () => copyText(statementArea.value) }, 'Kopieren')),
    statementArea,
    h('div', { class: 'grid-2', style: { marginTop: '14px' } },
      TEMPLATE_FIELDS.map(([key, label, ph]) => field(label,
        textInput(v[key], (val) => save((prj) => { prj.vision[key] = val; }), { placeholder: ph }))))));

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
