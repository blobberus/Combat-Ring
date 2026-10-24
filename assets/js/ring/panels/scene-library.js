// The map library (DM): the Scenes panel's second stage, opened out over the board. A tree on the left (Pinned,
// Recent, All scenes, the DM's own folders under "My maps", the Stone Wardens atlas: its maps and places) and what is
// chosen on the right as cards. Drag scenes and folders to file them: a folder into a folder (or above / below one in
// the tree), a scene into a folder, under an atlas place, or onto Pinned. Ctrl / Shift + click selects several.
// Every move can be undone; on touch screens the ⋯ menus do the same. Also the helpers the short list shares.
import { h, clear, add } from '../../core/dom.js';
import { icon, toast, confirmDialog, promptDialog, pickFromList } from '../../core/ui.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { repo, mimeOf } from '../../core/repo.js';
import { world, undoGroup } from '../world.js';
import { ui, setUi, clearSelection } from '../state.js';
import { K, newId } from '../model.js';
import { dmScenes, dmViewingId, playersSee } from '../view.js';
import * as A from '../actions.js';
import * as L from '../library.js';
import { openSceneEditor } from '../editors/scene-editor.js';
import { mediaUrl } from '../media.js';
import { swSite } from '../sheets.js';

const S = {
  ctx: null,
  query: '',
  sel: new Set(), // selected scene ids
  shown: [], // scene ids in the order they are shown (Shift+click selects a run of them)
  anchor: null,
  renaming: null, // folder id being renamed
  renameIn: 'main', // where its name field is: 'main' (its card) | 'tree'
  dragging: null, // {scenes: [ids]} | {folder: id}
  stale: false,
  marked: null,
  tree: null, // the library's tree element
};
const redraw = () => S.ctx?.panel.refresh();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- shared with the short list ----------

export const isDragging = () => !!S.dragging;
export const holdRedraw = () => { S.stale = true; };
export const setLibraryCtx = (ctx) => { S.ctx = ctx; };

/** Open the library (at a node: 'f:<folder>', 'm:<map>' …). panel: the side panel, until the Scenes panel has drawn once. */
export function openLibrary(node, panel = S.ctx?.panel) {
  if (node) go(node, { quiet: true });
  setSetting('scenesWide', true);
  panel?.open('scenes');
  panel?.rebuild();
}
export function closeLibrary() {
  S.sel.clear();
  S.query = '';
  setSetting('scenesWide', false);
  S.ctx?.panel.rebuild();
}
/** Esc: drop the selection first, then close the library. False when the library isn't open. */
export function libraryEscape() {
  if (!getSetting('scenesWide') || !S.ctx?.panel.isOpen() || S.ctx.panel.activeId() !== 'scenes') return false;
  if (S.sel.size) { S.sel.clear(); redraw(); } else closeLibrary();
  return true;
}

const thumbUrls = new Map(); // media -> object URL: a redraw shows a known picture at once, without a flash
function lazyImg(el, key, load) {
  const known = thumbUrls.get(key);
  const img = (src) => h('img', { src, alt: '', loading: 'lazy', draggable: 'false' }); // dragging drags the card
  if (known) { add(el, img(known)); return el; }
  load().then((u) => { if (u) { thumbUrls.set(key, u); add(el, img(u)); } }).catch(() => {});
  return el;
}
export function sceneThumb(s, cls = 'cr-scene-thumb') {
  const el = h('div', { class: cls, style: { background: s.color || '' } });
  const ref = s.map?.media;
  return ref ? lazyImg(el, typeof ref === 'string' ? ref : JSON.stringify(ref), () => mediaUrl(ref)) : el;
}
function mapThumb(m, cls) {
  const el = h('div', { class: cls });
  return m?.image ? lazyImg(el, `atlas:${m.image}`, () => L.atlasImageUrl(m, swSite())) : add(el, icon('compass'));
}

export function sceneState(s) {
  const ps = playersSee();
  const live = ps.id === s.id;
  return { live, seen: live && ps.state === 'scene', viewing: dmViewingId() === s.id };
}
export const sceneMeta = (s) => {
  const n = world.dVals('item.').filter((it) => it.scene === s.id && it.kind === 'creature').length;
  return `${s.cols} × ${s.rows} squares · ${plural(n, 'creature')}${s.light?.level && s.light.level !== 'bright' ? ` · ${s.light.level}` : ''}`;
};
export function sceneBadge(s, st = sceneState(s), cls = '') {
  if (st.live) return h('span', { class: ['badge', st.seen ? 'badge-ok' : 'badge-warn', cls], title: st.seen ? 'Players see this scene' : 'Live, but hidden: players see the curtain' }, st.seen ? 'Live' : 'Hidden');
  return st.viewing ? h('span', { class: ['badge', cls] }, 'Viewing') : null;
}

export function openScene(id) {
  setUi({ viewing: id });
  clearSelection();
}

export function showHideButton(s, st = sceneState(s)) {
  return st.seen
    ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Hide it: players see the curtain', onclick: () => A.setBlackout(true) }, icon('eye-off'), 'Hide')
    : h('button', { class: 'btn btn-sm', type: 'button', title: 'Players see this scene now', onclick: () => { A.goLive(s.id); setUi({ viewing: s.id }); L.noteViewed(s.id, { now: true }); } }, icon('eye'), 'Show');
}

export function pinButton(s, cls = 'btn-icon btn-sm') {
  const on = s.pin != null;
  return h('button', { class: [cls, on && 'is-pinned'], type: 'button', 'aria-pressed': String(on), title: on ? 'Unpin it from the short list' : 'Pin it to the short list', 'aria-label': on ? 'Unpin' : 'Pin', onclick: () => L.setPinned([s.id], !on) }, icon('pin'));
}

function duplicate(s) {
  const id = newId('s');
  undoGroup('duplicate scene', () => {
    world.dPut(K.scene(id), { ...structuredClone(s), id, name: `${s.name} (copy)`, order: (s.order ?? 0) + 0.5, pin: null }, { undo: true });
    for (const [k, f] of world.dList(`fog.${s.id}.`)) world.dPut(K.fog(id, k.slice(`fog.${s.id}.`.length)), structuredClone(f), { undo: true });
    for (const [, it] of world.dList('item.')) if (it.scene === s.id) world.dPut(K.item(newId(it.kind[0])), { ...structuredClone(it), scene: id }, { undo: true });
  });
  toast('Scene copied with its fog, creatures and props.');
}

