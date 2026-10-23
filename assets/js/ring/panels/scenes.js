// Scenes (DM): every prepared map. View one to edit it while the players keep seeing the live one; "Show" makes it
// live. The curtain hides the board from the players without changing scenes.
import { h, clear, add } from '../../core/dom.js';
import { icon, confirmDialog, toast } from '../../core/ui.js';
import { world, undoGroup } from '../world.js';
import { ui, setUi, clearSelection } from '../state.js';
import { K, newId, keyTail } from '../model.js';
import { dmScenes, dmViewingId } from '../view.js';
import * as A from '../actions.js';
import { openSceneEditor } from '../editors/scene-editor.js';
import { mediaUrl } from '../media.js';
import { hasChanges } from './index.js';

function duplicate(s) {
  const id = newId('s');
  undoGroup('duplicate scene', () => {
    world.dPut(K.scene(id), { ...structuredClone(s), id, name: `${s.name} (copy)`, order: (s.order ?? 0) + 0.5 }, { undo: true });
    for (const [k, f] of world.dList(`fog.${s.id}.`)) world.dPut(K.fog(id, k.slice(`fog.${s.id}.`.length)), structuredClone(f), { undo: true });
    for (const [k, it] of world.dList('item.')) if (it.scene === s.id) world.dPut(K.item(newId(it.kind[0])), { ...structuredClone(it), scene: id }, { undo: true });
  });
  toast('Scene copied with its fog, creatures and props.');
}

async function remove(s) {
  const items = world.dList('item.').filter(([, it]) => it.scene === s.id);
  if (!(await confirmDialog(`Delete “${s.name}”${items.length ? ` and its ${items.length} creatures, props and notes` : ''}? Ctrl+Z brings it back.`, { okLabel: 'Delete scene', danger: true }))) return;
  undoGroup('delete scene', () => {
    for (const [k] of world.dList(`fog.${s.id}.`)) world.del('dm', k, { undo: true });
    for (const [k] of items) world.del('dm', k, { undo: true });
    world.del('dm', K.scene(s.id), { undo: true });
    if (world.d('dmeta')?.live === s.id) A.patchDmeta({ live: null });
  });
  if (ui.viewing === s.id) setUi({ viewing: null });
}

function move(s, dir) {
  const list = dmScenes();
  const i = list.findIndex((x) => x.id === s.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  undoGroup('reorder', () => {
    list.forEach((x, n) => {
      const order = n === i ? j : n === j ? i : n;
      if ((x.order ?? -1) !== order) world.dPut(K.scene(x.id), { ...world.d(K.scene(x.id)), order }, { undo: true });
    });
  });
}

export default {
  id: 'scenes',
  title: 'Scenes',
  icon: 'map',
  dm: true,
  relevant: (c) => hasChanges(c, ['scene.', 'dmeta', 'media.'], 'dm'),
  render(el) {
    clear(el);
    const scenes = dmScenes();
    const dmeta = world.d('dmeta') || {};
    const viewing = dmViewingId();
    add(el, h('div', { class: 'row cr-panel-actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openSceneEditor() }, icon('plus'), 'New scene'),
      h('span', { class: 'spacer' }),
      h('button', { class: ['btn btn-sm', dmeta.blackout && 'is-active'], type: 'button', onclick: () => A.setBlackout(!dmeta.blackout) }, icon(dmeta.blackout ? 'eye' : 'eye-off'), dmeta.blackout ? 'Raise the curtain' : 'Curtain')));
    if (!scenes.length) {
      add(el, h('div', { class: 'empty-state' }, icon('map'), h('p', null, 'A scene is a map on a grid: pick its size in squares, place and crop an image on it, then add creatures, props, fog and interactions.')));
      return;
    }
    const list = h('ul', { class: 'cr-scenes', role: 'list' });
    scenes.forEach((s, i) => {
      const live = dmeta.live === s.id;
      const thumb = h('div', { class: 'cr-scene-thumb', style: { background: s.color || '' } });
      if (s.map?.media) mediaUrl(s.map.media).then((u) => { if (u) add(thumb, h('img', { src: u, alt: '', loading: 'lazy' })); }).catch(() => {});
      const nItems = world.dVals('item.').filter((it) => it.scene === s.id && it.kind === 'creature').length;
      add(list, h('li', { class: ['cr-scene', viewing === s.id && 'is-viewing', live && 'is-live'] },
        h('button', { class: 'cr-scene-open', type: 'button', title: 'View and edit this scene', onclick: () => { setUi({ viewing: s.id }); clearSelection(); } }, thumb,
          h('span', { class: 'cr-scene-text' },
            h('span', { class: 'cr-scene-name' }, s.name || 'Scene'),
            h('span', { class: 'cr-row-sub' }, `${s.cols} × ${s.rows} squares · ${nItems} creature${nItems === 1 ? '' : 's'}${s.light?.level && s.light.level !== 'bright' ? ` · ${s.light.level}` : ''}`)),
          live ? h('span', { class: ['badge', dmeta.blackout ? 'badge-warn' : 'badge-ok'] }, dmeta.blackout ? 'Curtained' : 'Live') : viewing === s.id ? h('span', { class: 'badge' }, 'Viewing') : null),
        h('div', { class: 'cr-scene-actions' },
          live && !dmeta.blackout ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { A.goLive(s.id); setUi({ viewing: s.id }); } }, icon('eye'), 'Show'),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit the map', 'aria-label': 'Edit the map', onclick: () => openSceneEditor(s.id) }, icon('edit')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: () => duplicate(s) }, icon('copy')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(s, -1) }, icon('chevron-up')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === scenes.length - 1, onclick: () => move(s, 1) }, icon('chevron-down')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: () => remove(s) }, icon('trash')))));
    });
    add(el, list);
    add(el, h('p', { class: 'muted text-xs cr-foot' }, 'Players see only the live scene (unless the curtain is down). Viewing another scene lets you prepare it in secret.'));
    void keyTail;
  },
};
