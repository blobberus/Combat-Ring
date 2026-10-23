// The shared world: the bus's two rooms ('table' for everyone, 'dm' for the DM), change batching for rendering, the
// DM's undo history, and who this device is (player name, characters, DM or not).
import { Bus } from '../core/bus.js';
import { getSetting } from '../core/settings.js';

const listeners = new Set();
// What changed since the last frame. moved: 'room:key' of objects whose only change was their position (panels and
// menus that don't show positions skip those); structural: a room was joined or a relay came back (re-project);
// view: only how this screen looks changed (hover, selection), no data.
const fresh = () => ({ table: new Set(), dm: new Set(), remote: false, moved: new Set(), structural: false, view: false });
let pending = fresh();
let frame = 0;

/** Did an object change only its position (x, y)? */
function posOnly(prev, next) {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return false;
  if (prev.x === next.x && prev.y === next.y) return false;
  const { x: _a, y: _b, ...p } = prev;
  const { x: _c, y: _d, ...n } = next;
  const keys = Object.keys(n);
  if (keys.length !== Object.keys(p).length) return false;
  for (const k of keys) if (p[k] !== n[k] && JSON.stringify(p[k]) !== JSON.stringify(n[k])) return false;
  return true;
}

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 80;

export const world = {
  bus: null,
  dm: false, // the DM room is joined (DM unlocked)
  version: { table: 0, dm: 0 }, // bumped by every change in a room (for caches of things computed from a whole room)

  init({ brokers, local }) {
    this.bus = new Bus({ brokers, local, name: getSetting('playerName') || 'A Warden' });
    this.bus.on((ev) => {
      if (ev.type === 'obj') {
        const set = pending[ev.room];
        if (!set) return;
        this.version[ev.room]++;
        const id = `${ev.room}:${ev.key}`;
        if (!set.has(ev.key) ? posOnly(ev.prev, ev.value) : pending.moved.has(id) && posOnly(ev.prev, ev.value)) pending.moved.add(id);
        else pending.moved.delete(id);
        set.add(ev.key);
        if (!ev.local) pending.remote = true;
        schedule();
      } else if (ev.type === 'room' || ev.type === 'status') {
        pending.table.add('#'); // something structural: redraw everything
        pending.structural = true;
        schedule();
      }
    });
    return this.bus.start();
  },

  setName(name) { if (this.bus) this.bus.name = name || 'A Warden'; },

  // ---------- reading ----------
  t(key) { return this.bus.get('table', key) ?? null; },
  d(key) { return this.dm ? this.bus.get('dm', key) ?? null : null; },
  tList(prefix) { return this.bus.entries('table', prefix); },
  dList(prefix) { return this.dm ? this.bus.entries('dm', prefix) : []; },
  tVals(prefix) { return this.tList(prefix).map(([, v]) => v); },
  dVals(prefix) { return this.dList(prefix).map(([, v]) => v); },

  // ---------- writing ----------
  /** Write to a room. opts.undo: record the previous value (DM edits). */
  put(room, key, value, { undo = false, label = '' } = {}) {
    if (room === 'dm' && !this.dm) return;
    if (undo) record([[room, key, this.bus.get(room, key) ?? null]], label);
    this.bus.put(room, key, value);
  },
  tPut(key, value, opts) { this.put('table', key, value, opts); },
  dPut(key, value, opts) { this.put('dm', key, value, opts); },
  /** Shallow-merge fields into an object (creating it). */
  patch(room, key, fields, opts) {
    const cur = this.bus.get(room, key) || {};
    this.put(room, key, { ...cur, ...fields }, opts);
  },
  del(room, key, opts) { if (this.bus.get(room, key) != null) this.put(room, key, null, opts); },

  /** Record a group of [room, key, before] as one undo step (for edits made with undo:false, e.g. drags). */
  record(entries, label = '') { record(entries, label); },

  undo() { return step(undoStack, redoStack); },
  redo() { return step(redoStack, undoStack); },
  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,

  send(room, channel, data) { this.bus.send(room, channel, data); },

  /**
   * fn({table: Set<key>, dm: Set<key>, remote, moved, structural, view}) once per animation frame with what changed
   * ('#' = everything).
   */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Redraw: everything (data outside the rooms changed, e.g. a sheet), or with 'view' only the board and menus. */
  invalidate(kind = 'all') { if (kind === 'view') pending.view = true; else pending.table.add('#'); schedule(); },
};

let grouping = null;
function record(entries, label) {
  if (grouping) { grouping.entries.push(...entries.filter(([r, k]) => !grouping.entries.some(([r2, k2]) => r2 === r && k2 === k))); return; }
  undoStack.push({ entries, label });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

/** Run fn with every undo-recorded write inside it grouped into one step. */
export function undoGroup(label, fn) {
  if (grouping) return fn();
  grouping = { entries: [], label };
  try { return fn(); } finally {
    const g = grouping;
    grouping = null;
    if (g.entries.length) record(g.entries, g.label);
  }
}

function step(from, to) {
  const s = from.pop();
  if (!s) return null;
  const back = s.entries.map(([room, key]) => [room, key, world.bus.get(room, key) ?? null]);
  for (const [room, key, value] of s.entries) {
    if (room === 'dm' && !world.dm) continue;
    world.bus.put(room, key, value);
  }
  to.push({ entries: back, label: s.label });
  return s.label || 'change';
}

// Once per frame; a timer backs the frame up because background tabs get no frames (the DM's tab must keep
// publishing to the players while the DM reads notes elsewhere).
let fallback = 0;
function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(flush);
  fallback = setTimeout(flush, 120);
}

function flush() {
  if (!frame) return;
  cancelAnimationFrame(frame);
  clearTimeout(fallback);
  frame = 0;
  const p = pending;
  pending = fresh();
  for (const fn of listeners) {
    try { fn(p); } catch (e) { console.error('[world] listener failed', e); }
  }
}

// ---------- who am I ----------

export const me = {
  name: () => getSetting('playerName') || '',
  chars: () => getSetting('chars') || [],
  owns: (charId) => (getSetting('chars') || []).includes(charId),
  isDm: () => world.dm,
};
