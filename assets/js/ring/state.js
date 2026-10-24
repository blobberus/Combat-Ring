// Local UI state of this device (never synced): tool, selection, the scene the DM is looking at, placement mode.
const listeners = new Set();

export const ui = {
  tool: 'select', // select | pan | measure | pin | fog | note
  fogShape: 'lasso', // lasso | poly | rect | toggle (click to reveal / hide) | select (pick areas to delete, reveal, hide)
  fogMode: 'hide', // hide | reveal
  viewing: null, // DM: the scene on the board (null = the live one)
  selected: new Set(), // view keys: 'd:item.<id>', 't:it.<id>', 't:pct.<scene>.<char>', 't:pin.<id>'
  fogSel: null, // DM: the fog area under the cursor (what a click would act on)
  fogPicked: new Set(), // DM: fog areas picked with the Select fog tool
  placing: null, // {kind: 'creature'|'prop'|'pc'|'note', …, name, w, h, img}
  previewChar: null, // DM preview: whose eyes (null = the whole party)
  optimistic: new Map(), // key -> {x, y, at}: our own moves of things the DM's client re-publishes
  showResolved: false,
};

export function setUi(patch) {
  Object.assign(ui, patch);
  for (const fn of listeners) fn(patch);
}

export function onUi(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function select(keys, { add = false } = {}) {
  if (!add) ui.selected.clear();
  for (const k of [].concat(keys)) if (k) ui.selected.add(k);
  for (const fn of listeners) fn({ selected: ui.selected });
}

export function toggleSelect(key) {
  if (ui.selected.has(key)) ui.selected.delete(key); else ui.selected.add(key);
  for (const fn of listeners) fn({ selected: ui.selected });
}

export function clearSelection() {
  if (!ui.selected.size) return;
  ui.selected.clear();
  for (const fn of listeners) fn({ selected: ui.selected });
}

/** 'd:item.x' -> {room: 'dm', key: 'item.x'} */
export function parseKey(vk) {
  const room = vk.startsWith('d:') ? 'dm' : 'table';
  return { room, key: vk.slice(2) };
}

export const viewKey = (room, key) => `${room === 'dm' ? 'd' : 't'}:${key}`;
