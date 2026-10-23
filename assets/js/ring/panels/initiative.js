// Initiative: players type their own characters' numbers, the DM types (or rolls) the creatures'; the list sorts
// itself (ties: Dexterity, then name). The DM runs the turns; everyone sees whose turn it is on the board.
import { h, clear, add } from '../../core/dom.js';
import { icon, toast, confirmDialog, promptDialog } from '../../core/ui.js';
import { world, me } from '../world.js';
import { party, pcProfile } from '../characters.js';
import { K } from '../model.js';
import { select } from '../state.js';
import * as A from '../actions.js';
import { hasChanges } from './index.js';
import { previewing } from '../view.js';

export default {
  id: 'initiative',
  title: 'Initiative',
  icon: 'd20',
  relevant: (c) => hasChanges(c, ['ini.', 'turn', 'item.', 'dmeta', 'pct.', 'it.']),
  render(el, { board }) {
    clear(el);
    const dm = world.dm && !previewing();
    const order = A.initiativeEntries({ forDm: dm });
    const turn = dm ? world.d('dmeta')?.turn || {} : world.t('turn') || {};
    const current = turn.active ? turn.current : null;

    if (dm) {
      add(el, h('div', { class: 'cr-turnbar' },
        turn.active
          ? [h('span', { class: 'cr-round' }, `Round ${turn.round || 1}`),
            h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Previous turn', 'aria-label': 'Previous turn', onclick: () => A.advanceTurn(-1) }, icon('chevron-left')),
            h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => A.advanceTurn(1) }, 'Next turn', icon('chevron-right')),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => A.setTurn({ active: false }) }, 'End')]
          : [h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !order.some((e) => e.value != null), onclick: () => A.setTurn({ active: true, round: 1, current: order.find((e) => e.value != null)?.id || null }) }, icon('sword'), 'Start combat')],
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Roll for creatures without a number', 'aria-label': 'Roll for creatures', onclick: () => A.rollCreatureInit() }, icon('d20')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Add an entry (lair action, event…)', 'aria-label': 'Add an entry', onclick: async () => { const n = await promptDialog('Add to initiative', { label: 'Name', value: 'Lair action' }); if (n) A.addInitExtra(n, 20); } }, icon('plus')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Clear initiative', 'aria-label': 'Clear initiative', onclick: async () => { if (await confirmDialog('Clear every initiative number and end combat?', { okLabel: 'Clear', danger: true })) A.clearInitiative(); } }, icon('trash'))));
    } else if (turn.active) {
      add(el, h('div', { class: 'cr-turnbar' }, h('span', { class: 'cr-round' }, `Round ${turn.round || 1}`),
        current === 'hidden' ? h('span', { class: 'muted text-sm' }, 'Something unseen acts…') : null));
    }

    // my characters (players) or everyone on the board (DM) still without a number
    const sceneId = A.currentSceneId();
    const waiting = party.all().filter((c) => (dm || me.owns(c.id)) && !order.some((e) => e.charId === c.id) && (dm ? sceneId && world.t(K.pct(sceneId, c.id)) : true));
    if (waiting.length) {
      add(el, h('div', { class: 'cr-waiting' }, h('h3', { class: 'cr-sec-title' }, dm ? 'Waiting for' : 'Your roll'),
        ...waiting.map((c) => h('label', { class: 'cr-ini-new' }, h('span', { class: 'cr-ini-name' }, c.name),
          h('input', { class: 'input input-number', type: 'number', inputmode: 'numeric', placeholder: '—', 'aria-label': `${c.name} initiative`, onchange: (e) => { if (e.target.value !== '') A.setPcInit(c.id, Number(e.target.value)); } })))));
    }

    if (!order.length) {
      add(el, h('div', { class: 'empty-state' }, icon('d20'), h('p', null, dm ? 'Roll for the creatures on the scene, and the players enter theirs.' : 'When combat starts, enter your initiative above; the order sorts itself.')));
      return;
    }
    const list = h('ol', { class: 'cr-ini', role: 'list' });
    for (const e of order) {
      const isPc = !!e.charId;
      const editable = dm || (isPc && me.owns(e.charId));
      const pr = isPc ? pcProfile(e.charId) : null;
      const name = isPc ? pr?.name || e.name : dm ? e.name : e.name;
      const li = h('li', {
        class: ['cr-ini-row', current === e.id && 'is-current', e.hidden && 'is-hidden', `d-${isPc ? 'pc' : e.disp || (e.src === 'x' ? 'x' : 'enemy')}`],
        onclick: (ev) => {
          if (ev.target.closest('input, button')) return;
          const key = isPc ? `t:${K.pct(sceneId, e.charId)}` : e.src === 'dm' ? (dm ? `d:${K.item(e.item)}` : `t:${K.pub(e.item)}`) : null;
          const pos = isPc ? world.t(K.pct(sceneId, e.charId)) : e.src === 'dm' ? (dm ? world.d(K.item(e.item)) : world.t(K.pub(e.item))) : null;
          if (key && pos) { select(key); board.centerOn(pos.x, pos.y); }
        },
      },
      editable
        ? h('input', { class: 'input input-number cr-ini-value', type: 'number', value: e.value ?? '', 'aria-label': `${name} initiative`, onchange: (ev) => A.setEntryInit(e, ev.target.value === '' ? null : Number(ev.target.value)) })
        : h('span', { class: 'cr-ini-value num' }, e.value ?? '—'),
      h('span', { class: 'cr-ini-name' }, name, dm && e.alias && e.alias !== e.name ? h('span', { class: 'muted text-xs' }, ` (${e.alias})`) : null),
      e.hidden ? h('span', { class: 'badge badge-warn', title: 'Hidden: players don’t see this line' }, icon('eye-off')) : null,
      isPc && pr?.owner ? h('span', { class: 'muted text-xs' }, pr.owner) : null,
      dm && current !== e.id && turn.active ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Make it this one’s turn', 'aria-label': 'Set turn', onclick: () => A.setTurn({ current: e.id }) }, icon('chevron-left')) : null,
      dm || (isPc && me.owns(e.charId)) ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove from initiative', 'aria-label': 'Remove', onclick: () => A.setEntryInit(e, null) }, icon('close')) : null);
      add(list, li);
    }
    add(el, list);
    if (dm) add(el, h('p', { class: 'muted text-xs cr-foot' }, 'Hidden creatures stay off the players’ list. Their numbers are on each creature’s menu too.'));
    void toast;
  },
};
