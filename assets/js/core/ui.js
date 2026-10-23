// Shared UI primitives (from Stone-Wardens core/ui.js): icons, toasts, modals, dialogs, pickers, form controls.
import { h, clear } from './dom.js';

const overlays = () => document.querySelector('body > #overlays') || document.body;

export function icon(name, size) {
  const svg = h('svg', { class: 'icon', 'aria-hidden': 'true', ...(size ? { width: size, height: size } : {}) });
  const id = name.startsWith('mk-') || name.startsWith('i-') ? name : `i-${name}`;
  svg.append(h('use', { href: `assets/img/icons.svg#${id}` }));
  return svg;
}

// ---------- toasts ----------

let toastBox = null;
export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  if (!toastBox || !toastBox.isConnected) toastBox = overlays().appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${type}` }, message);
  toastBox.append(t);
  const close = () => t.remove();
  if (timeout) setTimeout(close, type === 'error' ? timeout * 2 : timeout);
  t.addEventListener('click', close);
  return close;
}

// ---------- modal ----------

const modalStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) { e.preventDefault(); e.stopPropagation(); modalStack[modalStack.length - 1].dismiss(); }
}, true);

export const modalOpen = () => modalStack.length > 0;

/**
 * openModal({title, body, actions:[{label, kind:'primary'|'ghost'|'danger', onClick}], wide, onClose})
 * An action's onClick returning false (or a promise of false) keeps the modal open.
 */
export function openModal({ title, body, actions = [], wide = false, onClose, beforeClose, className = '' } = {}) {
  const box = h('div', { class: ['modal', wide && 'modal-wide', className], role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    modalStack.splice(modalStack.indexOf(api), 1);
    onClose?.();
  };
  const dismiss = async () => {
    if (beforeClose && (await beforeClose()) === false) return;
    close();
  };
  const api = { close, el: box, dismiss };
  const head = h('header', { class: 'modal-head' },
    h('h2', null, title || ''),
    h('button', { class: 'btn-icon modal-close', type: 'button', 'aria-label': 'Close', onclick: dismiss }, icon('close')));
  const content = h('div', { class: 'modal-body' }, body);
  box.append(head, content);
  if (actions.length) {
    box.append(h('footer', { class: 'modal-foot' }, actions.map((a) => (a.spacer ? h('span', { class: 'spacer' }) : h('button', {
      class: ['btn', a.kind ? `btn-${a.kind}` : ''],
      type: 'button',
      onclick: async () => { const r = await a.onClick?.(api); if (r !== false) close(); },
    }, a.label)))));
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  overlays().append(backdrop);
  modalStack.push(api);
  queueMicrotask(() => (box.querySelector('[autofocus], input:not([type=file]), textarea, select') || box.querySelector('.modal-foot .btn-primary'))?.focus());
  return api;
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      body: typeof message === 'string' ? h('p', null, message) : message,
      actions: [
        { label: cancelLabel, kind: 'ghost' },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Choice dialog. choices: [{label, value, kind}] -> resolves value (or null on dismiss). */
export function choiceDialog(message, choices, { title = 'Choose' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title,
      body: typeof message === 'string' ? h('p', null, message) : message,
      actions: choices.map((c) => ({ label: c.label, kind: c.kind, onClick: () => { result = c.value; } })),
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', okLabel = 'OK', multiline = false, type = 'text', hint = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const control = multiline
      ? h('textarea', { class: 'textarea', rows: 5, value, placeholder })
      : h('input', { class: 'input', value, placeholder, type, autofocus: true });
    const m = openModal({
      title,
      body: field(label, control, hint),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: okLabel, kind: 'primary', onClick: () => { result = control.value; } },
      ],
      onClose: () => resolve(result),
    });
    if (!multiline) control.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = control.value; m.close(); } });
  });
}

/**
 * pickFromList({title, items, render(item) -> Node|string, search(item) -> string, multi, selected, empty})
 * Resolves the chosen item (or array when multi), or null when dismissed.
 */
export function pickFromList({ title = 'Choose', items = [], render = (x) => x.name, search = (x) => x.name, multi = false, selected = [], empty = 'Nothing matches.', extra = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const chosen = new Set(selected);
    const q = h('input', { class: 'input picker-search', type: 'search', placeholder: 'Search…', autofocus: true });
    const list = h('ul', { class: 'picker-list', role: 'listbox' });
    let active = 0;
    let shown = [];
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      shown = items.filter((it) => !term || String(search(it) || '').toLowerCase().includes(term)).slice(0, 300);
      active = Math.min(active, Math.max(0, shown.length - 1));
      clear(list);
      if (!shown.length) list.append(h('li', { class: 'picker-empty muted' }, empty));
      shown.forEach((it, i) => {
        list.append(h('li', {
          class: ['picker-item', chosen.has(it) && 'is-selected', i === active && 'is-active'],
          role: 'option',
          onclick: () => pick(it),
        }, multi ? h('span', { class: 'picker-check' }, chosen.has(it) ? '✓' : '') : null, render(it)));
      });
    };
    const m = openModal({
      title,
      wide: true,
      className: 'modal-picker',
      body: h('div', { class: 'picker' }, q, extra, list),
      actions: multi ? [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Done', kind: 'primary', onClick: () => { result = items.filter((x) => chosen.has(x)); } },
      ] : [],
      onClose: () => resolve(result),
    });
    function pick(it) {
      if (multi) { chosen.has(it) ? chosen.delete(it) : chosen.add(it); draw(); return; }
      result = it;
      m.close();
    }
    q.addEventListener('input', () => { active = 0; draw(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && shown[active]) { pick(shown[active]); e.preventDefault(); }
      list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    });
    draw();
  });
}

// ---------- form controls ----------

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    label ? h('span', { class: 'field-label' }, label) : null,
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export const input = (props = {}) => h('input', { class: 'input', type: 'text', ...props });
export const textarea = (props = {}) => h('textarea', { class: 'textarea', rows: 4, ...props });

/** options: array of strings or {value, label}. */
export function select(options, value, onchange, props = {}) {
  return h('select', { class: 'select', ...props, onchange: (e) => onchange?.(e.target.value, e) },
    options.map((o) => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return h('option', { value: opt.value, selected: String(opt.value) === String(value), disabled: opt.disabled }, opt.label ?? opt.value);
    }));
}

export function checkbox(checked, onchange, label) {
  const box = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange?.(e.target.checked, e) });
  return label ? h('label', { class: 'checkbox' }, box, h('span', null, label)) : box;
}

export function numberInput(value, onchange, props = {}) {
  return h('input', {
    class: 'input input-number', type: 'number', inputmode: 'numeric', value: value ?? '', ...props,
    onchange: (e) => onchange?.(e.target.value === '' ? null : Number(e.target.value), e),
  });
}

/** A row of toggle chips; one active. options: [{value, label, title}] */
export function segmented(options, value, onchange, { className = '' } = {}) {
  const wrap = h('div', { class: ['seg', className], role: 'group' });
  const draw = (v) => {
    clear(wrap);
    for (const o of options) {
      wrap.append(h('button', {
        type: 'button', class: ['seg-btn', String(o.value) === String(v) && 'is-active'], title: o.title || null,
        'aria-pressed': String(String(o.value) === String(v)),
        onclick: () => { draw(o.value); onchange?.(o.value); },
      }, o.icon ? icon(o.icon) : null, o.label != null ? h('span', null, o.label) : null));
    }
  };
  draw(value);
  wrap.set = draw;
  return wrap;
}

/** Pick an image file. -> Promise<File|null> */
export function pickFile(accept = 'image/*') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, hidden: true });
    inp.addEventListener('change', () => { resolve(inp.files?.[0] || null); inp.remove(); });
    document.body.append(inp);
    inp.click();
    // No change event fires when the dialog is canceled in some browsers; a stale promise is harmless.
  });
}
