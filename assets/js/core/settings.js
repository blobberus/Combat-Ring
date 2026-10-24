// Per-device preferences (not synced). Values that differ from DEFAULTS live in localStorage `cr:settings`.
// The player name and theme start from Stone-Wardens' settings on the same site (sw:settings), so a player who set
// them there doesn't have to again.

const KEY = 'cr:settings';
const DEFAULTS = {
  playerName: '',
  chars: [], // ids of the Stone-Wardens characters this device plays (tokens it may move, initiative it may enter)
  theme: null, // null = follow Stone-Wardens (light by default)
  names: 'hover', // token names: 'hover' | 'always' | 'never'
  hpBars: 'bar', // health bars on tokens: 'bar' | 'numbers' (bar with HP where this device may see it) | 'off'
  hpPos: 'below', // 'below' | 'above' the token
  hpSize: 'normal', // bar thickness: 'thin' | 'normal' | 'thick'
  hpColor: '', // '' = by health (green, amber when bloodied), else one color
  snap: true, // snap moved tokens to the grid (hold Alt to place freely)
  diagonals: 'five', // 'five' (2024: every square 5 ft) | 'alternate' (5-10-5) | 'euclid'
  panelOpen: true,
  panelTab: 'party',
  iniMini: false, // during combat, a small "whose turn, who's next" card instead of the Initiative panel
  reduceMotion: false,
  placeHidden: true, // DM: creatures placed on a scene start hidden from players
  dmPreview: false, // DM: show the board as the players see it
  fogPanelMin: false, // DM: the fog controls folded to their title
  scenesWide: false, // DM: the Scenes panel opened out into the whole map library
  libNode: 'root', // DM: what the library shows: 'pinned' | 'recent' | 'all' | 'root' (My maps) | 'f:<folder>' | 'm:<map>' | 'p:<place>'
  libOpen: { root: true, 'm:main': true }, // DM: folders and atlas maps unfolded in the library's tree
  libSort: 'manual', // DM: scenes in a folder: 'manual' (dragged order) | 'name'
};

let cache = null;
const listeners = new Set();

// Stone-Wardens' settings, read once (the player name is asked for on every redraw) and again when that site changes them
let sw = null;
function swSettings() {
  if (!sw) { try { sw = JSON.parse(localStorage.getItem('sw:settings') || '{}') || {}; } catch { sw = {}; } }
  return sw;
}
addEventListener('storage', (e) => { if (e.key === 'sw:settings' || e.key === null) sw = null; });

function read() {
  if (!cache) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
    cache = { ...DEFAULTS, ...saved };
  }
  return cache;
}

function write() {
  const out = {};
  for (const [k, v] of Object.entries(cache)) if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) out[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage full or blocked: keep the in-memory value */ }
}

export function getSetting(k) {
  const v = read()[k];
  if (k === 'playerName' && !v) return swSettings().playerName || '';
  return v;
}

export function setSetting(k, v) {
  read()[k] = v;
  write();
  listeners.forEach((fn) => fn(k, v));
}

export function onSetting(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function currentTheme() {
  return getSetting('theme') || (swSettings().theme === 'dark' ? 'dark' : 'light');
}

export function applyTheme(theme = currentTheme()) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
