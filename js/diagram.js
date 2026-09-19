// Reusable diagram panel: renders PlantUML via the configured server, shows the
// source, and lets the user override the generated source by hand.

import { h, clear, toast, copyText, download, debounce } from './ui.js';
import { diagramUrl, editUrl, fetchDiagram, serverBase } from './plantuml.js';
import { getSettings } from './store.js';

/**
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {() => string} cfg.generate   generated source from the model
 * @param {() => (string|null)} [cfg.getCustom]  hand-written override, or null
 * @param {(v: string|null) => void} [cfg.setCustom]
 * @param {string} [cfg.fileName]
 */
export function diagramPanel(cfg) {
  const settings = getSettings();
  let showSource = false;
  let token = 0;

  const view = h('div', { class: 'diagram-view' });
  const srcBox = h('div', { class: 'diagram-src', hidden: true });
  const status = h('span', { class: 'meta', style: { fontSize: '12px', color: 'var(--fg-dim)' } });

  const current = () => {
    const custom = cfg.getCustom ? cfg.getCustom() : null;
    return (custom !== null && custom !== undefined) ? custom : cfg.generate();
  };
  const isCustom = () => {
    const c = cfg.getCustom ? cfg.getCustom() : null;
    return c !== null && c !== undefined;
  };

  async function render() {
    const my = ++token;
    const source = current();
    clear(view);
    view.classList.remove('is-error');
    view.appendChild(h('div', { class: 'spinner' }));
    let url;
    try {
      url = await diagramUrl(source, settings.format === 'png' ? 'png' : 'svg');
    } catch (err) {
      showError(`Quelle konnte nicht kodiert werden: ${err.message}`);
      return;
    }
    if (my !== token) return;
    const img = h('img', { alt: cfg.title, loading: 'eager' });
    const timer = setTimeout(() => {
      if (my !== token) return;
      showError(`Keine Antwort vom PlantUML-Server (${serverBase()}). Server in den Einstellungen prüfen.`);
    }, 20000);
    img.onload = () => {
      clearTimeout(timer);
      if (my !== token) return;
      clear(view);
      view.appendChild(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      if (my !== token) return;
      showError(navigator.onLine
        ? `Diagramm konnte nicht gerendert werden. PlantUML-Syntax prüfen oder Server (${serverBase()}) in den Einstellungen anpassen.`
        : 'Offline — Diagramme werden vom PlantUML-Server gerendert. Bearbeiten funktioniert weiter, die Quelle bleibt lokal gespeichert.');
    };
    img.src = url;
  }

  function showError(msg) {
    clear(view);
    view.classList.add('is-error');
    view.appendChild(h('div', {}, msg));
    view.appendChild(h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: render }, 'Erneut versuchen'));
  }

  const saveCustom = debounce((val) => { cfg.setCustom(val); render(); }, 500);

  function buildSourceBox() {
    clear(srcBox);
    const custom = isCustom();
    const ta = h('textarea', {
      class: 'code', spellcheck: 'false', rows: 14,
      readonly: !custom || !cfg.setCustom,
      oninput: (e) => { if (custom && cfg.setCustom) saveCustom(e.target.value); },
    }, current());
    srcBox.appendChild(ta);
    srcBox.appendChild(h('div', { class: 'row', style: { padding: '8px 10px', borderTop: '1px solid var(--line-soft)' } },
      h('span', { class: 'hint', style: { margin: 0 } },
        custom ? 'Eigene Quelle — das Modell überschreibt sie nicht mehr.' : 'Automatisch aus dem Modell erzeugt (schreibgeschützt).'),
      h('span', { class: 'spacer' }),
      cfg.setCustom ? (custom
        ? h('button', { class: 'btn small', onclick: () => { cfg.setCustom(null); buildSourceBox(); render(); toast('Auf generierte Quelle zurückgesetzt'); } }, 'Zurücksetzen')
        : h('button', { class: 'btn small', onclick: () => { cfg.setCustom(cfg.generate()); buildSourceBox(); toast('Quelle kann jetzt bearbeitet werden'); } }, 'Überschreiben'))
        : null));
  }

  async function openInServer() {
    try {
      window.open(await editUrl(current()), '_blank', 'noopener');
    } catch (err) { toast(err.message, 'err'); }
  }

  async function downloadDiagram(format) {
    try {
      const blob = await fetchDiagram(current(), format);
      download(`${(cfg.fileName || cfg.title).replace(/[^\w.-]+/g, '_')}.${format}`, blob, blob.type);
    } catch (err) {
      toast(`Download fehlgeschlagen (${err.message}) — öffne das Diagramm stattdessen im Browser.`, 'err');
    }
  }

  const bar = h('div', { class: 'diagram-bar' },
    h('span', { class: 'title' }, cfg.title),
    status,
    h('button', { class: 'btn small', onclick: render, title: 'Neu rendern' }, '↻'),
    h('button', {
      class: 'btn small',
      onclick: (e) => {
        showSource = !showSource;
        srcBox.hidden = !showSource;
        if (showSource) buildSourceBox();
        e.target.textContent = showSource ? 'Quelle ausblenden' : 'Quelle';
      },
    }, 'Quelle'),
    h('button', { class: 'btn small', onclick: () => copyText(current()) }, 'Kopieren'),
    h('button', { class: 'btn small', onclick: () => downloadDiagram('svg') }, 'SVG'),
    h('button', { class: 'btn small', onclick: () => downloadDiagram('png') }, 'PNG'),
    h('button', { class: 'btn small', onclick: openInServer, title: 'Im PlantUML-Server öffnen' }, '↗'));

  const root = h('div', { class: 'diagram' }, bar, view, srcBox);
  root.refresh = () => { if (showSource) buildSourceBox(); render(); };
  render();
  return root;
}
