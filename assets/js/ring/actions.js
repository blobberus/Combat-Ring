// Every change to the table goes through here (tools, token menu and panels share it), so permissions and undo
// are handled in one place. DM edits are undoable (Ctrl+Z); players' writes are their own tokens, pins, initiative
// and preferences.
import { world, me, undoGroup } from './world.js';
import { ui, parseKey, viewKey, clearSelection } from './state.js';
import { K, newId, keyTail, snapPoint, sizeCells, rectPts, sceneSize, sortInitiative, nextTurn, rollFormula, abilityMod, SIZE_CELLS } from './model.js';
import { getSetting } from '../core/settings.js';
import { toast } from '../core/ui.js';
import { dmViewingId, liveSceneId } from './view.js';
import { statsFromIndex, sizeOf, tokenUrls } from './bestiary.js';
import { propById } from './props.js';
import { pcProfile } from './characters.js';

const dmUndo = { undo: true };

export function currentSceneId() { return world.dm ? dmViewingId() : liveSceneId(); }

function sceneOf(id) { return id ? (world.dm ? world.d(K.scene(id)) : world.t(K.scene(id))) : null; }

/** Snap unless Alt is held or snapping is off. */
export function maybeSnap(x, y, cells, e) {
  if (!getSetting('snap') || e?.altKey) return { x: Math.round(x), y: Math.round(y) };
  return snapPoint(x, y, cells, sceneOf(currentSceneId()));
}

/** Snap a w x h footprint (props can be oblong): per axis, odd sizes center in a cell, even ones on a line. */
export function snapBox(x, y, w, hh, e) {
  if (!getSetting('snap') || e?.altKey) return { x: Math.round(x), y: Math.round(y) };
  const c = sceneOf(currentSceneId())?.grid?.size || 100;
  const ax = (v, n) => (Math.round(n) % 2 ? Math.floor(v / c) * c + c / 2 : Math.round(v / c) * c);
  return { x: ax(x, w), y: ax(y, hh) };
}

// ---------- moving ----------

/** Can this device drag the thing behind a view key? */
export function canMove(vk) {
  const { room, key } = parseKey(vk);
  if (world.dm && !getSetting('dmPreview')) return true;
  if (room === 'dm') return false;
  if (key.startsWith('pct.')) return me.owns(key.split('.').slice(2).join('.'));
  if (key.startsWith('it.')) return !!world.t(key)?.movable;
  if (key.startsWith('pin.')) return mineOrDm(world.t(key));
  return false;
}

const mineOrDm = (pin) => world.dm || (!!pin && (pin.cid === world.bus.cid || (!!pin.by && pin.by === me.name())));

/**
 * Move to (x, y). Intermediate drag steps pass final:false (no undo entry); the drop records `from` for undo.
 */
export function moveTo(vk, x, y, { final = true, before = null } = {}) {
  const { room, key } = parseKey(vk);
  if (room === 'dm') {
    const it = world.d(key);
    if (!it) return;
    world.dPut(key, { ...it, x, y });
    if (final && before) world.record([['dm', key, before]], 'move');
    return;
  }
  if (key.startsWith('it.')) {
    // a prop the DM made movable: ask the DM's client (it owns the item); show our move meanwhile
    ui.optimistic.set(key, { x, y, at: Date.now() });
    world.send('table', 'req', { op: 'move', id: keyTail(key), x, y });
    if (final) setTimeout(() => { const o = ui.optimistic.get(key); if (o && Date.now() - o.at > 2500) ui.optimistic.delete(key); world.invalidate(); }, 3000);
    world.invalidate();
    return;
  }
  const cur = world.t(key);
  if (!cur) return;
  world.tPut(key, { ...cur, x, y });
  if (final && before && world.dm) world.record([['table', key, before]], 'move');
}

// ---------- placing ----------

