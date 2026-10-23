// Pins: notes anyone drops on the map ("trap here?", "we hide behind the cart"). Everyone sees them; the DM
// resolves them (they fold away) or clears them.
import { h, clear, add } from '../../core/dom.js';
import { icon, confirmDialog } from '../../core/ui.js';
import { world } from '../world.js';
import { ui, setUi, select } from '../state.js';
import * as A from '../actions.js';
import { hasChanges } from './index.js';
import { previewing } from '../view.js';

export default {
  id: 'pins',
  title: 'Pins',
  icon: 'pin',
  badge: () => { const s = A.currentSceneId(); const n = world.tVals('pin.').filter((p) => p.scene === s && !p.resolved).length; return n || ''; },
  relevant: (c) => hasChanges(c, ['pin.', 'meta', 'dmeta']),
  render(el, { board }) {
    clear(el);
    const dm = world.dm && !previewing();
    const sceneId = A.currentSceneId();
    const all = world.tList('pin.').filter(([, p]) => p.scene === sceneId).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    const open = all.filter(([, p]) => !p.resolved);
    const done = all.filter(([, p]) => p.resolved);
    add(el, h('div', { class: 'row cr-panel-actions' },
      h('button', { class: ['btn btn-sm', ui.tool === 'pin' && 'is-active'], type: 'button', onclick: () => setUi({ tool: ui.tool === 'pin' ? 'select' : 'pin' }) }, icon('pin'), ui.tool === 'pin' ? 'Click the map…' : 'Drop a pin'),
      h('span', { class: 'spacer' }),
      done.length ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { setUi({ showResolved: !ui.showResolved }); world.invalidate(); } }, ui.showResolved ? 'Hide resolved on map' : 'Show resolved on map') : null));
    if (dm && all.length) {
      add(el, h('div', { class: 'row cr-panel-actions' },
        done.length ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => A.clearPins(sceneId, { resolvedOnly: true }) }, 'Clear resolved') : null,
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => { if (await confirmDialog(`Remove all ${all.length} pins from this scene?`, { okLabel: 'Clear all', danger: true })) A.clearPins(sceneId); } }, icon('trash'), 'Clear all')));
    }
    if (!all.length) {
      add(el, h('div', { class: 'empty-state' }, icon('pin'), h('p', null, 'Pins mark a spot for everyone: a hunch, a plan, a question for the DM. Choose “Drop a pin” and click the map.')));
      return;
    }
    const row = ([k, p]) => h('li', { class: ['cr-row is-clickable cr-pin', p.resolved && 'is-resolved'], onclick: (e) => { if (e.target.closest('button')) return; board.centerOn(p.x, p.y); select(`t:${k}`); } },
      h('span', { class: 'cr-pin-dot', style: { background: p.color || '' } }),
      h('div', { class: 'cr-row-main' }, h('div', { class: 'cr-row-title' }, p.text || h('span', { class: 'muted' }, 'No note')), h('div', { class: 'cr-row-sub' }, `${p.by || 'Someone'} · ${p.at ? new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}${p.resolved ? ` · resolved${p.resolvedBy ? ` by ${p.resolvedBy}` : ''}` : ''}`)),
      dm ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: p.resolved ? 'Reopen' : 'Resolve', 'aria-label': p.resolved ? 'Reopen' : 'Resolve', onclick: () => A.resolvePin(k, !p.resolved) }, icon(p.resolved ? 'undo' : 'check')) : null,
      A.canEditPin(p) ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: () => A.deleteKeys([`t:${k}`]) }, icon('trash')) : null);
    add(el, h('ul', { class: 'cr-list', role: 'list' }, open.map(row)));
    if (done.length) add(el, h('details', { class: 'cr-fold' }, h('summary', null, `Resolved (${done.length})`), h('ul', { class: 'cr-list', role: 'list' }, done.map(row))));
  },
};
