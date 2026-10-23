// Pointer tools on the board: select & drag, measure, pins, fog (lasso, polygon, rectangle, erase, toggle),
// interaction notes and placement. Each 'down' may return a drag session {move, up, cancel}.
import { world, me } from './world.js';
import { ui, setUi, select, toggleSelect, clearSelection, parseKey } from './state.js';
import { simplify, pointInPolygon, rectPts, distanceFt, sizeCells, sortShapes, polygonArea, snapPoint, cellPx } from './model.js';
import { getSetting } from '../core/settings.js';
import { toast } from '../core/ui.js';
import * as A from './actions.js';

const THROTTLE = 70;
let current = null; // the last view rendered (app sets it)
let hooks = { openMenu: () => {}, openPinEditor: () => {}, openDetails: () => {}, afterPlace: () => {} };

export function setToolHooks(h) { hooks = { ...hooks, ...h }; }
export function setCurrentView(v) { current = v; }

const PALETTE = ['#8e1b1b', '#22507c', '#23675f', '#3b6b2a', '#82600f', '#6e3a5c', '#a8321c', '#465266'];
export function colorFor(name) {
  let n = 0;
  for (const ch of String(name || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

function findToken(key) { return current?.tokens?.find((t) => t.key === key) || current?.marks?.find((m) => m.key === key) || null; }

function targetKey(target) {
  const el = target?.closest?.('.rg-tok, .rg-mark');
  return el?.dataset.key || null;
}

function fogAt(pt) {
  if (!current?.fog) return null;
  const shapes = sortShapes(current.fog).reverse();
  return shapes.find((s) => pointInPolygon(pt.x, pt.y, s.pts))?.id || null;
}

function sceneScale(board) { return board.scale || 1; }

// the token menu steps aside while a token is dragged or measured from (it would cover the line)
const dragging = (board, on) => board.root.closest('.rg-stage')?.classList.toggle('is-dragging', on);

export function handleTool(type, { pt, e, target, board }) {
  if (!current?.scene && type === 'down') return 'pan';
  const tool = ui.tool;
  if (type === 'hover') return hover(pt, target, board);
  if (type === 'leave') { board.setOverlay('ghost', null); return null; }
  if (type === 'dblclick') return dbl(pt, target, board, e);
  if (type === 'click-empty') {
    if (ui.placing) return null;
    if (tool === 'pin') { pinAt(pt, e); return null; }
    if (tool === 'note' && world.dm) { const k = A.placeNote(pt.x, pt.y); if (k) { select(k); hooks.openMenu(k); } return null; }
    clearSelection();
    return null;
  }
  if (type !== 'down') return null;

  if (ui.placing) return placeDown(pt, e);
  if (tool === 'measure') return measure(pt, board);
  if (tool === 'fog' && world.dm && !getSetting('dmPreview')) return fogDown(pt, e, board);

  const key = targetKey(target);
  if (key) return tokenDown(key, pt, e, board);
  if (world.dm && e.shiftKey && tool === 'select') return boxSelect(pt, board);
  return 'pan';
}

// ---------- select & drag ----------

function tokenDown(key, pt, e, board) {
  if (e.shiftKey) toggleSelect(key);
  else if (!ui.selected.has(key)) select(key);
  const keys = [...ui.selected].filter((k) => A.canMove(k) && findToken(k));
  if (!keys.includes(key) || !A.canMove(key)) {
    const t = findToken(key);
    if (t?.kind === 'pc' && t.mine) return rangeTest(t, pt, board); // a locked own character: dragging measures
    return { up: () => hooks.openMenu(key) };
  }
  const start = { x: pt.x, y: pt.y };
  const items = keys.map((k) => {
    const t = findToken(k);
    const { room, key: wk } = parseKey(k);
    return { k, t, x: t.x, y: t.y, before: world.bus.get(room, wk) ?? null, el: board.tokenEl(k) || board.markEl(k), mark: !!board.markEl(k) };
  });
  let moved = false;
  let last = 0;
  const lead = items.find((i) => i.k === key);
  const positions = (p, snap) => items.map((i) => {
    let x = i.x + p.x - start.x, y = i.y + p.y - start.y;
    if (snap && !i.mark) {
      const n = Math.max(sizeCells(i.t.w), sizeCells(i.t.h ?? i.t.w));
      const s = i.t.kind === 'prop' ? A.snapBox(x, y, sizeCells(i.t.w), sizeCells(i.t.h ?? i.t.w), snap) : A.maybeSnap(x, y, n, snap);
      x = s.x; y = s.y;
    }
    return { i, x: Math.round(x), y: Math.round(y) };
  });
  const showLine = (p) => {
    if (!lead || lead.mark) return;
    const ft = distanceFt({ x: lead.x, y: lead.y }, p, current.scene, getSetting('diagonals'));
    board.setOverlay('drag', { kind: 'line', x0: lead.x, y0: lead.y, x1: p.x, y1: p.y, label: `${ft} ft` });
  };
  return {
    move(p, ev) {
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * sceneScale(board) < 4) return;
      if (!moved) {
        moved = true;
        dragging(board, true);
        for (const i of items) i.el?.classList.add('is-dragging');
        ui.dragFrom = lead && !lead.mark ? { key: lead.k, x: lead.x, y: lead.y } : null;
      }
      for (const { i, x, y } of positions(p, null)) {
        if (!i.el) continue;
        if (i.mark) i.el.style.transform = `translate(${x}px, ${y}px) scale(var(--inv))`;
        else {
          const c = current.scene.grid?.size || 100;
          const w = sizeCells(i.t.w) * c, hh = sizeCells(i.t.h ?? i.t.w) * c;
          i.el.style.transform = `translate3d(${x - w / 2}px, ${y - hh / 2}px, 0) rotate(${i.t.rot || 0}deg)`;
        }
      }
      const lp = positions(p, null).find((q) => q.i === lead);
      if (lp) showLine(lp);
      if (Date.now() - last > THROTTLE) {
        last = Date.now();
        for (const { i, x, y } of positions(p, null)) A.moveTo(i.k, x, y, { final: false });
      }
    },
    up(p, ev) {
      board.setOverlay('drag', null);
      dragging(board, false);
      ui.dragFrom = null;
      for (const i of items) i.el?.classList.remove('is-dragging');
      if (!moved) { hooks.openMenu(key); return; }
      const final = positions(p, ev || {});
      const group = [];
      for (const { i, x, y } of final) {
        A.moveTo(i.k, x, y, { final: true });
        const { room, key: wk } = parseKey(i.k);
        if (world.dm) group.push([room, wk, i.before]);
      }
      if (group.length && world.dm) world.record(group, 'move');
      world.invalidate();
    },
    cancel() {
      board.setOverlay('drag', null);
      dragging(board, false);
      ui.dragFrom = null;
      for (const i of items) i.el?.classList.remove('is-dragging');
      world.invalidate();
    },
  };
}

// A player's token the DM keeps locked: dragging from it measures how far a move or a shot would reach (its range
// circles show while it is selected); the token stays where it is.
let lockedHint = false;
function rangeTest(t, start, board) {
  let moved = false;
  return {
    move(p) {
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * sceneScale(board) < 4) return;
      if (!moved) dragging(board, true);
      moved = true;
      const q = getSetting('snap') ? snapPoint(p.x, p.y, sizeCells(t.w), current.scene) : p;
      const ft = distanceFt({ x: t.x, y: t.y }, q, current.scene, getSetting('diagonals'));
      const move = t.profile?.ranges?.find((r) => r.id === 'move')?.ft || t.profile?.speed || 0;
      board.setOverlay('drag', { kind: 'line', x0: t.x, y0: t.y, x1: q.x, y1: q.y, label: move && ft > move ? `${ft} ft · past your ${move} ft move` : `${ft} ft` });
    },
    up() {
      board.setOverlay('drag', null);
      dragging(board, false);
      if (!moved) { hooks.openMenu(t.key); return; }
      if (!lockedHint) { lockedHint = true; toast('The DM moves your token while it is locked; dragging measures from it.', { timeout: 4000 }); }
    },
    cancel() { board.setOverlay('drag', null); dragging(board, false); },
  };
}

function boxSelect(start, board) {
  return {
    move(p) { board.setOverlay('box', { kind: 'box', x0: start.x, y0: start.y, x1: p.x, y1: p.y, mode: 'select' }); },
    up(p) {
      board.setOverlay('box', null);
      const x0 = Math.min(start.x, p.x), x1 = Math.max(start.x, p.x), y0 = Math.min(start.y, p.y), y1 = Math.max(start.y, p.y);
      const keys = [...(current.tokens || []), ...(current.marks || [])].filter((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map((t) => t.key);
      select(keys);
    },
    cancel() { board.setOverlay('box', null); },
  };
}

// ---------- measure ----------

let rulerSeq = 0;
function measure(start, board) {
  const scene = current.scene;
  const snapC = (p) => (getSetting('snap') ? snapPoint(p.x, p.y, 1, scene) : p);
  const points = [snapC(start), snapC(start)];
  const id = `me-${rulerSeq++}`;
  const name = me.name();
  const color = colorFor(name);
  let last = 0;
  const send = (end = false) => world.send('table', 'ruler', { scene: current.sceneId, points, name, color, end });
  const draw = () => board.setOverlay(id, { kind: 'ruler', points: [...points], name: '', color });
  draw();
  return {
    move(p) {
      points[points.length - 1] = snapC(p);
      draw();
      if (Date.now() - last > 90) { last = Date.now(); send(); }
    },
    up() {
      send(true);
      board.setOverlay(id, { kind: 'ruler', points: [...points], color, until: Date.now() + 1800 });
    },
    cancel() { send(true); board.setOverlay(id, null); },
  };
}

// ---------- pins ----------

function pinAt(pt, e) {
  const key = A.addPin(pt.x, pt.y, '', colorFor(me.name()));
  if (key) { select(key); hooks.openPinEditor(key, { isNew: true }); }
}

// ---------- fog ----------

let poly = null;

function fogDown(pt, e, board) {
  const shape = ui.fogShape;
  const mode = e.altKey ? (ui.fogMode === 'hide' ? 'reveal' : 'hide') : ui.fogMode;
  if (shape === 'erase' || shape === 'toggle') {
    const id = fogAt(pt);
    if (id) shape === 'erase' ? A.deleteFog(id) : A.toggleFog(id);
    return null;
  }
  // with Lasso or Rectangle, a drag draws and a click (no drag) on fog reveals it, or hides it again
  const clicked = (p) => Math.hypot(p.x - pt.x, p.y - pt.y) * sceneScale(board) < 5;
  const clickToggle = () => { const id = fogAt(pt); if (id) A.toggleFog(id); };
  if (shape === 'rect') {
    return {
      move(p) { if (!clicked(p)) board.setOverlay('fog', { kind: 'box', x0: pt.x, y0: pt.y, x1: p.x, y1: p.y, mode }); },
      up(p) {
        board.setOverlay('fog', null);
        if (clicked(p)) { clickToggle(); return; }
        const c = cellPx(current.scene); // rectangles snap to grid lines when snapping is on
        const sn = (v) => (getSetting('snap') && !e.altKey ? Math.round(v / c) * c : Math.round(v));
        const x0 = sn(Math.min(pt.x, p.x)), x1 = sn(Math.max(pt.x, p.x)), y0 = sn(Math.min(pt.y, p.y)), y1 = sn(Math.max(pt.y, p.y));
        if (x1 - x0 > 2 && y1 - y0 > 2) A.addFog(rectPts(x0, y0, x1, y1), mode);
      },
      cancel() { board.setOverlay('fog', null); },
    };
  }
  if (shape === 'poly') {
    if (!poly) poly = { pts: [], mode };
    const first = poly.pts.length >= 6 ? { x: poly.pts[0], y: poly.pts[1] } : null;
    if (first && Math.hypot(first.x - pt.x, first.y - pt.y) * sceneScale(board) < 12) { finishPoly(board); return null; }
    poly.pts.push(Math.round(pt.x), Math.round(pt.y));
    board.setOverlay('fog', { kind: 'path', pts: poly.pts, mode: poly.mode });
    return null;
  }
  // lasso
  const pts = [Math.round(pt.x), Math.round(pt.y)];
  let far = 0;
  return {
    move(p) {
      far = Math.max(far, Math.hypot(p.x - pt.x, p.y - pt.y) * sceneScale(board));
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) * sceneScale(board) < 3) return;
      pts.push(Math.round(p.x), Math.round(p.y));
      board.setOverlay('fog', { kind: 'path', pts, mode, closed: true });
    },
    up() {
      board.setOverlay('fog', null);
      if (far < 5) { clickToggle(); return; }
      const s = simplify(pts, 1.2 / sceneScale(board));
      if (s.length >= 6 && polygonArea(s) * sceneScale(board) ** 2 > 60) A.addFog(s, mode);
    },
    cancel() { board.setOverlay('fog', null); },
  };
}

export function finishPoly(board) {
  if (poly && poly.pts.length >= 6) A.addFog(poly.pts.slice(), poly.mode);
  poly = null;
  board?.setOverlay('fog', null);
}

export function cancelPoly(board) { poly = null; board?.setOverlay('fog', null); }
export const polyActive = () => !!poly;

// ---------- hover, double-click, placing ----------

function hover(pt, target, board) {
  if (ui.placing) {
    board.setOverlay('ghost', null);
    hooks.ghost?.(pt);
    return null;
  }
  if (ui.tool === 'fog' && world.dm && !poly && !getSetting('dmPreview')) { // the fog a click would reveal / hide / erase
    const id = fogAt(pt);
    if (id !== ui.fogSel) { setUi({ fogSel: id }); world.invalidate(); }
  } else if (ui.fogSel) { setUi({ fogSel: null }); world.invalidate(); }
  if (poly) board.setOverlay('fog', { kind: 'path', pts: [...poly.pts, Math.round(pt.x), Math.round(pt.y)], mode: poly.mode });
  return null;
}

function dbl(pt, target, board) {
  if (ui.tool === 'fog' && poly) { finishPoly(board); return null; }
  const key = targetKey(target);
  if (key) { hooks.openDetails(key); return null; }
  // double-click on the map: ping everyone
  ping(pt, board);
  return null;
}

export function ping(pt, board) {
  const color = colorFor(me.name());
  board.setOverlay(`ping-${Math.random()}`, { kind: 'ping', x: pt.x, y: pt.y, at: Date.now(), until: Date.now() + 1500, color });
  world.send('table', 'ping', { scene: current?.sceneId, x: pt.x, y: pt.y, color, name: me.name() });
}

function placeDown(pt, e) {
  const p = ui.placing;
  let key = null;
  if (p.kind === 'creature') key = A.placeCreature(p.src, pt.x, pt.y);
  else if (p.kind === 'prop') key = A.placeProp(p.src, pt.x, pt.y);
  else if (p.kind === 'pc') key = A.placePc(p.charId, pt.x, pt.y);
  if (key) select(key);
  if (!e.shiftKey || p.kind === 'pc') { setUi({ placing: null }); hooks.afterPlace?.(); }
  world.invalidate();
  return null;
}
