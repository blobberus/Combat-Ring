// The DM's map library: custom folders (nested to any depth), pinned scenes, recently used scenes, and the Stone
// Wardens atlas (its maps and places, read from the data repo) that scenes can be filed under. All DM-only.
//   folder.<id> (DM room)  {id, name, parent: folder id | null, order, color: pigment key | null}
//   scene.<id> fields      folder (folder id | null), pin (sort key while pinned | null),
//                          at ({map, loc?}: the atlas map or place it belongs to | null)
//   recent (DM room)       {ids: scene ids, last used first}
// None of it reaches the players (model.project copies only what it names).
import { repo } from '../core/repo.js';
import { config } from '../core/auth.js';
import { world, undoGroup } from './world.js';
import { K, newId, keyTail } from './model.js';
import { dmScenes } from './view.js';

export const FOLDER_COLORS = ['murrey', 'vermilion', 'ochre', 'gold', 'green', 'verdigris', 'lapis', 'slate', 'umber'];
const RECENT_MAX = 12;
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b);

// ---------- folders ----------

let index = null;
let indexAt = -1;
/** {list, byId, kids: Map(parent id | null -> folders in order)}; unknown, self or cyclic parents count as top level. */
export function folderIndex() {
  if (index && indexAt === world.version.dm) return index;
  const list = world.dList('folder.').filter(([, v]) => v).map(([k, v]) => ({ ...v, id: v.id || keyTail(k), parent: v.parent || null }));
  const byId = new Map(list.map((f) => [f.id, f]));
  for (const f of list) if (f.parent && (!byId.has(f.parent) || f.parent === f.id)) f.parent = null;
  for (const f of list) {
    const seen = new Set([f.id]);
    for (let p = f.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p)) { f.parent = null; break; }
      seen.add(p);
    }
  }
  const kids = new Map([[null, []]]);
  for (const f of list) { if (!kids.has(f.parent)) kids.set(f.parent, []); kids.get(f.parent).push(f); }
  for (const l of kids.values()) l.sort(byOrder);
  index = { list, byId, kids };
  indexAt = world.version.dm;
  return index;
}

export const folderById = (id) => (id ? folderIndex().byId.get(id) || null : null);
export const childFolders = (id) => folderIndex().kids.get(id || null) || [];
/** [top folder, …, the folder] */
export function folderPath(id) {
  const out = [];
  for (let f = folderById(id); f && out.length < 64; f = folderById(f.parent)) out.unshift(f);
  return out;
}
/** Is a inside b (or b itself)? */
export const within = (a, b) => folderPath(a).some((f) => f.id === b);
/** The folder a scene is filed in (null: none, or its folder is gone). */
export const folderOf = (s) => (s?.folder && folderById(s.folder) ? s.folder : null);
export const scenesIn = (id) => dmScenes().filter((s) => folderOf(s) === (id || null));
/** Scenes in a folder and every folder below it. */
export const countDeep = (id) => dmScenes().filter((s) => { const f = folderOf(s); return f && within(f, id); }).length;

export function newFolder(name, parent = null) {
  const id = newId('f');
  const order = Math.max(-1, ...childFolders(parent).map((f) => f.order ?? 0)) + 1;
  world.dPut(K.folder(id), { id, name: String(name || '').trim() || 'New folder', parent: parent || null, order, color: null }, { undo: true, label: 'new folder' });
  return id;
}

export function patchFolder(id, fields, label = 'folder') {
  const cur = world.d(K.folder(id));
  if (cur) world.dPut(K.folder(id), { ...cur, ...fields }, { undo: true, label });
}

/** Move a folder under parent (null: top level), before another folder (else last). False when it would go inside itself. */
export function moveFolder(id, parent, before = null) {
  parent = parent || null;
  if (parent && within(parent, id)) return false;
  const sibs = childFolders(parent).filter((f) => f.id !== id);
  const at = before ? sibs.findIndex((f) => f.id === before) : -1;
  sibs.splice(at < 0 ? sibs.length : at, 0, { id });
  undoGroup('move folder', () => {
    sibs.forEach((f, n) => {
      const cur = world.d(K.folder(f.id));
      if (cur && ((cur.order ?? -1) !== n || (f.id === id && (cur.parent || null) !== parent))) world.dPut(K.folder(f.id), { ...cur, order: n, ...(f.id === id ? { parent } : {}) }, { undo: true });
    });
  });
  return true;
}

/** Delete a folder: what was in it (folders and scenes) moves up to its parent. */
export function deleteFolder(id) {
  const f = folderById(id);
  if (!f) return;
  undoGroup('delete folder', () => {
    const base = Math.max(-1, ...childFolders(f.parent).map((x) => x.order ?? 0)) + 1;
    childFolders(id).forEach((c, n) => world.dPut(K.folder(c.id), { ...world.d(K.folder(c.id)), parent: f.parent, order: base + n }, { undo: true }));
    for (const s of scenesIn(id)) world.dPut(K.scene(s.id), { ...world.d(K.scene(s.id)), folder: f.parent }, { undo: true });
    world.del('dm', K.folder(id), { undo: true });
  });
}

