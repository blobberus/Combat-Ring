// The token menu: a card next to the selected token (or pin / note) with what this device may change about it.
// DM: names, HP, initiative, disposition, what players see of its stats, conditions, size, light, hidden.
// Players: their own PC's ranges and initiative; other things show what the DM lets them see.
import { h, clear, add, mount } from '../core/dom.js';
import { icon, openModal, toast, segmented, field, select, checkbox, confirmDialog } from '../core/ui.js';
import { world, me } from './world.js';
import { ui, parseKey, clearSelection, select as selectKeys } from './state.js';
import { CONDITIONS, SIZE_NAMES, sizeCells, K, keyTail, healthState, rollFormula, abilityMod, fmtMod } from './model.js';
import * as A from './actions.js';
import { getBoard } from './app.js';
import { previewing } from './view.js';
import { statBlock, fetchMonster } from './bestiary.js';
import { pcProfile } from './characters.js';
import { sheetUrl } from './sheets.js';
import { openPcEditor } from './editors/pc-editor.js';
import { cachedUrl, mediaUrl } from './media.js';
import { colorFor } from './tools.js';

let host = null;
let currentKey = null; // a view key, or MULTI: the DM has several tokens selected
let lastView = null;
const MULTI = '*';
const multiOk = () => ui.selected.size > 1 && world.dm && !previewing();

export const LIGHTS = [
  { value: '', label: 'No light' },
  { value: 'candle', label: 'Candle (5 / 5 ft)', bright: 5, dim: 5 },
  { value: 'torch', label: 'Torch (20 / 20 ft)', bright: 20, dim: 20 },
  { value: 'lantern', label: 'Lantern (30 / 30 ft)', bright: 30, dim: 30 },
  { value: 'light', label: 'Light cantrip (20 / 20 ft)', bright: 20, dim: 20 },
  { value: 'daylight', label: 'Daylight spell (60 / 60 ft)', bright: 60, dim: 60 },
];
export const lightValue = (l) => (!l ? '' : LIGHTS.find((x) => x.bright === l.bright && x.dim === l.dim)?.value || 'custom');
export function lightSelect(cur, onchange) {
  const opts = LIGHTS.map((l) => ({ value: l.value, label: l.label }));
  if (lightValue(cur) === 'custom') opts.push({ value: 'custom', label: `Custom (${cur.bright} / ${cur.dim} ft)` });
  return select(opts, lightValue(cur), (v) => { const l = LIGHTS.find((x) => x.value === v); onchange(l && l.value ? { bright: l.bright, dim: l.dim } : null); });
}

function ensureHost() {
  if (!host || !host.isConnected) {
    const stage = document.querySelector('.rg-stage');
    host = h('div', { class: 'rg-menu rg-float', hidden: true, role: 'dialog', 'aria-label': 'Token' });
    host.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.addEventListener('focusout', () => setTimeout(() => { if (host && !host.contains(document.activeElement)) draw(); }, 0));
    stage?.append(host);
  }
  return host;
}

export function openMenu(key) {
  currentKey = multiOk() ? MULTI : key;
  if (!currentKey) { closeMenu(); return; }
  ensureHost();
  draw(); // no focus: the keyboard stays on the board (Delete, arrows, H)
}

export function closeMenu() {
  currentKey = null;
  if (host) { host.hidden = true; clear(host); }
}

/**
 * After a redraw of the board (view, changes) or a pan / zoom (no arguments). The card is rebuilt only when something
 * it shows changed; it follows its token when that moves or the board pans.
 */
export function refreshMenu(view, changes) {
  if (view) lastView = view;
  if (!currentKey || !host) return;
  if (currentKey === MULTI ? !multiOk() : !ui.selected.has(currentKey)) { closeMenu(); return; }
  if (!view) { place(); return; }
  if (changes && !shows(changes)) { if (moves(changes)) place(); return; }
  const a = document.activeElement;
  if (host.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['checkbox', 'radio', 'range'].includes(a.type)) { place(); return; } // typing: keep the field
  draw();
}

const subjects = () => (currentKey === MULTI ? [...ui.selected] : [currentKey]).map(parseKey);

/** [room, key or prefix] pairs the open card reads. */
function readsFrom() {
  const out = [['table', 'meta'], ['dm', 'dmeta']];
  for (const { room, key } of subjects()) {
    out.push([room, key]);
    if (key.startsWith('pct.')) {
      const charId = key.split('.').slice(2).join('.');
      out.push(['table', K.pc(charId)], ['table', K.sheet(charId)], ['table', K.ini(`pc-${charId}`)]);
    } else if (room === 'dm' && world.d(key)?.kind === 'note') out.push(['dm', 'fog.'], ['dm', 'item.']);
  }
  if (currentKey === MULTI) out.push(['table', 'ini.']);
  return out;
}

