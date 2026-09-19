// AI assistant dialog for a single diagram: describe what you want, stream the
// model answer, review the PlantUML it produced, then apply it as the diagram's
// source.

import { h, clear, modal, toast, copyText } from './ui.js';
import { complete, buildMessages, extractPlantUml, projectContext, isConfigured } from './ai.js';
import { getSettings } from './store.js';

const QUICK_PROMPTS = {
  usecases: [
    'Erzeuge ein vollständiges Use-Case-Diagramm aus dem Projektkontext.',
    'Ergänze fehlende Akteure und sinnvolle include-/extend-Beziehungen.',
    'Vereinfache das Diagramm auf die wichtigsten Use Cases.',
  ],
  deployment: [
    'Erzeuge ein Deployment-Diagramm für eine typische Umsetzung dieses Projekts.',
    'Ergänze Datenbank, Reverse Proxy und externe Schnittstellen.',
    'Gruppiere die Knoten nach Umgebung (Client, Server, Extern).',
  ],
  datamodel: [
    'Erzeuge ein Datenmodell aus den Use Cases dieses Projekts.',
    'Ergänze Fremdschlüssel, Zeitstempel und fehlende Beziehungen.',
    'Normalisiere das Modell auf die 3. Normalform.',
  ],
  viewmodel: [
    'Erzeuge ein Navigationsdiagramm der wichtigsten Masken.',
    'Ergänze Fehler- und Leerzustände als eigene Views.',
    'Erzeuge ein Aktivitätsdiagramm für den Hauptablauf.',
  ],
  default: [
    'Erzeuge ein passendes Diagramm aus dem Projektkontext.',
    'Prüfe die Syntax und korrigiere Fehler.',
    'Verbessere Lesbarkeit und Layout, ohne Inhalte zu verlieren.',
  ],
};

/**
 * @param {object} cfg
 * @param {string} cfg.title          diagram title, shown to the model as type
 * @param {string} cfg.currentSource
 * @param {object} [cfg.project]
 * @param {string} [cfg.section]
 * @param {(uml: string) => void} [cfg.onApply]
 * @param {() => void} [cfg.onOpenSettings]
 */
export function openAiDialog(cfg) {
  return modal((close) => {
    if (!isConfigured()) {
      return h('div', {},
        h('h2', {}, 'KI-Assistent einrichten'),
        h('p', { class: 'hint' },
          'Der Assistent nutzt die Hugging-Face-Inference-API. Dafür werden ein Zugriffstoken und ein Modell benötigt — beides wird nur lokal im Browser gespeichert.'),
        h('ol', { class: 'hint' },
          h('li', {}, 'Token auf huggingface.co unter Settings → Access Tokens anlegen (Rolle „read").'),
          h('li', {}, 'In den Einstellungen unter „KI-Assistent" Token und Modell eintragen.')),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn ghost', onclick: () => close() }, 'Später'),
          h('button', {
            class: 'btn primary',
            onclick: () => { close(); if (cfg.onOpenSettings) cfg.onOpenSettings(); },
          }, 'Einstellungen öffnen')));
    }

    const settings = getSettings();
    let instruction = '';
    let withSource = !!cfg.currentSource;
    let withContext = settings.aiSendContext !== false;
    let controller = null;
    let result = '';

    const output = h('pre', { class: 'code ai-output', hidden: true });
    const statusEl = h('div', { class: 'hint', style: { margin: '10px 0 0' } });
    const input = h('textarea', {
      class: 'ai-input', rows: 3, placeholder: 'Was soll das Diagramm zeigen oder wie soll es geändert werden?',
      oninput: (e) => { instruction = e.target.value; updateButtons(); },
    });

    const applyBtn = h('button', {
      class: 'btn primary', disabled: true,
      onclick: () => {
        const uml = extractPlantUml(result);
        if (!uml) { toast('Keine PlantUML-Quelle in der Antwort gefunden', 'err'); return; }
        cfg.onApply(uml);
        close();
        toast('Diagramm übernommen');
      },
    }, 'Übernehmen');

    const copyBtn = h('button', {
      class: 'btn', disabled: true,
      onclick: () => copyText(extractPlantUml(result) || result),
    }, 'Kopieren');

    const runBtn = h('button', { class: 'btn primary', onclick: () => run() }, 'Generieren');
    const stopBtn = h('button', { class: 'btn', hidden: true, onclick: () => controller?.abort() }, 'Stopp');

    function updateButtons() {
      runBtn.disabled = !instruction.trim();
      const uml = result ? extractPlantUml(result) : null;
      applyBtn.disabled = !uml || !cfg.onApply;
      copyBtn.disabled = !result;
    }

    async function run() {
      controller = new AbortController();
      result = '';
      clear(output);
      output.hidden = false;
      output.textContent = '';
      statusEl.textContent = 'Modell antwortet …';
      runBtn.hidden = true;
      stopBtn.hidden = false;
      updateButtons();
      try {
        const messages = buildMessages({
          instruction,
          diagramTitle: cfg.title,
          currentSource: withSource ? cfg.currentSource : '',
          context: withContext ? projectContext(cfg.project, cfg.section) : '',
        });
        result = await complete({
          messages,
          signal: controller.signal,
          onDelta: (_d, full) => {
            result = full;
            output.textContent = full;
            output.scrollTop = output.scrollHeight;
          },
        });
        const uml = extractPlantUml(result);
        output.textContent = uml || result;
        statusEl.textContent = uml
          ? 'Fertig — Vorschlag prüfen und übernehmen.'
          : 'Antwort enthält keinen PlantUML-Block. Anweisung schärfen oder erneut generieren.';
      } catch (err) {
        if (err.name === 'AbortError') statusEl.textContent = 'Abgebrochen.';
        else {
          statusEl.textContent = err.message;
          statusEl.style.color = 'var(--danger)';
        }
      } finally {
        controller = null;
        runBtn.hidden = false;
        stopBtn.hidden = true;
        runBtn.textContent = 'Neu generieren';
        updateButtons();
      }
    }

    const quick = QUICK_PROMPTS[cfg.section] || QUICK_PROMPTS.default;

    return h('div', { class: 'ai-dialog' },
      h('h2', {}, 'KI-Assistent'),
      h('p', { class: 'hint' }, `${cfg.title} · Modell: ${settings.aiModel}`),
      input,
      h('div', { class: 'chips', style: { margin: '10px 0' } },
        quick.map((q) => h('button', {
          class: 'chip chip-toggle',
          onclick: () => { instruction = q; input.value = q; updateButtons(); },
        }, q))),
      h('div', { class: 'row', style: { gap: '14px' } },
        cfg.currentSource ? h('label', { class: 'row', style: { gap: '6px' } },
          h('input', {
            type: 'checkbox', checked: withSource, style: { width: 'auto' },
            onchange: (e) => { withSource = e.target.checked; },
          }), h('span', { class: 'hint', style: { margin: 0 } }, 'Aktuelle Quelle mitsenden')) : null,
        h('label', { class: 'row', style: { gap: '6px' } },
          h('input', {
            type: 'checkbox', checked: withContext, style: { width: 'auto' },
            onchange: (e) => { withContext = e.target.checked; },
          }), h('span', { class: 'hint', style: { margin: 0 } }, 'Projektkontext mitsenden'))),
      statusEl,
      output,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => { controller?.abort(); close(); } }, 'Schließen'),
        copyBtn, stopBtn, runBtn, applyBtn));
  });
}
