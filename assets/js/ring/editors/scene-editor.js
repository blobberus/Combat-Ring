// New scene / edit map: size in squares, feet per square, the map image placed (moved and scaled) on that grid,
// so the DM can crop and scale any image to the battle grid. "Pixels per square" lines up a gridded battlemap
// exactly. Saving renders the framed image (WebP, at most 4096 px a side), sealed until the scene is shown.
// A new scene can start in a library folder, filed under an atlas map or place, or from an image (a Stone Wardens map).
import { h, clear, add } from '../../core/dom.js';
import { openModal, field, toast, pickFile, select, checkbox, segmented, confirmDialog } from '../../core/ui.js';
import { world } from '../world.js';
import { K, newId, LIGHT_LEVELS } from '../model.js';
import { addMedia, mediaUrl, decodeImage, prepareUpload } from '../media.js';
import { dmScenes } from '../view.js';
import { setUi } from '../state.js';

const BOX_W = 620, BOX_H = 440;
const MAX_OUT = 4096;

/** opts (new scenes): {name, folder, at: {map, loc?}, file: an image to start from, region: it is a region map (no grid of its own)} */
export function openSceneEditor(sceneId = null, opts = {}) {
  const cur = sceneId ? world.d(K.scene(sceneId)) : null;
  const st = {
    name: cur?.name || opts.name || `Scene ${dmScenes().length + 1}`,
    cols: cur?.cols || 30, rows: cur?.rows || 20,
    ft: cur?.grid?.ft || 5,
    color: cur?.color || '#3b3631',
    grid: { show: cur?.grid?.show !== false, players: cur?.grid?.players !== false, color: cur?.grid?.color || '', opacity: cur?.grid?.opacity ?? 0.35 },
    light: cur?.light || { level: 'bright', shared: false },
    fogOn: cur?.fogOn !== false,
    fit: cur?.map?.fit || null, // {x, y, s}: image top-left in squares, squares per image pixel
    srcMedia: cur?.map?.source || cur?.map?.media || null,
    file: null, // a newly picked file (uploaded on save)
    img: null, // {w, h, url}
  };
  let dirty = !cur;
  const box = h('div', { class: 'cr-se-box' });
  const frame = h('div', { class: 'cr-se-frame' });
  const pic = h('img', { class: 'cr-se-img', alt: '', draggable: 'false' });
  const grid = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  grid.setAttribute('class', 'cr-se-grid');
  add(frame, pic, grid);
  add(box, frame);
  const scale = h('input', { type: 'range', class: 'cr-range', min: -4, max: 4, step: 0.01, value: 0, 'aria-label': 'Image scale' });
  const info = h('p', { class: 'muted text-xs cr-se-info' });
  const side = h('div', { class: 'cr-se-side' });

  const k = () => Math.min(BOX_W / st.cols, BOX_H / st.rows); // preview px per square
  function cover(contain = false) {
    if (!st.img) return;
    const s = contain ? Math.min(st.cols / st.img.w, st.rows / st.img.h) : Math.max(st.cols / st.img.w, st.rows / st.img.h);
    st.fit = { s, x: (st.cols - st.img.w * s) / 2, y: (st.rows - st.img.h * s) / 2 };
    dirty = true;
    draw();
  }
  function draw() {
    const kk = k();
    const fw = st.cols * kk, fh = st.rows * kk;
    Object.assign(frame.style, { width: `${fw}px`, height: `${fh}px`, background: st.color });
    grid.setAttribute('viewBox', `0 0 ${fw} ${fh}`);
    grid.setAttribute('width', fw);
    grid.setAttribute('height', fh);
    let d = '';
    for (let x = 0; x <= st.cols; x++) d += `M${x * kk} 0V${fh}`;
    for (let y = 0; y <= st.rows; y++) d += `M0 ${y * kk}H${fw}`;
    grid.innerHTML = st.grid.show ? `<path d="${d}" fill="none" stroke="${st.grid.color || '#000'}" stroke-opacity="${Math.max(0.25, st.grid.opacity)}" stroke-width="1"/>` : '';
    if (st.img && st.fit) {
      pic.hidden = false;
      pic.src = st.img.url;
      Object.assign(pic.style, { left: `${st.fit.x * kk}px`, top: `${st.fit.y * kk}px`, width: `${st.img.w * st.fit.s * kk}px`, height: `${st.img.h * st.fit.s * kk}px` });
      const ppsq = 1 / st.fit.s;
      info.textContent = `Image ${st.img.w} × ${st.img.h} px · ${ppsq.toFixed(ppsq < 10 ? 2 : 0)} image px per square · map ${st.cols * st.ft} × ${st.rows * st.ft} ft`;
    } else {
      pic.hidden = true;
      info.textContent = `Blank map · ${st.cols * st.ft} × ${st.rows * st.ft} ft`;
    }
  }

  // drag to move, wheel / slider to scale (around the frame center)
  let drag = null;
  frame.addEventListener('pointerdown', (e) => { if (!st.fit) return; frame.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, fx: st.fit.x, fy: st.fit.y }; });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const kk = k();
    st.fit = { ...st.fit, x: drag.fx + (e.clientX - drag.x) / kk, y: drag.fy + (e.clientY - drag.y) / kk };
    dirty = true;
    draw();
  });
  frame.addEventListener('pointerup', () => { drag = null; });
  const zoomBy = (f, cx = st.cols / 2, cy = st.rows / 2) => {
    if (!st.fit) return;
    const s = st.fit.s * f;
    st.fit = { s, x: cx - (cx - st.fit.x) * f, y: cy - (cy - st.fit.y) * f };
    dirty = true;
    draw();
  };
  frame.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = frame.getBoundingClientRect();
    const kk = k();
    zoomBy(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / kk, (e.clientY - r.top) / kk);
  }, { passive: false });
  let lastScale = 0;
  scale.addEventListener('input', () => { const v = Number(scale.value); zoomBy(Math.exp((v - lastScale) * 0.35)); lastScale = v; });
  scale.addEventListener('change', () => { scale.value = '0'; lastScale = 0; });

  async function loadImage(src) {
    try {
      const url = await mediaUrl(src);
      if (!url) return;
      const d = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      st.img = { w: d.naturalWidth, h: d.naturalHeight, url };
      if (!st.fit) cover();
      draw();
    } catch (e) { console.warn('[scene] image', e); }
  }

  async function pickImage() {
    const file = await pickFile('image/*');
    if (file) await useFile(file);
  }

  async function useFile(file) {
    try {
      const d = await decodeImage(file);
      st.file = file;
      st.img = { w: d.w, h: d.h, url: d.img.src };
      // a battlemap's own grid: guess squares from common sizes (70, 100, 140, 50 px); a region map has none
      const guess = opts.region ? null : [140, 128, 100, 75, 70, 64, 50].find((n) => d.w % n === 0 && d.h % n === 0 && d.w / n <= 120 && d.h / n <= 120);
      if (guess && !cur) { st.cols = Math.round(d.w / guess); st.rows = Math.round(d.h / guess); st.fit = { s: 1 / guess, x: 0, y: 0 }; toast(`Looks like ${guess} px squares: ${st.cols} × ${st.rows}. Adjust if not.`); }
      else {
        if (opts.region && !cur) st.rows = Math.max(2, Math.round(st.cols * d.h / d.w)); // the whole map, its own shape
        cover();
      }
      dirty = true;
      drawSide();
      draw();
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  function drawSide() {
    clear(side);
    const n = (label, key, min, max, hint) => field(label, h('input', { class: 'input input-number', type: 'number', min, max, value: st[key], onchange: (e) => { st[key] = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))); dirty = true; draw(); } }), hint);
    const ppsq = h('input', { class: 'input input-number', type: 'number', min: 8, max: 600, placeholder: 'e.g. 70', 'aria-label': 'Image pixels per square' });
    add(side, 
      field('Name', h('input', { class: 'input', value: st.name, oninput: (e) => { st.name = e.target.value; dirty = true; } })),
      h('div', { class: 'field-grid cr-se-dims' }, n('Columns', 'cols', 2, 200), n('Rows', 'rows', 2, 200), n('Feet per square', 'ft', 1, 100)),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: pickImage }, st.img ? 'Replace image…' : 'Choose image…'),
        st.img ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { st.img = null; st.fit = null; st.srcMedia = null; st.file = null; dirty = true; drawSide(); draw(); } }, 'Blank map') : null),
      st.img ? h('div', { class: 'stack stack-sm' },
        field('Scale', scale, 'Or the mouse wheel over the map. Drag the map to move it.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => cover(false) }, 'Fill'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => cover(true) }, 'Fit whole image'),
          h('button', { class: 'btn btn-sm', type: 'button', title: 'Rows follow the image shape', onclick: () => { st.rows = Math.max(2, Math.round(st.cols * st.img.h / st.img.w)); cover(); drawSide(); } }, 'Match shape')),
        field('Image pixels per square', h('div', { class: 'row row-nowrap' }, ppsq, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
          const v = Number(ppsq.value);
          if (!(v >= 8)) return;
          st.cols = Math.max(2, Math.round(st.img.w / v));
          st.rows = Math.max(2, Math.round(st.img.h / v));
          st.fit = { s: 1 / v, x: 0, y: 0 };
          dirty = true;
          drawSide();
          draw();
        } }, 'Line up')), 'For a battlemap with its own grid: the size of one of its squares.')) : null,
      field('Background', h('input', { type: 'color', class: 'rg-color', value: st.color, oninput: (e) => { st.color = e.target.value; dirty = true; draw(); } })),
      h('h3', { class: 'cr-pc-h' }, 'Grid'),
      checkbox(st.grid.show, (v) => { st.grid.show = v; dirty = true; draw(); }, 'Show the grid'),
      checkbox(st.grid.players, (v) => { st.grid.players = v; dirty = true; }, 'Players see the grid'),
      h('div', { class: 'row row-nowrap' },
        field('Color', h('input', { type: 'color', class: 'rg-color', value: st.grid.color || '#000000', oninput: (e) => { st.grid.color = e.target.value; dirty = true; draw(); } })),
        field('Strength', h('input', { type: 'range', class: 'cr-range', min: 0.05, max: 1, step: 0.05, value: st.grid.opacity, oninput: (e) => { st.grid.opacity = Number(e.target.value); dirty = true; draw(); } }))),
      h('h3', { class: 'cr-pc-h' }, 'Light and fog'),
      field('Light', segmented(LIGHT_LEVELS.map((l) => ({ value: l.id, label: l.label })), st.light.level, (v) => { st.light = { ...st.light, level: v }; dirty = true; }), 'Dim and dark scenes darken what players can’t see; darkvision and light sources cut through.'),
      checkbox(!!st.light.shared, (v) => { st.light = { ...st.light, shared: v }; dirty = true; }, 'Shared party vision (everyone sees what any PC sees)'),
      checkbox(st.fogOn, (v) => { st.fogOn = v; dirty = true; }, 'Fog of war on this scene'),
      info);
  }

  async function save() {
    const id = sceneId || newId('s');
    const prev = cur || {};
    let map = prev.map || null;
    try {
      if (st.img && st.fit) {
        const changed = st.file || JSON.stringify(prev.map?.fit) !== JSON.stringify(st.fit) || prev.cols !== st.cols || prev.rows !== st.rows || prev.color !== st.color || !prev.map?.media;
        if (changed) {
          toast('Preparing the map…');
          let srcMedia = st.srcMedia;
          let blob;
          if (st.file) {
            const prepared = await prepareUpload(st.file, { maxSide: 8192, keepAnimated: false });
            srcMedia = await addMedia(prepared, { name: `${st.name} (original)`, kind: 'map-source' });
            blob = new Blob([prepared.bytes], { type: prepared.mime });
            st.fit = { ...st.fit, s: (st.fit.s * st.img.w) / prepared.w }; // very large originals were scaled down
            st.img = { ...st.img, w: prepared.w, h: prepared.h };
            st.file = null;
            st.srcMedia = srcMedia;
          } else {
            const res = await fetch(st.img.url);
            blob = await res.blob();
          }
          const native = 1 / st.fit.s;
          const ppc = Math.max(16, Math.min(native, 200, MAX_OUT / Math.max(st.cols, st.rows)));
          const W = Math.round(st.cols * ppc), H = Math.round(st.rows * ppc);
          const { img, revoke } = await decodeImage(blob);
          const canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
          const g = canvas.getContext('2d');
          g.fillStyle = st.color;
          g.fillRect(0, 0, W, H);
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, st.fit.x * ppc, st.fit.y * ppc, img.naturalWidth * st.fit.s * ppc, img.naturalHeight * st.fit.s * ppc);
          revoke();
          const out = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.9));
          const bytes = new Uint8Array(await out.arrayBuffer());
          const media = await addMedia({ bytes, mime: out.type || 'image/webp', w: W, h: H }, { name: st.name, kind: 'map' });
          map = { media, source: srcMedia, fit: st.fit };
        }
      } else map = null;
    } catch (e) {
      toast(`The map image could not be saved: ${e.message}`, { type: 'error' });
      return false;
    }
    const order = prev.order ?? Math.max(0, ...dmScenes().map((s) => s.order ?? 0)) + 1;
    world.dPut(K.scene(id), {
      ...(cur ? {} : { folder: opts.folder || null, at: opts.at || null }),
      ...prev, id, name: st.name.trim() || 'Scene', cols: st.cols, rows: st.rows, color: st.color, order,
      grid: { size: 100, ft: st.ft, show: st.grid.show, players: st.grid.players, color: st.grid.color || null, opacity: st.grid.opacity },
      light: st.light, fogOn: st.fogOn, map, updated: Date.now(),
    }, { undo: true, label: sceneId ? 'edit scene' : 'new scene' });
    if (!sceneId) setUi({ viewing: id });
    dirty = false;
    toast(sceneId ? 'Scene saved.' : 'Scene created. Place creatures and fog, then “Show this scene”.', { type: 'success' });
    return true;
  }

  drawSide();
  draw();
  if (st.srcMedia) loadImage(st.srcMedia);
  if (!cur && opts.file) useFile(opts.file);
  openModal({
    title: cur ? `Edit ${cur.name}` : 'New scene',
    wide: true,
    className: 'modal-scene',
    body: h('div', { class: 'cr-se' }, h('div', { class: 'cr-se-main' }, box, h('p', { class: 'muted text-xs' }, 'The frame is the battle map; whatever lies outside it is cropped.')), side),
    beforeClose: async () => !dirty || confirmDialog('Close without saving this scene?', { okLabel: 'Discard', danger: true }),
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: async () => (!dirty || (await confirmDialog('Discard your changes?', { okLabel: 'Discard', danger: true }))) },
      { label: cur ? 'Save scene' : 'Create scene', kind: 'primary', onClick: save },
    ],
  });
}

export { select };
