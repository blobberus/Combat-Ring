// The table's pure model: object keys, sizes and distances, fog geometry, initiative order, and the projection of the
// DM's state into what players may see. No DOM, no network: Node-tested (tools/test_model.mjs).
//
// Coordinates are map pixels of the scene (cell = scene.grid.size px, default 100); token x/y is the center.

export const DEFAULT_CELL = 100;
export const DEFAULT_FT = 5;

export const SIZE_CELLS = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
export const SIZE_NAMES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
export const SIZE_FROM_LETTER = { T: 'tiny', S: 'small', M: 'medium', L: 'large', H: 'huge', G: 'gargantuan' };

export const DISPOSITIONS = [
  { id: 'enemy', label: 'Enemy' },
  { id: 'ally', label: 'Companion' },
  { id: 'neutral', label: 'Neutral' },
];

export const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating'];

export const LIGHT_LEVELS = [
  { id: 'bright', label: 'Bright' },
  { id: 'dim', label: 'Dim' },
  { id: 'dark', label: 'Dark' },
];

export const TIMES_OF_DAY = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Evening', 'Night', 'Midnight'];

// ---------- keys ----------
// table room (every player): meta, scene.<id>, fog.<scene>.<shape>, it.<item>, pc.<char>, pct.<scene>.<char>,
//   pin.<id>, ini.<id>, turn, show
// dm room (DM only): dmeta, scene.<id>, fog.<scene>.<shape>, item.<id>, cre.<id>, media.<id>, deck.<id>
export const K = {
  scene: (id) => `scene.${id}`,
  fog: (scene, id) => `fog.${scene}.${id}`,
  item: (id) => `item.${id}`,
  pub: (id) => `it.${id}`,
  pc: (charId) => `pc.${charId}`,
  pct: (scene, charId) => `pct.${scene}.${charId}`,
  pin: (id) => `pin.${id}`,
  ini: (id) => `ini.${id}`,
  cre: (id) => `cre.${id}`,
  media: (id) => `media.${id}`,
  deck: (id) => `deck.${id}`,
};

export const keyTail = (key) => key.slice(key.indexOf('.') + 1);

/** A key-safe id: letters, digits, dashes. */
export function newId(prefix = '') {
  const r = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  return prefix ? `${prefix}-${r}` : r;
}

export const safeKeyPart = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';

// ---------- scene geometry ----------

export const cellPx = (scene) => Number(scene?.grid?.size) || DEFAULT_CELL;
export const ftPerCell = (scene) => Number(scene?.grid?.ft) || DEFAULT_FT;
export const ftToPx = (ft, scene) => (Number(ft) || 0) / ftPerCell(scene) * cellPx(scene);
export const pxToFt = (px, scene) => px / cellPx(scene) * ftPerCell(scene);

export function sceneSize(scene) {
  const c = cellPx(scene);
  return { w: (Number(scene?.cols) || 20) * c, h: (Number(scene?.rows) || 15) * c };
}

/** Token footprint in cells for a size name or number. */
export function sizeCells(size) {
  if (typeof size === 'number' && size > 0) return size;
  return SIZE_CELLS[size] || 1;
}

/**
 * Distance in feet between two points, by the table's rule:
 * 'five' (2024 PHB: every square, diagonal or not, is 5 ft), 'alternate' (5-10-5), 'euclid' (straight line).
 */
export function distanceFt(a, b, scene, rule = 'five') {
  const c = cellPx(scene);
  const ft = ftPerCell(scene);
  const dx = Math.abs(b.x - a.x) / c;
  const dy = Math.abs(b.y - a.y) / c;
  if (rule === 'euclid') return Math.round(Math.hypot(dx, dy) * ft);
  const nx = Math.round(dx);
  const ny = Math.round(dy);
  const diag = Math.min(nx, ny);
  const straight = Math.max(nx, ny) - diag;
  if (rule === 'alternate') return (straight + diag + Math.floor(diag / 2)) * ft;
  return (straight + diag) * ft;
}

/** Snap a token center so a token of `cells` cells sits on the grid. */
export function snapPoint(x, y, cells, scene) {
  const c = cellPx(scene);
  const n = Math.max(1, Math.round(cells));
  const off = n % 2 === 1 ? c / 2 : 0; // odd sizes center in a cell, even ones on an intersection
  const sx = Math.round((x - off) / c) * c + off;
  const sy = Math.round((y - off) / c) * c + off;
  return { x: sx, y: sy };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- polygons (flat arrays [x0, y0, x1, y1, …]) ----------

export function pointInPolygon(x, y, pts) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1];
    const xj = pts[j * 2], yj = pts[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

export const rectPts = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];

