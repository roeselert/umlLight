// Reusable diagram panel: renders PlantUML via the configured server, shows the
// source, and lets the user override the generated source by hand.

import { h, clear, toast, copyText, download, debounce, modal } from './ui.js';
import { diagramUrl, editUrl, fetchDiagram, serverBase } from './plantuml.js';
import { getSettings } from './store.js';
import { openAiDialog } from './aipanel.js';

// One global listener closes any open overflow menu — panels are re-created on
// every render, so per-panel listeners would pile up on document.
document.addEventListener('click', () => {
  document.querySelectorAll('.more-menu.open').forEach((m) => m.classList.remove('open'));
});

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
  let zoom = 1;

  function applyZoom() {
    const img = view.querySelector('img');
    if (!img) return;
    if (zoom === 1) {
      img.style.width = '';
      img.style.maxWidth = '100%';
    } else {
      img.style.maxWidth = 'none';
      img.style.width = `${Math.round(zoom * 100)}%`;
    }
  }

  function openFullscreen() {
    const img = view.querySelector('img');
    if (!img) { toast('Erst rendern, dann vergrößern', 'err'); return; }
    modal((close) => h('div', { class: 'fullscreen-diagram' },
      h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('strong', { style: { flex: '1 1 auto' } }, cfg.title),
        h('button', { class: 'btn small', onclick: () => close() }, 'Schließen')),
      h('div', { class: 'fullscreen-canvas' }, h('img', { src: img.src, alt: cfg.title }))));
  }
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
      applyZoom();
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

  const aiButton = cfg.setCustom
    ? h('button', {
      class: 'btn small ai-btn',
      title: 'Diagramm mit KI erzeugen oder ändern',
      onclick: () => openAiDialog({
        title: cfg.title,
        section: cfg.section,
        project: cfg.project,
        currentSource: current(),
        onApply: (uml) => { cfg.setCustom(uml); buildSourceBox(); render(); },
        onOpenSettings: () => document.dispatchEvent(new CustomEvent('umllight:settings', { detail: { focus: 'ai' } })),
      }),
    }, '✨ KI')
    : null;

  const moreMenu = h('div', { class: 'more-menu' },
    h('button', { class: 'btn small', onclick: () => { closeMore(); copyText(current()); } }, 'Kopieren'),
    h('button', { class: 'btn small', onclick: () => { closeMore(); downloadDiagram('svg'); } }, 'SVG'),
    h('button', { class: 'btn small', onclick: () => { closeMore(); downloadDiagram('png'); } }, 'PNG'),
    h('button', { class: 'btn small', onclick: () => { closeMore(); openInServer(); } }, 'Im Server öffnen ↗'));
  const closeMore = () => moreMenu.classList.remove('open');

  const bar = h('div', { class: 'diagram-bar' },
    h('span', { class: 'title' }, cfg.title),
    status,
    aiButton,
    h('button', { class: 'btn small', onclick: render, title: 'Neu rendern', 'aria-label': 'Neu rendern' }, '↻'),
    h('button', {
      class: 'btn small', title: 'Verkleinern', 'aria-label': 'Verkleinern',
      onclick: () => { zoom = Math.max(0.5, Math.round((zoom - 0.25) * 100) / 100); applyZoom(); },
    }, '−'),
    h('button', {
      class: 'btn small', title: 'Vergrößern', 'aria-label': 'Vergrößern',
      onclick: () => { zoom = Math.min(4, Math.round((zoom + 0.25) * 100) / 100); applyZoom(); },
    }, '+'),
    h('button', {
      class: 'btn small', title: 'Vollbild', 'aria-label': 'Vollbild', onclick: openFullscreen,
    }, '⤢'),
    h('button', {
      class: 'btn small',
      onclick: (e) => {
        showSource = !showSource;
        srcBox.hidden = !showSource;
        if (showSource) buildSourceBox();
        e.target.textContent = showSource ? 'Quelle ausblenden' : 'Quelle';
      },
    }, 'Quelle'),
    h('button', {
      class: 'btn small more-toggle', title: 'Weitere Aktionen', 'aria-label': 'Weitere Aktionen',
      onclick: (e) => { e.stopPropagation(); moreMenu.classList.toggle('open'); },
    }, '⋯'),
    moreMenu);

  const root = h('div', { class: 'diagram' }, bar, view, srcBox);
  root.refresh = () => { if (showSource) buildSourceBox(); render(); };
  render();
  return root;
}
