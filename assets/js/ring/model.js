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
// dm room (DM only): dmeta, scene.<id>, fog.<scene>.<shape>, item.<id>, cre.<id>, media.<id>, deck.<id>,
//   folder.<id>, recent (the map library: library.js)
export const K = {
  scene: (id) => `scene.${id}`,
  fog: (scene, id) => `fog.${scene}.${id}`,
  item: (id) => `item.${id}`,
  pub: (id) => `it.${id}`,
  pc: (charId) => `pc.${charId}`,
  sheet: (charId) => `sheet.${charId}`,
  pct: (scene, charId) => `pct.${scene}.${charId}`,
  pin: (id) => `pin.${id}`,
  ini: (id) => `ini.${id}`,
  cre: (id) => `cre.${id}`,
  media: (id) => `media.${id}`,
  deck: (id) => `deck.${id}`,
  folder: (id) => `folder.${id}`,
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
// One layer: a fog area is {pts, holes: [pts, …], on, z, flat: true}. Drawing a new area (or a clearing) cuts itself out
// of the areas it overlaps (cutFog), so areas never overlap and every spot belongs to at most one; deleting an area
// leaves no fog there. on: false = revealed to the players (the DM still sees it, to hide it again).
// Older saves stacked shapes ({pts, mode: 'hide'|'reveal', on, z}, the newest winning): flattenFog makes them one layer.

export const sortShapes = (shapes) => [...shapes].sort((a, b) => (a.z || 0) - (b.z || 0));

const valid = (s) => !!s?.pts && s.pts.length >= 6;
/** Is the point inside the area (its outline, not one of its holes)? */
export const inArea = (x, y, s) => pointInPolygon(x, y, s.pts) && !(s.holes || []).some((h) => pointInPolygon(x, y, h));

/** Under fog the players can't see? shapes: one layer (oneLayer). */
export function fogged(x, y, shapes) {
  return shapes.some((s) => s.on !== false && s.mode !== 'reveal' && valid(s) && inArea(x, y, s));
}

export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i];
    if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1];
    if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  return [x0, y0, x1, y1];
}
const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const orient = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

/** Does any edge of polygon a cross an edge of polygon b? */
function edgesCross(a, b) {
  const na = a.length / 2, nb = b.length / 2;
  const bb = bbox(b);
  for (let i = 0, j = na - 1; i < na; j = i++) {
    const ax = a[j * 2], ay = a[j * 2 + 1], bx = a[i * 2], by = a[i * 2 + 1];
    if (Math.max(ax, bx) < bb[0] || Math.min(ax, bx) > bb[2] || Math.max(ay, by) < bb[1] || Math.min(ay, by) > bb[3]) continue;
    for (let k = 0, l = nb - 1; k < nb; l = k++) {
      const cx = b[l * 2], cy = b[l * 2 + 1], dx = b[k * 2], dy = b[k * 2 + 1];
      if (Math.max(cx, dx) < Math.min(ax, bx) || Math.min(cx, dx) > Math.max(ax, bx) || Math.max(cy, dy) < Math.min(ay, by) || Math.min(cy, dy) > Math.max(ay, by)) continue;
      const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy), o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
      if (o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4) return true;
    }
  }
  return false;
}

/** Do two polygons share any area? */
export function polysOverlap(a, b) {
  if (!boxesMeet(bbox(a), bbox(b))) return false;
  return pointInPolygon(a[0], a[1], b) || pointInPolygon(b[0], b[1], a) || edgesCross(a, b);
}

/** Is polygon a wholly inside polygon b? */
export function polyInside(a, b) {
  const ba = bbox(a), bb = bbox(b);
  if (ba[0] < bb[0] || ba[1] < bb[1] || ba[2] > bb[2] || ba[3] > bb[3]) return false;
  for (let i = 0; i < a.length; i += 2) if (!pointInPolygon(a[i], a[i + 1], b)) return false;
  return !edgesCross(a, b);
}

