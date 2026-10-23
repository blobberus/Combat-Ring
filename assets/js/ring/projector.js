// The DM's client publishes the players' view: after any change in the DM room it projects the live scene
// (model.js project) and writes the difference to the table room. Moving one creature takes the fast path (just that
// item); anything else re-projects everything. Images the live scene or slideshow needs get a public copy first.
// It also applies players' requests that need the DM's state (moving a prop the DM marked movable).
import { world } from './world.js';
import { project, diffProjection, publicItem, projectItemMedia, initiativeEntry, makeMediaRef, sortShapes, K, keyTail } from './model.js';
import { publishMedia } from './media.js';
import { toast } from '../core/ui.js';

let unsub = null;
let unsubMsg = null;
let timer = 0;
let full = true;
const items = new Set();

export function startProjector() {
  stopProjector();
  unsub = world.on((p) => {
    for (const k of p.dm) {
      if (k.startsWith('item.')) items.add(keyTail(k));
      else full = true;
    }
    if (p.table.has('#')) full = true;
    if (p.dm.size || p.table.has('#')) schedule();
  });
  unsubMsg = world.bus.on((ev) => { if (ev.type === 'msg' && ev.room === 'table' && ev.channel === 'req') handleRequest(ev); });
  full = true;
  schedule();
}

export function stopProjector() {
  unsub?.(); unsub = null;
  unsubMsg?.(); unsubMsg = null;
  clearTimeout(timer); timer = 0;
}

function schedule() { if (!timer) timer = setTimeout(run, 25); }

function apply(changes) {
  for (const [k, v] of changes) world.bus.put('table', k, v);
}

function run() {
  timer = 0;
  if (!world.dm) return;
  const dm = new Map(world.bus.entries('dm'));
  const get = (k) => dm.get(k) ?? null;
  if (full) {
    full = false;
    items.clear();
    const next = project(dm);
    apply(diffProjection(world.tList(''), next));
    ensureMedia(dm);
    return;
  }
  // fast path: only items changed
  const live = get('dmeta')?.live;
  const blackout = !!get('dmeta')?.blackout;
  const scene = live ? get(K.scene(live)) : null;
  const fogOn = scene?.fogOn !== false;
  const fogPre = `fog.${live}.`;
  const shapes = live ? sortShapes([...dm.entries()].filter(([k]) => k.startsWith(fogPre)).map(([, v]) => v)) : [];
  const mediaRef = makeMediaRef(get);
  const changes = [];
  for (const id of items) {
    const it = get(K.item(id));
    let p = null;
    if (it && live && !blackout && it.scene === live) {
      p = publicItem(it, { fogShapes: shapes, fogOn });
      if (p) projectItemMedia(p, it, mediaRef);
    }
    const shown = world.t(K.ini(`dm-${id}`));
    const ini = it && p ? initiativeEntry(id, it, p, shown?.tie ?? null) : null;
    const listChanged = !shown !== !ini || (shown && ini && shown.value !== ini.value); // the tie ranks may change
    if (listChanged) full = true;
    for (const [k, v] of listChanged ? [[K.pub(id), p]] : [[K.pub(id), p], [K.ini(`dm-${id}`), ini]]) {
      const cur = world.t(k);
      if (v == null) { if (cur != null) changes.push([k, null]); } else if (JSON.stringify(cur) !== JSON.stringify(v)) changes.push([k, v]);
    }
    if (it?.media && it.scene === live && !get(K.media(it.media))?.pub) publishMedia(it.media).catch((e) => console.warn(e));
  }
  items.clear();
  apply(changes);
  if (full) schedule(); // an initiative line came, went or moved: the full projection re-ranks the list
}

/** Give the live scene's map, its items' art and the shown slides a public copy. */
function ensureMedia(dm) {
  const get = (k) => dm.get(k) ?? null;
  const dmeta = get('dmeta') || {};
  const need = new Set();
  const live = dmeta.blackout ? null : dmeta.live;
  if (live) {
    const s = get(K.scene(live));
    if (s?.map?.media) need.add(s.map.media);
    for (const [k, v] of dm) if (k.startsWith('item.') && v?.scene === live && v.media && !v.hidden) need.add(v.media);
  }
  const deck = dmeta.presenting?.deck ? get(K.deck(dmeta.presenting.deck)) : null;
  for (const sl of deck?.slides || []) if (sl.media) need.add(sl.media);
  for (const id of need) {
    if (get(K.media(id))?.pub) continue;
    publishMedia(id).catch((e) => { console.warn('[projector] publish failed', e); toast(`An image could not be shown to the players: ${e.message}`, { type: 'error' }); });
  }
}

function handleRequest(ev) {
  const r = ev.data || {};
  if (r.op === 'move' && r.id) {
    const it = world.d(K.item(r.id));
    const live = world.d('dmeta')?.live;
    if (!it || !it.movable || it.hidden || it.scene !== live) return;
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return;
    world.dPut(K.item(r.id), { ...it, x: r.x, y: r.y });
  }
}
