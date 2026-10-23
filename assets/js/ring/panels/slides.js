// Slides (DM): decks of images for transitions (arrival at a city, a vision, a time skip). Each slide has a title,
// a caption, an animation (slow zoom, pan, drift, pulse) and a duration; a deck has its transition, fit, auto-advance
// and loop. Images are sealed until the deck is presented. GIFs and videos play as they are.
import { h, clear, add } from '../../core/dom.js';
import { icon, toast, confirmDialog, promptDialog, select, checkbox, field, segmented } from '../../core/ui.js';
import { world } from '../world.js';
import { K, keyTail, newId } from '../model.js';
import { addMedia, prepareUpload, mediaUrl } from '../media.js';
import { presentDeck, endShow, slideTo } from '../slideshow.js';
import { hasChanges } from './index.js';

const ANIMS = [
  { value: 'none', label: 'Still' }, { value: 'zoom-in', label: 'Slow zoom in' }, { value: 'zoom-out', label: 'Slow zoom out' },
  { value: 'pan-left', label: 'Pan left' }, { value: 'pan-right', label: 'Pan right' }, { value: 'pan-up', label: 'Pan up' },
  { value: 'drift', label: 'Drift' }, { value: 'pulse', label: 'Pulse' },
];
const TRANSITIONS = [{ value: 'fade', label: 'Crossfade' }, { value: 'slow', label: 'Slow fade' }, { value: 'slide', label: 'Slide' }, { value: 'cut', label: 'Cut' }];

let editing = null; // deck id open in the editor

async function addImages(deckId) {
  const input = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm', multiple: true, hidden: true });
  add(document.body, input);
  input.click();
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.remove();
    if (!files.length) return;
    toast(`Adding ${files.length} slide${files.length === 1 ? '' : 's'}…`);
    for (const f of files) {
      try {
        const prepared = await prepareUpload(f, { maxSide: 2560 });
        const media = await addMedia(prepared, { name: f.name, kind: 'slide' });
        const deck = world.d(K.deck(deckId));
        if (!deck) return;
        world.dPut(K.deck(deckId), { ...deck, slides: [...(deck.slides || []), { media, title: '', caption: '', anim: f.type.startsWith('image/gif') || f.type.startsWith('video') ? 'none' : 'zoom-in', dur: 8 }] });
      } catch (e) { toast(`${f.name}: ${e.message}`, { type: 'error' }); }
    }
  }, { once: true });
}

function deckEditor(el, id) {
  const deck = world.d(K.deck(id));
  if (!deck) { editing = null; return; }
  const set = (fields) => world.dPut(K.deck(id), { ...world.d(K.deck(id)), ...fields }, { undo: true, label: 'slides' });
  const setSlide = (i, fields) => { const d = world.d(K.deck(id)); set({ slides: d.slides.map((s, j) => (j === i ? { ...s, ...fields } : s)) }); };
  const presenting = world.d('dmeta')?.presenting?.deck === id;
  add(el, 
    h('div', { class: 'row cr-panel-actions' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { editing = null; world.invalidate(); } }, icon('chevron-left'), 'All decks'),
      h('span', { class: 'spacer' }),
      presenting ? h('button', { class: 'btn btn-sm', type: 'button', onclick: endShow }, 'End') : h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !deck.slides?.length, onclick: () => presentDeck(id) }, icon('eye'), 'Present')),
    field('Title', h('input', { class: 'input', value: deck.title || '', placeholder: 'Shown in the corner (optional)', onchange: (e) => set({ title: e.target.value }) })),
    h('div', { class: 'field-grid' },
      field('Transition', select(TRANSITIONS, deck.transition || 'fade', (v) => set({ transition: v }))),
      field('Fit', segmented([{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Whole image' }], deck.fit || 'cover', (v) => set({ fit: v })))),
    h('div', { class: 'row' }, checkbox(!!deck.auto, (v) => set({ auto: v }), 'Advance by itself'), checkbox(!!deck.loop, (v) => set({ loop: v }), 'Loop')),
    h('h3', { class: 'cr-sec-title' }, `Slides (${deck.slides?.length || 0})`));
  const ul = h('ol', { class: 'cr-slides', role: 'list' });
  (deck.slides || []).forEach((s, i) => {
    const thumb = h('div', { class: 'cr-slide-thumb' });
    const src = s.media || s.url;
    if (src) mediaUrl(src).then((u) => { if (!u) return; add(thumb, /\.(mp4|webm)(\?|$)/i.test(s.url || '') || world.d(K.media(s.media))?.mime?.startsWith('video') ? h('video', { src: u, muted: true }) : h('img', { src: u, alt: '' })); }).catch(() => {});
    add(ul, h('li', { class: ['cr-slide', presenting && world.d('dmeta')?.presenting?.index === i && 'is-current'] },
      h('div', { class: 'cr-slide-side' }, thumb,
        h('div', { class: 'row row-nowrap' },
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { const d = [...deck.slides]; [d[i - 1], d[i]] = [d[i], d[i - 1]]; set({ slides: d }); } }, icon('chevron-up')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === deck.slides.length - 1, onclick: () => { const d = [...deck.slides]; [d[i + 1], d[i]] = [d[i], d[i + 1]]; set({ slides: d }); } }, icon('chevron-down')),
          presenting ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Show this slide now', 'aria-label': 'Show now', onclick: () => slideTo(i) }, icon('eye')) : null,
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: () => set({ slides: deck.slides.filter((_, j) => j !== i) }) }, icon('trash')))),
      h('div', { class: 'cr-slide-main stack stack-sm' },
        h('input', { class: 'input', value: s.title || '', placeholder: 'Title', 'aria-label': 'Title', onchange: (e) => setSlide(i, { title: e.target.value }) }),
        h('textarea', { class: 'textarea', rows: 2, value: s.caption || '', placeholder: 'Caption', 'aria-label': 'Caption', onchange: (e) => setSlide(i, { caption: e.target.value }) }),
        h('div', { class: 'row row-nowrap' },
          select(ANIMS, s.anim || 'none', (v) => setSlide(i, { anim: v }), { 'aria-label': 'Animation' }),
          h('input', { class: 'input input-number', type: 'number', min: 2, max: 120, value: s.dur || 8, title: 'Seconds on screen (when advancing by itself)', 'aria-label': 'Seconds', onchange: (e) => setSlide(i, { dur: Math.max(2, Number(e.target.value) || 8) }) }),
          h('span', { class: 'muted text-sm' }, 's')))));
  });
  add(el, ul, h('div', { class: 'row' },
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addImages(id) }, icon('upload'), 'Add images…'),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => { const u = await promptDialog('Add a slide from the web', { label: 'Image, GIF or video URL', placeholder: 'https://…' }); if (u?.trim()) set({ slides: [...(deck.slides || []), { url: u.trim(), title: '', caption: '', anim: 'none', dur: 8 }] }); } }, 'By URL…')));
}