/** Has an area been cut away to nothing? (sampled: what is left is too small to matter) */
function areaGone(s) {
  const [x0, y0, x1, y1] = bbox(s.pts);
  const n = 24;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (inArea(x0 + ((a + 0.5) * (x1 - x0)) / n, y0 + ((b + 0.5) * (y1 - y0)) / n, s)) return false;
  }
  return true;
}

// An area is one bus object (brokers keep at most ~100 KB each): holes inside a newer hole go, and an area cut very
// many times has its holes simplified until it fits.
const FOG_BYTES = 40000;
function addHole(holes, cutter) {
  let out = [...holes.filter((h) => !polyInside(h, cutter)), cutter];
  for (let tol = 2; JSON.stringify(out).length > FOG_BYTES && tol <= 64; tol *= 2) out = out.map((h) => simplify(h, tol)).filter((h) => h.length >= 6);
  return out;
}

/** Cut a polygon (a new area or a clearing) out of the areas: [[id, area | null (gone)]] for the ones it changes. */
export function cutFog(shapes, cutter) {
  const out = [];
  for (const s of shapes) {
    if (!valid(s) || !polysOverlap(s.pts, cutter)) continue;
    if (polyInside(s.pts, cutter)) { out.push([s.id, null]); continue; }
    if ((s.holes || []).some((h) => polyInside(cutter, h))) continue; // already clear there
    const next = { ...s, holes: addHole(s.holes || [], cutter) };
    out.push([s.id, areaGone(next) ? null : next]);
  }
  return out;
}

/** Older, stacked shapes as one layer (newer shapes cut older ones; clearings only cut). Keeps ids, drops what is gone. */
export function flattenFog(shapes) {
  const list = sortShapes(shapes.filter(valid));
  const out = [];
  list.forEach((s, i) => {
    if (s.mode === 'reveal') return;
    const cur = { ...s, mode: undefined, holes: [...(s.holes || [])], on: s.on !== false, flat: true };
    for (const n of list.slice(i + 1)) {
      if (!polysOverlap(cur.pts, n.pts)) continue;
      if (polyInside(cur.pts, n.pts)) return;
      if (!cur.holes.some((h) => h === n.pts || JSON.stringify(h) === JSON.stringify(n.pts))) cur.holes.push(n.pts);
    }
    if (!areaGone(cur)) out.push(cur);
  });
  return out;
}

/** The areas as one layer, oldest first (flattened when they are an older save's stack). */
export const oneLayer = (shapes) => (shapes.every((s) => s?.flat) ? sortShapes(shapes.filter(valid)) : flattenFog(shapes));

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

// ---------- a character's sheet (Stone Wardens) -> what the table shows ----------

const titleCase = (id) => String(id).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The farthest of these senses in a sheet's senses list ("Darkvision 60 ft.", "Truesight 30 ft."), 0 if none. */
export function senseRange(list, kinds = ['darkvision', 'truesight']) {
  let best = 0;
  for (const s of list || []) {
    const m = /^\s*([a-z]+)\D*(\d+)/i.exec(String(s));
    if (m && kinds.includes(m[1].toLowerCase())) best = Math.max(best, Number(m[2]));
  }
  return best;
}

/**
 * What the table shows of a character, from its sheet document and (when Stone Wardens' rules engine could run) the
 * derived sheet: hit points {cur, max, temp}, condition names (+ "Exhaustion n"), senses, darkvision (Truesight
 * counts: it sees in the dark too), walking speed. at = the sheet's last edit (ms), so the newest copy wins.
 * Without a derived sheet the numbers are rough (approx): the document's current HP and a max from its hit-die rolls.
 */