/** Did something the card shows change? (A move only changes where it sits.) */
function shows(c) {
  if (c.table?.has('#') || c.dm?.has('#')) return true;
  const reads = readsFrom();
  for (const room of ['table', 'dm']) {
    for (const k of c[room] || []) {
      if (c.moved?.has(`${room}:${k}`)) continue;
      if (reads.some(([r, p]) => r === room && (k === p || (p.endsWith('.') && k.startsWith(p))))) return true;
    }
  }
  return false;
}

const moves = (c) => subjects().some(({ room, key }) => c[room]?.has(key));

const findToken = (key) => lastView?.tokens?.find((t) => t.key === key) || lastView?.marks?.find((m) => m.key === key) || null;
const token = () => findToken(currentKey);

function place() {
  const ts = (currentKey === MULTI ? [...ui.selected] : [currentKey]).map(findToken).filter(Boolean);
  const board = getBoard();
  if (!ts.length || !board || !host || host.hidden) return;
  const stage = host.parentElement.getBoundingClientRect();
  const c = lastView.scene?.grid?.size || 100;
  const half = (t) => ((t.w ? sizeCells(t.w) : 0.3) * c) / 2;
  const ys = ts.map((t) => t.y);
  const y0 = (Math.min(...ys) + Math.max(...ys)) / 2; // beside the selection: right of it, else left
  const right = board.toScreen(Math.max(...ts.map((t) => t.x + half(t))), y0);
  const left = board.toScreen(Math.min(...ts.map((t) => t.x - half(t))), y0);
  const w = host.offsetWidth || 300;
  const hh = host.offsetHeight || 200;
  let x = right.x - stage.left + 14;
  if (x + w > stage.width - 12) x = left.x - stage.left - w - 14;
  x = Math.max(12, Math.min(x, stage.width - w - 12));
  // stop above the DM bar when it is underneath, so Show / Hide / Player view stay clickable (phones dock the menu)
  const phone = matchMedia('(max-width: 760px)').matches;
  let bottom = stage.height - 12;
  const bar = document.querySelector('.rg-dmbar:not([hidden])')?.getBoundingClientRect();
  if (bar && !phone && x < bar.right - stage.left && x + w > bar.left - stage.left) bottom = bar.top - stage.top - 8;
  host.style.maxHeight = phone ? '' : `${Math.max(160, bottom - 64)}px`;
  const y = Math.max(64, Math.min(right.y - stage.top - 40, bottom - Math.min(hh, bottom - 64)));
  host.style.left = `${x}px`;
  host.style.top = `${y}px`;
}

function draw() {
  if (!currentKey) return;
  ensureHost();
  const { room, key } = parseKey(currentKey);
  const dm = world.dm && !previewing();
  let body = null;
  if (currentKey === MULTI) body = multiMenu();
  else if (key.startsWith('pin.')) body = pinMenu(key);
  else if (room === 'dm' && !dm) body = null; // the player view shows only what players get
  else if (room === 'dm') {
    const it = world.d(key);
    if (!it) { closeMenu(); return; }
    body = it.kind === 'creature' ? creatureMenu(key, it) : it.kind === 'prop' ? propMenu(key, it) : noteMenu(key, it);
  } else if (key.startsWith('pct.')) body = pcMenu(key, dm);
  else if (key.startsWith('it.')) body = publicMenu(key);
  if (!body) { closeMenu(); return; }
  // quick actions sit right under the name, where they are reached without scrolling
  const parts = [].concat(body).filter(Boolean);
  const ai = parts.findIndex((x) => x?.classList?.contains('rg-menu-actions'));
  if (ai > 1) { const [a] = parts.splice(ai, 1); a.classList.add('is-top'); parts.splice(1, 0, a); }
  mount(host, ...parts);
  host.hidden = false;
  place();
}

// ---------- helpers ----------

function head(art, name, sub, { prop = false, editName = null } = {}) {
  const img = h('img', { class: ['rg-menu-art', prop && 'is-prop'], alt: '' });
  if (art) {
    const u = cachedUrl(art);
    if (u) img.src = u; else mediaUrl(art).then((x) => { if (x) img.src = x; }).catch(() => {});
  } else img.hidden = true;
  const title = editName
    ? h('input', { class: 'input rg-menu-name-input', value: name || '', 'aria-label': 'Name', onchange: (e) => editName(e.target.value.trim()) })
    : h('div', { class: 'rg-menu-name' }, name || '—');
  return h('div', { class: 'rg-menu-head' }, img, h('div', { class: 'rg-menu-title' }, title, sub ? h('div', { class: 'rg-menu-sub' }, sub) : null),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => { clearSelection(); closeMenu(); } }, icon('close')));
}