export default {
  id: 'slides',
  title: 'Slides',
  icon: 'image',
  dm: true,
  relevant: (c) => hasChanges(c, ['deck.', 'dmeta', 'media.'], 'dm'),
  render(el) {
    clear(el);
    if (editing) { deckEditor(el, editing); if (editing) return; clear(el); }
    const decks = world.dList('deck.');
    const pres = world.d('dmeta')?.presenting;
    add(el, h('div', { class: 'row cr-panel-actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { const t = await promptDialog('New slideshow', { label: 'Title', value: 'Transition' }); if (t == null) return; const id = newId('d'); world.dPut(K.deck(id), { title: t, slides: [], transition: 'fade', fit: 'cover', auto: false, loop: false }, { undo: true }); editing = id; world.invalidate(); } }, icon('plus'), 'New slideshow'),
      pres ? h('button', { class: 'btn btn-sm', type: 'button', onclick: endShow }, 'End the slideshow') : null));
    if (!decks.length) {
      add(el, h('div', { class: 'empty-state' }, icon('image'), h('p', null, 'Show the players an image or a sequence between scenes: arriving at a port, a dream, a map of the journey. Slow zooms and pans make stills feel alive.')));
      return;
    }
    const ul = h('ul', { class: 'cr-list', role: 'list' });
    for (const [k, d] of decks) {
      const id = keyTail(k);
      const live = pres?.deck === id;
      add(ul, h('li', { class: ['cr-row', live && 'is-live'] },
        h('div', { class: 'cr-row-main' }, h('div', { class: 'cr-row-title' }, d.title || 'Slideshow', live ? h('span', { class: 'badge badge-ok' }, 'Showing') : null), h('div', { class: 'cr-row-sub' }, `${d.slides?.length || 0} slide${d.slides?.length === 1 ? '' : 's'}${d.auto ? ' · advances by itself' : ''}${d.loop ? ' · loops' : ''}`)),
        live ? h('button', { class: 'btn btn-sm', type: 'button', onclick: endShow }, 'End') : h('button', { class: 'btn btn-sm', type: 'button', disabled: !d.slides?.length, onclick: () => presentDeck(id) }, icon('eye'), 'Present'),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit', 'aria-label': 'Edit', onclick: () => { editing = id; world.invalidate(); } }, icon('edit')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: async () => { if (await confirmDialog(`Delete “${d.title || 'Slideshow'}”?`, { okLabel: 'Delete', danger: true })) { if (live) endShow(); world.del('dm', k, { undo: true }); } } }, icon('trash'))));
    }
    add(el, ul);
  },
};
