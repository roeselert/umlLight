// Minimal DOM helpers — no framework, no build step.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const withId = (el, id) => { el.dataset.id = id; return el; };

/** Keep the collapsible header in sync while a name field is edited. */
export function syncTitle(inputEl, value, fallback = '—') {
  const title = inputEl.closest('.item')?.querySelector('.item-head .title');
  if (title) title.textContent = String(value || '').trim() || fallback;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function field(labelText, control, hint) {
  return h('label', { class: 'field' },
    h('span', {}, labelText),
    control,
    hint ? h('div', { class: 'hint', style: { marginTop: '4px', marginBottom: 0 } }, hint) : null);
}

// The handler is called with the input element as `this`, so callers can e.g.
// sync a surrounding header while typing.
export function textInput(value, oninput, props = {}) {
  return h('input', {
    type: 'text', value: value ?? '',
    oninput: (e) => oninput.call(e.target, e.target.value, e),
    ...props,
  });
}

export function textArea(value, oninput, props = {}) {
  return h('textarea', { oninput: (e) => oninput.call(e.target, e.target.value, e), ...props }, value ?? '');
}

export function select(value, options, onchange, props = {}) {
  const el = h('select', { onchange: (e) => onchange(e.target.value), ...props },
    options.map((o) => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: val, selected: String(val) === String(value) }, label);
    }));
  el.value = value ?? '';
  return el;
}

export function toast(message, kind = '') {
  const root = document.getElementById('toastRoot');
  const el = h('div', { class: `toast ${kind}` }, message);
  root.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2400);
}

/**
 * Generic modal. render(close) must return a Node.
 * Dialogs stack: opening one from inside another keeps the parent alive.
 */
export function modal(render) {
  const root = document.getElementById('modalRoot');
  let resolveFn = null;
  const promise = new Promise((res) => { resolveFn = res; });

  const layer = h('div', { class: 'modal-layer' });
  const close = (result) => {
    document.removeEventListener('keydown', onKey);
    layer.remove();
    if (!root.children.length) root.hidden = true;
    if (typeof resolveFn === 'function') resolveFn(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && layer === root.lastElementChild) {
      e.stopPropagation();
      close(undefined);
    }
  };
  document.addEventListener('keydown', onKey);

  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, render(close));
  layer.appendChild(box);
  layer.addEventListener('click', (e) => { if (e.target === layer) close(undefined); });
  root.appendChild(layer);
  root.hidden = false;

  const focusable = box.querySelector('input, textarea, select, button');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return promise;
}

export function confirmDialog(title, message, confirmLabel = 'Löschen') {
  return modal((close) => h('div', {},
    h('h2', {}, title),
    h('p', { class: 'hint' }, message),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Abbrechen'),
      h('button', { class: 'btn danger', onclick: () => close(true) }, confirmLabel))));
}

export function promptDialog(title, label, initial = '', confirmLabel = 'OK') {
  return modal((close) => {
    let value = initial;
    const input = h('input', { type: 'text', value: initial, oninput: (e) => { value = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') close(value.trim() || null); } });
    return h('div', {},
      h('h2', {}, title),
      field(label, input),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Abbrechen'),
        h('button', { class: 'btn primary', onclick: () => close(value.trim() || null) }, confirmLabel)));
  });
}

/** Collapsible list item with a title row and a body rendered lazily. */
export function listItem({ title, meta, open = false, onToggle, actions = [], body }) {
  const bodyEl = h('div', { class: 'item-body', hidden: !open });
  if (open) bodyEl.appendChild(body());
  const item = h('div', { class: 'item' },
    h('div', {
      class: 'item-head',
      onclick: (e) => {
        if (e.target.closest('.no-toggle')) return;
        const show = bodyEl.hidden;
        if (show && !bodyEl.childNodes.length) bodyEl.appendChild(body());
        bodyEl.hidden = !show;
        if (onToggle) onToggle(show);
      },
    },
      h('span', { class: 'drag-handle no-toggle', title: 'Ziehen zum Sortieren' }, '⠿'),
      h('span', { class: 'title' }, title),
      meta ? h('span', { class: 'meta' }, meta) : null,
      h('span', { class: 'no-toggle row', style: { gap: '6px' } }, actions)),
    bodyEl);
  return item;
}

/**
 * Up/down buttons for reordering a list. Works on touch devices, where HTML5
 * drag & drop does not.
 */
export function moveActions(list, id, after) {
  const idx = list.findIndex((x) => x.id === id);
  const mk = (dir, label, title) => h('button', {
    class: 'btn small ghost move-btn',
    title,
    'aria-label': title,
    disabled: dir < 0 ? idx <= 0 : idx >= list.length - 1,
    onclick: (e) => {
      e.stopPropagation();
      const j = idx + dir;
      if (j < 0 || j >= list.length) return;
      [list[idx], list[j]] = [list[j], list[idx]];
      after();
    },
  }, label);
  return [mk(-1, '↑', 'Nach oben'), mk(1, '↓', 'Nach unten')];
}

/**
 * Table with cells labelled by their column header, so narrow screens can
 * render each row as a stacked card (see the CSS for table.grid).
 */
export function gridTable(headers, rows) {
  return h('table', { class: 'grid' },
    h('thead', {}, h('tr', {}, headers.map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((cells) => h('tr', {},
      cells.map((c, i) => h('td', { 'data-label': headers[i] || '' }, c))))));
}

/** Simple drag & drop reordering for a container of .item elements. */
export function makeSortable(container, onReorder) {
  let dragged = null;
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.item');
    if (item) item.draggable = true;
  });
  container.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('.item');
    if (!dragged) return;
    dragged.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const target = e.target.closest('.item');
    if (!target || target === dragged) return;
    const rect = target.getBoundingClientRect();
    const after = (e.clientY - rect.top) / rect.height > 0.5;
    container.insertBefore(dragged, after ? target.nextSibling : target);
  });
  container.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged.draggable = false;
    dragged = null;
    onReorder([...container.querySelectorAll('.item')].map((el) => el.dataset.id));
  });
}

export function download(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert');
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('In die Zwischenablage kopiert'); }
    catch { toast('Kopieren nicht möglich', 'err'); }
    ta.remove();
  }
}

/** Debounce helper for auto-save on typing. */
export function debounce(fn, ms = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