const act = (ic, label, onclick, { danger = false, active = false, title } = {}) => h('button', { class: ['btn btn-sm', danger && 'btn-danger', active && 'is-active'], type: 'button', title: title || label, onclick }, icon(ic), label);
const iconAct = (ic, label, onclick, { active = false } = {}) => h('button', { class: ['btn btn-icon btn-sm', active && 'is-active'], type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(!!active), onclick }, icon(ic));

function condChips(list, onToggle) {
  const set = new Set(list || []);
  return h('div', { class: 'rg-conds' }, CONDITIONS.map((c) => h('button', { class: ['chip', set.has(c) && 'is-active'], type: 'button', onclick: () => onToggle(c) }, c)));
}

// Folded sections remember being open across re-renders of the menu.
const openFolds = new Set();
function fold(label, content, id) {
  const d = h('details', { class: 'rg-fold', open: openFolds.has(id) }, h('summary', null, label), content);
  d.addEventListener('toggle', () => { if (d.open) openFolds.add(id); else openFolds.delete(id); });
  return d;
}

function toggleIn(list, v) { const s = new Set(list || []); if (s.has(v)) s.delete(v); else s.add(v); return [...s]; }

// field() is a <label>: a click on its caption would press the first button inside, so rows of buttons use this
const fieldDiv = (label, control, hint) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);

const numIn = (v, onchange, label, props = {}) => h('input', { class: 'input input-number', type: 'number', value: v ?? '', 'aria-label': label, ...props, onchange: (e) => onchange(e.target.value === '' ? null : Number(e.target.value)) });

/**
 * HP, max and temp fields with a quick Damage / Heal box (Enter / Shift+Enter). get() -> the current hp (read at
 * each edit: the menu doesn't redraw while one of its fields has focus); save(hp, label).
 */
export function hpBlock(get, save, { formula = '', onRoll = null } = {}) {
  const now = () => ({ cur: null, max: null, temp: 0, ...(get() || {}) });
  const hp = now();
  const put = (next, label) => save({ ...next, cur: next.cur ?? next.max ?? null }, label); // a first max fills the current HP
  const dmg = h('input', { class: 'input input-number', type: 'number', inputmode: 'numeric', placeholder: '0', 'aria-label': 'Damage or healing' });
  const apply = (sign) => {
    const n = Math.abs(Number(dmg.value) || 0);
    if (!n) return;
    const cur0 = now();
    let cur = cur0.cur ?? cur0.max ?? 0, temp = cur0.temp || 0;
    if (sign < 0) { const fromTemp = Math.min(temp, n); temp -= fromTemp; cur = Math.max(0, cur - (n - fromTemp)); } else cur = Math.min(cur0.max ?? cur + n, cur + n);
    put({ ...cur0, cur, temp }, sign < 0 ? 'damage' : 'heal');
    dmg.value = '';
  };
  dmg.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(e.shiftKey ? 1 : -1); });
  return [
    h('div', { class: 'rg-hp' },
      field('HP', numIn(hp.cur, (v) => put({ ...now(), cur: v ?? 0 }, 'HP'), 'Current HP')),
      h('span', { class: 'rg-hp-sep' }, '/'),
      field('Max', numIn(hp.max, (v) => { const x = now(); put({ ...x, max: v, cur: v == null ? null : x.cur }, 'max HP'); }, 'Max HP', { min: 0 })),
      field('Temp', numIn(hp.temp || 0, (v) => put({ ...now(), temp: v ?? 0 }, 'temp HP'), 'Temporary HP', { min: 0 }))),
    h('div', { class: 'rg-menu-row' },
      h('div', { class: 'rg-hp-quick' }, dmg,
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', title: 'Damage (Enter)', onclick: () => apply(-1) }, 'Damage'),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Heal (Shift+Enter)', onclick: () => apply(1) }, 'Heal')),
      formula && onRoll ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: `Roll ${formula}`, onclick: onRoll }, icon('d20'), 'Roll HP') : null),
  ];
}

const SIZE_OPTIONS = [
  ['tiny', 'Tiny · ½ square'], ['small', 'Small · 1 square'], ['medium', 'Medium · 1 square'],
  ['large', 'Large · 2 × 2'], ['huge', 'Huge · 3 × 3'], ['gargantuan', 'Gargantuan · 4 × 4'],
];

/**
 * Token size: a 5e size or any number of squares across (Custom). value: a size name or a number of squares;
 * onchange gets the name, or the number for Custom.
 */
export function sizeControl(value, onchange) {
  const named = SIZE_NAMES.includes(value) ? value : null;
  const cells = sizeCells(value);
  const num = h('input', {
    class: 'input input-number', type: 'number', min: 0.25, max: 12, step: 0.25, value: cells, 'aria-label': 'Squares across',
    onchange: (e) => { const n = Math.round(Math.min(12, Math.max(0.25, Number(e.target.value) || 1)) * 100) / 100; e.target.blur(); onchange(n); },
  });
  return h('div', { class: 'row row-nowrap rg-size' },
    select([...SIZE_OPTIONS.map(([v, label]) => ({ value: v, label })), { value: 'custom', label: 'Custom…' }], named || 'custom', (v) => onchange(v === 'custom' ? cells : v), { 'aria-label': 'Size' }),
    named ? null : [num, h('span', { class: 'muted text-sm' }, 'squares')]);
}