export function circlePts(cx, cy, r, n = 28) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
  }
  return out;
}

function perpDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  if (!len) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer–Douglas–Peucker on a flat array (open polyline). */
export function simplify(pts, tol = 2) {
  const n = pts.length / 2;
  if (n <= 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(Math.round(pts[i * 2]), Math.round(pts[i * 2 + 1]));
  return out;
}

export function polygonArea(pts) {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (pts[j * 2] + pts[i * 2]) * (pts[j * 2 + 1] - pts[i * 2 + 1]);
  return Math.abs(a / 2);
}

/** SVG path data for a closed polygon. */
export function pathD(pts) {
  if (!pts || pts.length < 6) return '';
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
  return `${d}Z`;
}

// ---------- fog ----------
// A shape is {pts, mode: 'hide'|'reveal', on (default true), z}. Shapes apply in z order: a 'hide' shape covers, a
// 'reveal' shape cuts a hole in what came before it. A point is fogged when the last active shape containing it hides.

export const sortShapes = (shapes) => [...shapes].sort((a, b) => (a.z || 0) - (b.z || 0));

export function fogged(x, y, shapes) {
  let hidden = false;
  for (const s of shapes) {
    if (s.on === false || !s.pts || s.pts.length < 6) continue;
    if (pointInPolygon(x, y, s.pts)) hidden = s.mode !== 'reveal';
  }
  return hidden;
}

// ---------- initiative ----------

/** Entries [{id, value, tie, name}] highest first; ties by tie (Dex) then name. Entries without a value last. */
export function sortInitiative(entries) {
  return [...entries].sort((a, b) => {
    const av = a.value == null || a.value === '' ? -Infinity : Number(a.value);
    const bv = b.value == null || b.value === '' ? -Infinity : Number(b.value);
    if (av !== bv) return bv - av;
    const at = Number(a.tie) || 0, bt = Number(b.tie) || 0;
    if (at !== bt) return bt - at;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
  });
}

/** The entry after `current` in order (wrapping, with a new round). -> {current, round} */
export function nextTurn(order, current, round = 1, dir = 1) {
  const ids = order.filter((e) => e.value != null && e.value !== '').map((e) => e.id);
  if (!ids.length) return { current: null, round };
  const i = ids.indexOf(current);
  if (i < 0) return { current: dir > 0 ? ids[0] : ids[ids.length - 1], round: Math.max(1, round) };
  let j = i + dir;
  let r = round;
  if (j >= ids.length) { j = 0; r += 1; }
  if (j < 0) { j = ids.length - 1; r = Math.max(1, r - 1); }
  return { current: ids[j], round: r };
}

export function crValue(cr) {
  if (cr == null || cr === '') return null;
  const s = String(typeof cr === 'object' ? cr.cr : cr);
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b : null; }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const abilityMod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);
export const fmtMod = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Roll a dice formula like "2d6+3" (or a plain number). -> integer */
export function rollFormula(formula, rand = Math.random) {
  const s = String(formula || '').replace(/\s+/g, '');
  if (/^-?\d+$/.test(s)) return Number(s);
  let total = 0;
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
  let m;
  let any = false;
  while ((m = re.exec(s))) {
    any = true;
    if (m[3]) {
      const sign = m[1] === '-' ? -1 : 1;
      const n = Number(m[2] || 1), d = Number(m[3]);
      for (let i = 0; i < n; i++) total += sign * (1 + Math.floor(rand() * d));
    } else total += (m[4] === '-' ? -1 : 1) * Number(m[5]);
  }
  return any ? total : 0;
}

// ---------- the projection: DM state -> what players see ----------

/** A health word for an HP bar shown to players (exact numbers stay with the DM unless stats are shown). */
export function healthState(hp) {
  const cur = Number(hp?.cur), max = Number(hp?.max);
  if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return null;
  const f = cur / max;
  return { pct: Math.round(clamp(f, 0, 1) * 100), word: cur <= 0 ? 'Down' : f <= 0.5 ? 'Bloodied' : f < 1 ? 'Hurt' : 'Unhurt' };
}

