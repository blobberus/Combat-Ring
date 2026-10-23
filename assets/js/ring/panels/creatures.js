// Creatures (DM): the whole 5etools bestiary (search, CR / type / size / book filters, token art, stat blocks),
// the DM's custom creatures, and the creatures on the scene being viewed. Click Place (or drag a row) to summon.
import { h, clear, add, mount } from '../../core/dom.js';
import { icon, toast, confirmDialog, select as selectEl, checkbox } from '../../core/ui.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { world } from '../world.js';
import { K, keyTail, crValue, SIZE_NAMES, healthState } from '../model.js';
import { select } from '../state.js';
import { loadIndex, search, tokenUrls, sourceName, sourceList, TYPES, fetchMonster, statBlock, hasToken, isSrd } from '../bestiary.js';
import { openCreatureEditor } from '../editors/creature-editor.js';
import { dmViewingId } from '../view.js';
import { mediaUrl } from '../media.js';
import { draggable, startPlacing, hasChanges } from './index.js';
import * as A from '../actions.js';

const CRS = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const state = { tab: 'bestiary', q: '', crMin: '', crMax: '', type: '', size: '', src: '', srd: false, open: null };

function tokenImg(m) {
  const urls = tokenUrls(m);
  const img = h('img', { class: 'cr-tok', alt: '', loading: 'lazy', decoding: 'async' });
  let i = 0;
  img.onerror = () => { i++; if (i < urls.length) img.src = urls[i]; else img.replaceWith(h('span', { class: 'cr-tok cr-tok-none' }, m.name.slice(0, 1))); };
  if (urls.length) img.src = urls[0]; else return h('span', { class: 'cr-tok cr-tok-none' }, m.name.slice(0, 1));
  return img;
}

export default {
  id: 'creatures',
  title: 'Creatures',
  icon: 'sword',
  dm: true,
  // the bestiary list only changes when the DM searches; the other tabs follow their objects
  relevant: (c) => (state.tab === 'here' ? hasChanges(c, ['item.'], 'dm') : state.tab === 'custom' ? hasChanges(c, ['cre.', 'media.'], 'dm') : false),
  mount(el) {
    el.dataset.ready = '';
  },
  render(el, { board }) {
    clear(el);
    const tabs = h('div', { class: 'seg cr-tabs' }, ...[['bestiary', 'Bestiary'], ['custom', 'Custom'], ['here', 'On this scene']].map(([id, label]) =>
      h('button', { class: ['seg-btn', state.tab === id && 'is-active'], type: 'button', onclick: () => { state.tab = id; this.render(el, { board }); } }, label)));
    add(el, tabs);
    add(el, h('div', { class: 'row cr-panel-actions' },
      checkbox(getSetting('placeHidden'), (v) => setSetting('placeHidden', v), 'Place hidden'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openCreatureEditor(null, { onSaved: () => { state.tab = 'custom'; } }) }, icon('plus'), 'New creature')));
    if (state.tab === 'bestiary') bestiaryTab(el, board);
    else if (state.tab === 'custom') customTab(el);
    else hereTab(el, board);
  },
};

function bestiaryTab(el, board) {
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search 4,500 creatures…', value: state.q, 'aria-label': 'Search creatures' });
  const results = h('ul', { class: 'cr-list cr-results', role: 'list' });
  const count = h('p', { class: 'muted text-xs' });
  const filters = h('div', { class: 'cr-filters' },
    selectEl([{ value: '', label: 'CR from' }, ...CRS.map((c) => ({ value: c, label: c }))], state.crMin, (v) => { state.crMin = v; draw(); }, { 'aria-label': 'Lowest CR' }),
    selectEl([{ value: '', label: 'CR to' }, ...CRS.map((c) => ({ value: c, label: c }))], state.crMax, (v) => { state.crMax = v; draw(); }, { 'aria-label': 'Highest CR' }),
    selectEl([{ value: '', label: 'Any type' }, ...TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))], state.type, (v) => { state.type = v; draw(); }, { 'aria-label': 'Type' }),
    selectEl([{ value: '', label: 'Any size' }, ...SIZE_NAMES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))], state.size, (v) => { state.size = v; draw(); }, { 'aria-label': 'Size' }));
  const srcWrap = h('div', { class: 'cr-filters' });
  add(el, h('div', { class: 'search' }, icon('search'), q), filters, srcWrap, count, results);
  let t = 0;
  q.addEventListener('input', () => { state.q = q.value; clearTimeout(t); t = setTimeout(draw, 90); });
  add(results, h('li', { class: 'muted' }, h('span', { class: 'spinner' }), ' Opening the bestiary…'));
  loadIndex().then(() => {
    mount(srcWrap, 
      selectEl([{ value: '', label: 'Every book' }, ...sourceList().map((s) => ({ value: s.code, label: s.name }))], state.src, (v) => { state.src = v; draw(); }, { 'aria-label': 'Book' }),
      checkbox(state.srd, (v) => { state.srd = v; draw(); }, 'Free rules only'));
    draw();
  }).catch((e) => { mount(results, h('li', { class: 'danger-text' }, `The bestiary did not load: ${e.message}`)); });

  function draw() {
    const list = search(state.q, {
      crMin: state.crMin ? crValue(state.crMin) : null, crMax: state.crMax ? crValue(state.crMax) : null,
      type: state.type || null, size: state.size || null, src: state.src || null, srd: state.srd,
    }, 120);
    count.textContent = list.length >= 120 ? 'Showing the first 120. Narrow it down with the search or filters.' : `${list.length} creature${list.length === 1 ? '' : 's'}`;
    clear(results);
    for (const m of list) add(results, row(m));
  }

  function row(m) {
    const open = state.open === m.id;
    const detail = h('div', { class: 'cr-detail', hidden: !open });
    const li = h('li', { class: ['cr-row cr-beast', open && 'is-open'] },
      h('div', { class: 'cr-row-line', onclick: (e) => { if (e.target.closest('button')) return; state.open = open ? null : m.id; draw(); } },
        tokenImg(m),
        h('div', { class: 'cr-row-main' },
          h('div', { class: 'cr-row-title' }, m.name),
          h('div', { class: 'cr-row-sub' }, `CR ${m.cr || '—'} · ${m.type || '—'} · ${sourceName(m.src)}${isSrd(m) ? ' · free rules' : ''}`)),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Click the map to place it (Shift-click to place more)', onclick: () => startPlacing({ kind: 'creature', src: m, name: m.name }) }, 'Place')),
      detail);
    draggable(li, { kind: 'creature', src: m });
    if (open) {
      add(detail, h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Reading the stat block…'));
      fetchMonster(m).then((full) => {
        mount(detail, statBlock(full), h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => startPlacing({ kind: 'creature', src: m, name: m.name }) }, 'Place on the map'),
          h('span', { class: 'muted text-xs' }, `${sourceName(m.src)}${m.page ? `, p. ${m.page}` : ''}`)));
      }).catch((e) => { mount(detail, h('p', { class: 'danger-text' }, `Could not read the stat block (${e.message}). The numbers: AC ${m.ac ?? '—'}, HP ${m.hp ?? '—'}, speed ${m.speed || '—'}.`)); });
    }
    void hasToken;
    return li;
  }
}