export async function removeScenes(ids) {
  const scenes = ids.map((id) => world.d(K.scene(id))).filter(Boolean);
  if (!scenes.length) return;
  const set = new Set(ids);
  const items = world.dList('item.').filter(([, it]) => set.has(it.scene));
  const what = scenes.length === 1 ? `“${scenes[0].name}”` : plural(scenes.length, 'scene');
  if (!(await confirmDialog(`Delete ${what}${items.length ? ` and ${scenes.length === 1 ? 'its' : 'their'} ${items.length} creatures, props and notes` : ''}? Ctrl+Z brings ${scenes.length === 1 ? 'it' : 'them'} back.`, { okLabel: scenes.length === 1 ? 'Delete scene' : `Delete ${plural(scenes.length, 'scene')}`, danger: true }))) return;
  undoGroup(scenes.length === 1 ? 'delete scene' : 'delete scenes', () => {
    for (const s of scenes) {
      for (const [k] of world.dList(`fog.${s.id}.`)) world.del('dm', k, { undo: true });
      world.del('dm', K.scene(s.id), { undo: true });
    }
    for (const [k] of items) world.del('dm', k, { undo: true });
    if (set.has(world.d('dmeta')?.live)) A.patchDmeta({ live: null });
  });
  for (const id of ids) S.sel.delete(id);
  if (set.has(ui.viewing)) setUi({ viewing: null });
}

async function renameScene(s) {
  const name = await promptDialog('Rename the scene', { label: 'Name', value: s.name || '' });
  if (name?.trim() && name.trim() !== s.name) world.dPut(K.scene(s.id), { ...world.d(K.scene(s.id)), name: name.trim() }, { undo: true, label: 'rename scene' });
}

// ---------- menus and pickers ----------

let pop = null;
function closePop() { pop?.close(); pop = null; }
/** A small menu by anchor. items: {icon, label, run, danger, disabled} | {sep} | {node} */
export function popMenu(anchor, items) {
  closePop();
  const box = h('div', { class: 'rg-pop rg-float cr-lib-pop', role: 'menu', tabindex: -1 });
  box.addEventListener('keydown', (e) => { // arrows walk the items (the menu itself takes focus: a stray Enter does nothing)
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...box.querySelectorAll('button:not(:disabled)')];
    const i = btns.indexOf(document.activeElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1 + (i < 0 ? 1 : 0))) % btns.length]?.focus();
  });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) add(box, h('hr', { class: 'cr-pop-sep' }));
    else if (it.node) add(box, it.node);
    else add(box, h('button', { class: ['rg-pop-item', it.danger && 'is-danger'], type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => { closePop(); it.run(); } }, icon(it.icon || 'chevron-right'), h('span', { class: 'truncate' }, it.label)));
  }
  add(document.body, box);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - bw - 8, r.right - bw));
  const top = Math.max(8, Math.min(innerHeight - bh - 8, r.bottom + 4 + bh > innerHeight - 8 ? r.top - bh - 4 : r.bottom + 4));
  Object.assign(box.style, { position: 'fixed', left: `${left}px`, top: `${top}px` });
  const outside = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); anchor.focus?.(); } };
  setTimeout(() => addEventListener('pointerdown', outside, true));
  addEventListener('keydown', esc, true);
  pop = { close: () => { box.remove(); removeEventListener('pointerdown', outside, true); removeEventListener('keydown', esc, true); } };
  box.focus({ preventScroll: true });
}

function folderIcon(f, size) {
  const ic = icon('folder', size);
  if (f?.color) ic.style.color = `var(--pin-${f.color})`;
  return ic;
}