const STAT_FIELDS = ['size', 'type', 'alignment', 'cr', 'ac', 'acNote', 'speed', 'abilities', 'saves', 'skills', 'senses', 'languages',
  'resist', 'immune', 'vulnerable', 'conditionImmune', 'traits', 'actions', 'bonus', 'reactions', 'legendary', 'ref'];

/** What a player sees of one DM item (or null when they see nothing of it). */
export function publicItem(item, { fogShapes = [], fogOn = true } = {}) {
  if (!item || item.hidden) return null;
  if (item.kind === 'note') {
    if (!item.revealed) return null;
    return { scene: item.scene, kind: 'notice', x: item.x, y: item.y, w: 1, h: 1, name: item.title || 'Notice', text: item.playerText || '', icon: item.icon || 'mk-quest', z: item.z || 0 };
  }
  if (fogOn && fogged(item.x, item.y, fogShapes)) return null;
  const out = {
    scene: item.scene, kind: item.kind, x: item.x, y: item.y, w: item.w || 1, h: item.h || item.w || 1,
    rot: item.rot || 0, z: item.z || 0, name: item.alias || item.name || '', img: item.img || null,
    movable: !!item.movable, light: item.light || null,
  };
  if (item.kind === 'creature') {
    out.disp = item.disp || 'enemy';
    out.conditions = item.conditions || [];
    out.imgs = item.img ? [item.img] : item.tokens || [];
    const vis = item.statsVisible || 'none';
    if (vis === 'hp' || vis === 'full') out.health = healthState(item.hp);
    if (vis === 'full') {
      const st = {};
      for (const f of STAT_FIELDS) if (item.stats?.[f] != null) st[f] = item.stats[f];
      st.hp = item.hp ? { cur: item.hp.cur, max: item.hp.max, temp: item.hp.temp || 0 } : null;
      out.stats = st;
    }
  } else if (item.kind === 'prop') {
    out.prop = item.prop || null;
    out.tint = item.tint || null;
  }
  return out;
}

/** media id -> the public reference players load ({p, s, m, w, h}), {pending} before it is published, or null. */
export const makeMediaRef = (get) => (id) => {
  if (!id) return null;
  if (typeof id === 'object') return id.url ? { url: id.url } : null;
  const m = get(K.media(id));
  if (!m) return null;
  return m.pub ? { ...m.pub, w: m.w, h: m.h } : { pending: true };
};

/** An uploaded image on an item: its public copy, or none until there is one (players see the default art). */
export function projectItemMedia(p, item, mediaRef) {
  if (!item.media) return p;
  const ref = mediaRef(item.media);
  p.img = ref && !ref.pending ? ref : null;
  if (item.kind === 'creature') p.imgs = p.img ? [p.img] : [];
  return p;
}

/**
 * A creature's line in the players' initiative list (only for creatures they can see). `tie` is not its Dexterity but
 * that score's rank among the listed creatures (tieRanks): players get the DM's order without the stat.
 */
export function initiativeEntry(id, item, p, tie = null) {
  if (item.kind !== 'creature' || item.init == null || item.init === '' || !p) return null;
  return { name: p.name || 'Creature', value: Number(item.init), tie, item: id, disp: p.disp, src: 'dm' };
}

/** items: [item] -> (item -> rank of its Dexterity tie-breaker among them, 1 = lowest; null without one). */
export function tieRanks(items) {
  const scores = [...new Set(items.map((it) => Number(it.tie)).filter((n) => n > 0))].sort((a, b) => a - b);
  return (it) => { const i = scores.indexOf(Number(it.tie)); return i < 0 ? null : i + 1; };
}

/**
 * Everything the DM's client publishes to the table room, from the DM room's objects.
 * dm: Map|object key -> value (DM room). Returns a Map key -> value of public objects (keys the projector owns:
 * meta, scene.*, fog.*, it.*, ini.dm-*, turn, show). Media without a public copy yet makes the scene's map `pending`.
 */
