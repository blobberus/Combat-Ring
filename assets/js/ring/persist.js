// Backups of the live table in the data repo. The brokers hold the table while people play; these files bring it
// back if a broker forgets (restart, eviction) and keep it between campaigns' sessions.
//   content/combat-ring/dm/state.bin   both rooms, sealed with the DM data key (written by the DM's client)
//   content/combat-ring/table.json     the table room in the clear (what players may see anyway)
// The DM's client saves at most every SAVE_GAP while things change, and on "Save now". Every write costs GitHub API
// calls on the one shared token, so this stays slow on purpose; live play never waits for it.
import { repo } from '../core/repo.js';
import { dataPath } from '../core/auth.js';
import { sealBytes, openBytes } from '../core/crypto.js';
import { utf8 } from '../core/util.js';
import { world } from './world.js';
import { dmSession } from './dm.js';

const SAVE_GAP = 180 * 1000;
const TOMBSTONE_DAYS = 14;
const STATE = () => dataPath('dm/state.bin');
const TABLE = () => dataPath('table.json');

let unsub = null;
let dirty = false;
let timer = 0;
let lastSave = 0;
let saving = null;
const listeners = new Set();
export const saveState = { dirty: false, saving: false, lastSave: 0, error: null };
export function onSaveState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => { Object.assign(saveState, { dirty, saving: !!saving, lastSave }); for (const fn of listeners) fn(saveState); };

export function startPersistence() {
  stopPersistence();
  unsub = world.on((p) => {
    const real = [...p.dm, ...p.table].some((k) => k !== '#');
    if (!real) return;
    dirty = true;
    notify();
    if (!timer) timer = setTimeout(() => { timer = 0; saveNow().catch(() => {}); }, Math.max(4000, lastSave + SAVE_GAP - Date.now()));
  });
  addEventListener('pagehide', onHide);
}

export function stopPersistence() {
  unsub?.();
  unsub = null;
  clearTimeout(timer);
  timer = 0;
  removeEventListener('pagehide', onHide);
}

function onHide() { if (dirty) saveNow().catch(() => {}); }

/** DM: write both backups now (one commit). */
export function saveNow() {
  if (saving) return saving;
  if (!dmSession.dataKey) return Promise.resolve(false);
  clearTimeout(timer);
  timer = 0;
  saving = (async () => {
    notify();
    const bus = world.bus;
    bus.purge('dm', TOMBSTONE_DAYS * 864e5);
    bus.purge('table', TOMBSTONE_DAYS * 864e5);
    const state = { v: 1, savedAt: new Date().toISOString(), dm: bus.dump('dm'), table: bus.dump('table') };
    const sealed = await sealBytes(dmSession.dataKey, utf8.encode(JSON.stringify(state)));
    dirty = false;
    repo.stage({ path: STATE(), bytes: sealed });
    repo.stage({ path: TABLE(), text: `${JSON.stringify({ v: 1, savedAt: state.savedAt, objects: state.table })}\n` });
    try {
      await repo.flush('Combat Ring: save the table');
      lastSave = Date.now();
      saveState.error = null;
      return true;
    } catch (e) {
      dirty = true;
      saveState.error = e.message || String(e);
      throw e;
    }
  })().finally(() => { saving = null; notify(); });
  return saving;
}

/** DM: merge the sealed backup into both rooms (newer versions win, the brokers catch up). */
export async function restoreDmBackup() {
  try {
    await repo.tree(true);
    const bytes = await repo.bytes(STATE());
    if (!bytes || !dmSession.dataKey) return 0;
    const state = JSON.parse(utf8.decode(await openBytes(dmSession.dataKey, bytes)));
    return world.bus.merge('dm', state.dm) + world.bus.merge('table', state.table);
  } catch (e) {
    console.warn('[persist] DM backup unreadable', e);
    return 0;
  }
}

/** Anyone: when the brokers have no table at all, bring back the last public backup. */
export async function restoreTableIfEmpty() {
  if (world.t('meta')) return 0;
  try {
    const doc = await repo.json(TABLE());
    if (!doc?.objects || world.t('meta')) return 0;
    return world.bus.merge('table', doc.objects);
  } catch (e) {
    console.warn('[persist] table backup unreadable', e);
    return 0;
  }
}
