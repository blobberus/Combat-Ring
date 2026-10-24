// The side panel: an icon rail on the right edge and one open panel beside it. Panels re-render from world changes,
// except while something inside them has focus (typing); they catch up when focus leaves.
import { h, clear, add, mount } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { world } from '../world.js';
import { previewing } from '../view.js';
import { setUi } from '../state.js';
import * as A from '../actions.js';
import party from './party.js';
import initiative from './initiative.js';
import pins from './pins.js';
import scenes from './scenes.js';
import creatures from './creatures.js';
import props from './props.js';
import slides from './slides.js';
import table from './table.js';

const PANELS = [party, initiative, pins, scenes, creatures, props, slides, table];

export function createPanel(app, { board }) {
  const rail = h('nav', { class: 'rg-rail', 'aria-label': 'Panels' });
  const head = h('header', { class: 'rg-panel-head' });
  const body = h('div', { class: 'rg-panel-body' });
  const pane = h('section', { class: 'rg-pane' }, head, body);
  const el = h('aside', { class: 'rg-panel' }, pane, rail);
  add(app, el);
  let stale = false;
  let rendered = null;
  const ctx = { board, panel: null };

  const visible = () => PANELS.filter((p) => !p.dm || (world.dm && !previewing()));
  const active = () => {
    const list = visible();
    return list.find((p) => p.id === getSetting('panelTab')) || list[0];
  };
  // Phones start with the panel closed (it covers the whole board there); the choice is not saved for them.
  const phone = matchMedia('(max-width: 760px)').matches;
  let phoneOpen = false;
  const isOpen = () => (phone ? phoneOpen : !!getSetting('panelOpen'));

  // Rebuilt only when what it shows changed: it was redrawn on every change (each move a player makes), and redrawing
  // its icons cost the DM's screen more than everything else a move does.
  let railSig = '';
  function drawRail() {
    const cur = active();
    const sig = JSON.stringify([isOpen(), cur.id, visible().map((p) => [p.id, p.badge ? p.badge() || 0 : null])]);
    if (sig === railSig) return;
    railSig = sig;
    clear(rail);
    let dmDivider = false;
    for (const p of visible()) {
      if (p.dm && !dmDivider) { add(rail, h('hr', { class: 'divider' })); dmDivider = true; }
      add(rail, h('button', {
        class: ['rg-rail-btn', isOpen() && cur.id === p.id && 'is-active', p.dm && 'is-dm'], type: 'button', title: p.title, 'aria-label': p.title,
        'aria-pressed': String(isOpen() && cur.id === p.id),
        onclick: () => { if (isOpen() && cur.id === p.id) setOpen(false); else open(p.id); },
      }, icon(p.icon), p.badge ? h('span', { class: 'rg-rail-badge', hidden: !p.badge() }, p.badge() || '') : null));
    }
    add(rail, h('span', { class: 'spacer' }),
      h('button', { class: 'rg-rail-btn', type: 'button', title: isOpen() ? 'Close the panel' : 'Open the panel', 'aria-label': 'Toggle the panel', onclick: () => setOpen(!isOpen()) }, icon(isOpen() ? 'sidebar-right' : 'sidebar-left')));
  }

  function setOpen(on) {
    if (phone) phoneOpen = on; else setSetting('panelOpen', on);
    app.classList.toggle('has-panel', on);
    pane.hidden = !on;
    drawRail();
    if (on) draw(true);
    window.dispatchEvent(new Event('resize'));
  }

  function open(id) {
    setSetting('panelTab', id);
    if (!isOpen()) { setOpen(true); return; }
    drawRail();
    draw(true);
  }

  function draw(force = false) {
    if (!isOpen()) return;
    const p = active();
    if (!force && typingIn(body)) { stale = true; return; }
    stale = false;
    el.classList.toggle('is-wide', !!p.wide?.()); // a panel opened out over the board (the scene library)
    if (rendered !== p.id) {
      mount(head, h('h2', { class: 'rg-panel-title' }, p.title), p.headExtra ? p.headExtra(ctx) : null);
      clear(body);
      body.scrollTop = 0;
      p.mount?.(body, ctx);
      rendered = p.id;
    } else if (p.headExtra) mount(head, h('h2', { class: 'rg-panel-title' }, p.title), p.headExtra(ctx));
    const top = body.scrollTop;
    p.render(body, ctx);
    body.scrollTop = top; // a re-render keeps the list where it was
  }

  body.addEventListener('focusout', () => setTimeout(() => { if (stale && !typingIn(body)) draw(); }, 0));
  // a committed field (Enter or leaving it) hands focus back, so the panel can show the result
  body.addEventListener('change', (e) => { if (isTextField(e.target) && e.target.type !== 'search') setTimeout(() => e.target.blur(), 0); });

  // Drag a creature, prop or PC from a panel onto the board.
  board.root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('application/x-combat-ring')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  board.root.addEventListener('drop', (e) => {
    const raw = e.dataTransfer?.getData('application/x-combat-ring');
    if (!raw) return;
    e.preventDefault();
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    const pt = board.toWorld(e.clientX, e.clientY);
    const item = dragPayloads.get(d.id);
    if (!item) return;
    if (item.kind === 'creature') A.placeCreature(item.src, pt.x, pt.y);
    else if (item.kind === 'prop') A.placeProp(item.src, pt.x, pt.y);
    else if (item.kind === 'pc') A.placePc(item.charId, pt.x, pt.y);
    setUi({ placing: null });
  });

  const api = {
    el,
    isOpen,
    open,
    close: () => setOpen(false),
    activeId: () => active().id,
    refresh(changes) {
      drawRail();
      const p = active();
      if (!isOpen()) return;
      if (p.relevant && changes && !p.relevant(changes)) return;
      draw();
    },
    rebuild() { rendered = null; drawRail(); draw(true); },
  };
  ctx.panel = api;
  pane.hidden = !isOpen();
  drawRail();
  draw(true);
  return api;
}

const isTextField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes(el.type)));
/** Is the user typing in a field inside el? (Then a re-render would eat their text.) */
export const typingIn = (el) => el.contains(document.activeElement) && isTextField(document.activeElement);

// Payloads for HTML drag and drop (dataTransfer only carries strings).
const dragPayloads = new Map();
let dragSeq = 0;
export function draggable(el, payload) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    const id = `d${dragSeq++}`;
    dragPayloads.set(id, payload);
    e.dataTransfer.setData('application/x-combat-ring', JSON.stringify({ id }));
    e.dataTransfer.effectAllowed = 'copy';
  });
  return el;
}

/** Enter placement mode (click the board to place). */
export function startPlacing(payload) {
  setUi({ placing: payload });
}

/** Did anything a panel shows change? Moves (position-only changes) don't count: no panel lists positions. */
export const hasChanges = (changes, prefixes, room = 'both') => {
  if (changes.table?.has?.('#') || changes.dm?.has?.('#')) return true; // world.invalidate(): redraw everything
  for (const r of room === 'both' ? ['table', 'dm'] : [room]) {
    for (const k of changes[r] || []) if (!changes.moved?.has(`${r}:${k}`) && prefixes.some((p) => k.startsWith(p))) return true;
  }
  return false;
};