/** Pick a folder (null = My maps, top level). exclude: a folder that can't hold itself. Resolves undefined when dismissed. */
async function chooseFolder({ title = 'Move to folder', current, exclude = null } = {}) {
  const items = [{ id: null, name: 'My maps (no folder)', depth: 0 }];
  const walk = (parent, depth) => {
    for (const f of L.childFolders(parent)) {
      if (exclude && f.id === exclude) continue;
      items.push({ id: f.id, name: f.name, depth, color: f.color, path: L.folderPath(f.id).map((x) => x.name).join(' ') });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  items.push({ make: true, name: 'New folder…', depth: 0 });
  const pick = await pickFromList({
    title, items,
    render: (it) => h('span', { class: 'cr-pick-row', style: `--depth: ${it.depth}` }, it.make ? icon('folder-plus') : it.id ? folderIcon(it) : icon('map'), h('span', null, it.name), it.id === current && !it.make ? h('span', { class: 'badge' }, 'Here now') : null),
    search: (it) => (it.make ? 'new folder' : `${it.path || ''} ${it.name}`),
  });
  if (!pick) return undefined;
  if (!pick.make) return pick.id;
  const name = await promptDialog('New folder', { label: 'Name', placeholder: 'The Barrow Deeps' });
  return name?.trim() ? L.newFolder(name) : undefined;
}

/** Pick an atlas map or place ({map, loc?}; null = none). Resolves undefined when dismissed. */
async function choosePlace({ title = 'File under a place', current = null } = {}) {
  await L.loadAtlas().catch(() => {});
  const a = L.atlas();
  if (!a) { toast('The Stone Wardens atlas could not be read.', { type: 'error' }); return undefined; }
  const items = [{ none: true, name: 'No place', depth: 0 }];
  const walk = (m, depth) => {
    items.push({ at: { map: m.id }, name: m.name, depth, map: true });
    for (const p of m.places) items.push({ at: { map: m.id, loc: p.id }, name: p.name, type: p.type, depth: depth + 1, place: p });
    for (const k of m.kids) walk(k, depth + 1);
  };
  walk(a.main, 0);
  const cur = L.atlasSpot(current);
  const isCur = (it) => !!cur && (it.place ? cur.place?.id === it.place.id : it.map && !cur.place && cur.map.id === it.at.map);
  const pick = await pickFromList({
    title, items,
    render: (it) => h('span', { class: 'cr-pick-row', style: `--depth: ${it.depth}` }, it.none ? icon('close') : it.place ? icon(L.placeIcon(it.place)) : icon('map'), h('span', null, it.name), it.place ? h('span', { class: 'muted text-xs' }, typeName(it.place)) : null, isCur(it) ? h('span', { class: 'badge' }, 'Here now') : null),
    search: (it) => `${it.name} ${it.type || ''}`,
  });
  if (!pick) return undefined;
  return pick.none ? null : pick.at;
}

async function moveToFolder(ids) {
  const one = ids.length === 1 ? world.d(K.scene(ids[0])) : null;
  const f = await chooseFolder({ title: ids.length === 1 ? `Move “${one?.name || 'scene'}” to` : `Move ${plural(ids.length, 'scene')} to`, current: one ? L.folderOf(one) : undefined });
  if (f === undefined) return;
  L.moveScenes(ids, f);
  toast(`Moved to ${f ? `“${L.folderById(f)?.name}”` : 'My maps'}.`, { timeout: 2000 });
}

async function fileUnder(ids) {
  const one = ids.length === 1 ? world.d(K.scene(ids[0])) : null;
  const at = await choosePlace({ current: one?.at || null });
  if (at === undefined) return;
  L.linkScenes(ids, at);
  const spot = L.atlasSpot(at);
  toast(spot ? `Filed under ${(spot.place || spot.map).name}.` : 'Not filed under a place any more.', { timeout: 2000 });
}

export function sceneMenu(anchor, s) {
  const st = sceneState(s);
  popMenu(anchor, [
    st.seen ? { icon: 'eye-off', label: 'Hide from players', run: () => A.setBlackout(true) } : { icon: 'eye', label: 'Show to players', run: () => { A.goLive(s.id); setUi({ viewing: s.id }); L.noteViewed(s.id, { now: true }); } },
    { icon: 'pin', label: s.pin != null ? 'Unpin from the short list' : 'Pin to the short list', run: () => L.setPinned([s.id], s.pin == null) },
    { sep: true },
    { icon: 'edit', label: 'Edit the map…', run: () => openSceneEditor(s.id) },
    { icon: 'file', label: 'Rename…', run: () => renameScene(s) },
    { icon: 'folder', label: 'Move to folder…', run: () => moveToFolder([s.id]) },
    { icon: 'compass', label: s.at ? 'Change its place…' : 'File under a place…', run: () => fileUnder([s.id]) },
    { icon: 'copy', label: 'Duplicate', run: () => duplicate(s) },
    { sep: true },
    { icon: 'trash', label: 'Delete…', danger: true, run: () => removeScenes([s.id]) },
  ]);
}

function folderMenu(anchor, f) {
  popMenu(anchor, [
    { icon: 'folder', label: 'Open', run: () => go(`f:${f.id}`) },
    { icon: 'folder-plus', label: 'New folder inside', run: () => createFolder(f.id) },
    { icon: 'plus', label: 'New scene in it…', run: () => openSceneEditor(null, { folder: f.id }) },
    { icon: 'edit', label: 'Rename', run: () => startRename(f.id) },
    { icon: 'folder', label: 'Move to…', run: async () => {
      const t = await chooseFolder({ title: `Move “${f.name}” to`, current: f.parent, exclude: f.id });
      if (t !== undefined && !L.moveFolder(f.id, t)) toast('A folder can’t go inside itself.');
    } },
    { node: h('div', { class: 'rg-pop-field' }, h('div', { class: 'rg-pop-title cr-pop-sub' }, 'Color'),
      h('div', { class: 'rg-swatches' },
        h('button', { class: ['rg-swatch cr-swatch-none', !f.color && 'is-active'], type: 'button', title: 'No color', 'aria-label': 'No color', onclick: () => { closePop(); L.patchFolder(f.id, { color: null }, 'folder color'); } }),
        L.FOLDER_COLORS.map((c) => h('button', { class: ['rg-swatch', f.color === c && 'is-active'], type: 'button', title: c, 'aria-label': c, style: { background: `var(--pin-${c})` }, onclick: () => { closePop(); L.patchFolder(f.id, { color: c }, 'folder color'); } })))) },
    { sep: true },
    { icon: 'trash', label: 'Delete folder…', danger: true, run: () => removeFolder(f) },
  ]);
}

async function removeFolder(f) {
  const n = L.countDeep(f.id);
  const kids = L.folderIndex().list.filter((x) => x.id !== f.id && L.within(x.id, f.id)).length;
  const up = f.parent ? `“${L.folderById(f.parent)?.name}”` : 'My maps';
  if ((n || kids) && !(await confirmDialog(`Delete the folder “${f.name}”? What is in it (${[n && plural(n, 'scene'), kids && plural(kids, 'folder')].filter(Boolean).join(' and ')}) moves up to ${up}; no scene is deleted. Ctrl+Z brings the folder back.`, { okLabel: 'Delete folder', danger: true }))) return;
  const node = getSetting('libNode');
  L.deleteFolder(f.id);
  if (node === `f:${f.id}`) go(f.parent ? `f:${f.parent}` : 'root');
}

function createFolder(parent) {
  const id = L.newFolder('New folder', parent);
  if (parent) openNode(`f:${parent}`, true);
  S.renaming = id;
  S.renameIn = mainShowsFolder(id, parent) ? 'main' : 'tree';
  if (S.renameIn === 'tree') openNode('root', true);
}
function startRename(id) {
  const f = L.folderById(id);
  if (!f) return;
  S.renaming = id;
  S.renameIn = mainShowsFolder(id, f.parent) ? 'main' : 'tree';
  redraw();
}
const mainShowsFolder = (id, parent) => !S.query.trim() && getSetting('libNode') === (parent ? `f:${parent}` : 'root');

function renameField(f) {
  let cancel = false;
  const inp = h('input', {
    class: 'input input-sm cr-rename', value: f.name, 'aria-label': 'Folder name', draggable: 'false',
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel = true; inp.blur(); }
    },
    onblur: () => {
      const v = inp.value.trim();
      S.renaming = null;
      if (!cancel && v && v !== f.name) L.patchFolder(f.id, { name: v }, 'rename folder');
      else setTimeout(redraw);
    },
    onclick: (e) => e.stopPropagation(),
    ondragstart: (e) => { e.preventDefault(); e.stopPropagation(); },
  });
  return inp;
}

// ---------- navigation ----------

const openSet = () => getSetting('libOpen') || {};
const isOpen = (key) => !!openSet()[key];
function openNode(key, on) { if (isOpen(key) !== on) setSetting('libOpen', { ...openSet(), [key]: on }); }
function toggleNode(key) { openNode(key, !isOpen(key)); redraw(); }

/** Show a node; the tree unfolds down to it, and it unfolds too. */
function go(node, { quiet = false } = {}) {
  S.sel.clear();
  S.query = '';
  setSetting('libNode', node);
  const open = { ...openSet() };
  if (node === 'root') open.root = true;
  if (node.startsWith('f:')) { open.root = true; for (const f of L.folderPath(node.slice(2))) open[`f:${f.id}`] = true; }
  if (node.startsWith('m:') || node.startsWith('p:')) {
    const mapId = node.startsWith('m:') ? node.slice(2) : L.atlas()?.places.get(node.slice(2))?.map;
    for (const m of mapId ? L.mapChain(mapId) : []) open[`m:${m.id}`] = true;
  }
  setSetting('libOpen', open);
  if (!quiet) redraw();
}