export function sheetVitals(doc, sheet = null, { condNames = {}, defaults = {} } = {}) {
  if (!doc) return null;
  const at = Date.parse(doc.updated || doc.created || '') || 0;
  const conditions = (Array.isArray(doc.conditions) ? doc.conditions : []).map((id) => condNames[id] || titleCase(id));
  const exhaustion = Math.max(0, Math.min(6, Number(doc.exhaustion) || 0));
  if (exhaustion) conditions.push(`Exhaustion ${exhaustion}`);
  if (sheet && Number(sheet.hpMax) > 0) {
    const senses = Array.isArray(sheet.sensesList) ? sheet.sensesList.map(String) : [];
    return {
      at, approx: false, conditions, exhaustion, senses,
      hp: { cur: Number(sheet.hp?.current ?? sheet.hpMax), max: Number(sheet.hp?.max ?? sheet.hpMax), temp: Number(sheet.hp?.temp) || 0 },
      darkvision: Math.max(senseRange(senses), Number(sheet.darkvision) || 0),
      speed: Number.isFinite(Number(sheet.speed?.walk)) ? Number(sheet.speed.walk) : defaults.speed ?? 30,
    };
  }
  // rough: max HP = the hit-die results the sheet recorded + Constitution per level (or the sheet's override)
  const level = (doc.classes || []).reduce((n, c) => n + (Number(c.level) || 0), 0);
  const rolls = (doc.classes || []).flatMap((c) => (Array.isArray(c.hp) ? c.hp : [])).map(Number).filter(Number.isFinite);
  const con = abilityMod((Number(doc.baseAbilities?.con) || 10) + (Number(doc.background?.abilityBonuses?.con) || 0));
  const max = Number(doc.overrides?.hpMax) || (rolls.length ? Math.max(level, rolls.reduce((a, b) => a + b, 0) + con * level) : null);
  const cur = doc.hp?.current ?? max;
  const dv = Number(defaults.darkvision) || 0;
  return {
    at, approx: true, conditions, exhaustion, senses: dv ? [`Darkvision ${dv} ft.`] : [],
    hp: max ? { cur: Math.min(Number(cur) || 0, max), max, temp: Number(doc.hp?.temp) || 0 } : null,
    darkvision: dv,
    speed: Math.max(0, (Number(defaults.speed) || 30) - 5 * exhaustion),
  };
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
  const unlocked = live ? Object.entries(dmeta.unlocked?.[live] || {}).filter(([, v]) => v).map(([id]) => id).sort() : [];
  out.set('meta', {
    live: blackout ? null : live,
    blackout,
    unlocked, // characters whose players may move their token on the live scene (locked by default)
    banner: Object.keys(shownBanner).length ? shownBanner : null,
    measure: dmeta.measure || null,
  });

  const mediaRef = makeMediaRef(get);

  if (live && !blackout) {
    const s = get(K.scene(live));
    const { w, h } = sceneSize(s);
    const fogPre = `fog.${live}.`;
    const fogShapes = oneLayer(all.filter(([k, v]) => v && k.startsWith(fogPre)).map(([k, v]) => ({ ...v, id: k.slice(fogPre.length) })));
    const fogOn = s.fogOn !== false;
    out.set(K.scene(live), {
      id: live, name: s.name || 'Scene', cols: s.cols, rows: s.rows, w, h, color: s.color || null,
      map: s.map?.media ? mediaRef(s.map.media) : s.map?.url ? { url: s.map.url } : null,
      grid: { size: cellPx(s), ft: ftPerCell(s), show: s.grid?.show !== false && s.grid?.players !== false, color: s.grid?.color || null, opacity: s.grid?.opacity ?? 0.35 },
      light: { level: s.light?.level || 'bright', shared: !!s.light?.shared },
      fogOn, fogColor: s.fogColor === 'white' ? 'white' : 'black',
    });
    if (fogOn) {
      for (const sh of fogShapes) {
        if (sh.on === false) continue; // revealed: nothing to send
        out.set(K.fog(live, sh.id), { pts: sh.pts, holes: sh.holes || [], z: sh.z || 0, flat: true });
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
