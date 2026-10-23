// Config, the site password and the DM password.
//
// Site: the password opens Stone-Wardens' vault.json (the same file, so both sites always share one password) and
// gives the GitHub token. The unlocked auth is kept under Stone-Wardens' own storage key (config.authKey, sw:auth):
// both sites live on blobberus.github.io, so unlocking (or locking) one does the same for the other.
// DM: the DM password opens a DM vault (content/combat-ring/dm/vault.json in the data repo once the DM changes the
// password, else dm-vault.json shipped with this site) that wraps the random DM data key.
import { openSiteVault, openDmVault, createDmVault, rewrapDmVault } from './crypto.js';
import { b64encode, b64decode } from './util.js';

const DEFAULTS = {
  dataRoot: 'content/combat-ring/',
  characters: 'content/characters/',
  locations: 'content/locations/',
  species: [],
  customSpecies: 'content/library/species/',
  vaults: ['vault.json'],
  authKey: 'cr:auth',
  dmVault: 'dm-vault.json',
  brokers: [],
  bestiary: { index: 'data/bestiary.json', data: '', tokens: [] },
  stoneWardens: '../Stone-Wardens/',
};

export let config = { ...DEFAULTS };

export async function loadConfig() {
  try {
    const res = await fetch(`config.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) config = { ...DEFAULTS, ...(await res.json()) };
  } catch (e) { console.warn('[auth] no config.json', e); }
  return config;
}

export const dataPath = (rest) => `${config.dataRoot}${rest}`;

// ---------- site ----------

/** The first site vault that loads: {vault, url} or null. */
export async function fetchSiteVault() {
  for (const url of config.vaults) {
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const vault = await res.json();
      if (vault?.data && vault?.kdf) return { vault, url };
    } catch { /* next */ }
  }
  return null;
}

/** -> {token, owner, repo, branch} or throws Error('bad-password'). */
export async function unlockSite(vault, password) {
  const secret = await openSiteVault(vault, password);
  return { branch: 'main', ...(vault.repo || {}), ...secret };
}

export function saveAuth(auth, remember) {
  const s = JSON.stringify(auth);
  sessionStorage.setItem(config.authKey, s);
  if (remember) localStorage.setItem(config.authKey, s);
}

export function loadAuth() {
  const s = sessionStorage.getItem(config.authKey) || localStorage.getItem(config.authKey);
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

export function clearAuth() {
  sessionStorage.removeItem(config.authKey);
  localStorage.removeItem(config.authKey);
}

// ---------- DM ----------

const DM_KEY = 'cr:dm';
export const DM_VAULT_PATH = () => dataPath('dm/vault.json');

/** The DM vault in force: the data repo's (after a password change) or the one shipped with the site. */
export async function fetchDmVault(repo) {
  try {
    const v = await repo.json(DM_VAULT_PATH());
    if (v?.data) return v;
  } catch (e) { console.warn('[auth] DM vault in repo unreadable', e); }
  try {
    const res = await fetch(`${config.dmVault}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* none */ }
  return null;
}

/** DM password -> raw data key (Uint8Array 32), or throws Error('bad-password'). */
export const openDm = (vault, password) => openDmVault(vault, password);

/** First-time DM setup (no vault anywhere): a new data key under this password. -> {vault, raw} */
export const newDmVault = (password) => createDmVault(password);
export const rewrapDm = (raw, password) => rewrapDmVault(raw, password);

export function saveDmKey(raw, remember) {
  const s = b64encode(raw);
  sessionStorage.setItem(DM_KEY, s);
  if (remember) localStorage.setItem(DM_KEY, s); else localStorage.removeItem(DM_KEY);
}

export function loadDmKey() {
  const s = sessionStorage.getItem(DM_KEY) || localStorage.getItem(DM_KEY);
  try { return s ? b64decode(s) : null; } catch { return null; }
}

export const dmRemembered = () => !!localStorage.getItem(DM_KEY);

export function clearDmKey() {
  sessionStorage.removeItem(DM_KEY);
  localStorage.removeItem(DM_KEY);
}