function validNode() {
  const n = getSetting('libNode') || 'root';
  if (n.startsWith('f:')) return L.folderById(n.slice(2)) ? n : 'root';
  const a = L.atlas();
  if (n.startsWith('m:')) return !a || a.maps.has(n.slice(2)) ? n : `m:${L.MAIN}`;
  if (n.startsWith('p:')) return !a || a.places.has(n.slice(2)) ? n : `m:${L.MAIN}`;
  return ['pinned', 'recent', 'all', 'root'].includes(n) ? n : 'root';
}

// ---------- drag and drop ----------

function mark(el, zone) {
  if (S.marked && S.marked !== el) S.marked.classList.remove('is-drop', 'is-drop-before', 'is-drop-after');
  S.marked = zone ? el : null;
  if (!el) return;
  el.classList.toggle('is-drop', zone === 'into');
  el.classList.toggle('is-drop-before', zone === 'before');
  el.classList.toggle('is-drop-after', zone === 'after');
}

function endDrag() {
  S.dragging = null;
  mark(null);
  document.body.classList.remove('cr-lib-dragging');
  if (S.stale) { S.stale = false; setTimeout(redraw); }
}

/** el can be dragged: payload() -> {scenes: [ids]} | {folder: id} | null */
export function dragSource(el, payload) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    if (e.target.closest?.('input')) return;
    const p = payload();
    if (!p) { e.preventDefault(); return; }
    e.stopPropagation();
    S.dragging = p;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-cr-library', JSON.stringify(p));
    if (p.scenes?.length > 1) {
      const ghost = h('div', { class: 'cr-drag-ghost' }, icon('map'), plural(p.scenes.length, 'scene'));
      add(document.body, ghost);
      e.dataTransfer.setDragImage(ghost, 16, 16);
      setTimeout(() => ghost.remove());
    }
    setTimeout(() => { el.classList.add('is-dragging'); document.body.classList.add('cr-lib-dragging'); });
    // a drag whose source left the page (the tree redrew under it) never reports its end: the next plain move does
    addEventListener('mousemove', function moved(ev) { if (!ev.buttons) { removeEventListener('mousemove', moved, true); if (S.dragging === p) endDrag(); } }, true);
  });
  el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); endDrag(); });
  return el;
}

/** el takes drops: zone(e, el) -> 'into' | 'before' | 'after'; accept(payload, zone) -> bool; run(payload, zone). */
export function dropTarget(el, { accept, run, zone = () => 'into' }) {
  el.addEventListener('dragover', (e) => {
    if (!S.dragging) return;
    const z = zone(e, el);
    if (!accept(S.dragging, z)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    mark(el, z);
  });
  el.addEventListener('dragleave', (e) => { if (S.marked === el && !el.contains(e.relatedTarget)) mark(null); });
  el.addEventListener('drop', (e) => {
    const p = S.dragging;
    if (!p) return;
    const z = zone(e, el);
    if (!accept(p, z)) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    run(p, z);
  });
  return el;
}

export const yHalves = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? 'before' : 'after'; };
const xHalves = (e, el) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'before' : 'after'; };
const yThirds = (e, el) => { const r = el.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into'; };
/** The first scene after list[i] that isn't being moved (where "after list[i]" really lands), or null (the end). */
export const nextStill = (list, i, moving) => list.slice(i + 1).find((x) => !moving.includes(x.id))?.id || null;

// dropping things where they already are does nothing (it would only send them to the end)
const intoFolder = (fid) => ({
  accept: (p) => !!p.scenes || (!!p.folder && !(fid && L.within(fid, p.folder))),
  run: (p) => {
    const name = fid ? `“${L.folderById(fid)?.name}”` : 'My maps';
    if (p.scenes) {
      const ids = p.scenes.filter((id) => L.folderOf(world.d(K.scene(id))) !== (fid || null));
      if (!ids.length) return;
      L.moveScenes(ids, fid);
      toast(`${ids.length > 1 ? `${plural(ids.length, 'scene')} moved` : 'Moved'} to ${name}.`, { timeout: 1800 });
    } else if ((L.folderById(p.folder)?.parent || null) !== (fid || null) && L.moveFolder(p.folder, fid) && fid) openNode(`f:${fid}`, true);
  },
});
const ontoPlace = (at) => ({
  accept: (p) => !!p.scenes,
  run: (p) => { L.linkScenes(p.scenes, at); const spot = L.atlasSpot(at); toast(`Filed under ${(spot?.place || spot?.map)?.name || 'the place'}.`, { timeout: 1800 }); },
});
const ontoPinned = { accept: (p) => !!p.scenes, run: (p) => { L.setPinned(p.scenes, true); toast(p.scenes.length > 1 ? `Pinned ${plural(p.scenes.length, 'scene')}.` : 'Pinned.', { timeout: 1500 }); } };

function selectedInOrder() {
  const order = new Map(S.shown.map((id, i) => [id, i]));
  return [...S.sel].filter((id) => world.d(K.scene(id))).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
}

// ---------- the tree ----------

function treeRow(o) {
  const node = S.node;
  const open = !!o.kids && isOpen(o.key);
  const label = o.rename ? renameField(o.rename) : h('span', { class: 'cr-tree-label', ondblclick: o.onRename || null }, o.label);
  const row = h('div', {
    class: ['cr-tree-row', o.key === node && 'is-active', o.cls], role: 'treeitem', tabindex: o.key === node ? 0 : -1,
    style: `--depth: ${o.depth || 0}`, 'aria-expanded': o.kids ? String(open) : null, 'aria-selected': String(o.key === node), title: o.title || null,
    onclick: (e) => { if (e.target.closest('.cr-tree-twisty')) toggleNode(o.key); else if (!e.target.closest('input')) go(o.key); },
    onkeydown: (e) => {
      if (e.target.closest('input')) return;
      if (e.key === 'Enter') { e.preventDefault(); go(o.key); }
      else if (e.key === 'ArrowRight' && o.kids && !open) { e.preventDefault(); toggleNode(o.key); }
      else if (e.key === 'ArrowLeft' && open) { e.preventDefault(); toggleNode(o.key); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...row.closest('.cr-tree').querySelectorAll('.cr-tree-row')];
        rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      }
    },
  }, h('span', { class: ['cr-tree-twisty', !o.kids && 'is-blank'] }, icon('chevron-right')), o.iconEl || icon(o.icon), label,
  o.count ? h('span', { class: 'cr-tree-count' }, o.count) : null);
  if (o.drop) dropTarget(row, o.drop);
  if (o.drag) dragSource(row, o.drag);
  if (o.kids && !open) { // hold a drag over a folded row a moment and it unfolds
    let t = 0;
    const stop = () => { clearTimeout(t); t = 0; };
    row.addEventListener('dragover', () => { if (S.dragging && !t) t = setTimeout(() => { t = 0; if (S.dragging) { openNode(o.key, true); redrawTree(); } }, 650); });
    row.addEventListener('dragleave', stop);
    row.addEventListener('drop', stop);
  }
  const line = h('div', { class: 'cr-tree-line' }, row,
    o.more ? h('button', { class: 'cr-tree-more', type: 'button', title: 'More', 'aria-label': `More: ${o.label}`, onclick: (e) => { e.stopPropagation(); o.more(e.currentTarget); } }, icon('more')) : null);
  const item = h('div', { class: 'cr-tree-item', role: 'none' }, line);
  if (open) add(item, h('div', { class: 'cr-tree-kids', role: 'group', style: `--depth: ${o.depth || 0}` }, o.kids()));
  return item;
}