function customTab(el) {
  const list = world.dList('cre.').sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
  if (!list.length) {
    add(el, h('div', { class: 'empty-state' }, icon('sword'), h('p', null, 'Make your own creatures: a stat block, art and a side. Start from scratch or from any bestiary creature.')));
    return;
  }
  const ul = h('ul', { class: 'cr-list', role: 'list' });
  for (const [k, c] of list) {
    const id = keyTail(k);
    const art = h('span', { class: 'cr-tok cr-tok-none' }, (c.name || '?').slice(0, 1));
    const src = c.media || c.img || c.tokens?.[0];
    if (src) mediaUrl(src).then((u) => { if (u) art.replaceWith(h('img', { class: 'cr-tok', src: u, alt: '' })); }).catch(() => {});
    const li = h('li', { class: 'cr-row' },
      art,
      h('div', { class: 'cr-row-main' }, h('div', { class: 'cr-row-title' }, c.name), h('div', { class: 'cr-row-sub' }, `CR ${c.cr || '—'} · ${c.type || '—'} · AC ${c.ac ?? '—'} · HP ${c.hp ?? '—'}`)),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => startPlacing({ kind: 'creature', src: { custom: id }, name: c.name }) }, 'Place'),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit', 'aria-label': 'Edit', onclick: () => openCreatureEditor(id) }, icon('edit')),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: async () => { if (await confirmDialog(`Delete “${c.name}”? Creatures already placed stay.`, { okLabel: 'Delete', danger: true })) world.del('dm', k, { undo: true }); } }, icon('trash')));
    draggable(li, { kind: 'creature', src: { custom: id } });
    add(ul, li);
  }
  add(el, ul);
}

function hereTab(el, board) {
  const sceneId = dmViewingId();
  const list = world.dList('item.').filter(([, it]) => it.scene === sceneId && it.kind === 'creature').sort((a, b) => String(a[1].name).localeCompare(String(b[1].name), undefined, { numeric: true }));
  if (!list.length) { add(el, h('p', { class: 'muted' }, 'No creatures on this scene yet.')); return; }
  const anyShown = list.some(([, it]) => !it.hidden);
  add(el, h('div', { class: 'row cr-panel-actions' },
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { for (const [k, it] of list) world.dPut(k, { ...it, hidden: anyShown }, { undo: true }); } }, icon(anyShown ? 'eye-off' : 'eye'), anyShown ? 'Hide all' : 'Show all'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => A.rollCreatureInit({ force: true, onlyIds: list.map(([k]) => keyTail(k)), say: true }) }, icon('d20'), 'Roll initiative')));
  const ul = h('ul', { class: 'cr-list', role: 'list' });
  for (const [k, it] of list) {
    const hs = healthState(it.hp);
    add(ul, h('li', { class: ['cr-row is-clickable', it.hidden && 'is-hidden'], onclick: (e) => { if (e.target.closest('button')) return; select(`d:${k}`); board.centerOn(it.x, it.y); } },
      h('div', { class: 'cr-row-main' },
        h('div', { class: 'cr-row-title' }, it.name, it.alias ? h('span', { class: 'muted text-xs' }, ` (${it.alias})`) : null),
        h('div', { class: 'cr-row-sub' }, `HP ${it.hp?.cur ?? '—'} / ${it.hp?.max ?? '—'}${hs ? ` · ${hs.word}` : ''}${it.init != null ? ` · init ${it.init}` : ''}${it.disp && it.disp !== 'enemy' ? ` · ${it.disp === 'ally' ? 'companion' : 'neutral'}` : ''}`)),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: it.hidden ? 'Show to players' : 'Hide from players', 'aria-label': it.hidden ? 'Show' : 'Hide', onclick: () => world.dPut(k, { ...it, hidden: !it.hidden }, { undo: true }) }, icon(it.hidden ? 'eye-off' : 'eye'))));
  }
  add(el, ul);
  void toast;
}
