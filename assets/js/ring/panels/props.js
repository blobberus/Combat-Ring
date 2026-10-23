// Props (DM): crates, carts, barrels, doors, campfires… drawn for the table, plus the DM's own uploaded art.
// Click one, then the map (Shift-click to place several), or drag it on. Props can be made movable by players.
import { h, clear, add } from '../../core/dom.js';
import { icon, toast, pickFile, promptDialog, confirmDialog } from '../../core/ui.js';
import { world } from '../world.js';
import { K, keyTail, newId } from '../model.js';
import { PROPS } from '../props.js';
import { addMedia, prepareUpload, mediaUrl } from '../media.js';
import { dmViewingId } from '../view.js';
import { select } from '../state.js';
import { draggable, startPlacing, hasChanges } from './index.js';

async function uploadProp() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const prepared = await prepareUpload(file, { maxSide: 1024 });
    const name = (await promptDialog('Name the prop', { label: 'Name', value: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') })) || 'Prop';
    const sizeText = await promptDialog('Size in squares', { label: 'Width × height', value: '1x1', hint: 'For example 2x1 for a cart.' });
    const [w, hh] = String(sizeText || '1x1').toLowerCase().split(/[x×*, ]+/).map((n) => Math.max(0.5, Number(n) || 1));
    const media = await addMedia(prepared, { name, kind: 'prop' });
    world.dPut(`cprop.${newId('cp')}`, { name, media, w: w || 1, h: hh || w || 1, at: Date.now() }, { undo: true, label: 'prop' });
    toast(`${name} added to your props.`, { type: 'success' });
  } catch (e) { toast(`Could not add that image: ${e.message}`, { type: 'error' }); }
}

export default {
  id: 'props',
  title: 'Props',
  icon: 'backpack',
  dm: true,
  relevant: (c) => hasChanges(c, ['cprop.', 'item.', 'media.'], 'dm'),
  render(el, { board }) {
    clear(el);
    add(el, h('div', { class: 'row cr-panel-actions' },
      h('span', { class: 'muted text-sm' }, 'Click a prop, then the map.'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: uploadProp }, icon('upload'), 'Your own…')));
    const grid = h('div', { class: 'cr-props' });
    const tile = (def, payloadSrc, extra = null) => {
      const img = h('img', { alt: '', loading: 'lazy' });
      if (def.url) img.src = def.url; else if (def.media) mediaUrl(def.media).then((u) => { if (u) img.src = u; }).catch(() => {});
      const b = h('button', { class: 'cr-prop', type: 'button', title: `${def.name} (${def.w}×${def.h})`, onclick: () => startPlacing({ kind: 'prop', src: payloadSrc, name: def.name }) },
        h('span', { class: 'cr-prop-art' }, img), h('span', { class: 'cr-prop-name' }, def.name), extra);
      draggable(b, { kind: 'prop', src: payloadSrc });
      return b;
    };
    const custom = world.dList('cprop.');
    if (custom.length) {
      add(el, h('h3', { class: 'cr-sec-title' }, 'Yours'));
      const mine = h('div', { class: 'cr-props' });
      for (const [k, p] of custom) {
        add(mine, h('div', { class: 'cr-prop-wrap' }, tile(p, { ...p, custom: true, id: keyTail(k) }),
          h('button', { class: 'btn-icon btn-sm cr-prop-x', type: 'button', title: 'Remove from your props', 'aria-label': 'Remove', onclick: async () => { if (await confirmDialog(`Remove “${p.name}” from your props? Placed copies stay.`, { okLabel: 'Remove', danger: true })) world.del('dm', k, { undo: true }); } }, icon('close'))));
      }
      add(el, mine, h('h3', { class: 'cr-sec-title' }, 'Built in'));
    }
    for (const p of PROPS) add(grid, tile(p, p.id));
    add(el, grid);

    const sceneId = dmViewingId();
    const here = world.dList('item.').filter(([, it]) => it.scene === sceneId && it.kind === 'prop');
    if (here.length) {
      add(el, h('h3', { class: 'cr-sec-title' }, `On this scene (${here.length})`));
      const ul = h('ul', { class: 'cr-list', role: 'list' });
      for (const [k, it] of here) {
        add(ul, h('li', { class: ['cr-row is-clickable', it.hidden && 'is-hidden'], onclick: (e) => { if (e.target.closest('button')) return; select(`d:${k}`); board.centerOn(it.x, it.y); } },
          h('div', { class: 'cr-row-main' }, h('div', { class: 'cr-row-title' }, it.name || 'Prop'), h('div', { class: 'cr-row-sub' }, [`${it.w}×${it.h}`, it.movable && 'players can move it', it.light && 'gives light'].filter(Boolean).join(' · '))),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: it.hidden ? 'Show to players' : 'Hide from players', 'aria-label': it.hidden ? 'Show' : 'Hide', onclick: () => world.dPut(k, { ...it, hidden: !it.hidden }, { undo: true }) }, icon(it.hidden ? 'eye-off' : 'eye'))));
      }
      add(el, ul);
    }
    void K;
  },
};
