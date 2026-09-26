// Use-case model: actors, use cases, relations, scenario steps and free-form
// activity diagrams (Abläufe) that use cases link to.

import { h, clear, field, textInput, textArea, select, listItem, makeSortable, withId,
  confirmDialog, debounce, toast, syncTitle, moveActions } from '../ui.js';
import * as store from '../store.js';
import { diagramPanel } from '../diagram.js';
import { useCaseUml, useCaseScenarioUml, ACTIVITY_TEMPLATE } from '../generators.js';

const PRIORITIES = [['normal', 'normal'], ['muss', 'muss'], ['soll', 'soll'], ['kann', 'kann']];

export function renderUseCases(main, ctx) {
  clear(main);
  const p = ctx.project;
  const uc = p.useCases;
  const patch = (fn) => { store.update(p.id, fn); ctx.markSaved(); };
  // mutate the model immediately, batch the write to localStorage
  const save = (fn) => { store.updateSoon(p.id, fn); ctx.markSaved(); };

  let diagram;
  const refresh = () => diagram && diagram.refresh();
  const patchAndDraw = (fn) => { patch(fn); refresh(); };
  const redrawSoon = debounce(() => refresh(), 700);

  main.appendChild(h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', {}, 'Use-Case-Modell'),
      h('p', { class: 'hint' }, 'Akteure, Nutzungsszenarien und ihre Beziehungen. Das Diagramm entsteht automatisch aus dem Modell.'))));

  diagram = diagramPanel({
    title: 'Use-Case-Diagramm',
    project: p,
    section: 'usecases',
    fileName: `${p.name}-usecases`,
    generate: () => useCaseUml(uc, p.name),
    getCustom: () => uc.custom,
    setCustom: (val) => patch((prj) => { prj.useCases.custom = val; }),
  });
  main.appendChild(diagram);

  main.appendChild(h('div', { class: 'card' },
    field('Systemgrenze (Name des Systems)',
      textInput(uc.systemName, (val) => { save((prj) => { prj.useCases.systemName = val; }); redrawSoon(); },
        { placeholder: p.name }))));

  // ------------------------------------------------------------- actors
  const actorsWrap = h('div', {});
  const renderActors = () => {
    clear(actorsWrap);
    if (!uc.actors.length) actorsWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Akteure.'));
    for (const a of uc.actors) {
      const used = uc.useCases.filter((c) => (c.actorIds || []).includes(a.id)).length;
      actorsWrap.appendChild(withId(listItem({
        title: a.name || 'Akteur',
        meta: `${used} UC`,
        actions: [...moveActions(uc.actors, a.id, () => { patchAndDraw(() => {}); renderActors(); }), h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Akteur löschen?', `„${a.name}" und alle Zuordnungen werden entfernt.`))) return;
            patchAndDraw((prj) => {
              prj.useCases.actors = prj.useCases.actors.filter((x) => x.id !== a.id);
              for (const c of prj.useCases.useCases) c.actorIds = (c.actorIds || []).filter((id) => id !== a.id);
              prj.robustness.links = prj.robustness.links.filter((l) => l.from !== a.id && l.to !== a.id);
            });
            renderAll();
          },
        }, 'Löschen')],
        body: () => h('div', {},
          field('Name', textInput(a.name, function (val) {
            a.name = val;
            syncTitle(this, val, 'Akteur');
            save(() => {});
            redrawSoon();
          })),
          field('Typ', select(a.type || 'human', [['human', 'Person / Rolle'], ['system', 'Fremdsystem']],
            (val) => { a.type = val; patchAndDraw(() => {}); })),
          field('Beschreibung', textArea(a.description, (val) => { a.description = val; save(() => {}); }, { rows: 2 }))),
      }), a.id));
    }
  };

  const actorsCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Akteure'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          patchAndDraw((prj) => prj.useCases.actors.push({ id: store.uid('act'), name: 'Neuer Akteur', type: 'human', description: '' }));
          renderActors();
        },
      }, '+ Akteur')),
    actorsWrap);
  main.appendChild(actorsCard);
  renderActors();
  makeSortable(actorsWrap, (ids) => {
    patchAndDraw((prj) => {
      prj.useCases.actors.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
    });
  });

  // ---------------------------------------------------------- use cases
  const ucWrap = h('div', {});

  const stepsEditor = (c) => {
    const wrap = h('div', { class: 'stack' });
    const rebuild = () => {
      clear(wrap);
      c.steps ||= [];
      c.steps.forEach((s, i) => {
        const row = h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
          h('span', { class: 'chip' }, String(i + 1)),
          h('div', { style: { flex: '1 1 auto' } },
            h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
              select(s.kind || 'action', [['action', 'Schritt'], ['decision', 'Entscheidung']],
                (val) => { s.kind = val; patch(() => {}); rebuild(); }, { style: { width: '140px' } }),
              textInput(s.text, (val) => { s.text = val; save(() => {}); },
                { placeholder: s.kind === 'decision' ? 'Bedingung, z. B. Daten vollständig' : 'z. B. Nutzer wählt Projekt aus' })),
            s.kind === 'decision'
              ? h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } },
                textInput(s.yes, (val) => { s.yes = val; save(() => {}); }, { placeholder: 'ja →' }),
                textInput(s.no, (val) => { s.no = val; save(() => {}); }, { placeholder: 'nein →' }))
              : null),
          h('button', { class: 'btn small ghost', onclick: () => { c.steps.splice(i, 1); patch(() => {}); rebuild(); } }, '✕'));
        wrap.appendChild(row);
      });
      wrap.appendChild(h('button', {
        class: 'btn small',
        onclick: () => { c.steps.push({ kind: 'action', text: '' }); patch(() => {}); rebuild(); },
      }, '+ Schritt'));
    };
    rebuild();
    return wrap;
  };

  const relationChips = (c, key, label) => {
    const others = uc.useCases.filter((x) => x.id !== c.id);
    if (!others.length) return null;
    return h('div', { style: { marginBottom: '12px' } },
      h('span', { class: 'hint', style: { display: 'block', marginBottom: '4px' } }, label),
      h('div', { class: 'chips' }, others.map((o) => {
        const on = (c[key] || []).includes(o.id);
        return h('button', {
          class: `chip chip-toggle ${on ? 'on' : ''}`,
          onclick: (e) => {
            c[key] ||= [];
            if (on) c[key] = c[key].filter((id) => id !== o.id); else c[key].push(o.id);
            patchAndDraw(() => {});
            e.target.classList.toggle('on');
            renderUseCaseList();
          },
        }, o.name || 'UC');
      })));
  };

  const newActivity = (name) => ({ id: store.uid('flw'), name, description: '', uml: ACTIVITY_TEMPLATE });

  const activityChips = (c) => {
    const wrap = h('div', { style: { marginBottom: '12px' } });
    const rebuild = () => {
      clear(wrap);
      c.activityIds ||= [];
      wrap.appendChild(h('span', { class: 'hint', style: { display: 'block', marginBottom: '4px' } }, 'Verknüpfte Abläufe'));
      wrap.appendChild(h('div', { class: 'chips' },
        uc.activities.map((a) => {
          const on = c.activityIds.includes(a.id);
          return h('button', {
            class: `chip chip-toggle ${on ? 'on' : ''}`,
            onclick: () => {
              if (on) c.activityIds = c.activityIds.filter((id) => id !== a.id); else c.activityIds.push(a.id);
              patch(() => {});
              rebuild();
              renderActivities();
            },
          }, a.name || 'Ablauf');
        }),
        h('button', {
          class: 'chip chip-toggle',
          title: 'Neuen Ablauf anlegen und mit diesem Use Case verknüpfen',
          onclick: () => {
            const a = newActivity(c.name || 'Neuer Ablauf');
            patch((prj) => prj.useCases.activities.push(a));
            c.activityIds.push(a.id);
            patch(() => {});
            openActivities.add(a.id);
            rebuild();
            renderActivities();
            toast('Ablauf angelegt und verknüpft');
          },
        }, '+ neuer Ablauf')));
    };
    rebuild();
    return wrap;
  };

  function useCaseBody(c) {
    const scenario = diagramPanel({
      title: 'Ablauf (Aktivitätsdiagramm)',
      project: p,
      section: 'usecases',
      fileName: `${p.name}-${c.name || 'uc'}`,
      generate: () => useCaseScenarioUml(c, uc.actors),
      getCustom: () => c.customUml ?? null,
      setCustom: (val) => patch(() => { c.customUml = val; }),
    });
    const rerenderScenario = debounce(() => scenario.refresh(), 700);
    return h('div', {},
      field('Name', textInput(c.name, function (val) {
        c.name = val;
        syncTitle(this, val, 'Use Case');
        save(() => {});
        redrawSoon();
      })),
      h('div', { class: 'grid-2' },
        field('Priorität', select(c.priority || 'normal', PRIORITIES, (val) => { c.priority = val; patchAndDraw(() => {}); })),
        field('Auslöser', textInput(c.trigger, (val) => { c.trigger = val; save(() => {}); }, { placeholder: 'Was startet den Ablauf?' }))),
      h('div', { style: { marginBottom: '12px' } },
        h('span', { class: 'hint', style: { display: 'block', marginBottom: '4px' } }, 'Beteiligte Akteure'),
        uc.actors.length
          ? h('div', { class: 'chips' }, uc.actors.map((a) => {
            const on = (c.actorIds || []).includes(a.id);
            return h('button', {
              class: `chip chip-toggle ${on ? 'on' : ''}`,
              onclick: (e) => {
                c.actorIds ||= [];
                if (on) c.actorIds = c.actorIds.filter((id) => id !== a.id); else c.actorIds.push(a.id);
                patchAndDraw(() => {});
                e.target.classList.toggle('on');
                scenario.refresh();
              },
            }, a.name || 'Akteur');
          }))
          : h('span', { class: 'hint' }, 'Zuerst Akteure anlegen.')),
      field('Beschreibung', textArea(c.description, (val) => { c.description = val; save(() => {}); }, { rows: 2 })),
      h('div', { class: 'grid-2' },
        field('Vorbedingung', textInput(c.precondition, (val) => { c.precondition = val; save(() => {}); })),
        field('Ergebnis / Nachbedingung', textInput(c.result, (val) => { c.result = val; save(() => {}); }))),
      h('h3', {}, 'Ablaufschritte'),
      h('div', { onInput: rerenderScenario }, stepsEditor(c)),
      relationChips(c, 'includes', 'enthält (include)'),
      relationChips(c, 'extends', 'erweitert (extend)'),
      activityChips(c),
      scenario);
  }

  function renderUseCaseList() {
    clear(ucWrap);
    if (!uc.useCases.length) ucWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Use Cases.'));
    for (const c of uc.useCases) {
      const actorNames = (c.actorIds || [])
        .map((id) => uc.actors.find((a) => a.id === id)?.name).filter(Boolean).join(', ');
      ucWrap.appendChild(withId(listItem({
        title: c.name || 'Use Case',
        meta: [actorNames, (c.activityIds || []).length ? `${c.activityIds.length} ${c.activityIds.length === 1 ? 'Ablauf' : 'Abläufe'}` : ''].filter(Boolean).join(' · '),
        actions: [...moveActions(uc.useCases, c.id, () => { patchAndDraw(() => {}); renderUseCaseList(); }), h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Use Case löschen?', `„${c.name}" wird entfernt.`))) return;
            patchAndDraw((prj) => {
              prj.useCases.useCases = prj.useCases.useCases.filter((x) => x.id !== c.id);
              for (const o of prj.useCases.useCases) {
                o.includes = (o.includes || []).filter((id) => id !== c.id);
                o.extends = (o.extends || []).filter((id) => id !== c.id);
              }
            });
            renderUseCaseList();
          },
        }, 'Löschen')],
        body: () => useCaseBody(c),
      }), c.id));
    }
  }

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Use Cases'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          patchAndDraw((prj) => prj.useCases.useCases.push({
            id: store.uid('uc'), name: 'Neuer Use Case', description: '', actorIds: [],
            priority: 'normal', precondition: '', result: '', trigger: '', steps: [], includes: [], extends: [], activityIds: [],
          }));
          renderUseCaseList();
          toast('Use Case angelegt');
        },
      }, '+ Use Case')),
    ucWrap));
  renderUseCaseList();
  makeSortable(ucWrap, (ids) => {
    patchAndDraw((prj) => prj.useCases.useCases.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)));
  });

  // --------------------------------------------------------- activities
  const actWrap = h('div', {});
  // activity items stay expanded when the list is rebuilt
  const openActivities = new Set();
  function renderActivities() {
    clear(actWrap);
    if (!uc.activities.length) actWrap.appendChild(h('div', { class: 'empty' }, 'Noch keine Abläufe.'));
    for (const act of uc.activities) {
      const users = uc.useCases.filter((c) => (c.activityIds || []).includes(act.id));
      actWrap.appendChild(withId(listItem({
        title: act.name || 'Ablauf',
        meta: users.length ? users.map((c) => c.name || 'Use Case').join(', ') : 'nicht verknüpft',
        open: openActivities.has(act.id),
        onToggle: (show) => { if (show) openActivities.add(act.id); else openActivities.delete(act.id); },
        actions: [...moveActions(uc.activities, act.id, () => { patch(() => {}); renderActivities(); }), h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Ablauf löschen?', `„${act.name}" wird entfernt und bei allen Use Cases entknüpft.`))) return;
            patch((prj) => {
              prj.useCases.activities = prj.useCases.activities.filter((x) => x.id !== act.id);
              for (const c of prj.useCases.useCases) c.activityIds = (c.activityIds || []).filter((id) => id !== act.id);
            });
            renderActivities();
            renderUseCaseList();
          },
        }, 'Löschen')],
        body: () => h('div', {},
          field('Name', textInput(act.name, function (val) { act.name = val; syncTitle(this, val, 'Ablauf'); save(() => {}); })),
          field('Beschreibung', textArea(act.description, (val) => { act.description = val; save(() => {}); }, { rows: 2 })),
          h('p', { class: 'hint' }, users.length
            ? `Verknüpft mit: ${users.map((c) => c.name || 'Use Case').join(', ')}. Verknüpfungen werden im jeweiligen Use Case gepflegt.`
            : 'Noch mit keinem Use Case verknüpft — im Use Case unter „Verknüpfte Abläufe" auswählen.'),
          diagramPanel({
            title: act.name || 'Ablauf',
            project: p,
            section: 'usecases',
            fileName: `${p.name}-${act.name || 'ablauf'}`,
            generate: () => act.uml || ACTIVITY_TEMPLATE,
            getCustom: () => act.uml ?? null,
            setCustom: (val) => patch(() => { act.uml = val === null ? ACTIVITY_TEMPLATE : val; }),
          })),
      }), act.id));
    }
  }

  main.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Abläufe'),
      h('button', {
        class: 'btn small primary',
        onclick: () => {
          const a = newActivity('Neuer Ablauf');
          openActivities.add(a.id);
          patch((prj) => prj.useCases.activities.push(a));
          renderActivities();
          toast('Ablauf mit Vorlage angelegt');
        },
      }, '+ Ablauf')),
    h('p', { class: 'hint' }, 'Frei gestaltbare Aktivitätsdiagramme — über „Quelle" direkt in PlantUML bearbeitbar. Ein Ablauf kann mit mehreren Use Cases verknüpft werden.'),
    actWrap));
  renderActivities();
  makeSortable(actWrap, (ids) => patch((prj) =>
    prj.useCases.activities.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id))));

  function renderAll() {
    renderActors();
    renderUseCaseList();
    refresh();
  }
}