export function project(dm) {
  const get = (k) => (dm instanceof Map ? dm.get(k) : dm[k]) ?? null;
  const all = dm instanceof Map ? [...dm.entries()] : Object.entries(dm);
  const out = new Map();
  const dmeta = get('dmeta') || {};
  const live = dmeta.live && get(K.scene(dmeta.live)) ? dmeta.live : null;
  const banner = dmeta.banner || {};
  const shownBanner = {};
  if (banner.showTime && banner.time) shownBanner.time = banner.time;
  if (banner.showLocation && banner.location) shownBanner.location = banner.location;
  const blackout = !!dmeta.blackout;
  out.set('meta', {
    live: blackout ? null : live,
    blackout,
    banner: Object.keys(shownBanner).length ? shownBanner : null,
    measure: dmeta.measure || null,
  });

  const mediaRef = makeMediaRef(get);

  if (live && !blackout) {
    const s = get(K.scene(live));
    const { w, h } = sceneSize(s);
    const fogPre = `fog.${live}.`;
    const fogShapes = sortShapes(all.filter(([k, v]) => v && k.startsWith(fogPre)).map(([k, v]) => ({ ...v, id: k.slice(fogPre.length) })));
    const fogOn = s.fogOn !== false;
    out.set(K.scene(live), {
      id: live, name: s.name || 'Scene', cols: s.cols, rows: s.rows, w, h, color: s.color || null,
      map: s.map?.media ? mediaRef(s.map.media) : s.map?.url ? { url: s.map.url } : null,
      grid: { size: cellPx(s), ft: ftPerCell(s), show: s.grid?.show !== false && s.grid?.players !== false, color: s.grid?.color || null, opacity: s.grid?.opacity ?? 0.35 },
      light: { level: s.light?.level || 'bright', shared: !!s.light?.shared },
      fogOn,
    });
    if (fogOn) {
      for (const sh of fogShapes) {
        if (sh.on === false) continue;
        out.set(K.fog(live, sh.id), { pts: sh.pts, mode: sh.mode === 'reveal' ? 'reveal' : 'hide', z: sh.z || 0 });
      }
    }
    const items = all.filter(([k, v]) => v && k.startsWith('item.') && v.scene === live);
    const listed = [];
    for (const [k, it] of items) {
      const p = publicItem(it, { fogShapes, fogOn });
      if (!p) continue;
      projectItemMedia(p, it, mediaRef);
      out.set(K.pub(keyTail(k)), p);
      if (initiativeEntry(keyTail(k), it, p)) listed.push([keyTail(k), it, p]);
    }
    const rank = tieRanks(listed.map(([, it]) => it));
    for (const [id, it, p] of listed) out.set(K.ini(`dm-${id}`), initiativeEntry(id, it, p, rank(it)));
  }
  const turn = dmeta.turn;
  if (turn?.active) {
    let current = turn.current || null;
    if (current && current.startsWith('dm-') && !out.has(K.ini(current))) current = 'hidden';
    out.set('turn', { active: true, round: turn.round || 1, current });
  } else out.set('turn', { active: false });

  const pres = dmeta.presenting;
  const deck = pres?.deck ? get(K.deck(pres.deck)) : null;
  if (deck) {
    const slides = (deck.slides || []).map((sl) => {
      const img = sl.media ? mediaRef(sl.media) : sl.url ? { url: sl.url } : null;
      // a title or description the DM keeps to themself is not sent at all
      return { img: img && !img.pending ? img : null, pending: !!img?.pending, caption: sl.hideCaption ? '' : sl.caption || '', title: sl.hideTitle ? '' : sl.title || '', anim: sl.anim || 'none', dur: sl.dur || 8 };
    });
    out.set('show', {
      on: true, deck: pres.deck, title: deck.hideTitle ? '' : deck.title || '', slides, index: clamp(Number(pres.index) || 0, 0, Math.max(0, slides.length - 1)),
      at: pres.at || 0, auto: !!pres.auto, loop: !!deck.loop, transition: deck.transition || 'fade', fit: deck.fit || 'cover',
    });
  } else out.set('show', { on: false });
  return out;
}

/** Keys the projector owns in the table room (it removes the ones it no longer produces). */
export const projectedKey = (k) => k === 'meta' || k === 'turn' || k === 'show' || k.startsWith('scene.') || k.startsWith('fog.') || k.startsWith('it.') || k.startsWith('ini.dm-');

/** Changes to make the table room match a projection: [[key, value|null]]. current: [[key, value]]. */
export function diffProjection(current, next) {
  const changes = [];
  const have = new Map(current.filter(([k]) => projectedKey(k)));
  for (const [k, v] of next) {
    const cur = have.get(k);
    if (cur === undefined || JSON.stringify(cur) !== JSON.stringify(v)) changes.push([k, v]);
    have.delete(k);
  }
  for (const k of have.keys()) changes.push([k, null]);
  return changes;
}