// ---------- DM: creature ----------

function creatureMenu(key, it) {
  const id = keyTail(key);
  const p = (fields, label) => A.patchItem(id, fields, label);
  const st = it.stats || {};
  const sub = [st.type, st.cr != null && st.cr !== '' ? `CR ${st.cr}` : null, st.ac != null ? `AC ${st.ac}` : null, st.ref?.src].filter(Boolean).join(' · ');
  const art = it.media || it.img || it.tokens?.[0] || null;
  const dexMod = A.creatureInitMod(it);
  const inIni = it.init != null && it.init !== '';
  // the size menu shows the chosen 5e size (Small and Medium are both 1 square), or Custom with the squares across
  const w = it.w || 1;
  const size = it.size === 'custom' ? w : it.size && sizeCells(it.size) === w ? it.size : SIZE_NAMES.find((s) => s !== 'small' && sizeCells(s) === w) || w;
  return [
    head(art, it.name, sub, { editName: (v) => v && p({ name: v }, 'rename') }),
    ...hpBlock(() => world.d(K.item(id))?.hp, (hp, label) => p({ hp }, label), { formula: it.hpFormula, onRoll: () => { const r = Math.max(1, rollFormula(it.hpFormula)); p({ hp: { cur: r, max: r, temp: 0 } }, 'roll HP'); } }),
    fieldDiv('Initiative', inIni
      ? h('div', { class: 'row row-nowrap' }, numIn(it.init, (v) => p({ init: v }, 'initiative'), 'Initiative'),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Roll again: d20 ${fmtMod(dexMod)}`, 'aria-label': 'Roll initiative again', onclick: () => A.addToInitiative([id], { force: true, say: true }) }, icon('d20')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Take it out of initiative', 'aria-label': 'Take it out of initiative', onclick: () => A.removeFromInitiative([id]) }, icon('close')))
      : h('div', { class: 'row row-nowrap' },
        h('button', { class: 'btn btn-sm', type: 'button', title: `Roll d20 ${fmtMod(dexMod)} and add it to the order`, onclick: () => A.addToInitiative([id], { say: true }) }, icon('d20'), 'Add to initiative'),
        numIn(null, (v) => v != null && p({ init: v }, 'initiative'), 'Initiative', { placeholder: '—', title: 'Or type its number' })),
    inIni && it.scene !== A.initiativeSceneId() ? 'It joins the order once this scene is live.' : null),
    field('Size', sizeControl(size, (v) => { const n = Math.max(sizeCells(v), 0.25); p({ w: n, h: n, size: typeof v === 'string' ? v : 'custom' }, 'size'); })),
    field('Side', segmented([{ value: 'enemy', label: 'Enemy' }, { value: 'ally', label: 'Companion' }, { value: 'neutral', label: 'Neutral' }], it.disp || 'enemy', (v) => p({ disp: v }, 'side'))),
    field('Players see its stats', segmented([{ value: 'none', label: 'No' }, { value: 'hp', label: 'Health' }, { value: 'full', label: 'Full' }], it.statsVisible || 'none', (v) => p({ statsVisible: v }, 'stats visibility')),
      it.statsVisible === 'full' ? 'Players can open its stat block.' : it.statsVisible === 'hp' ? 'Players see a health bar (Unhurt, Hurt, Bloodied, Down).' : 'Players see only its name.'),
    fold(`Conditions${it.conditions?.length ? ` (${it.conditions.length})` : ''}`, condChips(it.conditions, (c) => p({ conditions: toggleIn(it.conditions, c) }, 'condition')), 'conditions'),
    fold(it.alias ? `More · players see “${it.alias}”` : 'More', h('div', { class: 'stack stack-sm' },
      field('Players see it as', h('input', { class: 'input', value: it.alias || '', placeholder: it.name, onchange: (e) => p({ alias: e.target.value.trim() || null }, 'alias') }), 'Hover name for the players (e.g. “Hooded figure”).'),
      field('Light it carries', lightSelect(it.light, (l) => p({ light: l }, 'light')))), 'more'),
    h('div', { class: 'rg-menu-actions' },
      act(it.hidden ? 'eye' : 'eye-off', it.hidden ? 'Show to players' : 'Hide', () => p({ hidden: !it.hidden }, it.hidden ? 'show' : 'hide'), { active: it.hidden }),
      iconAct('book-open', 'Stat block', () => openDetails(currentKey)),
      iconAct('copy', 'Duplicate (Ctrl+D)', () => { const k = A.duplicateKeys([currentKey]); if (k[0]) selectKeys(k[0]); }),
      iconAct('chevron-up', 'Bring to front', () => A.restack([currentKey], true)),
      iconAct('chevron-down', 'Send to back', () => A.restack([currentKey], false)),
      iconAct(it.locked ? 'lock' : 'unlock', it.locked ? 'Unlock position' : 'Lock position', () => p({ locked: !it.locked }, 'lock'), { active: it.locked }),
      h('span', { class: 'spacer' }),
      iconAct('trash', 'Delete', () => A.deleteKeys([currentKey]))),
  ];
}

// ---------- DM: several tokens (Shift+drag a box, Shift+click) ----------

let groupRoll = false; // "One roll for the group", remembered while the page is open

function multiMenu() {
  const keys = [...ui.selected];
  const items = keys.map(parseKey).filter((x) => x.room === 'dm' && x.key.startsWith('item.')).map(({ key }) => ({ id: keyTail(key), it: world.d(key) })).filter((x) => x.it);
  const kind = (k) => items.filter((x) => x.it.kind === k);
  const creatures = kind('creature');
  const out = creatures.filter((x) => x.it.init == null || x.it.init === '');
  const n = (count, one, many) => (count ? `${count} ${count === 1 ? one : many}` : null);
  const sub = [n(creatures.length, 'creature', 'creatures'), n(keys.filter((k) => k.startsWith('t:pct.')).length, 'character', 'characters'),
    n(kind('prop').length, 'prop', 'props'), n(kind('note').length, 'interaction', 'interactions'), n(keys.filter((k) => k.startsWith('t:pin.')).length, 'pin', 'pins')].filter(Boolean).join(' · ');
  const anyShown = items.some((x) => !x.it.hidden);
  let ini = null;
  if (out.length) {
    ini = fieldDiv('Initiative', h('div', { class: 'stack stack-sm' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', title: groupRoll ? 'One d20 for them all: they act together' : 'Each rolls d20 + its Dex', onclick: () => A.addToInitiative(out.map((x) => x.id), { group: groupRoll, say: true }) },
        icon('d20'), out.length === 1 ? `Add ${out[0].it.name} to initiative` : `Add ${out.length} creatures to initiative`),
      out.length > 1 ? checkbox(groupRoll, (v) => { groupRoll = v; draw(); }, 'One roll for the group') : null),
    out.length < creatures.length ? `${creatures.length - out.length} of them already in the order.` : null);
  } else if (creatures.length) {
    ini = fieldDiv('Initiative', h('div', { class: 'row row-nowrap' }, h('span', { class: 'muted text-sm' }, creatures.length === 1 ? 'In the order' : 'All in the order'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => A.removeFromInitiative(creatures.map((x) => x.id)) }, 'Take them out')));
  }
  return [
    head(null, `${keys.length} selected`, sub),
    ini,
    h('div', { class: 'rg-menu-actions' },
      items.length ? act(anyShown ? 'eye-off' : 'eye', anyShown ? 'Hide' : 'Show to players', () => A.setItemsHidden(items.map((x) => x.id), anyShown), { active: !anyShown }) : null,
      h('span', { class: 'spacer' }),
      iconAct('trash', `Delete ${keys.length}`, () => A.deleteKeys(keys))),
  ];
}

// ---------- DM: prop ----------

function propMenu(key, it) {
  const id = keyTail(key);
  const p = (fields, label) => A.patchItem(id, fields, label);
  const num = (v, onchange, label, step = 1) => h('input', { class: 'input input-number', type: 'number', min: 0.5, step, value: v ?? '', 'aria-label': label, onchange: (e) => onchange(Number(e.target.value) || 1) });
  return [
    head(it.media || it.img || null, it.name, 'Prop', { prop: true, editName: (v) => v && p({ name: v }, 'rename') }),
    h('div', { class: 'rg-menu-row' },
      field('Width (squares)', num(it.w || 1, (v) => p({ w: v }, 'size'), 'Width', 0.5)),
      field('Height (squares)', num(it.h || 1, (v) => p({ h: v }, 'size'), 'Height', 0.5))),
    h('div', { class: 'rg-menu-row' },
      field('Turn', h('div', { class: 'row row-nowrap' },
        iconAct('undo', 'Turn left 90°', () => p({ rot: ((it.rot || 0) - 90 + 360) % 360 }, 'turn')),
        h('input', { class: 'input input-number', type: 'number', value: it.rot || 0, step: 15, 'aria-label': 'Angle', onchange: (e) => p({ rot: ((Number(e.target.value) || 0) % 360 + 360) % 360 }, 'turn') }),
        h('button', { class: 'btn btn-icon btn-sm rg-flip', type: 'button', title: 'Turn right 90°', 'aria-label': 'Turn right', onclick: () => p({ rot: ((it.rot || 0) + 90) % 360 }, 'turn') }, icon('undo'))))),
    checkbox(!!it.movable, (v) => p({ movable: v }, 'movable'), 'Players can move it'),
    field('Light', lightSelect(it.light, (l) => p({ light: l }, 'light'))),
    h('div', { class: 'rg-menu-actions' },
      act(it.hidden ? 'eye' : 'eye-off', it.hidden ? 'Show to players' : 'Hide', () => p({ hidden: !it.hidden }, it.hidden ? 'show' : 'hide'), { active: it.hidden }),
      iconAct('copy', 'Duplicate (Ctrl+D)', () => { const k = A.duplicateKeys([currentKey]); if (k[0]) selectKeys(k[0]); }),
      iconAct('chevron-up', 'Bring to front', () => A.restack([currentKey], true)),
      iconAct('chevron-down', 'Send to back', () => A.restack([currentKey], false)),
      iconAct(it.locked ? 'lock' : 'unlock', it.locked ? 'Unlock position' : 'Lock position', () => p({ locked: !it.locked }, 'lock'), { active: it.locked }),
      h('span', { class: 'spacer' }),
      iconAct('trash', 'Delete', () => A.deleteKeys([currentKey]))),
  ];
}

// ---------- DM: interaction note ----------

function noteMenu(key, it) {
  const id = keyTail(key);
  const p = (fields, label) => A.patchItem(id, fields, label);
  const fogs = world.dList(`fog.${it.scene}.`).filter(([, f]) => f).map(([k, f], i) => ({ id: k.slice(`fog.${it.scene}.`.length), f, i }));
  const linked = new Set(it.reveals || []);
  const spawns = new Set(it.spawns || []);
  const hiddenItems = world.dList('item.').filter(([k, x]) => x.scene === it.scene && x.kind !== 'note' && (x.hidden || spawns.has(keyTail(k))));
  const fogList = h('div', { class: 'rg-link-list' }, fogs.length ? fogs.map(({ id: fid, f, i }) => h('label', {
    class: 'checkbox', onpointerenter: () => { ui.fogSel = fid; world.invalidate('view'); }, onpointerleave: () => { ui.fogSel = null; world.invalidate('view'); },
  }, h('input', { type: 'checkbox', checked: linked.has(fid), onchange: (e) => p({ reveals: e.target.checked ? [...linked, fid] : [...linked].filter((x) => x !== fid) }, 'link fog') }),
  h('span', null, `Fog area ${i + 1}${f.on === false ? ' (revealed)' : ''}`))) : h('p', { class: 'muted text-xs' }, 'No fog on this scene yet.'));
  const itemList = h('div', { class: 'rg-link-list' }, hiddenItems.length ? hiddenItems.map(([k, x]) => {
    const iid = keyTail(k);
    return h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: spawns.has(iid), onchange: (e) => p({ spawns: e.target.checked ? [...spawns, iid] : [...spawns].filter((s) => s !== iid) }, 'link item') }), h('span', null, x.name || 'Item'));
  }) : h('p', { class: 'muted text-xs' }, 'Hidden creatures and props on this scene appear here.'));
  return [
    head(null, it.title || 'Interaction', it.triggered ? 'Triggered' : 'DM only until triggered', { editName: (v) => p({ title: v || 'Interaction' }, 'rename') }),
    field('Notes (DM only)', h('textarea', { class: 'textarea', rows: 3, value: it.notes || '', placeholder: 'DC 13 Perception spots the tripwire…', onchange: (e) => p({ notes: e.target.value }, 'notes') })),
    field('Shown to players when triggered', h('textarea', { class: 'textarea', rows: 2, value: it.playerText || '', placeholder: 'Optional: a notice on the map', onchange: (e) => p({ playerText: e.target.value }, 'player text') })),
    field('Lift this fog', fogList),
    field('Reveal these', itemList),
    h('div', { class: 'rg-menu-actions' },
      it.triggered
        ? act('undo', 'Reset', () => A.triggerNote(id, false))
        : h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => A.triggerNote(id, true) }, icon('sparkle'), 'Trigger'),
      it.playerText ? act(it.revealed ? 'eye-off' : 'eye', it.revealed ? 'Hide notice' : 'Show notice', () => p({ revealed: !it.revealed }, 'notice')) : null,
      h('span', { class: 'spacer' }),
      iconAct('trash', 'Delete', () => A.deleteKeys([currentKey]))),
  ];
}

// ---------- PCs ----------

/**
 * A character's hit points and conditions as its Stone Wardens sheet has them (read-only here: they change on the
 * sheet, and the table follows within seconds), with a link to the sheet.
 */
export function sheetBlock(pr) {
  const hp = pr.hp;
  const hs = healthState(hp);
  const note = !pr.sheet ? 'Reading the Stone Wardens sheet…' : pr.sheet.approx ? 'From the Stone Wardens sheet (rough numbers: its rules didn’t load)' : 'From the Stone Wardens sheet';
  return h('div', { class: 'rg-sheet' },
    h('div', { class: 'rg-sheet-hp' },
      h('span', { class: 'rg-sheet-label' }, 'HP'),
      hp ? h('span', { class: 'rg-sheet-num' }, `${hp.cur} / ${hp.max}`) : h('span', { class: 'muted' }, '—'),
      hp?.temp ? h('span', { class: 'rg-sheet-temp' }, `+${hp.temp} temp`) : null,
      hs ? h('span', { class: ['rg-sheet-bar', `is-${hs.word.toLowerCase()}`], role: 'img', 'aria-label': hs.word }, h('span', { style: { width: `${hs.pct}%` } })) : null),
    pr.conditions.length ? h('div', { class: 'rg-conds' }, pr.conditions.map((c) => h('span', { class: 'chip is-active' }, c))) : null,
    h('div', { class: 'rg-sheet-foot' }, h('span', null, note),
      h('a', { class: 'btn btn-ghost btn-sm', href: sheetUrl(pr.id), target: '_blank', rel: 'noopener', title: 'Hit points and conditions change on the sheet' }, icon('book-open'), 'Open the sheet')));
}

function pcMenu(key, dm) {
  const parts = key.split('.');
  const charId = parts.slice(2).join('.');
  const pr = pcProfile(charId);
  if (!pr) return null;
  const mine = me.owns(charId);
  const canEdit = mine || dm;
  const prefs = world.t(K.pc(charId)) || {};
  const setPrefs = (fields) => world.tPut(K.pc(charId), { ...(world.t(K.pc(charId)) || {}), ...fields }); // fresh: see hpBlock
  const ini = world.t(K.ini(`pc-${charId}`));
  const scene = parts[1];
  const unlocked = A.pcUnlocked(charId, scene);
  const handles = A.canHandlePc(charId, scene); // place, move, resize, take off: the DM, or its player once unlocked
  const who = pr.owner || 'its player';
  const out = [head(pr.img, pr.name, [pr.owner && `Played by ${pr.owner}`, `Speed ${pr.speed} ft`, pr.darkvision ? `Darkvision ${pr.darkvision} ft` : null].filter(Boolean).join(' · '))];
  if (dm) {
    out.push(h('div', { class: 'rg-menu-lock' },
      h('span', { class: ['rg-lock-state', unlocked && 'is-open'] }, icon(unlocked ? 'unlock' : 'lock'), unlocked ? `${who} can move it` : 'Locked: only you move it'),
      h('button', { class: 'btn btn-sm', type: 'button', title: unlocked ? 'Only you will be able to move it' : `Let ${who} move it on this scene`, onclick: () => A.setPcLocked(charId, unlocked, scene) }, icon(unlocked ? 'lock' : 'unlock'), unlocked ? 'Lock' : `Unlock for ${who}`)));
  } else if (mine && !unlocked) {
    out.push(h('p', { class: 'rg-menu-meta' }, icon('lock'), ' Locked by the DM. Drag your token to measure a move or a shot; it stays put.'));
  }
  if (canEdit) {
    out.push(sheetBlock(pr));
    out.push(h('div', { class: 'rg-menu-row' },
      field('Initiative', h('input', { class: 'input input-number', type: 'number', value: ini?.value ?? '', placeholder: '—', onchange: (e) => A.setPcInit(charId, e.target.value === '' ? null : Number(e.target.value)) })),
      handles ? field('Size', sizeControl(pr.size, (v) => setPrefs({ size: v }))) : null));
    out.push(field('Ranges', h('div', { class: 'rg-conds' }, pr.ranges.map((r, i) => h('button', {
      class: ['chip', r.on && 'is-active'], type: 'button',
      onclick: () => { const base = prefs.ranges || [{ id: 'move', label: 'Move', ft: null, on: true }]; setPrefs({ ranges: base.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) }); },
    }, `${r.label} ${r.ft} ft`)))));
    out.push(field('Show ranges', segmented([{ value: 'selected', label: 'Selected' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], pr.showRanges, (v) => setPrefs({ showRanges: v }))));
  } else {
    const hs = token()?.health; // what this player may see of another PC's health (its player chooses)
    if (hs) out.push(h('p', { class: 'rg-menu-meta' }, hs.text ? `HP ${hs.text}` : `Health: ${hs.word}`));
    if (pr.conditions?.length) out.push(h('p', { class: 'rg-menu-meta' }, pr.conditions.join(', ')));
  }
  out.push(h('div', { class: 'rg-menu-actions' },
    canEdit ? act('edit', 'Customize…', () => openPcEditor(charId)) : null,
    h('span', { class: 'spacer' }),
    handles ? iconAct('trash', 'Take off the map', () => A.deleteKeys([currentKey])) : null));
  return out;
}

// ---------- players: public items ----------

function publicMenu(key) {
  const it = world.t(key);
  if (!it) return null;
  if (it.kind === 'notice') return [head(null, it.name, 'Notice'), it.text ? h('p', { class: 'rg-menu-text' }, it.text) : null];
  const side = it.kind === 'creature' ? (it.disp === 'ally' ? 'Companion' : it.disp === 'neutral' ? 'Neutral' : 'Enemy') : 'Object';
  const out = [head(it.imgs?.[0] || it.img || null, it.name || (it.kind === 'creature' ? 'Creature' : 'Object'), side, { prop: it.kind === 'prop' })];
  const hs = token()?.health || it.health;
  if (hs) out.push(h('p', { class: 'rg-menu-meta' }, hs.text ? `HP ${hs.text}` : `Health: ${hs.word}`));
  if (it.conditions?.length) out.push(h('p', { class: 'rg-menu-meta' }, it.conditions.join(', ')));
  if (it.stats) out.push(h('div', { class: 'rg-menu-actions' }, act('book-open', 'Stat block', () => openDetails(currentKey))));
  if (it.kind === 'prop' && it.movable) out.push(h('p', { class: 'rg-menu-meta' }, 'You can drag this.'));
  return out;
}

// ---------- pins ----------

const PIN_COLORS = ['#22507c', '#8e1b1b', '#23675f', '#3b6b2a', '#82600f', '#6e3a5c', '#465266', '#1f1a14'];

function pinMenu(key) {
  const pin = world.t(key);
  if (!pin) return null;
  const can = A.canEditPin(pin);
  const when = pin.at ? new Date(pin.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const out = [head(null, pin.text || 'Pin', `${pin.by || 'Someone'}${when ? ` · ${when}` : ''}${pin.resolved ? ' · resolved' : ''}`)];
  if (can) {
    out.push(field('Note', h('textarea', { class: 'textarea', rows: 2, value: pin.text || '', placeholder: 'What is here?', onchange: (e) => A.editPin(key, { text: e.target.value.trim() }) })));
    out.push(h('div', { class: 'rg-swatches' }, PIN_COLORS.map((c) => h('button', { class: ['rg-swatch', pin.color === c && 'is-active'], type: 'button', style: { background: c }, title: 'Pin color', 'aria-label': 'Pin color', onclick: () => A.editPin(key, { color: c }) }))));
  } else if (pin.text) out.push(h('p', { class: 'rg-menu-text' }, pin.text));
  out.push(h('div', { class: 'rg-menu-actions' },
    world.dm ? act(pin.resolved ? 'undo' : 'check', pin.resolved ? 'Reopen' : 'Resolve', () => A.resolvePin(key, !pin.resolved)) : null,
    h('span', { class: 'spacer' }),
    can ? iconAct('trash', 'Delete pin', () => A.deleteKeys([currentKey])) : null));
  return out;
}

export function openPinEditor(vk, { isNew = false } = {}) {
  openMenu(vk);
  if (isNew) setTimeout(() => host?.querySelector('textarea')?.focus(), 30);
}

// ---------- details (double-click / Stat block) ----------

export async function openDetails(vk) {
  const { room, key } = parseKey(vk);
  if (key.startsWith('pct.')) { const charId = key.split('.').slice(2).join('.'); if (world.dm || me.owns(charId)) openPcEditor(charId); return; }
  if (key.startsWith('pin.')) { openMenu(vk); return; }
  if (room === 'dm' && previewing()) return;
  let it = room === 'dm' ? world.d(key) : world.t(key);
  if (!it) return;
  if (it.kind !== 'creature') { openMenu(vk); return; }
  const stats = room === 'dm' ? it.stats : it.stats;
  if (!stats) { toast('The DM hasn’t shared its stats.'); return; }
  const body = h('div', { class: 'cr-stat-wrap' }, h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Reading the bestiary…'));
  const name = room === 'dm' ? it.name : it.name;
  openModal({ title: name || 'Creature', body, wide: false, className: 'modal-stat' });
  try {
    let src;
    if (stats.ref) {
      src = await fetchMonster(stats.ref);
      if (room !== 'dm') src = { ...src, name };
    } else src = { ...stats, name, hp: room === 'dm' ? it.hp : stats.hp };
    mount(body, statBlock(src, { title: name }));
    if (room === 'dm' && stats.ref) add(body, h('p', { class: 'muted text-xs' }, `${stats.ref.name}, from the 5etools bestiary (${stats.ref.src}). This creature: ${it.hp?.cur ?? '—'} / ${it.hp?.max ?? '—'} HP.`));
  } catch (e) {
    mount(body, h('p', { class: 'danger-text' }, `Could not load the stat block: ${e.message}`), statBlock({ ...stats, name }));
  }
}

export { colorFor, confirmDialog, healthState };
