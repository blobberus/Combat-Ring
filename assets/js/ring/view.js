// The board's view model for this device: what the DM edits, or what a player sees (the DM's "player view" shows the
// same thing a player would, computed locally from the DM's state).
import { h } from '../core/dom.js';
import { getSetting } from '../core/settings.js';
import { world, me } from './world.js';
import { ui, viewKey } from './state.js';
import { party, pcProfile } from './characters.js';
import { project, sceneSize, fogged, oneLayer, healthState, K, keyTail, sizeCells, cellPx, ftToPx } from './model.js';
import { propById } from './props.js';

export function dmScenes() {
  return world.dList('scene.').map(([k, v]) => ({ ...v, id: v.id || keyTail(k) })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

/** The scene the DM has on the board. */
export function dmViewingId() {
  const scenes = dmScenes();
  if (ui.viewing && scenes.some((s) => s.id === ui.viewing)) return ui.viewing;
  const live = world.d('dmeta')?.live;
  if (live && scenes.some((s) => s.id === live)) return live;
  return scenes[0]?.id || null;
}

export const liveSceneId = () => (world.dm ? world.d('dmeta')?.live || null : world.t('meta')?.live || null);

/** Is the DM looking at the players' view? */
export const previewing = () => world.dm && getSetting('dmPreview');

/** What the players see right now (DM side): a scene, the curtain (the live scene hidden) or nothing. */
export function playersSee() {
  const dmeta = world.d('dmeta') || {};
  const s = dmeta.live ? dmScenes().find((x) => x.id === dmeta.live) : null;
  const show = !!dmeta.presenting; // a slideshow covers the board for them until it ends
  if (dmeta.blackout) return { state: 'curtain', id: s?.id || null, name: s?.name || null, show };
  if (s) return { state: 'scene', id: s.id, name: s.name || 'Scene', show };
  return { state: 'nothing', id: null, name: null, show };
}

/** The DM's "Players see …" line: a colored dot (green: a scene, amber: hidden) and the words. */
export function playersSeeLine(ps = playersSee()) {
  const words = ps.show ? ['Players see ', h('strong', null, 'the slideshow'), ps.state === 'scene' ? `, then ${ps.name}` : ps.state === 'curtain' ? ', then the curtain' : '']
    : ps.state === 'scene' ? ['Players see ', h('strong', null, ps.name)]
      : ps.state === 'curtain' ? [h('strong', null, 'Hidden'), ' · players see the curtain']
        : ['Players see ', h('strong', null, 'nothing yet')];
  return h('span', { class: ['rg-seen', `is-${ps.state}`] }, h('span', { class: 'rg-seen-dot', 'aria-hidden': 'true' }), h('span', { class: 'rg-seen-text' }, words));
}

const hpText = (hp) => `${hp.cur}/${hp.max}${hp.temp ? ` +${hp.temp}` : ''}`;

function creatureImgs(it) {
  if (it.media) return [it.media];
  if (it.img) return [it.img];
  return it.tokens || [];
}

function propImg(it) {
  if (it.media) return it.media;
  if (it.img) return it.img;
  return propById(it.prop)?.url || null;
}

// Whose turn it is: the DM's own board reads the DM's turn (the players' copy says only "something unseen" for a
// creature they can't see, which left the DM's enemies without the turn ring); players and the player view, theirs.
function turnTarget(role) {
  const turn = role === 'dm' ? world.d('dmeta')?.turn : world.t('turn');
  return turn?.active ? turn.current : null;
}

function pcTokens(sceneId, role) {
  const out = [];
  const turn = turnTarget(role);
  const unlocked = world.dm ? world.d('dmeta')?.unlocked?.[sceneId] || {} : Object.fromEntries((world.t('meta')?.unlocked || []).map((id) => [id, true]));
  for (const [k, pos] of world.tList(`pct.${sceneId}.`)) {
    if (!pos) continue;
    const charId = k.slice(`pct.${sceneId}.`.length);
    const p = pcProfile(charId);
    if (!p) continue;
    const mine = me.owns(charId);
    const opt = ui.optimistic.get(k);
    // its player and the DM see the numbers; the others what the player chose (hpShow)
    const hs = healthState(p.hp);
    const show = role === 'dm' || mine ? 'numbers' : p.hpShow;
    const health = !hs || show === 'private' ? null : show === 'numbers' ? { ...hs, text: hpText(p.hp) } : hs;
    out.push({
      key: viewKey('table', k), kind: 'pc', charId, x: opt?.x ?? pos.x, y: opt?.y ?? pos.y, w: sizeCells(p.size), h: sizeCells(p.size),
      name: p.name, label: p.name, owner: p.owner, img: p.img, accent: p.accent, mine, missing: p.missing,
      canDrag: role === 'dm' || (mine && !!unlocked[charId]), locked: !unlocked[charId], selected: ui.selected.has(viewKey('table', k)), turn: turn === `pc-${charId}`,
      dragFrom: ui.dragFrom?.key === viewKey('table', k) ? ui.dragFrom : null,
      conditions: p.conditions, health, profile: p, z: 1000,
    });
  }
  return out;
}

function pinMarks(sceneId, role) {
  const out = [];
  for (const [k, p] of world.tList('pin.')) {
    if (p.scene !== sceneId) continue;
    if (p.resolved && !ui.showResolved) continue;
    const vk = viewKey('table', k);
    out.push({
      key: vk, kind: 'pin', x: p.x, y: p.y, color: p.color || null, label: p.text ? '' : '', text: p.text, by: p.by, resolved: !!p.resolved,
      canDrag: role === 'dm' || p.byId === world.bus.cid || (p.by && p.by === me.name()), selected: ui.selected.has(vk), data: p,
    });
  }
  return out;
}

/** Ranges around tokens: the selected (or always-on) PCs' circles and a dragged token's movement. */
function ringsFor(tokens) {
  const rings = [];
  for (const t of tokens) {
    if (t.kind !== 'pc' || !t.profile) continue;
    const mode = t.profile.showRanges;
    if (mode === 'never') continue;
    if (mode === 'selected' && !t.selected && !t.dragFrom) continue;
    for (const r of t.profile.ranges) {
      if (!r.on || !(r.ft > 0)) continue;
      const at = r.id === 'move' && t.dragFrom ? t.dragFrom : t;
      rings.push({ x: at.x, y: at.y, ft: r.ft, label: `${r.label} ${r.ft} ft`, color: r.color || t.accent || null, kind: r.id === 'move' ? 'move' : 'range' });
    }
    if (t.profile.vision.show && t.profile.darkvision > 0) rings.push({ x: t.x, y: t.y, ft: t.profile.darkvision, label: `Darkvision ${t.profile.darkvision} ft`, kind: 'vision', color: t.profile.vision.tint || null });
  }
  return rings;
}

function lightSources(tokens, scene, viewerChars, role) {
  const level = scene.light?.level || 'bright';
  if (level === 'bright') return null;
  const shared = !!scene.light?.shared;
  const out = [];
  for (const t of tokens) {
    if (t.light && (t.light.bright || t.light.dim)) out.push({ x: t.x, y: t.y, bright: t.light.bright || 0, dim: t.light.dim || 0 });
    if (t.kind !== 'pc' || !t.profile) continue;
    if (t.profile.light) out.push({ x: t.x, y: t.y, bright: t.profile.light.bright || 0, dim: t.profile.light.dim || 0 });
    const sees = role === 'dm' ? false : shared || viewerChars.includes(t.charId);
    if (!sees) continue;
    const v = t.profile.vision;
    // a viewer's own sight (not a light: `fade` is how dim their darkvision looks, in percent)
    out.push({ x: t.x, y: t.y, sight: true, darkvision: t.profile.darkvision, soft: v.soft, gray: v.gray, fade: v.dim, tint: v.tint, tintStrength: v.tintStrength });
  }
  return out;
}

/**
 * What a player can't see is not drawn at all (no picture, no name on hover, no range rings): other characters under
 * fog (creatures and props under fog never reach the players), and in a dark scene everything outside the light and
 * the viewers' darkvision. Their own characters always show (with shared party vision, the whole party).
 * v.light holds the lights of every token, seen or not.
 */
function unseen(v, viewers) {
  const fog = v.scene.fogOn === false ? [] : v.fog;
  const dark = (v.scene.light?.level || 'bright') === 'dark' && v.light;
  const c = cellPx(v.scene);
  const sight = dark ? v.light.map((src) => ({ x: src.x, y: src.y, r: ftToPx(src.sight ? src.darkvision || 0 : (src.bright || 0) + (src.dim || 0), v.scene) })).filter((src) => src.r > 0) : null;
  const party = !!v.scene.light?.shared; // shared party vision: the party sees each other
  return (t) => {
    if (t.kind === 'pc' && (party || viewers.includes(t.charId))) return false;
    if (fog.length && fogged(t.x, t.y, fog)) return true;
    if (!sight) return false;
    const slack = (sizeCells(t.w) * c) / 4; // a big creature shows once part of it is in sight
    return !sight.some((src) => Math.hypot(t.x - src.x, t.y - src.y) <= src.r + slack);
  };
}

/** Players' tokens, rings and lights: lights from every token, then only what they can see is drawn. */
function playerSight(v, tokens, viewers) {
  v.light = lightSources(tokens, v.scene, viewers, 'player');
  const hide = unseen(v, viewers);
  v.tokens = tokens.filter((t) => !hide(t));
  v.rings = ringsFor(v.tokens);
  return v;
}

function waiting(title, text) {
  return [h('div', { class: 'rg-curtain' },
    h('svg', { class: 'rg-curtain-mark', viewBox: '0 0 48 48', 'aria-hidden': 'true' }, h('use', { href: 'assets/img/icons.svg#i-emblem' })),
    h('h2', { class: 'rg-curtain-title' }, title),
    text ? h('p', { class: 'rg-curtain-text' }, text) : null)];
}

const curtain = () => waiting('The scene is being set');

/** Player-side tokens from public objects (the table room, or a projection in the DM's preview). */
function publicTokens(get, list, sceneId, role) {
  const tokens = [];
  const marks = [];
  const turn = turnTarget(role);
  for (const [k, it] of list('it.')) {
    if (!it || it.scene !== sceneId) continue;
    const id = keyTail(k);
    const vk = viewKey('table', k);
    if (it.kind === 'notice') {
      marks.push({ key: vk, kind: 'notice', x: it.x, y: it.y, icon: it.icon, label: it.name, text: it.text, selected: ui.selected.has(vk), data: it });
      continue;
    }
    const opt = ui.optimistic.get(k);
    const base = {
      key: vk, kind: it.kind, x: opt?.x ?? it.x, y: opt?.y ?? it.y, w: it.w, h: it.h, rot: it.rot, z: it.z || 0, name: it.name, label: it.name,
      selected: ui.selected.has(vk), light: it.light, data: it, id,
    };
    if (it.kind === 'creature') {
      const health = it.health ? { ...it.health, text: it.stats?.hp?.max ? hpText(it.stats.hp) : null } : null; // numbers only with full stats
      tokens.push({ ...base, imgs: it.imgs?.length ? it.imgs : it.img ? [it.img] : [], disp: it.disp, health, conditions: it.conditions, turn: turn === `dm-${id}`, z: 500 + (it.z || 0) });
    } else {
      tokens.push({ ...base, img: it.img || propById(it.prop)?.url || null, canDrag: !!it.movable && role !== 'dm' });
    }
  }
  return { tokens, marks };
}

export function buildView() {
  const role = world.dm && !previewing() ? 'dm' : 'player';
  if (world.dm) return previewing() ? buildPreview() : buildDm();
  return buildPlayer(role);
}

function buildPlayer() {
  const meta = world.t('meta');
  const sceneId = meta?.live || null;
  const scene = sceneId ? world.t(K.scene(sceneId)) : null;
  if (!meta) return { role: 'player', emptyContent: waiting('The ring is quiet', 'Waiting for the DM to set the table.') };
  if (meta.blackout) return { role: 'player', emptyContent: curtain() };
  if (!scene) return { role: 'player', emptyContent: waiting('No scene yet', 'When the DM shows a map, it appears here.') };
  const fog = oneLayer(world.tList(`fog.${sceneId}.`).filter(([, v]) => v).map(([k, v]) => ({ ...v, id: k.slice(`fog.${sceneId}.`.length) })));
  const { tokens, marks } = publicTokens((k) => world.t(k), (p) => world.tList(p), sceneId, 'player');
  tokens.push(...pcTokens(sceneId, 'player'));
  marks.push(...pinMarks(sceneId, 'player'));
  return playerSight({ role: 'player', sceneId, scene: { ...scene, w: scene.w, h: scene.h }, map: scene.map, fog, marks }, tokens, me.chars());
}

// The player view projects the DM's whole state; that is done again only when the DM's state changed (players'
// moves and pins are table objects, read fresh each time).
let previewCache = null;
function previewProjection(sceneId) {
  if (previewCache?.sceneId === sceneId && previewCache.version === world.version.dm) return previewCache.pub;
  const dm = new Map(world.bus.entries('dm'));
  dm.set('dmeta', { ...(dm.get('dmeta') || {}), live: sceneId, blackout: false });
  const pub = project(dm);
  previewCache = { sceneId, version: world.version.dm, pub };
  return pub;
}

// The live scene shows exactly what the players see (the curtain while it is hidden); any other scene shows how it
// will look once it is shown.
function buildPreview() {
  const sceneId = dmViewingId();
  if (!sceneId) return { role: 'player', emptyContent: waiting('No scenes yet', 'Create a scene in the Scenes panel.') };
  const dmeta = world.d('dmeta') || {};
  if (dmeta.blackout && dmeta.live === sceneId) return { role: 'player', preview: true, emptyContent: curtain() };
  const pub = previewProjection(sceneId);
  const scene = pub.get(K.scene(sceneId));
  const get = (k) => pub.get(k) ?? null;
  const list = (prefix) => [...pub.entries()].filter(([k]) => k.startsWith(prefix));
  const fog = oneLayer(list(`fog.${sceneId}.`).map(([k, v]) => ({ ...v, id: k.slice(`fog.${sceneId}.`.length) })));
  const { tokens, marks } = publicTokens(get, list, sceneId, 'player');
  tokens.push(...pcTokens(sceneId, 'player'));
  marks.push(...pinMarks(sceneId, 'player'));
  let map = scene.map;
  if (map?.pending) map = world.d(K.scene(sceneId))?.map?.media || null; // the DM can see the sealed image
  const viewers = ui.previewChar ? [ui.previewChar] : party.all().map((c) => c.id);
  return playerSight({ role: 'player', preview: true, sceneId, scene: scene.light?.level ? scene : { ...scene, light: { level: 'bright' } }, map, fog, marks }, tokens, viewers);
}

// "Is this spot under fog?" remembered per spot until the fog changes (the DM's board asks it for every item on
// every redraw).
let fogMemo = { sig: '', at: new Map() };
function fogTest(shapes) {
  const sig = shapes.map((s) => `${s.id}:${s.z}:${s.on}:${s.pts?.length}:${s.pts?.[0]},${s.pts?.[1]}:${s.holes?.length || 0}`).join(';');
  if (sig !== fogMemo.sig) fogMemo = { sig, at: new Map() };
  return (x, y) => {
    const k = `${x},${y}`;
    let v = fogMemo.at.get(k);
    if (v === undefined) { v = fogged(x, y, shapes); fogMemo.at.set(k, v); if (fogMemo.at.size > 5000) fogMemo.at.clear(); }
    return v;
  };
}

function buildDm() {
  const sceneId = dmViewingId();
  if (!sceneId) return { role: 'dm', emptyContent: waiting('No scenes yet', 'Open the Scenes panel and create the first map.') };
  const s = world.d(K.scene(sceneId));
  const { w, h: hh } = sceneSize(s);
  const scene = { ...s, w, h: hh, grid: { size: s.grid?.size || 100, ft: s.grid?.ft || 5, show: s.grid?.show !== false, color: s.grid?.color, opacity: s.grid?.opacity ?? 0.35 }, light: s.light || { level: 'bright' }, fogOn: s.fogOn !== false };
  const fogPre = `fog.${sceneId}.`;
  const fog = oneLayer(world.dList(fogPre).filter(([, v]) => v).map(([k, v]) => ({ ...v, id: k.slice(fogPre.length) })));
  const activeFog = fog.filter((f) => f.on !== false);
  const underFog = fogTest(activeFog);
  const tokens = [];
  const marks = [];
  const turn = turnTarget('dm');
  for (const [k, it] of world.dList('item.')) {
    if (it.scene !== sceneId) continue;
    const id = keyTail(k);
    const vk = viewKey('dm', k);
    const selected = ui.selected.has(vk);
    if (it.kind === 'note') {
      marks.push({ key: vk, kind: 'note', x: it.x, y: it.y, icon: it.icon || 'mk-quest', label: it.title || 'Note', selected, canDrag: true, hidden: !it.revealed, data: it });
      continue;
    }
    const base = {
      key: vk, kind: it.kind, id, x: it.x, y: it.y, w: it.w || 1, h: it.h || it.w || 1, rot: it.rot || 0, z: it.z || 0,
      name: it.name, label: it.alias && it.alias !== it.name ? `${it.name} (${it.alias})` : it.name, hidden: !!it.hidden,
      fogged: scene.fogOn && underFog(it.x, it.y), selected, canDrag: !it.locked, light: it.light, data: it,
    };
    if (it.kind === 'creature') {
      const hs = healthState(it.hp);
      tokens.push({ ...base, imgs: creatureImgs(it), disp: it.disp || 'enemy', health: hs ? { ...hs, text: hpText(it.hp) } : null, conditions: it.conditions, turn: turn === `dm-${id}`, z: 500 + (it.z || 0) });
    } else tokens.push({ ...base, img: propImg(it) });
  }
  tokens.push(...pcTokens(sceneId, 'dm'));
  marks.push(...pinMarks(sceneId, 'dm'));
  const v = { role: 'dm', sceneId, scene, map: s.map?.media || s.map?.url || null, fog, fogSel: ui.fogSel, fogPicked: ui.fogShape === 'select' ? [...ui.fogPicked] : [], tokens, marks, live: world.d('dmeta')?.live === sceneId };
  v.rings = ringsFor(tokens);
  v.light = lightSources(tokens, scene, [], 'dm');
  return v;
}
