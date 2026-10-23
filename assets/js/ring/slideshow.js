// Transition scenes: the DM presents a deck of images (or GIFs / videos) over the board, with optional slow
// animations (zoom, pan, drift) and crossfades. Everyone renders the table's `show` object; the DM's client drives
// the slide index (and auto-advance), and can shrink the show to a corner ("peek") to keep working on the board.
import { h, clear, add, mount } from '../core/dom.js';
import { icon } from '../core/ui.js';
import { world } from './world.js';
import { K } from './model.js';
import { mediaUrl } from './media.js';
import { previewing } from './view.js';

const isVideo = (ref, url) => /^video\//.test(ref?.m || '') || /\.(mp4|webm)(\?|$)/i.test(url || ref?.url || '');

export function presentDeck(deckId, index = 0) {
  const dmeta = world.d('dmeta') || {};
  const deck = world.d(K.deck(deckId));
  world.dPut('dmeta', { ...dmeta, presenting: { deck: deckId, index, at: Date.now(), auto: !!deck?.auto } }, { undo: true, label: 'slideshow' });
}

export function slideTo(index) {
  const dmeta = world.d('dmeta') || {};
  if (!dmeta.presenting) return;
  const deck = world.d(K.deck(dmeta.presenting.deck));
  const n = deck?.slides?.length || 0;
  if (!n) return;
  let i = index;
  if (i >= n) i = deck.loop ? 0 : n - 1;
  if (i < 0) i = deck.loop ? n - 1 : 0;
  world.dPut('dmeta', { ...dmeta, presenting: { ...dmeta.presenting, index: i, at: Date.now() } });
}

export function endShow() {
  const dmeta = world.d('dmeta') || {};
  world.dPut('dmeta', { ...dmeta, presenting: null }, { undo: true, label: 'end slideshow' });
}

export function createSlideshow(stage) {
  const el = h('div', { class: 'rg-show', 'aria-live': 'polite' });
  const headEl = h('div', { class: 'rg-show-head' });
  const bar = h('div', { class: 'rg-show-bar rg-float', hidden: true });
  add(el, headEl);
  add(stage, el, bar);
  let sig = '';
  let current = null;
  let peek = false;
  let autoTimer = 0;

  async function slideEl(slide, show) {
    const layer = h('div', { class: 'rg-slide' });
    if (slide.pending) add(layer, h('div', { class: 'rg-show-wait' }, 'The image is on its way…'));
    else if (slide.img) {
      const url = await mediaUrl(slide.img).catch(() => null);
      const cls = ['rg-slide-media', slide.anim && slide.anim !== 'none' && `a-${slide.anim}`].filter(Boolean).join(' ');
      const media = isVideo(slide.img, url)
        ? h('video', { class: cls, src: url, autoplay: true, muted: true, loop: true, playsinline: true })
        : h('img', { class: cls, src: url, alt: slide.title || slide.caption || '' });
      media.style.setProperty('--dur-slide', `${Math.max(3, Number(slide.dur) || 8) + 2}s`);
      add(layer, media);
    }
    if (slide.title || slide.caption) {
      add(layer, h('div', { class: 'rg-slide-cap' },
        slide.title ? h('div', { class: 'rg-slide-title' }, slide.title) : null,
        slide.caption ? h('div', { class: 'rg-slide-text' }, slide.caption) : null));
    }
    void show;
    return layer;
  }

  async function update() {
    const s = world.t('show');
    const dmControls = world.dm && !previewing();
    if (!s?.on) {
      el.classList.remove('is-on', 'is-peek');
      bar.hidden = true;
      clearTimeout(autoTimer);
      if (current) { current.remove(); current = null; }
      sig = '';
      return;
    }
    el.classList.add('is-on');
    el.classList.toggle('is-peek', peek && dmControls);
    el.dataset.transition = s.transition || 'fade';
    el.dataset.fit = s.fit || 'cover';
    headEl.textContent = s.title || '';
    const slide = s.slides[s.index] || {};
    const nsig = `${s.deck}|${s.index}|${JSON.stringify(slide)}`;
    if (nsig !== sig) {
      sig = nsig;
      const layer = await slideEl(slide, s);
      if (sig !== nsig) return;
      el.insertBefore(layer, headEl);
      const old = current;
      current = layer;
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-in')));
      if (old) { old.classList.remove('is-in'); setTimeout(() => old.remove(), 2400); }
    }
    // presenter controls and auto-advance (the DM's client only)
    bar.hidden = !dmControls;
    clearTimeout(autoTimer);
    if (dmControls) {
      const pres = world.d('dmeta')?.presenting;
      const bsig = JSON.stringify([s.index, s.slides.length, !!pres?.auto, peek]);
      if (bar.dataset.sig !== bsig) {
        bar.dataset.sig = bsig;
        mount(bar, 
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Previous slide', 'aria-label': 'Previous slide', onclick: () => slideTo((pres?.index || 0) - 1) }, icon('chevron-left')),
        h('span', { class: 'rg-show-count num' }, `${s.index + 1} / ${s.slides.length}`),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Next slide', 'aria-label': 'Next slide', onclick: () => slideTo((pres?.index || 0) + 1) }, icon('chevron-right')),
        h('button', { class: ['btn btn-sm', pres?.auto && 'is-active'], type: 'button', title: 'Advance by itself', onclick: () => { const d = world.d('dmeta'); world.dPut('dmeta', { ...d, presenting: { ...d.presenting, auto: !d.presenting.auto, at: Date.now() } }); } }, icon('clock'), pres?.auto ? 'Auto on' : 'Auto'),
        h('button', { class: 'btn btn-sm', type: 'button', title: peek ? 'Show full screen' : 'Shrink to a corner to keep working', onclick: () => { peek = !peek; update(); } }, icon(peek ? 'external' : 'collapse'), peek ? 'Expand' : 'Peek'),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: endShow }, 'End slideshow'));
      }
      if (pres?.auto && s.slides.length > 1) {
        const dur = Math.max(2, Number(slide.dur) || 8) * 1000;
        const left = Math.max(300, dur - (Date.now() - (pres.at || Date.now())));
        if (s.index < s.slides.length - 1 || s.loop) autoTimer = setTimeout(() => slideTo((world.d('dmeta')?.presenting?.index || 0) + 1), left);
      }
    }
  }

  return { update, el };
}