function folderRows(parent, depth) {
  return L.childFolders(parent).map((f) => {
    const n = L.countDeep(f.id);
    const kids = L.childFolders(f.id);
    return treeRow({
      key: `f:${f.id}`, label: f.name, iconEl: folderIcon(f), depth, count: n || null,
      kids: kids.length ? () => folderRows(f.id, depth + 1) : null,
      rename: S.renaming === f.id && S.renameIn === 'tree' ? f : null,
      onRename: () => startRename(f.id),
      more: (a) => folderMenu(a, f),
      drag: () => (S.renaming === f.id ? null : { folder: f.id }),
      drop: {
        zone: (e, el) => (S.dragging?.folder ? yThirds(e, el) : 'into'),
        accept: (p, z) => (z === 'into' ? intoFolder(f.id).accept(p) : !!p.folder && !L.within(f.id, p.folder)),
        run: (p, z) => {
          if (z === 'into') return intoFolder(f.id).run(p);
          const sibs = L.childFolders(f.parent);
          L.moveFolder(p.folder, f.parent, z === 'before' ? f.id : nextStill(sibs, sibs.findIndex((x) => x.id === f.id), [p.folder]));
        },
      },
    });
  });
}

function atlasRows(m, depth) {
  return [
    ...m.kids.map((k) => atlasMapRow(k, depth)),
    ...m.places.map((p) => treeRow({
      key: `p:${p.id}`, label: p.name, icon: L.placeIcon(p), depth, cls: 'is-place', count: L.scenesAt(null, p.id).length || null,
      title: p.type ? `${p.name} (${p.type})` : p.name, drop: ontoPlace({ map: p.map, loc: p.id }),
    })),
  ];
}
function atlasMapRow(m, depth) {
  const has = m.kids.length || m.places.length;
  return treeRow({
    key: `m:${m.id}`, label: m.name, icon: 'map', depth, count: L.scenesAt(m.id, null, { places: true }).length || null,
    kids: has ? () => atlasRows(m, depth + 1) : null, drop: ontoPlace({ map: m.id }),
  });
}

/** Only the tree (while dragging: the card being dragged must stay). */
function redrawTree() {
  const tree = S.tree;
  if (!tree?.isConnected) return;
  const top = tree.scrollTop;
  clear(tree);
  drawTree(tree);
  tree.scrollTop = top;
}

