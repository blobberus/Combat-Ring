// A small cropper: drag the image inside the frame, zoom with the slider or the wheel. Circle frames make token art
// (transparent outside the circle); rectangles any aspect. -> {bytes, mime, w, h} WebP, or null when canceled.
import { h } from '../../core/dom.js';
import { openModal, field } from '../../core/ui.js';
import { decodeImage, renderImage } from '../media.js';

export async function cropDialog(blob, { title = 'Crop the image', circle = true, aspect = 1, out = 512, hint = 'Drag to move, use the slider or the mouse wheel to zoom.' } = {}) {
  const { img, w, h: ih, revoke } = await decodeImage(blob);
  const SW = aspect >= 1 ? 320 : Math.round(320 * aspect);
  const SH = aspect >= 1 ? Math.round(320 / aspect) : 320;
  const base = Math.max(SW / w, SH / ih);
  let z = 1;
  let ox = (SW - w * base) / 2;
  let oy = (SH - ih * base) / 2;
  const pic = h('img', { class: 'cr-crop-img', src: img.src, alt: '', draggable: 'false' });
  const frame = h('div', { class: ['cr-crop', circle && 'is-circle'], style: { width: `${SW}px`, height: `${SH}px` } }, pic, h('span', { class: 'cr-crop-mask' }));
  const slider = h('input', { type: 'range', min: 1, max: 5, step: 0.01, value: 1, class: 'cr-range' });
  const clampOff = () => {
    const s = base * z;
    ox = Math.min(0, Math.max(SW - w * s, ox));
    oy = Math.min(0, Math.max(SH - ih * s, oy));
  };
  const draw = () => {
    clampOff();
    const s = base * z;
    pic.style.width = `${w * s}px`;
    pic.style.height = `${ih * s}px`;
    pic.style.transform = `translate(${ox}px, ${oy}px)`;
  };
  const zoomTo = (nz, cx = SW / 2, cy = SH / 2) => {
    const s0 = base * z;
    z = Math.min(5, Math.max(1, nz));
    const s1 = base * z;
    ox = cx - ((cx - ox) * s1) / s0;
    oy = cy - ((cy - oy) * s1) / s0;
    slider.value = String(z);
    draw();
  };
  slider.addEventListener('input', () => zoomTo(Number(slider.value)));
  frame.addEventListener('wheel', (e) => { e.preventDefault(); const r = frame.getBoundingClientRect(); zoomTo(z * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  frame.addEventListener('pointerdown', (e) => { frame.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox, oy }; });
  frame.addEventListener('pointermove', (e) => { if (!drag) return; ox = drag.ox + e.clientX - drag.x; oy = drag.oy + e.clientY - drag.y; draw(); });
  frame.addEventListener('pointerup', () => { drag = null; });
  draw();
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title,
      body: h('div', { class: 'cr-crop-wrap' }, frame, field('Zoom', slider, hint)),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Use this', kind: 'primary', onClick: async () => {
            const s = base * z;
            const crop = { x: -ox / s, y: -oy / s, w: SW / s, h: SH / s };
            const ow = aspect >= 1 ? out : Math.round(out * aspect);
            const oh = aspect >= 1 ? Math.round(out / aspect) : out;
            result = await renderImage(blob, { crop, outW: ow, outH: oh, circle, maxSide: out });
          },
        },
      ],
      onClose: () => { revoke(); resolve(result); },
    });
  });
}