// ---------- scenes ----------

function patchScenes(ids, fn, label) {
  undoGroup(label, () => {
    ids.forEach((id, n) => {
      const cur = world.d(K.scene(id));
      const fields = cur && fn(cur, n);
      if (fields && Object.entries(fields).some(([k, v]) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(v ?? null))) world.dPut(K.scene(id), { ...cur, ...fields }, { undo: true });
    });
  });
}

/**
 * File scenes in a folder (null: no folder), before another scene of that folder (else last); keeps their order.
 * The folder's scenes are renumbered (order counts within a folder).
 */
export function moveScenes(ids, folder, before = null) {
  folder = folder || null;
  const moving = new Set(ids);
  const list = scenesIn(folder).filter((s) => !moving.has(s.id));
  const at = before && !moving.has(before) ? list.findIndex((s) => s.id === before) : -1;
  const ordered = dmScenes().filter((s) => moving.has(s.id)); // the order they had
  list.splice(at < 0 ? list.length : at, 0, ...ordered);
  patchScenes(list.map((s) => s.id), (cur, n) => ({ order: n, ...(moving.has(cur.id) ? { folder } : {}) }), ids.length > 1 ? 'move scenes' : 'move scene');
}

export const pinned = () => dmScenes().filter((s) => s.pin != null).sort((a, b) => a.pin - b.pin || byName(a, b));

export function setPinned(ids, on) {
  let next = Math.max(0, ...pinned().map((s) => s.pin)) + 1;
  patchScenes(ids, (cur) => (on ? (cur.pin != null ? null : { pin: next++ }) : { pin: null }), on ? 'pin' : 'unpin');
}

/** Reorder the pinned scenes: ids go before another pinned scene (else last). */
export function movePinned(ids, before = null) {
  const moving = new Set(ids);
  const list = pinned().filter((s) => !moving.has(s.id));
  const at = before && !moving.has(before) ? list.findIndex((s) => s.id === before) : -1;
  list.splice(at < 0 ? list.length : at, 0, ...dmScenes().filter((s) => moving.has(s.id)));
  patchScenes(list.map((s) => s.id), (cur, n) => ({ pin: n + 1 }), 'reorder pins');
}

/** File scenes under an atlas map or place ({map, loc?}), or take them out (null). */
export function linkScenes(ids, at) {
  const v = at?.map ? { map: at.map, ...(at.loc ? { loc: at.loc } : {}) } : null;
  patchScenes(ids, () => ({ at: v }), v ? 'file under a place' : 'unlink place');
}

// ---------- recent ----------

export const recent = () => {
  const by = new Map(dmScenes().map((s) => [s.id, s]));
  return (world.d('recent')?.ids || []).map((id) => by.get(id)).filter(Boolean);
};

let recentTimer = 0;
let recentNext = null;
/** The DM is looking at a scene: once they stay a moment (flicking past doesn't count), it heads the recent list. */
export function noteViewed(id, { now = false } = {}) {
  if (!world.dm || !id || recentNext === id) return;
  const ids = world.d('recent')?.ids || [];
  clearTimeout(recentTimer);
  recentNext = null;
  if (ids[0] === id) return;
  recentNext = id;
  const write = () => {
    recentNext = null;
    if (!world.dm || !world.d(K.scene(id))) return;
    const cur = world.d('recent')?.ids || [];
    if (cur[0] !== id) world.dPut('recent', { ids: [id, ...cur.filter((x) => x !== id)].slice(0, RECENT_MAX) });
  };
  if (now) write(); else recentTimer = setTimeout(write, 1500);
}

// ---------- the Stone Wardens atlas ----------
// Mirrors Stone Wardens' map model (its docs/map-model.md): content/map/config.json is the main map (id "main"),
// content/maps/<id>.json the sub-maps ({name, parent, image}), content/locations/<id>.json the places ({name, type,
// map}). Sub-maps with an unknown, self or cyclic parent sit on the main map; places on an unknown map too. Places
// and maps the Stone Wardens DM hid are sealed there, so they don't show here.

export const MAIN = 'main';
const MAIN_NAME = 'The Uncharted Realm';
const MARKERS = new Set(['city', 'town', 'village', 'temple', 'danger', 'dungeon', 'ruins', 'castle', 'port', 'camp', 'cave', 'forest', 'mountain', 'landmark', 'tavern', 'shop', 'portal', 'battle', 'quest']);
export const placeIcon = (p) => (MARKERS.has(p?.type) ? `mk-${p.type}` : 'mk-custom');