function drawTree(tree) {
  const all = dmScenes();
  const a = L.atlas();
  const top = h('div', { class: 'cr-tree', role: 'tree', 'aria-label': 'Scenes' },
    treeRow({ key: 'pinned', label: 'Pinned', icon: 'pin', count: L.pinned().length || null, drop: ontoPinned, title: 'Your pinned scenes: they head the short list' }),
    treeRow({ key: 'recent', label: 'Recent', icon: 'clock' }),
    treeRow({ key: 'all', label: 'All scenes', icon: 'layers', count: all.length || null }),
    h('div', { class: 'cr-tree-gap' }),
    treeRow({
      key: 'root', label: 'My maps', icon: 'book-open', count: null, title: 'Your own folders: drag scenes and folders to file them',
      kids: () => {
        const rows = folderRows(null, 1);
        return rows.length ? rows : h('div', { class: 'cr-tree-none', style: '--depth: 1' }, 'No folders yet');
      },
      more: (anchor) => popMenu(anchor, [
        { icon: 'folder-plus', label: 'New folder', run: () => createFolder(null) },
        { icon: 'plus', label: 'New scene…', run: () => openSceneEditor() },
      ]),
      drop: intoFolder(null),
    }),
    h('div', { class: 'cr-tree-gap' }),
    h('div', { class: 'cr-tree-head' }, h('span', null, 'Stone Wardens atlas'),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Look for new maps and places on Stone Wardens', 'aria-label': 'Refresh the atlas', onclick: () => L.refreshAtlas().then(redraw) }, icon('refresh'))),
    a ? atlasMapRow(a.main, 0) : h('div', { class: 'cr-tree-none' }, 'Reading the atlas…'));
  add(tree, top);
}

// ---------- the main pane ----------

function crumbs(node) {
  const bits = [];
  const crumb = (label, to, drop, iconName) => {
    const b = h('button', { class: 'cr-crumb', type: 'button', onclick: () => go(to) }, iconName ? icon(iconName) : null, label);
    if (drop) dropTarget(b, drop);
    return b;
  };
  if (node === 'root' || node.startsWith('f:')) {
    bits.push(crumb('My maps', 'root', intoFolder(null)));
    for (const f of node.startsWith('f:') ? L.folderPath(node.slice(2)) : []) bits.push(crumb(f.name, `f:${f.id}`, intoFolder(f.id)));
  } else if (node.startsWith('m:') || node.startsWith('p:')) {
    const a = L.atlas();
    const place = node.startsWith('p:') ? a?.places.get(node.slice(2)) : null;
    const chain = L.mapChain(place ? place.map : node.slice(2));
    for (const m of chain) bits.push(crumb(m.name, `m:${m.id}`, ontoPlace({ map: m.id })));
    if (place) bits.push(crumb(place.name, node, ontoPlace({ map: place.map, loc: place.id })));
  } else bits.push(crumb({ pinned: 'Pinned', recent: 'Recent', all: 'All scenes' }[node], node, node === 'pinned' ? ontoPinned : null));
  bits[bits.length - 1]?.setAttribute('aria-current', 'page');
  const out = h('nav', { class: 'cr-crumbs', 'aria-label': 'Where you are' });
  bits.forEach((b, i) => add(out, i ? h('span', { class: 'cr-crumb-sep', 'aria-hidden': 'true' }, '›') : null, b));
  return out;
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
const sorted = (list) => (getSetting('libSort') === 'name' ? [...list].sort(byName) : list);

function sceneTags(s, { folder = true, place = true } = {}) {
  const tags = [];
  if (folder) {
    const path = L.folderPath(L.folderOf(s));
    if (path.length) tags.push(h('span', { class: 'cr-tag', title: path.map((f) => f.name).join(' › ') }, folderIcon(path[path.length - 1]), h('span', { class: 'truncate' }, path[path.length - 1].name)));
  }
  const spot = place ? L.atlasSpot(s.at) : null;
  if (spot) tags.push(h('span', { class: 'cr-tag', title: [...L.mapChain(spot.map.id).map((m) => m.name), spot.place?.name].filter(Boolean).join(' › ') }, icon(spot.place ? L.placeIcon(spot.place) : 'map'), h('span', { class: 'truncate' }, (spot.place || spot.map).name)));
  return tags.length ? h('span', { class: 'cr-tags' }, tags) : null;
}

function clickCard(e, s) {
  if (e.ctrlKey || e.metaKey) {
    if (S.sel.has(s.id)) S.sel.delete(s.id); else S.sel.add(s.id);
    S.anchor = s.id;
    redraw();
    return;
  }
  if (e.shiftKey) {
    const a = S.shown.indexOf(S.anchor ?? s.id), b = S.shown.indexOf(s.id);
    if (a >= 0 && b >= 0) for (const id of S.shown.slice(Math.min(a, b), Math.max(a, b) + 1)) S.sel.add(id);
    else S.sel.add(s.id);
    S.anchor ??= s.id;
    redraw();
    return;
  }
  openScene(s.id);
  closeLibrary();
}

/** reorder(ids, before) when the cards can be put in order by dragging. */
function sceneGrid(list, { reorder = null, tags = {} } = {}) {
  const g = h('div', { class: 'cr-lib-grid', role: 'list' });
  for (const s of list) S.shown.push(s.id);
  list.forEach((s, i) => {
    const st = sceneState(s);
    const card = h('div', { class: ['cr-card', S.sel.has(s.id) && 'is-selected', st.seen ? 'is-live' : st.live && 'is-hidden-live', st.viewing && 'is-viewing'], role: 'listitem' },
      h('button', { class: 'cr-card-open', type: 'button', title: 'Open it on the board · Ctrl+click or Shift+click selects', 'aria-pressed': S.sel.size ? String(S.sel.has(s.id)) : null, onclick: (e) => clickCard(e, s) },
        sceneThumb(s, 'cr-card-thumb'),
        h('span', { class: 'cr-card-text' }, h('span', { class: 'cr-card-name' }, s.name || 'Scene'), h('span', { class: 'cr-row-sub' }, sceneMeta(s)), sceneTags(s, tags))),
      sceneBadge(s, st, 'cr-card-badge'),
      pinButton(s, 'cr-card-pin'),
      S.sel.has(s.id) ? h('span', { class: 'cr-card-check', 'aria-hidden': 'true' }, icon('check')) : null,
      h('div', { class: 'cr-card-actions' }, showHideButton(s, st),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit the map', 'aria-label': 'Edit the map', onclick: () => openSceneEditor(s.id) }, icon('edit')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'More', 'aria-label': `More: ${s.name}`, onclick: (e) => sceneMenu(e.currentTarget, s) }, icon('more'))));
    dragSource(card, () => ({ scenes: S.sel.has(s.id) ? selectedInOrder() : [s.id] }));
    if (reorder) dropTarget(card, { zone: xHalves, accept: (p) => !!p.scenes, run: (p, z) => { if (!p.scenes.includes(s.id)) reorder(p.scenes, z === 'before' ? s.id : nextStill(list, i, p.scenes)); } });
    add(g, card);
  });
  return g;
}

function folderCards(list) {
  return h('div', { class: 'cr-lib-folders', role: 'list' }, list.map((f) => {
    const n = L.countDeep(f.id), k = L.childFolders(f.id).length;
    const renaming = S.renaming === f.id && S.renameIn === 'main';
    const card = h('div', { class: 'cr-fcard', role: 'listitem' },
      h(renaming ? 'div' : 'button', { class: 'cr-fcard-open', type: renaming ? null : 'button', title: renaming ? null : 'Open the folder', onclick: renaming ? null : () => go(`f:${f.id}`), ondblclick: renaming ? null : (e) => e.preventDefault() },
        folderIcon(f, 26),
        h('span', { class: 'cr-fcard-text' }, renaming ? renameField(f) : h('span', { class: 'cr-fcard-name' }, f.name),
          h('span', { class: 'cr-row-sub' }, [n ? plural(n, 'scene') : 'Empty', k ? plural(k, 'folder') : null].filter(Boolean).join(' · ')))),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'More', 'aria-label': `More: ${f.name}`, onclick: (e) => folderMenu(e.currentTarget, f) }, icon('more')));
    dragSource(card, () => (renaming ? null : { folder: f.id }));
    dropTarget(card, intoFolder(f.id));
    return card;
  }));
}

function placeCards(places) {
  return h('div', { class: 'cr-lib-folders', role: 'list' }, places.map((p) => {
    const n = L.scenesAt(null, p.id).length;
    const card = h('div', { class: 'cr-fcard is-place', role: 'listitem' },
      h('button', { class: 'cr-fcard-open', type: 'button', title: 'Open the place', onclick: () => go(`p:${p.id}`) },
        h('span', { class: 'cr-place-mark' }, icon(L.placeIcon(p))),
        h('span', { class: 'cr-fcard-text' }, h('span', { class: 'cr-fcard-name' }, p.name), h('span', { class: 'cr-row-sub' }, [typeName(p), n ? plural(n, 'scene') : null].filter(Boolean).join(' · ')))));
    dropTarget(card, ontoPlace({ map: p.map, loc: p.id }));
    return card;
  }));
}

function mapCards(maps) {
  return h('div', { class: 'cr-lib-folders', role: 'list' }, maps.map((m) => {
    const n = L.scenesAt(m.id, null, { places: true }).length;
    const card = h('div', { class: 'cr-fcard is-map', role: 'listitem' },
      h('button', { class: 'cr-fcard-open', type: 'button', title: 'Open the map', onclick: () => go(`m:${m.id}`) },
        mapThumb(m, 'cr-fcard-thumb'),
        h('span', { class: 'cr-fcard-text' }, h('span', { class: 'cr-fcard-name' }, m.name), h('span', { class: 'cr-row-sub' }, [plural(m.places.length, 'place'), n ? plural(n, 'scene') : null].filter(Boolean).join(' · ')))));
    dropTarget(card, ontoPlace({ map: m.id }));
    return card;
  }));
}

const head = (title, count, ...extra) => h('div', { class: 'cr-sec-head cr-lib-h' }, h('h3', { class: 'cr-sec-title' }, title, count != null ? h('span', { class: 'cr-lib-count' }, ` ${count}`) : null), ...extra);
const empty = (text) => h('p', { class: 'cr-lib-empty' }, text);
const swLink = (hash) => new URL(hash, swSite()).href;
const typeName = (p) => (p.type ? p.type[0].toUpperCase() + p.type.slice(1).replace(/-/g, ' ') : 'Place');

async function sceneFromMap(m) {
  const done = toast('Fetching the map from Stone Wardens…', { timeout: 0 });
  try {
    let blob;
    if (m.image.startsWith('content/')) {
      const bytes = await repo.bytes(m.image);
      if (!bytes) throw new Error('the image is missing');
      blob = new Blob([bytes], { type: mimeOf(m.image) });
    } else {
      const r = await fetch(new URL(m.image, swSite()));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      blob = await r.blob();
    }
    const file = new File([blob], m.image.split('/').pop() || 'map', { type: blob.type || mimeOf(m.image) });
    openSceneEditor(null, { name: m.name, at: { map: m.id }, file, region: true });
  } catch (e) {
    toast(`The map could not be read: ${e.message}`, { type: 'error' });
  } finally { done(); }
}

function drawContent(content, node) {
  clear(content);
  S.shown = [];
  const ids = selectedInOrder();
  if (ids.length) {
    const b = (ic, label, fn, cls = 'btn btn-sm') => h('button', { class: cls, type: 'button', onclick: fn }, icon(ic), label);
    add(content, h('div', { class: 'cr-lib-sel', role: 'toolbar', 'aria-label': 'Selected scenes' },
      h('strong', null, `${plural(ids.length, 'scene')} selected`),
      b('pin', 'Pin', () => L.setPinned(ids, true)),
      ids.some((id) => world.d(K.scene(id))?.pin != null) ? b('pin', 'Unpin', () => L.setPinned(ids, false)) : null,
      b('folder', 'Move to…', () => moveToFolder(ids)),
      b('compass', 'File under a place…', () => fileUnder(ids)),
      b('trash', 'Delete…', () => removeScenes(ids)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Clear the selection (Esc)', onclick: () => { S.sel.clear(); redraw(); } }, icon('close'), 'Clear')));
  }
  const q = S.query.trim().toLowerCase();
  if (q) { drawSearch(content, q); return; }
  const a = L.atlas();

  if (node === 'pinned') {
    const list = L.pinned();
    add(content, h('p', { class: 'muted text-sm cr-lib-note' }, 'Pinned scenes head the short list. Drag them into the order you like.'));
    add(content, list.length ? sceneGrid(list, { reorder: (ids2, before) => L.movePinned(ids2, before) }) : empty('Nothing pinned yet. Pin a scene with its pin button, or drag it onto Pinned in the tree.'));
  } else if (node === 'recent') {
    const list = L.recent();
    add(content, list.length ? sceneGrid(list) : empty('The scenes you open show up here.'));
  } else if (node === 'all') {
    const list = sorted(dmScenes());
    add(content, list.length ? sceneGrid(list) : empty('No scenes yet.'));
  } else if (node === 'root' || node.startsWith('f:')) {
    const fid = node === 'root' ? null : node.slice(2);
    const kids = sorted(L.childFolders(fid));
    const list = sorted(L.scenesIn(fid));
    const manual = getSetting('libSort') !== 'name';
    if (kids.length) add(content, head('Folders', kids.length), folderCards(kids));
    add(content, head(fid ? 'Scenes' : 'Scenes not in a folder', list.length));
    if (list.length) add(content, sceneGrid(list, { reorder: manual ? (ids2, before) => L.moveScenes(ids2, fid, before) : null, tags: { folder: false } }));
    else add(content, empty(fid ? 'This folder is empty. Drag scenes here, or make a new scene in it.' : kids.length ? 'Every scene is in a folder.' : 'Make folders to sort your scenes: by adventure, region, dungeon level, anything. Drag scenes onto a folder to file them.'));
  } else if (node.startsWith('m:')) {
    if (!a) { add(content, empty('Reading the Stone Wardens atlas…')); return; }
    const m = a.maps.get(node.slice(2)) || a.main;
    const here = sorted(L.scenesAt(m.id));
    add(content, h('div', { class: 'cr-lib-intro' }, mapThumb(m, 'cr-lib-intro-thumb'),
      h('div', { class: 'cr-lib-intro-text' },
        h('h3', { class: 'cr-lib-intro-name' }, m.name),
        h('p', { class: 'muted text-sm' }, [m.id === L.MAIN ? 'The main map of Stone Wardens' : `A map inside ${a.maps.get(m.parent)?.name || 'the main map'}`, plural(m.places.length, 'place'), m.kids.length ? plural(m.kids.length, 'map') + ' inside' : null].filter(Boolean).join(' · ')),
        h('div', { class: 'row' },
          m.image ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', title: 'A scene with this map as its image (crop and scale it next)', onclick: () => sceneFromMap(m) }, icon('image'), 'New scene from this map') : null,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openSceneEditor(null, { name: `${m.name} scene`, at: { map: m.id } }) }, icon('plus'), 'New scene here'),
          h('a', { class: 'btn btn-ghost btn-sm', href: swLink(m.id === L.MAIN ? '#/map' : `#/map/m/${encodeURIComponent(m.id)}`), target: '_blank', rel: 'noopener' }, icon('external'), 'Open in Stone Wardens')))));
    add(content, head('Scenes filed here', here.length), here.length ? sceneGrid(here, { tags: { place: false } }) : empty(`Drag scenes onto ${m.name} to file them here.`));
    if (m.places.length) add(content, head('Places', m.places.length), placeCards(m.places));
    if (m.kids.length) add(content, head('Maps inside', m.kids.length), mapCards(m.kids));
  } else if (node.startsWith('p:')) {
    if (!a) { add(content, empty('Reading the Stone Wardens atlas…')); return; }
    const p = a.places.get(node.slice(2));
    if (!p) { add(content, empty('This place is no longer on the Stone Wardens map.')); return; }
    const m = a.maps.get(p.map);
    const list = sorted(L.scenesAt(null, p.id));
    const desc = p.description.replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (x, t, alias) => alias || t.replace(/^\w+:/, '')).replace(/[*_`>#]/g, '').trim();
    add(content, h('div', { class: 'cr-lib-intro' }, h('span', { class: 'cr-place-mark is-big' }, icon(L.placeIcon(p))),
      h('div', { class: 'cr-lib-intro-text' },
        h('h3', { class: 'cr-lib-intro-name' }, p.name),
        h('p', { class: 'muted text-sm' }, `${typeName(p)} on ${m?.name || 'the main map'}`),
        desc ? h('p', { class: 'text-sm cr-lib-desc' }, desc.length > 280 ? `${desc.slice(0, 280).trim()}…` : desc) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openSceneEditor(null, { name: p.name, at: { map: p.map, loc: p.id } }) }, icon('plus'), 'New scene here'),
          p.submap && a.maps.has(p.submap) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go(`m:${p.submap}`) }, icon('map'), `Open its map`) : null,
          h('a', { class: 'btn btn-ghost btn-sm', href: swLink(`#/map/loc/${encodeURIComponent(p.id)}`), target: '_blank', rel: 'noopener' }, icon('external'), 'Open in Stone Wardens')))));
    add(content, head('Scenes', list.length), list.length ? sceneGrid(list, { tags: { place: false } }) : empty(`No scenes at ${p.name} yet. Drag scenes onto it here or in the tree, or make a new one.`));
  }
}

function drawSearch(content, q) {
  const has = (...xs) => xs.some((x) => String(x || '').toLowerCase().includes(q));
  const a = L.atlas();
  const scenes = dmScenes().filter((s) => {
    const spot = L.atlasSpot(s.at);
    return has(s.name, ...L.folderPath(L.folderOf(s)).map((f) => f.name), spot?.place?.name, spot?.map?.name);
  });
  const folders = L.folderIndex().list.filter((f) => has(f.name));
  const places = a ? [...a.places.values()].filter((p) => has(p.name, p.type)) : [];
  const maps = a ? [...a.maps.values()].filter((m) => has(m.name)) : [];
  if (!scenes.length && !folders.length && !places.length && !maps.length) { add(content, empty(`Nothing matches “${S.query.trim()}”.`)); return; }
  if (scenes.length) add(content, head('Scenes', scenes.length), sceneGrid(scenes));
  if (folders.length) add(content, head('Folders', folders.length), folderCards(folders));
  if (maps.length) add(content, head('Stone Wardens maps', maps.length), mapCards(maps));
  if (places.length) add(content, head('Stone Wardens places', places.length), placeCards(places));
}

function mainDrop(node) {
  if (node === 'pinned') return ontoPinned;
  if (node === 'root') return { accept: (p) => !!p.scenes || !!p.folder, run: intoFolder(null).run };
  if (node.startsWith('f:')) return intoFolder(node.slice(2));
  const a = L.atlas();
  if (node.startsWith('m:') && a) return ontoPlace({ map: node.slice(2) });
  const p = node.startsWith('p:') ? a?.places.get(node.slice(2)) : null;
  return p ? ontoPlace({ map: p.map, loc: p.id }) : null;
}

/** The wide library. */
export function renderLibrary(el, ctx) {
  S.ctx = ctx;
  if (S.dragging) { S.stale = true; return; }
  const keep = { tree: el.querySelector('.cr-lib-tree')?.scrollTop || 0, main: el.querySelector('.cr-lib-main')?.scrollTop || 0 };
  clear(el);
  L.loadAtlas().then((changed) => { if (changed) redraw(); }).catch((e) => console.warn('[library] atlas', e));
  const node = validNode();
  S.node = node;
  const tree = h('nav', { class: 'cr-lib-tree', 'aria-label': 'Folders and places' });
  S.tree = tree;
  drawTree(tree);
  const content = h('div', { class: 'cr-lib-content' });
  const inFolder = node === 'root' || node.startsWith('f:') ? (node === 'root' ? null : node.slice(2)) : undefined;
  const atPlace = node.startsWith('p:') || node.startsWith('m:');
  const search = h('input', {
    class: 'input input-sm cr-lib-search', type: 'search', value: S.query, placeholder: 'Find a scene, folder or place…', 'aria-label': 'Find a scene, folder or place',
    oninput: (e) => { S.query = e.target.value; S.sel.clear(); drawContent(content, node); },
  });
  const bar = h('div', { class: 'cr-lib-bar' },
    crumbs(node), h('span', { class: 'spacer' }),
    inFolder !== undefined || ['pinned', 'recent', 'all'].includes(node) ? h('button', { class: 'btn btn-sm', type: 'button', title: inFolder ? 'A new folder inside this one' : 'A new folder in My maps', onclick: () => { if (inFolder === undefined) go('root', { quiet: true }); createFolder(inFolder ?? null); } }, icon('folder-plus'), 'New folder') : null,
    atPlace ? null : h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openSceneEditor(null, { folder: inFolder ?? null }) }, icon('plus'), 'New scene')); // a map or place has its own, by its picture
  const tools = h('div', { class: 'cr-lib-tools' }, search,
    ['root', 'all'].includes(node) || node.startsWith('f:') || node.startsWith('m:') || node.startsWith('p:')
      ? h('select', { class: 'select cr-lib-sort', 'aria-label': 'Order', onchange: (e) => { setSetting('libSort', e.target.value); redraw(); } },
        h('option', { value: 'manual', selected: getSetting('libSort') !== 'name' }, 'Your order'),
        h('option', { value: 'name', selected: getSetting('libSort') === 'name' }, 'Name (A–Z)'))
      : null);
  const main = h('section', { class: 'cr-lib-main', 'aria-label': 'Scenes' }, bar, tools, content);
  const drop = mainDrop(node);
  if (drop) dropTarget(main, drop);
  drawContent(content, node);
  add(el, h('div', { class: 'cr-lib' }, tree, main));
  tree.scrollTop = keep.tree;
  main.scrollTop = keep.main;
  const r = el.querySelector('.cr-rename');
  if (r) { r.focus(); r.select(); }
}