function nextName(base, sceneId) {
  const names = new Set(world.dVals('item.').filter((it) => it.scene === sceneId).map((it) => it.name));
  if (!names.has(base) && !names.has(`${base} 1`)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

const topZ = (sceneId) => Math.max(0, ...world.dVals('item.').filter((it) => it.scene === sceneId).map((it) => it.z || 0)) + 1;

/** DM: place a creature from the bestiary index (m) or a custom creature ({custom: id}). */
export function placeCreature(src, x, y, { hidden = getSetting('placeHidden') } = {}) {
  const sceneId = dmViewingId();
  if (!sceneId) return null;
  const id = newId('c');
  let item;
  if (src.custom) {
    const c = world.d(K.cre(src.custom));
    if (!c) return null;
    const cells = sizeCells(c.size || 'medium');
    const p = maybeSnap(x, y, cells);
    const max = Number(c.hp) || 10;
    item = {
      scene: sceneId, kind: 'creature', name: nextName(c.name || 'Creature', sceneId), x: p.x, y: p.y, w: cells, h: cells, z: topZ(sceneId),
      custom: src.custom, media: c.media || null, img: c.img || null, tokens: c.tokens || [], disp: c.disp || 'enemy', hidden,
      hp: { cur: max, max, temp: 0 }, init: null, tie: c.abilities?.dex ?? null, statsVisible: 'none', conditions: [],
      stats: { size: c.size, type: c.type, alignment: c.alignment, cr: c.cr, ac: c.ac, acNote: c.acNote, speed: c.speed, abilities: c.abilities, saves: c.saves, skills: c.skills, senses: c.senses, languages: c.languages, resist: c.resist, immune: c.immune, traits: c.traits, actions: c.actions, bonus: c.bonus, reactions: c.reactions, legendary: c.legendary },
    };
  } else {
    const size = sizeOf(src);
    const cells = SIZE_CELLS[size] < 1 ? 1 : SIZE_CELLS[size];
    const p = maybeSnap(x, y, cells);
    const max = Number(src.hp) || 1;
    item = {
      scene: sceneId, kind: 'creature', name: nextName(src.name, sceneId), x: p.x, y: p.y, w: cells, h: cells, z: topZ(sceneId),
      tokens: tokenUrls(src), disp: 'enemy', hidden, hp: { cur: max, max, temp: 0 }, hpFormula: src.hpf || '',
      init: null, tie: src.abilities?.dex ?? null, statsVisible: 'none', conditions: [], stats: statsFromIndex(src),
    };
  }
  world.dPut(K.item(id), item, dmUndo);
  return viewKey('dm', K.item(id));
}

export function placeProp(prop, x, y, { hidden = false } = {}) {
  const sceneId = dmViewingId();
  if (!sceneId) return null;
  const def = typeof prop === 'string' ? propById(prop) : prop;
  const w = def?.w || 1, hh = def?.h || 1;
  const { x: sx, y: sy } = snapBox(x, y, w, hh);
  const id = newId('p');
  world.dPut(K.item(id), {
    scene: sceneId, kind: 'prop', prop: def?.custom ? null : def?.id || null, media: def?.media || null, img: def?.img || null,
    name: def?.name || 'Prop', x: sx, y: sy, w, h: hh, rot: 0, z: topZ(sceneId) - 1000, hidden, movable: false, light: def?.light || null,
  }, dmUndo);
  return viewKey('dm', K.item(id));
}

export function placeNote(x, y) {
  const sceneId = dmViewingId();
  if (!sceneId) return null;
  const id = newId('n');
  world.dPut(K.item(id), { scene: sceneId, kind: 'note', title: 'Interaction', notes: '', playerText: '', icon: 'mk-quest', x: Math.round(x), y: Math.round(y), revealed: false, reveals: [], spawns: [] }, dmUndo);
  return viewKey('dm', K.item(id));
}

/** Put a PC on a scene (the player places their own; the DM places anyone). */
export function placePc(charId, x, y, sceneId = currentSceneId()) {
  if (!sceneId) return null;
  if (!world.dm && !me.owns(charId)) return null;
  const p = pcProfile(charId);
  const pt = maybeSnap(x, y, sizeCells(p?.size || 'medium'));
  const key = K.pct(sceneId, charId);
  world.tPut(key, { x: pt.x, y: pt.y }, world.dm ? dmUndo : {});
  return viewKey('table', key);
}

/** DM: everyone in the party onto the scene, in a cluster around (x, y). */
export function placeParty(charIds, x, y) {
  const sceneId = currentSceneId();
  const scene = sceneOf(sceneId);
  const c = scene?.grid?.size || 100;
  undoGroup('place party', () => {
    charIds.forEach((id, i) => {
      if (world.t(K.pct(sceneId, id))) return;
      const ring = Math.floor(Math.sqrt(i));
      const a = (i * 2.4);
      placePc(id, x + Math.cos(a) * ring * c, y + Math.sin(a) * ring * c, sceneId);
    });
  });
}

// ---------- selection ops ----------

export function deleteKeys(vks) {
  undoGroup('delete', () => {
    for (const vk of vks) {
      const { room, key } = parseKey(vk);
      if (room === 'dm') { if (world.dm) world.del('dm', key, dmUndo); continue; }
      if (key.startsWith('pin.')) { if (mineOrDm(world.t(key))) world.del('table', key, world.dm ? dmUndo : {}); continue; }
      if (key.startsWith('pct.')) { if (world.dm || me.owns(key.split('.').slice(2).join('.'))) world.del('table', key, world.dm ? dmUndo : {}); continue; }
      if (key.startsWith('it.') && world.dm) world.del('dm', K.item(keyTail(key)), dmUndo);
    }
  });
  clearSelection();
}

export function duplicateKeys(vks) {
  const c = sceneOf(currentSceneId())?.grid?.size || 100;
  const out = [];
  undoGroup('duplicate', () => {
    for (const vk of vks) {
      const { room, key } = parseKey(vk);
      if (room !== 'dm' || !key.startsWith('item.')) continue;
      const it = world.d(key);
      if (!it) continue;
      const id = newId(it.kind[0]);
      const copy = { ...structuredClone(it), x: it.x + c, y: it.y };
      if (it.kind === 'creature') copy.name = nextName(String(it.name).replace(/\s+\d+$/, ''), it.scene);
      world.dPut(K.item(id), copy, dmUndo);
      out.push(viewKey('dm', K.item(id)));
    }
  });
  return out;
}

export function patchItem(id, fields, label = 'edit') {
  const key = K.item(id);
  const cur = world.d(key);
  if (!cur) return;
  world.dPut(key, { ...cur, ...fields }, { undo: true, label });
}

/** Bring to front / send to back (within its kind's layer). */
export function restack(vks, front = true) {
  undoGroup('order', () => {
    for (const vk of vks) {
      const { room, key } = parseKey(vk);
      if (room !== 'dm') continue;
      const it = world.d(key);
      if (!it) continue;
      const zs = world.dVals('item.').filter((x) => x.scene === it.scene && x.kind === it.kind).map((x) => x.z || 0);
      world.dPut(key, { ...it, z: front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1 }, dmUndo);
    }
  });
}

// ---------- fog ----------

export function addFog(pts, mode = ui.fogMode) {
  const sceneId = dmViewingId();
  if (!sceneId || !pts || pts.length < 6) return null;
  const id = newId('f');
  world.dPut(K.fog(sceneId, id), { pts, mode, on: true, z: Date.now() }, dmUndo);
  return id;
}

export function fogShapeKey(id) { return K.fog(dmViewingId(), id); }

export function toggleFog(id) {
  const key = fogShapeKey(id);
  const f = world.d(key);
  if (f) world.dPut(key, { ...f, on: f.on === false }, { undo: true, label: 'fog' });
}

export function deleteFog(id) { world.del('dm', fogShapeKey(id), dmUndo); }

export function coverAll() {
  const sceneId = dmViewingId();
  const s = sceneOf(sceneId);
  if (!s) return;
  const { w, h } = sceneSize(s);
  addFog(rectPts(0, 0, w, h), 'hide');
}

export function clearFog() {
  const sceneId = dmViewingId();
  undoGroup('clear fog', () => { for (const [k] of world.dList(`fog.${sceneId}.`)) world.del('dm', k, dmUndo); });
}

export function setFogOn(on) {
  const sceneId = dmViewingId();
  undoGroup('fog', () => { for (const [k, f] of world.dList(`fog.${sceneId}.`)) if ((f.on !== false) !== on) world.dPut(k, { ...f, on }, dmUndo); });
}

// ---------- interactions (DM notes) ----------

/** Reveal: show the player text as a notice, lift the linked fog, unhide the linked items. */
export function triggerNote(id, on = true) {
  const key = K.item(id);
  const n = world.d(key);
  if (!n) return;
  undoGroup(on ? 'trigger' : 'reset', () => {
    world.dPut(key, { ...n, revealed: on && !!n.playerText, triggered: on }, dmUndo);
    for (const f of n.reveals || []) {
      const fk = K.fog(n.scene, f);
      const sh = world.d(fk);
      if (sh) world.dPut(fk, { ...sh, on: !on }, dmUndo);
    }
    for (const i of n.spawns || []) {
      const ik = K.item(i);
      const it = world.d(ik);
      if (it) world.dPut(ik, { ...it, hidden: !on }, dmUndo);
    }
  });
  if (on) toast('Interaction triggered.', { type: 'success' });
}

// ---------- pins ----------

export function addPin(x, y, text, color) {
  const sceneId = currentSceneId();
  if (!sceneId) return null;
  const id = newId('pin');
  world.tPut(K.pin(id), { scene: sceneId, x: Math.round(x), y: Math.round(y), text: text || '', color: color || null, by: me.name() || 'A Warden', cid: world.bus.cid, at: Date.now(), resolved: false });
  return viewKey('table', K.pin(id));
}

export function editPin(key, fields) {
  const p = world.t(key);
  if (p && mineOrDm(p)) world.tPut(key, { ...p, ...fields });
}

export function resolvePin(key, resolved = true) {
  const p = world.t(key);
  if (p && world.dm) world.tPut(key, { ...p, resolved, resolvedBy: resolved ? me.name() || 'DM' : null }, dmUndo);
}

export function clearPins(sceneId = currentSceneId(), { resolvedOnly = false } = {}) {
  undoGroup('clear pins', () => {
    for (const [k, p] of world.tList('pin.')) if (p.scene === sceneId && (!resolvedOnly || p.resolved)) world.del('table', k, dmUndo);
  });
}

export const canEditPin = (p) => mineOrDm(p);

// ---------- initiative ----------
// ini.pc-<char> (players write their own), ini.x-<id> (DM extras: lair actions…), ini.dm-<item> (projected from
// creatures' init). The DM's list also shows its hidden creatures.

export function initiativeEntries({ forDm = world.dm } = {}) {
  const out = [];
  for (const [k, e] of world.tList('ini.')) {
    const id = keyTail(k);
    if (id.startsWith('dm-') && forDm) continue; // the DM reads creatures from its own items
    out.push({ id, key: k, ...e });
  }
  if (forDm) {
    const sceneId = world.d('dmeta')?.live || dmViewingId();
    for (const [k, it] of world.dList('item.')) {
      if (it.kind !== 'creature' || it.scene !== sceneId || it.init == null || it.init === '') continue;
      const id = keyTail(k);
      out.push({ id: `dm-${id}`, item: id, name: it.name, alias: it.alias, value: Number(it.init), tie: it.tie, disp: it.disp, hidden: !!it.hidden, src: 'dm' });
    }
  }
  return sortInitiative(out);
}

export function setPcInit(charId, value) {
  if (!world.dm && !me.owns(charId)) return;
  const p = pcProfile(charId);
  const key = K.ini(`pc-${charId}`);
  if (value == null || value === '') { world.del('table', key); return; }
  world.tPut(key, { name: p?.name || 'Adventurer', charId, value: Number(value), tie: world.t(key)?.tie ?? null, by: me.name() || '' });
}

export function setEntryInit(entry, value) {
  if (entry.src === 'dm') { patchItem(entry.item, { init: value == null || value === '' ? null : Number(value) }, 'initiative'); return; }
  if (entry.charId) { setPcInit(entry.charId, value); return; }
  if (!world.dm) return;
  if (value == null || value === '') world.del('table', entry.key, dmUndo);
  else world.tPut(entry.key, { ...world.t(entry.key), value: Number(value) }, dmUndo);
}

export function addInitExtra(name, value) {
  world.tPut(K.ini(`x-${newId()}`), { name: name || 'Lair action', value: Number(value) || 20, src: 'x' }, dmUndo);
}

/** DM: roll d20 + Dex for the creatures on the live scene that have no initiative yet (or all with force). */
export function rollCreatureInit({ force = false, onlyIds = null } = {}) {
  const sceneId = world.d('dmeta')?.live || dmViewingId();
  undoGroup('roll initiative', () => {
    for (const [k, it] of world.dList('item.')) {
      if (it.kind !== 'creature' || it.scene !== sceneId) continue;
      if (onlyIds && !onlyIds.includes(keyTail(k))) continue;
      if (!force && it.init != null && it.init !== '') continue;
      const mod = abilityMod(it.stats?.abilities?.dex ?? it.tie ?? 10);
      world.dPut(k, { ...it, init: rollFormula('1d20') + mod }, dmUndo);
    }
  });
}

export function setTurn(patch) {
  const dmeta = world.d('dmeta') || {};
  world.dPut('dmeta', { ...dmeta, turn: { ...(dmeta.turn || {}), ...patch } }, { undo: true, label: 'turn' });
}

export function advanceTurn(dir = 1) {
  const order = initiativeEntries({ forDm: true });
  const t = world.d('dmeta')?.turn || {};
  const next = nextTurn(order, t.current, t.round || 1, dir);
  setTurn({ active: true, ...next });
}

export function clearInitiative() {
  undoGroup('clear initiative', () => {
    for (const [k] of world.tList('ini.')) if (!keyTail(k).startsWith('dm-')) world.del('table', k, dmUndo);
    for (const [k, it] of world.dList('item.')) if (it.init != null) world.dPut(k, { ...it, init: null }, dmUndo);
    const dmeta = world.d('dmeta') || {};
    world.dPut('dmeta', { ...dmeta, turn: { active: false, round: 1, current: null } }, dmUndo);
  });
}

// ---------- scenes & table state ----------

export function dmeta() { return world.d('dmeta') || {}; }

export function patchDmeta(fields, label = 'table') {
  world.dPut('dmeta', { ...dmeta(), ...fields }, { undo: true, label });
}

export function goLive(sceneId) {
  patchDmeta({ live: sceneId, blackout: false }, 'show scene');
  toast('The players now see this scene.', { type: 'success' });
}

/** Hide the live scene from the players (they see the curtain), or show it to them again. */
export function setBlackout(on) {
  patchDmeta({ blackout: !!on }, on ? 'hide from players' : 'show to players');
  toast(on ? 'Hidden: the players see the curtain.' : 'The players see the scene again.', { type: on ? 'info' : 'success' });
}

export function setBanner(fields) { patchDmeta({ banner: { ...(dmeta().banner || {}), ...fields } }, 'banner'); }

export function centerOfView(board) {
  const r = board.root.getBoundingClientRect();
  return board.toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
