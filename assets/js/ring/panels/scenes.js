// Scenes (DM): every prepared map. View one to edit it while the players keep seeing the live one; "Show" makes it
// live; "Hide" lowers the curtain over the live scene (players see the curtain) until a scene is shown again.
// Two stages: the short list (pinned scenes, then the recent ones, and a quick search) and, opened out over the
// board, the whole library with the DM's folders and the Stone Wardens atlas (scene-library.js).
import { h, clear, add } from '../../core/dom.js';
import { icon } from '../../core/ui.js';
import { getSetting } from '../../core/settings.js';
import { dmScenes, playersSee, playersSeeLine } from '../view.js';
import * as A from '../actions.js';
import * as L from '../library.js';
import { openSceneEditor } from '../editors/scene-editor.js';
import { hasChanges } from './index.js';
import {
  renderLibrary, openLibrary, closeLibrary, setLibraryCtx, isDragging, holdRedraw, dragSource, dropTarget, yHalves, nextStill,
  sceneThumb, sceneState, sceneMeta, sceneBadge, showHideButton, pinButton, sceneMenu, openScene,
} from './scene-library.js';

const SHORT = 6; // recent scenes in the short list
let query = '';

function sceneRow(s, { reorder = null, list = null, i = 0 } = {}) {
  const st = sceneState(s);
  const spot = L.atlasSpot(s.at);
  const folder = L.folderById(L.folderOf(s));
  const where = [folder?.name, spot && (spot.place || spot.map).name].filter(Boolean).join(' · ');
  const row = h('li', { class: ['cr-scene', st.viewing && 'is-viewing', st.seen ? 'is-live' : st.live && 'is-hidden-live'] },
    h('button', { class: 'cr-scene-open', type: 'button', title: 'View and edit this scene', onclick: () => openScene(s.id) }, sceneThumb(s),
      h('span', { class: 'cr-scene-text' },
        h('span', { class: 'cr-scene-name' }, s.name || 'Scene'),
        h('span', { class: 'cr-row-sub' }, sceneMeta(s)),
        where ? h('span', { class: 'cr-row-sub cr-scene-where' }, where) : null),
      sceneBadge(s, st)),
    h('div', { class: 'cr-scene-actions' },
      showHideButton(s, st),
      pinButton(s),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Edit the map', 'aria-label': 'Edit the map', onclick: () => openSceneEditor(s.id) }, icon('edit')),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'More: move, file under a place, duplicate, delete', 'aria-label': `More: ${s.name}`, onclick: (e) => sceneMenu(e.currentTarget, s) }, icon('more'))));
  dragSource(row, () => ({ scenes: [s.id] }));
  if (reorder) dropTarget(row, { zone: yHalves, accept: (p) => !!p.scenes, run: (p, z) => { if (!p.scenes.includes(s.id)) reorder(p.scenes, z === 'before' ? s.id : nextStill(list, i, p.scenes)); } });
  return row;
}

const rows = (list, opts = {}) => h('ul', { class: 'cr-scenes', role: 'list' }, list.map((s, i) => sceneRow(s, { ...opts, list, i })));

function drawShort(box, scenes) {
  clear(box);
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = scenes.filter((s) => {
      const spot = L.atlasSpot(s.at);
      return [s.name, ...L.folderPath(L.folderOf(s)).map((f) => f.name), spot?.place?.name, spot?.map?.name].some((x) => String(x || '').toLowerCase().includes(q));
    });
    add(box, hits.length ? rows(hits.slice(0, 30)) : h('p', { class: 'muted text-sm' }, `No scene matches “${query.trim()}”.`));
    if (hits.length > 30) add(box, h('p', { class: 'muted text-xs' }, `${hits.length - 30} more in the library.`));
    return;
  }
  const pins = L.pinned();
  const pinnedIds = new Set(pins.map((s) => s.id));
  const ps = playersSee();
  let recent = L.recent().filter((s) => !pinnedIds.has(s.id)).slice(0, SHORT);
  // the live scene is always one click away
  const live = ps.id && !pinnedIds.has(ps.id) && !recent.some((s) => s.id === ps.id) ? scenes.find((s) => s.id === ps.id) : null;
  if (live) recent = [live, ...recent].slice(0, SHORT);
  const fill = !pins.length && !recent.length; // nothing used yet: the first few scenes

  const pinHead = h('div', { class: 'cr-sec-head' }, h('h3', { class: 'cr-sec-title' }, icon('pin'), 'Pinned'));
  dropTarget(pinHead, { accept: (p) => !!p.scenes, run: (p) => L.setPinned(p.scenes, true) });
  add(box, pinHead);
  if (pins.length) add(box, rows(pins, { reorder: (ids, before) => L.movePinned(ids, before) }));
  else add(box, h('p', { class: 'muted text-sm cr-short-hint' }, 'Pin the maps you use most (', icon('pin'), ') to keep them here.'));

  add(box, h('div', { class: 'cr-sec-head' }, h('h3', { class: 'cr-sec-title' }, icon('clock'), fill ? 'Scenes' : 'Recent')));
  add(box, rows(fill ? scenes.slice(0, SHORT) : recent));
}

export default {
  id: 'scenes',
  title: 'Scenes',
  icon: 'map',
  dm: true,
  wide: () => !!getSetting('scenesWide'),
  relevant: (c) => hasChanges(c, ['scene.', 'dmeta', 'media.', 'folder.', 'recent'], 'dm'),
  headExtra: () => (getSetting('scenesWide')
    ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Back to the short list (Esc)', onclick: () => closeLibrary() }, icon('collapse'), 'Smaller')
    : h('button', { class: 'btn btn-sm', type: 'button', title: 'Every scene, your folders and the Stone Wardens atlas', onclick: () => openLibrary() }, icon('folder'), 'All maps')),
  render(el, ctx) {
    setLibraryCtx(ctx);
    if (getSetting('scenesWide')) { renderLibrary(el, ctx); return; }
    if (isDragging()) { holdRedraw(); return; }
    clear(el);
    L.loadAtlas().then((changed) => { if (changed) ctx.panel.refresh(); }).catch(() => {});
    const scenes = dmScenes();
    const ps = playersSee();
    add(el, h('div', { class: 'row cr-panel-actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openSceneEditor() }, icon('plus'), 'New scene')));
    if (scenes.length) {
      add(el, h('div', { class: ['cr-seen', `is-${ps.state}`] }, playersSeeLine(ps), h('span', { class: 'spacer' }),
        ps.state === 'scene' ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Players see the curtain until you show a scene (Shift+H)', onclick: () => A.setBlackout(true) }, icon('eye-off'), 'Hide from players')
          : ps.state === 'curtain' && ps.id ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', title: `Show “${ps.name}” again (Shift+H)`, onclick: () => A.setBlackout(false) }, icon('eye'), 'Show it again') : null));
    }
    if (!scenes.length) {
      add(el, h('div', { class: 'empty-state' }, icon('map'), h('p', null, 'A scene is a map on a grid: pick its size in squares, place and crop an image on it, then add creatures, props, fog and interactions.')),
        h('p', { class: 'muted text-sm' }, 'Or start from a Stone Wardens map: ', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openLibrary(`m:${L.MAIN}`) }, icon('compass'), 'Open the atlas')));
      return;
    }
    const box = h('div', { class: 'cr-short' });
    add(el, h('input', { class: 'input input-sm cr-short-search', type: 'search', value: query, placeholder: 'Find a scene…', 'aria-label': 'Find a scene', oninput: (e) => { query = e.target.value; drawShort(box, dmScenes()); } }), box);
    drawShort(box, scenes);
    const nf = L.folderIndex().list.length;
    add(el, h('div', { class: 'cr-short-foot' },
      h('span', { class: 'muted text-sm' }, `${scenes.length} scene${scenes.length === 1 ? '' : 's'}${nf ? ` · ${nf} folder${nf === 1 ? '' : 's'}` : ''}`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openLibrary() }, icon('folder'), 'Browse all maps')));
  },
};
