// Each character's hit points, conditions, senses and speed come from its Stone Wardens sheet; the table never edits
// them (the token menu links to the sheet). The newest copy wins, by the sheet's own `updated` stamp:
//  - the sheet files in the repository: characters.js reads them and checks the folder for commits (the DM's browser
//    every few seconds, players' less often);
//  - Stone Wardens open in another tab of this browser (same origin): its local drafts are read the moment it writes
//    them, before it commits;
//  - the table: the first browser to see a newer sheet (a draft or a commit) publishes the numbers as sheet.<charId>,
//    so every screen follows within a moment.
// The numbers come from Stone Wardens' own rules engine, loaded from its site, so they match the sheet (Exhaustion and
// conditions included); if it can't be loaded, model.sheetVitals makes rough ones from the document.
import { config } from '../core/auth.js';
import { repo } from '../core/repo.js';
import { world, me } from './world.js';
import { K, sheetVitals } from './model.js';

const SRD = {
  classes: 'classes', features: 'features', subclasses: 'subclasses', species: 'species', backgrounds: 'backgrounds',
  feats: 'feats', spells: 'spells', weapons: 'weapons', armor: 'armor', gear: 'gear', magicItems: 'magic-items', rules: 'rules',
};
const STUBS = ['subclasses', 'species', 'backgrounds', 'feats'];
const CUSTOM = ['weapon', 'armor', 'gear', 'magic-item', 'spell', 'feat', 'ability', 'species', 'class', 'subclass', 'background'];

const docs = new Map(); // charId -> {doc, defaults}: the committed sheet (characters.js)
const fromRepo = new Map(); // charId -> vitals of the committed sheet
const fromDraft = new Map(); // charId -> vitals of Stone Wardens' unsaved draft in this browser
let engine = null; // {derive, rules, condNames}; false when it couldn't be loaded
let engineP = null;

export const swSite = () => new URL(config.stoneWardens || '../Stone-Wardens/', location.href);
export const sheetUrl = (charId) => new URL(`#/characters/${encodeURIComponent(charId)}`, swSite()).href;