const dirs = () => {
  const maps = config.maps || 'content/maps/';
  return { main: config.mainMap || 'content/map/config.json', maps, places: config.locations || 'content/locations/' };
};
const atlasFiles = () => {
  const d = dirs();
  const direct = (dir) => repo.list(dir).filter((f) => f.path.endsWith('.json') && !f.path.slice(dir.length).includes('/'));
  return [...(repo.has(d.main) ? [repo.files.get(d.main)] : []), ...direct(d.maps), ...direct(d.places)];
};

let atlasCache = null;
let atlasSig = '';
let atlasP = null;
/** The atlas as loaded last (null until the first load finished). */
export const atlas = () => atlasCache;

/** Load (or reload, when the files changed) the atlas. Resolves true when it changed. */
export function loadAtlas() {
  if (atlasP) return atlasP;
  const files = atlasFiles();
  const sig = files.map((f) => `${f.path}@${f.sha}`).join('|');
  if (atlasCache && sig === atlasSig) return Promise.resolve(false);
  atlasP = (async () => {
    const d = dirs();
    const read = async (f) => ({ path: f.path, data: await repo.json(f.path).catch(() => null) });
    const docs = await Promise.all(files.map(read));
    const cfg = docs.find((x) => x.path === d.main)?.data || {};
    const main = { id: MAIN, name: String(cfg.name || '').trim() || MAIN_NAME, parent: null, image: cfg.image || '', kids: [], places: [] };
    const maps = [main];
    const places = [];
    for (const { path, data } of docs) {
      if (!data || typeof data !== 'object' || path === d.main) continue;
      const id = path.split('/').pop().replace(/\.json$/i, '');
      if (path.startsWith(d.maps)) { if (id !== MAIN) maps.push({ id, name: String(data.name || '').trim() || 'Unnamed map', parent: String(data.parent || MAIN), image: data.image || '', kids: [], places: [] }); }
      else if (data.name) places.push({ id: data.id || id, name: String(data.name).trim(), type: data.type || '', map: String(data.map || MAIN), submap: data.submap || null, description: data.description || '' });
    }
    const byId = new Map(maps.map((m) => [m.id, m]));
    for (const m of maps) if (m.parent && (!byId.has(m.parent) || m.parent === m.id)) m.parent = MAIN;
    for (const m of maps) {
      const seen = new Set([m.id]);
      for (let p = m.parent; p && p !== MAIN; p = byId.get(p)?.parent) {
        if (seen.has(p)) { m.parent = MAIN; break; }
        seen.add(p);
      }
    }
    for (const m of maps) if (m.parent) byId.get(m.parent).kids.push(m);
    for (const p of places) { if (!byId.has(p.map)) p.map = MAIN; byId.get(p.map).places.push(p); }
    for (const m of maps) { m.kids.sort(byName); m.places.sort(byName); }
    atlasCache = { main, maps: byId, places: new Map(places.map((p) => [p.id, p])) };
    atlasSig = sig;
    return true;
  })().finally(() => { atlasP = null; });
  return atlasP;
}

let treeAt = 0;
/** Look for Stone Wardens map edits made since the page loaded (at most once a minute: it costs an API call). */
export async function refreshAtlas() {
  if (Date.now() - treeAt > 60000) { treeAt = Date.now(); await repo.tree(true).catch(() => {}); }
  return loadAtlas();
}

/** Where a scene is filed in the atlas: {map, place} (null when it isn't, or the atlas isn't loaded). */
export function atlasSpot(at) {
  const a = atlasCache;
  if (!a || !at?.map) return null;
  const place = at.loc ? a.places.get(at.loc) || null : null;
  const map = place ? a.maps.get(place.map) : a.maps.get(at.map) || a.main;
  return { map, place };
}

/** [main map, …, the map] */
export function mapChain(id) {
  const a = atlasCache;
  const out = [];
  for (let m = a?.maps.get(id); m && out.length < 64; m = m.parent ? a.maps.get(m.parent) : null) out.unshift(m);
  return out;
}

/** Scenes filed under a map (directly, or under one of its places when places is true) or a place. */
export function scenesAt(mapId, locId = null, { places = false } = {}) {
  return dmScenes().filter((s) => {
    const spot = atlasSpot(s.at);
    if (!spot) return false;
    if (locId) return spot.place?.id === locId;
    return spot.map.id === mapId && (places || !spot.place);
  });
}

/** An object URL for a Stone Wardens map image (a repo file, or one of the Stone Wardens site's own images). */
export async function atlasImageUrl(m, swBase) {
  const img = m?.image || '';
  if (!img) return null;
  if (img.startsWith('content/')) return repo.url({ p: img });
  return new URL(img, swBase).href;
}
