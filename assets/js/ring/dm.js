// The DM session: the DM password opens the DM vault -> data key. With it this device joins the DM room (scenes,
// creatures, hidden things), seals the DM's media and backups, and runs the projector that publishes what players
// may see. The data key stays in this tab (sessionStorage) or, if asked, on this device (localStorage).
import { importDataKey, roomKeys } from '../core/crypto.js';
import { repo } from '../core/repo.js';
import { fetchDmVault, openDm, newDmVault, rewrapDm, saveDmKey, loadDmKey, clearDmKey, dmRemembered, DM_VAULT_PATH } from '../core/auth.js';
import { world } from './world.js';

const listeners = new Set();
export const dmSession = { raw: null, dataKey: null, active: false };
let hooks = { start: async () => {}, stop: async () => {} };

/** main wires the projector/persistence start and stop (avoids import cycles). */
export function setDmHooks(h) { hooks = { ...hooks, ...h }; }

export function onDm(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => { for (const fn of listeners) { try { fn(dmSession.active); } catch (e) { console.error(e); } } };

export async function dmVaultExists() { return !!(await fetchDmVault(repo)); }

/** DM password -> DM mode, or throws Error('bad-password' | 'no-vault'). */
export async function unlockDm(password, remember = false) {
  const vault = await fetchDmVault(repo);
  if (!vault) throw new Error('no-vault');
  const raw = await openDm(vault, password);
  await enterDm(raw, remember);
}

/** First DM on a fresh install: create the vault (committed to the data repo) and enter. */
export async function setupDm(password, remember = false) {
  const { vault, raw } = await newDmVault(password);
  repo.stage({ path: DM_VAULT_PATH(), text: `${JSON.stringify(vault, null, 2)}\n` });
  await repo.flush('Combat Ring: set up DM mode');
  await enterDm(raw, remember);
}

export async function enterDm(raw, remember) {
  dmSession.raw = raw;
  dmSession.dataKey = await importDataKey(raw);
  const keys = await roomKeys(raw, 'dm');
  saveDmKey(raw, remember);
  world.dm = true;
  const ready = world.bus.addRoom('dm', keys);
  dmSession.active = true;
  notify();
  await ready;
  await hooks.start();
  world.invalidate();
}

export async function restoreDm() {
  const raw = loadDmKey();
  if (!raw) return false;
  try { await enterDm(raw, dmRemembered()); return true; } catch (e) {
    console.warn('[dm] could not restore DM mode', e);
    clearDmKey();
    return false;
  }
}

export async function lockDm() {
  await hooks.stop();
  world.bus.removeRoom('dm');
  world.dm = false;
  dmSession.raw = null;
  dmSession.dataKey = null;
  dmSession.active = false;
  clearDmKey();
  notify();
  world.invalidate();
}

/** Re-wrap the same data key under a new password (committed to content/combat-ring/dm/vault.json). */
export async function changeDmPassword(password) {
  if (!dmSession.raw) throw new Error('DM mode is locked');
  const vault = await rewrapDm(dmSession.raw, password);
  repo.stage({ path: DM_VAULT_PATH(), text: `${JSON.stringify(vault, null, 2)}\n` });
  await repo.flush('Combat Ring: change the DM password');
}
