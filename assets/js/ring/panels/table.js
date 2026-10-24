// Scene settings (DM): light (bright / dim / dark) and shared vision, fog and grid for the scene being viewed, and
// the banner: location name and time of day, each hidden from the players until the DM shows it.
import { h, clear, add } from '../../core/dom.js';
import { icon, field, segmented, checkbox } from '../../core/ui.js';
import { world } from '../world.js';
import { K, LIGHT_LEVELS, TIMES_OF_DAY } from '../model.js';
import { repo } from '../../core/repo.js';
import { config } from '../../core/auth.js';
import { dmViewingId } from '../view.js';
import * as A from '../actions.js';
import { openSceneEditor } from '../editors/scene-editor.js';
import { hasChanges } from './index.js';

let places = null;
async function swPlaces() {
  if (places) return places;
  places = [];
  try {
    const dir = config.locations || 'content/locations/';
    for (const f of repo.list(dir).filter((x) => x.path.endsWith('.json'))) {
      const d = await repo.json(f.path);
      if (d?.name) places.push(d.name);
    }
    places.sort();
  } catch { /* the codex has none */ }
  return places;
}

export default {
  id: 'table',
  title: 'Scene',
  icon: 'settings',
  dm: true,
  relevant: (c) => hasChanges(c, ['scene.', 'dmeta'], 'dm'),
  render(el) {
    clear(el);
    const sceneId = dmViewingId();
    const s = sceneId ? world.d(K.scene(sceneId)) : null;
    const bn = world.d('dmeta')?.banner || {};
    const set = (fields, label) => world.dPut(K.scene(sceneId), { ...world.d(K.scene(sceneId)), ...fields }, { undo: true, label });

    // banner
    const list = h('datalist', { id: 'cr-places' });
    swPlaces().then((p) => { for (const n of p) add(list, h('option', { value: n })); });
    add(el, h('section', { class: 'cr-sec stack stack-sm' },
      h('h3', { class: 'cr-sec-title' }, 'Where and when'),
      field('Location', h('input', { class: 'input', list: 'cr-places', value: bn.location || '', placeholder: 'Brinewick docks', onchange: (e) => A.setBanner({ location: e.target.value.trim() }) }), 'Places from the Stone Wardens map are suggested.'),
      list,
      checkbox(!!bn.showLocation, (v) => A.setBanner({ showLocation: v }), 'Show the location to players'),
      field('Time of day', h('div', { class: 'stack stack-sm' },
        h('div', { class: 'rg-conds' }, TIMES_OF_DAY.map((t) => h('button', { class: ['chip', bn.time === t && 'is-active'], type: 'button', onclick: () => A.setBanner({ time: bn.time === t ? '' : t }) }, t))),
        h('input', { class: 'input', value: bn.time || '', placeholder: 'Or anything: “Third bell, raining”', onchange: (e) => A.setBanner({ time: e.target.value.trim() }) }))),
      checkbox(!!bn.showTime, (v) => A.setBanner({ showTime: v }), 'Show the time to players'),
      h('p', { class: 'muted text-xs' }, 'Both start hidden. You always see the banner; it is dashed while the players can’t.')));

    if (!s) { add(el, h('p', { class: 'muted' }, 'Create a scene to set its light and grid.')); return; }
    add(el, h('section', { class: 'cr-sec stack stack-sm' },
      h('h3', { class: 'cr-sec-title' }, s.name || 'Scene'),
      field('Light', segmented(LIGHT_LEVELS.map((l) => ({ value: l.id, label: l.label })), s.light?.level || 'bright', (v) => set({ light: { ...(s.light || {}), level: v } }, 'light')),
        s.light?.level === 'dark' ? 'Players see only what light and their darkvision reach; the rest is black, creatures and other characters included.' : s.light?.level === 'dim' ? 'Everything beyond darkvision and light is darker, but players still see what is there.' : 'Everyone sees the whole revealed map.'),
      checkbox(!!s.light?.shared, (v) => set({ light: { ...(s.light || {}), shared: v } }, 'shared vision'), 'Shared party vision'),
      checkbox(s.fogOn !== false, (v) => set({ fogOn: v }, 'fog'), 'Fog of war'),
      checkbox(s.grid?.show !== false, (v) => set({ grid: { ...(s.grid || {}), show: v } }, 'grid'), 'Show the grid'),
      checkbox(s.grid?.players !== false, (v) => set({ grid: { ...(s.grid || {}), players: v } }, 'grid'), 'Players see the grid'),
      field('Grid strength', h('input', { type: 'range', class: 'cr-range', min: 0.05, max: 1, step: 0.05, value: s.grid?.opacity ?? 0.35, onchange: (e) => set({ grid: { ...(s.grid || {}), opacity: Number(e.target.value) } }, 'grid') })),
      h('p', { class: 'muted text-sm' }, `${s.cols} × ${s.rows} squares of ${s.grid?.ft || 5} ft`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openSceneEditor(sceneId) }, icon('edit'), 'Edit map, size and crop'),
      field('Scene notes (DM only)', h('textarea', { class: 'textarea', rows: 4, value: s.notes || '', placeholder: 'Read-aloud text, tactics, loot…', onchange: (e) => set({ notes: e.target.value }, 'notes') }))));
  },
};
