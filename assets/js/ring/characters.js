// The party, read from Stone-Wardens (content/characters/*.json): name, owner (the sheet's player), portrait and
// accent color, plus speed and darkvision from the sheet's species (srd/species.json and stubs) for sensible
// defaults. Stats are not copied. Players' own token settings (image, ranges, vision) live on the table as pc.<id>.
import { repo } from '../core/repo.js';
import { config } from '../core/auth.js';
import { world } from './world.js';

const chars = new Map(); // id -> {id, name, owner, portrait: {p}|{url}|null, accent, speed, darkvision, size}
const listeners = new Set();
let species = null;
let loadedAt = 0;
let loaded = false;

export const party = {
  all: () => [...chars.values()].sort((a, b) => a.name.localeCompare(b.name)),
  get: (id) => chars.get(id) || null,
  loaded: () => loaded,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  refresh,
};

async function loadSpecies() {
  if (species) return species;
  species = new Map();
  for (const path of config.species || []) {
    try {
      const list = await repo.json(path);
      for (const s of Array.isArray(list) ? list : []) species.set(s.id, s);
    } catch (e) { console.warn('[party] species', path, e); }
  }
  for (const f of repo.list(config.customSpecies || 'content/library/species/')) {
    try { const s = await repo.json(f.path); if (s?.id) species.set(s.id, s); } catch { /* skip */ }
  }
  return species;
}

function speciesDefaults(doc) {
  const sp = species?.get(doc.species?.id) || null;
  const sub = sp?.subspecies?.find?.((x) => x.id === doc.species?.subspecies) || null;
  const speed = Number(doc.overrides?.speed) || Number(sub?.speed) || Number(sp?.speed) || 30;
  const darkvision = Number(sub?.darkvision ?? sp?.darkvision) || 0;
  const sizeName = String(doc.species?.size || sp?.size || 'Medium').toLowerCase();
  return { speed, darkvision, size: sizeName.includes('small') ? 'small' : 'medium' };
}

/** Re-read the characters (cheap when nothing changed: blobs are cached by sha). */
async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < 20000) return;
  loadedAt = Date.now();
  try {
    await repo.tree(force);
    await loadSpecies();
    const dir = config.characters || 'content/characters/';
    const files = repo.list(dir).filter((f) => f.path.endsWith('.json') && !f.path.slice(dir.length).includes('/'));
    const next = new Map();
    for (const f of files) {
      try {
        const doc = await repo.json(f.path);
        if (!doc?.id || !doc.name) continue;
        const portrait = !doc.portrait ? null : /^https?:/.test(doc.portrait) ? { url: doc.portrait } : { p: doc.portrait, s: repo.sha(doc.portrait) };
        next.set(doc.id, {
          id: doc.id, name: doc.name, owner: doc.player || doc.createdBy || '', portrait,
          accent: /^#[0-9a-f]{6}$/i.test(doc.style?.accent || '') ? doc.style.accent : null,
          level: (doc.classes || []).reduce((n, c) => n + (Number(c.level) || 0), 0),
          classes: (doc.classes || []).map((c) => c.id).filter(Boolean),
          ...speciesDefaults(doc),
        });
      } catch (e) { console.warn('[party] could not read', f.path, e); }
    }
    const changed = !loaded || JSON.stringify([...chars]) !== JSON.stringify([...next]);
    loaded = true;
    chars.clear();
    for (const [k, v] of next) chars.set(k, v);
    if (changed) {
      for (const fn of listeners) fn();
      world.invalidate();
    }
  } catch (e) {
    console.warn('[party] refresh failed', e);
  }
}

/** A PC's effective token settings: the sheet's defaults overlaid with the table's pc.<id> prefs. */
export function pcProfile(charId) {
  const c = chars.get(charId);
  const p = world.t(`pc.${charId}`) || {};
  if (!c && !p.name) return null;
  const speed = p.speed ?? c?.speed ?? 30;
  return {
    id: charId,
    name: c?.name || p.name || 'Adventurer',
    owner: c?.owner || p.owner || '',
    img: p.img || c?.portrait || null,
    accent: p.color || c?.accent || null,
    size: p.size || c?.size || 'medium',
    speed,
    darkvision: p.darkvision ?? c?.darkvision ?? 0,
    vision: { show: false, soft: 45, gray: 85, dim: 25, tint: null, tintStrength: 0, ...(p.vision || {}) },
    // The Move range follows the speed unless the player typed a number for it.
    ranges: (p.ranges || [{ id: 'move', label: 'Move', ft: null, on: true }]).map((r) => ({ ...r, ft: r.ft ?? (r.id === 'move' ? speed : 0) })),
    showRanges: p.showRanges ?? 'selected', // 'selected' | 'always' | 'never'
    light: p.light || null,
    conditions: p.conditions || [],
    hp: p.hp || null, // optional, typed by the player or the DM (the sheet's stats are not copied)
    hpShow: p.hpShow || 'bar', // what the other players see of it: 'numbers' | 'bar' | 'private'
    missing: !c, // the sheet was deleted in Stone-Wardens
  };
}

export function startPartyWatch() {
  refresh(true);
  setInterval(() => refresh(true), 120000);
  addEventListener('focus', () => refresh());
}