function loadEngine() {
  engineP ||= (async () => {
    const base = swSite();
    const E = await import(new URL('assets/js/views/characters/engine.js', base).href);
    if (typeof E.derive !== 'function' || typeof E.buildRules !== 'function') throw new Error('unexpected engine');
    const get = (name) => fetch(new URL(`srd/${name}.json`, base)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const files = { stubs: {}, custom: {} };
    await Promise.all([
      ...Object.entries(SRD).map(async ([k, n]) => { files[k] = await get(n); }),
      ...STUBS.map(async (k) => { files.stubs[k] = await get(`stubs/${k}`); }),
      ...CUSTOM.map(async (kind) => { // the campaign's own library entries (custom species, feats, items…)
        const list = [];
        for (const f of repo.list(`content/library/${kind}/`)) {
          const d = f.path.endsWith('.json') ? await repo.json(f.path).catch(() => null) : null;
          if (d?.id) list.push({ ...d, kind, origin: 'custom' });
        }
        files.custom[kind] = list;
      }),
    ]);
    if (!files.classes) throw new Error('no SRD data');
    const condNames = Object.fromEntries((files.rules?.conditions || []).map((c) => [c.id, c.name]));
    return { derive: E.derive, rules: E.buildRules(files), condNames };
  })().then((e) => { engine = e; }, (e) => { console.warn('[sheets] Stone Wardens’ rules engine is unavailable; rough numbers', e); engine = false; })
    .then(() => {
      for (const [id, d] of docs) { const v = compute(d.doc, d.defaults); fromRepo.set(id, v); share(id, v); }
      readDrafts();
      world.invalidate();
    });
  return engineP;
}

function compute(doc, defaults = {}) {
  let sheet = null;
  if (engine) { try { sheet = engine.derive(doc, engine.rules); } catch (e) { console.warn('[sheets] derive', doc.id, e); } }
  return sheetVitals(doc, sheet, { condNames: engine?.condNames || {}, defaults });
}

/** characters.js: a committed sheet was read (defaults: speed and darkvision from its species, for rough numbers). */
export function setSheetDoc(charId, doc, defaults) {
  const had = docs.get(charId)?.doc;
  if (had && (Date.parse(doc.updated) || 0) < (Date.parse(had.updated) || 0)) return; // a stale listing: keep the newer sheet
  docs.set(charId, { doc, defaults });
  if (engine === null) { loadEngine(); return; } // computed once the engine is in: no flash of rough numbers
  const v = compute(doc, defaults);
  share(charId, v);
  if (JSON.stringify(v) !== JSON.stringify(fromRepo.get(charId))) { fromRepo.set(charId, v); world.invalidate(); }
}

/** Put this browser's copy on the table when it is newer than the table's (the first to see a change tells everyone). */
function share(charId, v) {
  if (v.at > (busCopy(charId)?.at || 0)) world.tPut(K.sheet(charId), { ...v, by: me.name() || '' });
}

// ---------- Stone Wardens' drafts in this browser ----------

const draftKey = () => `sw:drafts:${repo.mode === 'sandbox' ? 'sandbox' : `${repo.backend?.owner}/${repo.backend?.repo}`}`;

function readDrafts() {
  if (engine === null) { loadEngine(); return; }
  const dir = config.characters || 'content/characters/';
  let all = {};
  try { all = JSON.parse(localStorage.getItem(draftKey()) || '{}') || {}; } catch { all = {}; }
  const seen = new Set();
  let changed = false;
  for (const [path, d] of Object.entries(all)) {
    if (!path.startsWith(dir) || !path.endsWith('.json') || path.slice(dir.length).includes('/') || typeof d?.text !== 'string') continue;
    let doc;
    try { doc = JSON.parse(d.text); } catch { continue; }
    if (!doc?.id) continue;
    if (!doc.updated && d.ts) doc.updated = new Date(d.ts).toISOString();
    seen.add(doc.id);
    const v = compute(doc, docs.get(doc.id)?.defaults);
    if (JSON.stringify(v) !== JSON.stringify(fromDraft.get(doc.id))) { fromDraft.set(doc.id, v); changed = true; }
  }
  for (const id of [...fromDraft.keys()]) if (!seen.has(id)) { fromDraft.delete(id); changed = true; }
  if (!changed) return;
  for (const [id, v] of fromDraft) if (v.at > (fromRepo.get(id)?.at || 0)) share(id, v);
  world.invalidate();
}

// ---------- reading ----------

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const strs = (a) => (Array.isArray(a) ? a.slice(0, 24).map((x) => String(x).slice(0, 60)) : []);

/** The table's copy, checked (it comes from another browser). */
function busCopy(charId) {
  const v = world.t(K.sheet(charId));
  if (!v || typeof v !== 'object' || !Number.isFinite(v.at)) return null;
  return {
    at: v.at, approx: !!v.approx, conditions: strs(v.conditions), senses: strs(v.senses), exhaustion: num(v.exhaustion),
    hp: v.hp && num(v.hp.max) > 0 ? { cur: num(v.hp.cur), max: num(v.hp.max), temp: num(v.hp.temp) } : null,
    darkvision: num(v.darkvision), speed: Number.isFinite(Number(v.speed)) ? Number(v.speed) : null,
  };
}

/**
 * What the table shows of a character's sheet: {at, approx, hp: {cur, max, temp}|null, conditions, exhaustion, senses,
 * darkvision, speed}, the newest of the three copies; null until a sheet was read.
 */
export function sheetOf(charId) {
  const all = [fromRepo.get(charId), fromDraft.get(charId), busCopy(charId)].filter(Boolean);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.at > a.at || (b.at === a.at && a.approx && !b.approx) ? b : a));
}

export function startSheetSync() {
  addEventListener('storage', (e) => { if (e.key === draftKey() || e.key === null) readDrafts(); });
  addEventListener('focus', () => readDrafts());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) readDrafts(); });
  readDrafts();
}
