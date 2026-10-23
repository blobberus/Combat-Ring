// The board: a pannable, zoomable world (map pixels) with layers, rendered from a view model (view.js).
//   map · grid · props · rings (movement / ranges) · tokens · darkvision · darkness · fog · marks (pins, notes) · overlay
// The map, tokens and marks are DOM (crisp images, cheap hover and drag); grid, rings, fog, light and the overlay are
// SVG, so they stay sharp at every zoom. Tools (tools.js) get pointer events in world coordinates.
import { h, clear, add, mount } from '../core/dom.js';
import { icon } from '../core/ui.js';
import { getSetting } from '../core/settings.js';
import { cellPx, ftToPx, pathD, sizeCells, distanceFt, clamp } from './model.js';
import { mediaUrl, cachedUrl, mediaKey, isUrl } from './media.js';

const NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 6;

const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function createBoard(root, { onTool, onHover, onViewChange } = {}) {
  const world = h('div', { class: 'rg-world' });
  const mapLayer = h('div', { class: 'rg-map' });
  const gridSvg = svgEl('svg', { class: 'rg-grid' });
  const propLayer = h('div', { class: 'rg-layer rg-props' });
  const ringSvg = svgEl('svg', { class: 'rg-rings' });
  const tokLayer = h('div', { class: 'rg-layer rg-tokens' });
  const desat = h('div', { class: 'rg-desat' });
  const desatSvg = svgEl('svg');
  add(desat, desatSvg);
  const darkSvg = svgEl('svg', { class: 'rg-dark' });
  const fogSvg = svgEl('svg', { class: 'rg-fog' });
  const markLayer = h('div', { class: 'rg-layer rg-marks' });
  const overSvg = svgEl('svg', { class: 'rg-over' });
  add(world, mapLayer, gridSvg, propLayer, ringSvg, tokLayer, desat, darkSvg, fogSvg, markLayer, overSvg);
  const empty = h('div', { class: 'rg-empty', hidden: true });
  add(root, world, empty);
  root.classList.add('rg-board');

  const st = { tx: 0, ty: 0, s: 1, w: 1000, h: 1000, view: null, sceneId: null, fitted: null };
  const els = new Map(); // token key -> element
  const marks = new Map(); // mark key -> element
  let fogSig = '';
  let gridSig = '';
  let mapSig = '';

  // ---------- viewport ----------
  function applyTransform() {
    world.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.s})`;
    world.style.setProperty('--inv', String(1 / st.s));
    root.style.setProperty('--zoom', String(st.s));
    onViewChange?.(st);
  }

  function rect() { return root.getBoundingClientRect(); }

  function toWorld(cx, cy) {
    const r = rect();
    return { x: (cx - r.left - st.tx) / st.s, y: (cy - r.top - st.ty) / st.s };
  }

  function toScreen(x, y) {
    const r = rect();
    return { x: r.left + st.tx + x * st.s, y: r.top + st.ty + y * st.s };
  }

  function zoomAt(cx, cy, factor) {
    const r = rect();
    const px = cx - r.left, py = cy - r.top;
    const ns = clamp(st.s * factor, MIN_ZOOM, MAX_ZOOM);
    st.tx = px - ((px - st.tx) * ns) / st.s;
    st.ty = py - ((py - st.ty) * ns) / st.s;
    st.s = ns;
    applyTransform();
  }

  function fit(pad = 48) {
    const r = rect();
    if (!r.width || !r.height) return;
    const s = clamp(Math.min((r.width - pad * 2) / st.w, (r.height - pad * 2) / st.h), MIN_ZOOM, 2);
    st.s = s;
    st.tx = (r.width - st.w * s) / 2;
    st.ty = (r.height - st.h * s) / 2;
    applyTransform();
  }

  function centerOn(x, y, s = st.s) {
    const r = rect();
    st.s = clamp(s, MIN_ZOOM, MAX_ZOOM);
    st.tx = r.width / 2 - x * st.s;
    st.ty = r.height / 2 - y * st.s;
    applyTransform();
  }

  // ---------- input ----------
  const pointers = new Map();
  let pan = null;
  let pinch = null;
  let drag = null; // a tool's drag session {move(pt, e), up(pt, e), cancel()}
  let spaceDown = false;

  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01)); // trackpad pinch
    else if (e.shiftKey) { st.tx -= e.deltaY; applyTransform(); }
    else zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });

  addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; root.classList.add('is-grab'); } });
  addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; root.classList.remove('is-grab'); } });

  root.addEventListener('contextmenu', (e) => e.preventDefault());

  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.rg-float, button, input, textarea, select, a')) return;
    root.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      drag?.cancel?.();
      drag = null;
      pan = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    const wantPan = e.button === 1 || e.button === 2 || spaceDown || st.tool === 'pan';
    if (wantPan) { startPan(e); return; }
    if (e.button !== 0) return;
    const pt = toWorld(e.clientX, e.clientY);
    const session = onTool?.('down', { pt, e, target: e.target, board: api });
    if (session === 'pan') startPan(e);
    else if (session) drag = session;
  });

  function startPan(e) {
    pan = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty, moved: false };
    root.classList.add('is-panning');
  }

  root.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      st.tx += cx - pinch.cx;
      st.ty += cy - pinch.cy;
      applyTransform();
      zoomAt(cx, cy, d / (pinch.d || d));
      pinch = { d, cx, cy };
      return;
    }
    if (pan) {
      st.tx = pan.tx + e.clientX - pan.x;
      st.ty = pan.ty + e.clientY - pan.y;
      if (Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y) > 3) pan.moved = true;
      applyTransform();
      return;
    }
    const pt = toWorld(e.clientX, e.clientY);
    if (drag) { drag.move?.(pt, e); return; }
    onTool?.('hover', { pt, e, target: e.target, board: api });
    onHover?.(e);
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan) {
      const moved = pan.moved;
      pan = null;
      root.classList.remove('is-panning');
      if (!moved && st.tool !== 'pan' && e.type === 'pointerup') onTool?.('click-empty', { pt: toWorld(e.clientX, e.clientY), e, board: api });
      return;
    }
    if (drag) {
      const d = drag;
      drag = null;
      if (e.type === 'pointercancel') d.cancel?.(); else d.up?.(toWorld(e.clientX, e.clientY), e);
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('pointerleave', (e) => { if (!pointers.size) onTool?.('leave', { e, board: api }); });
  root.addEventListener('dblclick', (e) => {
    // the board holds pointer capture, so the event's own target is the board: look under the cursor instead
    const target = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    if (target.closest('.rg-float')) return;
    onTool?.('dblclick', { pt: toWorld(e.clientX, e.clientY), e, target, board: api });
  });

  new ResizeObserver(() => { if (st.fitted !== st.sceneId) { fit(); st.fitted = st.sceneId; } }).observe(root);

  // ---------- rendering ----------

  function setSize(w, h) {
    if (w === st.w && h === st.h) return;
    st.w = w; st.h = h;
    world.style.width = `${w}px`;
    world.style.height = `${h}px`;
    for (const s of [gridSvg, ringSvg, darkSvg, desatSvg, fogSvg, overSvg]) {
      s.setAttribute('viewBox', `0 0 ${w} ${h}`);
      s.setAttribute('width', w);
      s.setAttribute('height', h);
    }
  }

  async function renderMap(v) {
    const sig = `${v.sceneId}|${mediaKey(v.map)}|${v.map?.pending ? 'p' : ''}|${v.scene.color || ''}`;
    if (sig === mapSig) return;
    mapSig = sig;
    clear(mapLayer);
    mapLayer.style.background = v.scene.color || '';
    mapLayer.classList.toggle('is-blank', !v.map);
    if (!v.map) return;
    if (v.map.pending) { add(mapLayer, h('div', { class: 'rg-map-wait' }, h('span', { class: 'spinner' }), 'The map is on its way…')); return; }
    const img = h('img', { class: 'rg-map-img', alt: '', draggable: 'false' });
    const url = cachedUrl(v.map) || await mediaUrl(v.map).catch(() => null);
    if (mapSig !== sig) return;
    if (url) { img.src = url; add(mapLayer, img); } else add(mapLayer, h('div', { class: 'rg-map-wait' }, 'The map image could not be loaded.'));
  }

  function renderGrid(v) {
    const g = v.scene.grid || {};
    const c = cellPx(v.scene);
    const sig = `${st.w}|${st.h}|${c}|${g.show}|${g.color}|${g.opacity}`;
    if (sig === gridSig) return;
    gridSig = sig;
    clear(gridSvg);
    if (g.show === false) return;
    let d = '';
    for (let x = 0; x <= st.w + 0.5; x += c) d += `M${x} 0V${st.h}`;
    for (let y = 0; y <= st.h + 0.5; y += c) d += `M0 ${y}H${st.w}`;
    add(gridSvg, svgEl('path', { d, class: 'rg-grid-line', style: `${g.color ? `stroke:${g.color};` : ''}opacity:${g.opacity ?? 0.35}`, 'vector-effect': 'non-scaling-stroke' }));
  }

  function renderFog(v) {
    const shapes = v.fog || [];
    const sig = `${v.role}|${v.scene.fogOn}|${st.w}|${st.h}|${v.fogSel || ''}|${shapes.map((s) => `${s.id}:${s.z}:${s.on !== false}:${s.mode}:${s.pts.length}:${s.pts[0]},${s.pts[1]}`).join(';')}`;
    if (sig === fogSig) return;
    fogSig = sig;
    clear(fogSvg);
    if (v.scene.fogOn === false || !shapes.length) return;
    const id = `fogmask-${Math.random().toString(36).slice(2, 7)}`;
    const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: st.w, height: st.h });
    add(mask, svgEl('rect', { x: 0, y: 0, width: st.w, height: st.h, fill: 'black' }));
    for (const s of shapes) {
      if (s.on === false) continue;
      add(mask, svgEl('path', { d: pathD(s.pts), fill: s.mode === 'reveal' ? 'black' : 'white' }));
    }
    const defs = svgEl('defs');
    add(defs, mask);
    add(fogSvg, defs, svgEl('rect', { x: 0, y: 0, width: st.w, height: st.h, class: 'rg-fog-fill', mask: `url(#${id})` }));
    if (v.role === 'dm') {
      for (const s of shapes) {
        add(fogSvg, svgEl('path', {
          d: pathD(s.pts), 'data-fog': s.id,
          class: ['rg-fog-edge', s.mode === 'reveal' ? 'is-reveal' : 'is-hide', s.on === false && 'is-off', v.fogSel === s.id && 'is-sel'].filter(Boolean).join(' '),
          'vector-effect': 'non-scaling-stroke',
        }));
      }
    }
  }

  function setImg(img, src, fallbacks = []) {
    const key = mediaKey(src) + fallbacks.join('|');
    if (img.dataset.src === key) return;
    img.dataset.src = key;
    const list = [src, ...fallbacks].filter(Boolean);
    let i = 0;
    const tryNext = async () => {
      if (img.dataset.src !== key) return;
      if (i >= list.length) { img.removeAttribute('src'); img.closest('.rg-tok')?.classList.add('no-art'); return; }
      const s = list[i++];
      const url = cachedUrl(s) || await mediaUrl(s).catch(() => null);
      if (img.dataset.src !== key) return;
      if (url) img.src = url; else tryNext();
    };
    img.onerror = () => tryNext();
    img.onload = () => img.closest('.rg-tok')?.classList.remove('no-art');
    tryNext();
  }

  function tokenEl(t) {
    let el = els.get(t.key);
    if (!el) {
      el = h('div', { class: 'rg-tok', 'data-key': t.key },
        h('img', { class: 'rg-tok-art', alt: '', draggable: 'false' }),
        h('span', { class: 'rg-tok-initials' }),
        h('span', { class: 'rg-tok-ring' }),
        h('span', { class: 'rg-tok-hp', hidden: true }, h('i'), h('b')),
        h('span', { class: 'rg-tok-conds', hidden: true }),
        h('span', { class: 'rg-tok-label' }),
        h('span', { class: 'rg-tok-flag', hidden: true }));
      els.set(t.key, el);
    }
    return el;
  }

  function renderTokens(v) {
    const c = cellPx(v.scene);
    const seen = new Set();
    const names = getSetting('names');
    const hpMode = getSetting('hpBars');
    root.dataset.hpPos = getSetting('hpPos');
    root.dataset.hpSize = getSetting('hpSize');
    const hpColor = getSetting('hpColor');
    root.dataset.hpColor = hpColor ? 'one' : 'health';
    root.style.setProperty('--hp-color', hpColor || '');
    const sorted = [...v.tokens].sort((a, b) => (a.z || 0) - (b.z || 0));
    const order = { prop: [], tok: [] };
    for (const t of sorted) {
      seen.add(t.key);
      const el = tokenEl(t);
      const layer = t.kind === 'prop' ? propLayer : tokLayer;
      if (el.parentNode !== layer) add(layer, el);
      order[t.kind === 'prop' ? 'prop' : 'tok'].push(el);
      const w = sizeCells(t.w) * c, hh = sizeCells(t.h ?? t.w) * c;
      const x = t.x - w / 2, y = t.y - hh / 2;
      if (!el.classList.contains('is-dragging')) el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${t.rot || 0}deg)`;
      el.style.width = `${w}px`;
      el.style.height = `${hh}px`;
      el.className = ['rg-tok', `k-${t.kind}`, t.disp && `d-${t.disp}`, t.hidden && 'is-hidden', t.selected && 'is-selected', t.turn && 'is-turn',
        t.canDrag && 'can-drag', t.mine && 'is-mine', names === 'always' && 'show-name', names === 'never' && 'no-name', t.fogged && 'is-fogged',
        el.classList.contains('is-dragging') && 'is-dragging', !t.img && !(t.imgs || []).length && 'no-art', t.missing && 'is-missing'].filter(Boolean).join(' ');
      el.style.setProperty('--accent-tok', t.accent || '');
      const img = el.firstChild;
      const srcs = t.imgs || (t.img ? [t.img] : []);
      if (srcs.length) setImg(img, srcs[0], srcs.slice(1)); else { img.removeAttribute('src'); img.dataset.src = ''; }
      el.children[1].textContent = initials(t.name);
      const label = el.children[5];
      label.textContent = t.label ?? t.name ?? '';
      const hp = el.children[3];
      const bar = hpMode !== 'off' && t.health;
      hp.hidden = !bar;
      el.classList.toggle('has-hp', !!bar);
      el.classList.toggle('hp-text', !!(bar && hpMode === 'numbers' && t.health.text));
      if (bar) { hp.firstChild.style.width = `${t.health.pct}%`; hp.dataset.word = t.health.word; hp.lastChild.textContent = hpMode === 'numbers' ? t.health.text || '' : ''; }
      const conds = el.children[4];
      if (t.conditions?.length) { conds.hidden = false; conds.textContent = t.conditions.map((x) => x.slice(0, 2)).join(' '); conds.title = t.conditions.join(', '); } else conds.hidden = true;
      const flag = el.children[6];
      flag.hidden = !t.hidden;
      if (t.hidden && !flag.firstChild) add(flag, icon('eye-off'));
    }
    for (const [k, el] of els) if (!seen.has(k)) { el.remove(); els.delete(k); }
    // stacking follows z (re-append only when the order is off)
    for (const [layer, list] of [[propLayer, order.prop], [tokLayer, order.tok]]) {
      const kids = layer.children;
      if (list.length !== kids.length || list.some((el, i) => kids[i] !== el)) for (const el of list) add(layer, el);
    }
  }

  function renderMarks(v) {
    const seen = new Set();
    for (const m of v.marks || []) {
      seen.add(m.key);
      let el = marks.get(m.key);
      if (!el) {
        el = h('div', { class: 'rg-mark', 'data-key': m.key }, h('span', { class: 'rg-mark-pin' }), h('span', { class: 'rg-mark-label' }));
        marks.set(m.key, el);
        add(markLayer, el);
      }
      el.className = ['rg-mark', `m-${m.kind}`, m.resolved && 'is-resolved', m.selected && 'is-selected', m.canDrag && 'can-drag', m.hidden && 'is-hidden'].filter(Boolean).join(' ');
      if (!el.classList.contains('is-dragging')) el.style.transform = `translate(${m.x}px, ${m.y}px) scale(var(--inv))`;
      el.style.setProperty('--pin', m.color || '');
      const pin = el.firstChild;
      const glyph = m.kind === 'pin' ? 'pin' : m.icon || 'mk-quest';
      if (pin.dataset.glyph !== glyph) { pin.dataset.glyph = glyph; mount(pin, icon(glyph)); }
      el.lastChild.textContent = m.label || '';
    }
    for (const [k, el] of marks) if (!seen.has(k)) { el.remove(); marks.delete(k); }
  }

  function renderRings(v) {
    clear(ringSvg);
    for (const r of v.rings || []) {
      const rad = ftToPx(r.ft, v.scene);
      if (!(rad > 0)) continue;
      const g = svgEl('g', { class: ['rg-ring', r.kind && `is-${r.kind}`].filter(Boolean).join(' '), style: r.color ? `--ring:${r.color}` : null });
      add(g, svgEl('circle', { cx: r.x, cy: r.y, r: rad, 'vector-effect': 'non-scaling-stroke' }));
      if (r.label) {
        const tx = svgEl('text', { x: r.x, y: r.y - rad, class: 'rg-ring-label', style: 'font-size: calc(13px * var(--inv))' });
        tx.textContent = r.label;
        add(g, tx);
      }
      add(ringSvg, g);
    }
  }

  /** Darkness (dim / dark scenes) with darkvision and light sources cut out; darkvision areas desaturated. */
  function renderLight(v) {
    clear(darkSvg);
    clear(desatSvg);
    const level = v.scene.light?.level || 'bright';
    const lit = v.light;
    if (!lit || level === 'bright') { darkSvg.style.display = 'none'; desat.style.display = 'none'; return; }
    darkSvg.style.display = '';
    const alpha = (level === 'dark' ? 0.97 : 0.5) * (v.role === 'dm' ? 0.45 : 1);
    const uid = Math.random().toString(36).slice(2, 7);
    const defs = svgEl('defs');
    const mask = svgEl('mask', { id: `dk-${uid}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: st.w, height: st.h });
    add(mask, svgEl('rect', { x: 0, y: 0, width: st.w, height: st.h, fill: 'white' }));
    const dmask = svgEl('mask', { id: `dv-${uid}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: st.w, height: st.h });
    add(dmask, svgEl('rect', { x: 0, y: 0, width: st.w, height: st.h, fill: 'black' }));
    let anyDesat = false;
    const grad = (id, stops) => {
      const g = svgEl('radialGradient', { id, gradientUnits: 'objectBoundingBox' });
      for (const [off, color, op] of stops) add(g, svgEl('stop', { offset: off, 'stop-color': color, 'stop-opacity': op }));
      add(defs, g);
      return `url(#${id})`;
    };
    lit.forEach((src, i) => {
      // light sources: bright radius fully lit, dim radius half; darkvision: seen dimly (in gray) to its edge
      if (src.bright || src.dim) {
        const r = ftToPx((src.bright || 0) + (src.dim || 0), v.scene);
        const inner = r ? ftToPx(src.bright || 0, v.scene) / r : 0;
        add(mask, svgEl('circle', { cx: src.x, cy: src.y, r, fill: grad(`l${i}-${uid}`, [[0, 'black', 1], [Math.max(0, inner - 0.02), 'black', 1], [Math.min(1, inner + 0.08), 'black', 0.55], [1, 'black', 0]]) }));
      }
      if (src.darkvision > 0) {
        const r = ftToPx(src.darkvision, v.scene);
        const soft = clamp((src.soft ?? 45) / 100, 0.02, 1);
        const keep = level === 'dark' ? 1 - clamp((src.dim ?? 25) / 100, 0, 0.9) : 1;
        add(mask, svgEl('circle', { cx: src.x, cy: src.y, r, fill: grad(`d${i}-${uid}`, [[0, 'black', keep], [1 - soft, 'black', keep], [1, 'black', 0]]) }));
        if (level === 'dark' && (src.gray ?? 85) > 0) {
          anyDesat = true;
          add(dmask, svgEl('circle', { cx: src.x, cy: src.y, r, fill: grad(`g${i}-${uid}`, [[0, 'white', (src.gray ?? 85) / 100], [1 - soft, 'white', (src.gray ?? 85) / 100], [1, 'white', 0]]) }));
        }
        if (src.tint && src.tintStrength > 0) {
          add(darkSvg, svgEl('circle', { cx: src.x, cy: src.y, r, fill: grad(`t${i}-${uid}`, [[0, src.tint, src.tintStrength / 100], [1 - soft, src.tint, src.tintStrength / 100], [1, src.tint, 0]]) }));
        }
      }
      if (!src.darkvision && !src.bright && !src.dim && src.self) {
        // everyone sees their own token, even blind in the dark
        add(mask, svgEl('circle', { cx: src.x, cy: src.y, r: cellPx(v.scene) * 0.7, fill: grad(`s${i}-${uid}`, [[0, 'black', 0.9], [0.6, 'black', 0.6], [1, 'black', 0]]) }));
      }
    });
    add(defs, mask, dmask);
    darkSvg.prepend(defs);
    add(darkSvg, svgEl('rect', { x: 0, y: 0, width: st.w, height: st.h, class: 'rg-dark-fill', style: `opacity:${alpha}`, mask: `url(#dk-${uid})` }));
    if (anyDesat && v.role !== 'dm') {
      desat.style.display = '';
      const ddefs = svgEl('defs');
      add(ddefs, dmask);
      add(desatSvg, ddefs, svgEl('rect', { x: 0, y: 0, width: st.w, height: st.h, fill: '#808080', mask: `url(#dv-${uid})` }));
    } else desat.style.display = 'none';
  }

  // ---------- overlay (rulers, previews, pings) ----------
  const overlays = new Map(); // id -> {kind, …, until}

  function drawOverlay() {
    clear(overSvg);
    const v = st.view;
    if (!v) return;
    const now = Date.now();
    for (const [id, o] of overlays) {
      if (o.until && o.until < now) { overlays.delete(id); continue; }
      if (o.kind === 'ruler') {
        const g = svgEl('g', { class: 'rg-ruler', style: o.color ? `--ruler:${o.color}` : null });
        const pts = o.points;
        add(g, svgEl('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), 'vector-effect': 'non-scaling-stroke' }));
        for (const p of [pts[0], pts[pts.length - 1]]) add(g, svgEl('circle', { cx: p.x, cy: p.y, r: 4, style: 'r: calc(4px * var(--inv))' }));
        let ft = 0;
        for (let i = 1; i < pts.length; i++) ft += distanceFt(pts[i - 1], pts[i], v.scene, getSetting('diagonals'));
        const last = pts[pts.length - 1];
        const label = svgEl('text', { x: last.x, y: last.y, class: 'rg-ruler-label', style: 'font-size: calc(15px * var(--inv))', dy: '-0.9em' });
        label.textContent = `${ft} ft${o.name ? ` · ${o.name}` : ''}`;
        add(g, label);
        add(overSvg, g);
      } else if (o.kind === 'path') {
        add(overSvg, svgEl('path', { d: o.closed ? pathD(o.pts) : o.pts.reduce((d, n, i) => d + (i % 2 ? `${n}` : `${i ? 'L' : 'M'}${n} `), ''), class: ['rg-draft', o.mode === 'reveal' ? 'is-reveal' : 'is-hide'].join(' '), 'vector-effect': 'non-scaling-stroke' }));
      } else if (o.kind === 'box') {
        add(overSvg, svgEl('rect', { x: Math.min(o.x0, o.x1), y: Math.min(o.y0, o.y1), width: Math.abs(o.x1 - o.x0), height: Math.abs(o.y1 - o.y0), class: ['rg-draft', o.mode === 'reveal' ? 'is-reveal' : o.mode === 'select' ? 'is-select' : 'is-hide'].join(' '), 'vector-effect': 'non-scaling-stroke' }));
      } else if (o.kind === 'ping') {
        const age = (now - o.at) / 1400;
        const g = svgEl('g', { class: 'rg-ping', style: o.color ? `--ping:${o.color}` : null });
        for (const k of [0, 0.35]) {
          const a = clamp(age - k, 0, 1);
          add(g, svgEl('circle', { cx: o.x, cy: o.y, r: (10 + a * 70) / st.s, style: `opacity:${1 - a}`, 'vector-effect': 'non-scaling-stroke' }));
        }
        add(overSvg, g);
      } else if (o.kind === 'line') {
        add(overSvg, svgEl('line', { x1: o.x0, y1: o.y0, x2: o.x1, y2: o.y1, class: 'rg-drag-line', 'vector-effect': 'non-scaling-stroke' }));
        if (o.label) {
          const t = svgEl('text', { x: o.x1, y: o.y1, class: 'rg-ruler-label', style: 'font-size: calc(15px * var(--inv))', dy: '-1.6em' });
          t.textContent = o.label;
          add(overSvg, t);
        }
      }
    }
    if ([...overlays.values()].some((o) => o.kind === 'ping' || o.until)) requestAnimationFrame(drawOverlay);
  }

  function setOverlay(id, o) {
    if (o) overlays.set(id, o); else overlays.delete(id);
    drawOverlay();
  }

  // ---------- api ----------
  function render(v) {
    const sceneChanged = v?.sceneId !== st.sceneId;
    st.view = v;
    root.classList.toggle('is-dm', v?.role === 'dm');
    if (!v || !v.scene) {
      world.hidden = true;
      empty.hidden = false;
      mount(empty, ...(v?.emptyContent || []));
      st.sceneId = null;
      return;
    }
    world.hidden = false;
    empty.hidden = true;
    setSize(v.scene.w, v.scene.h);
    st.sceneId = v.sceneId;
    renderMap(v);
    renderGrid(v);
    renderTokens(v);
    renderMarks(v);
    renderRings(v);
    renderLight(v);
    renderFog(v);
    drawOverlay();
    if (sceneChanged) { requestAnimationFrame(() => { fit(); st.fitted = st.sceneId; }); }
  }

  const api = {
    root, world, st, render, fit, centerOn, toWorld, toScreen, zoomAt, setOverlay, drawOverlay,
    tokenEl: (key) => els.get(key) || null,
    markEl: (key) => marks.get(key) || null,
    setTool(tool) { st.tool = tool; root.dataset.tool = tool; },
    zoomBy(f) { const r = rect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); },
    get scale() { return st.s; },
  };
  applyTransform();
  return api;
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export { isTyping, isUrl };
