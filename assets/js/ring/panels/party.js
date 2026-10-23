// Party: the Stone Wardens characters (name, owner, art), who is online, whose token is on the board, and quick
// ways to place, find and customize them. Players see their own movement and ranges at the top.
import { h, clear, add, mount } from '../../core/dom.js';
import { icon, toast } from '../../core/ui.js';
import { world, me } from '../world.js';
import { party, pcProfile } from '../characters.js';
import { presence } from '../presence.js';
import { K } from '../model.js';
import { select, setUi } from '../state.js';
import { currentSceneId, placeParty, centerOfView, deleteKeys, canHandlePc, pcUnlocked, setPcLocked } from '../actions.js';
import { openPcEditor } from '../editors/pc-editor.js';
import { identityDialog } from '../dialogs.js';
import { mediaUrl } from '../media.js';
import { draggable, startPlacing, hasChanges } from './index.js';
import { previewing } from '../view.js';

function art(p) {
  const el = h('span', { class: 'cr-char-art', style: { '--accent-tok': p.accent || '' } }, (p.name || '?').slice(0, 1).toUpperCase());
  if (p.img) mediaUrl(p.img).then((u) => { if (u) mount(el, h('img', { src: u, alt: '' })); }).catch(() => {});
  return el;
}

export default {
  id: 'party',
  title: 'Party',
  icon: 'users',
  relevant: (c) => hasChanges(c, ['pc.', 'pct.', 'meta', 'dmeta', 'scene.']),
  render(el, { board }) {
    clear(el);
    const sceneId = currentSceneId();
    const dm = world.dm && !previewing();
    const online = new Set(presence.list().flatMap((p) => p.chars || []));
    const all = party.all();
    const mine = all.filter((c) => me.owns(c.id));

    if (!dm) {
      if (!mine.length) {
        add(el, h('div', { class: 'cr-callout' }, h('p', null, 'Choose your character to move its token and enter initiative.'),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => identityDialog() }, 'Choose my character')));
      }
      for (const c of mine) {
        const p = pcProfile(c.id);
        const placed = sceneId && world.t(K.pct(sceneId, c.id));
        add(el, h('section', { class: 'cr-me' },
          h('div', { class: 'cr-me-head' }, art(p), h('div', null, h('div', { class: 'cr-me-name' }, p.name), h('div', { class: 'muted text-xs' }, `Speed ${p.speed} ft${p.darkvision ? ` · darkvision ${p.darkvision} ft` : ''}`))),
          h('div', { class: 'cr-me-ranges' }, p.ranges.filter((r) => r.ft > 0).map((r) => h('span', { class: ['chip', r.on && 'is-active'], title: r.on ? 'Shown around your token' : 'Hidden' }, `${r.label} ${r.ft} ft`))),
          sceneId && !canHandlePc(c.id, sceneId) ? h('p', { class: 'cr-me-lock' }, icon('lock'), placed ? 'The DM moves your token. Drag it to measure a move or a shot.' : 'The DM places your token.') : null,
          h('div', { class: 'row' },
            sceneId ? (placed
              ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { board.centerOn(placed.x, placed.y); select(`t:${K.pct(sceneId, c.id)}`); } }, icon('compass'), 'Find me')
              : canHandlePc(c.id, sceneId) ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => startPlacing({ kind: 'pc', charId: c.id, name: p.name }) }, icon('plus'), 'Place my token') : null) : null,
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openPcEditor(c.id) }, icon('edit'), 'Customize'))));
      }
    } else if (sceneId) {
      const missing = all.filter((c) => !world.t(K.pct(sceneId, c.id))).map((c) => c.id);
      const open = all.filter((c) => pcUnlocked(c.id, sceneId)).map((c) => c.id);
      add(el, h('div', { class: 'row cr-panel-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', disabled: !missing.length, onclick: () => { const pt = centerOfView(board); placeParty(missing, pt.x, pt.y); toast(`Placed ${missing.length} on the board.`); } }, icon('users'), 'Place the party'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: missing.length === all.length, onclick: () => deleteKeys(all.map((c) => `t:${K.pct(sceneId, c.id)}`)) }, 'Take all off')),
        h('div', { class: 'row cr-panel-actions cr-lock-all' },
          h('span', { class: 'muted text-xs' }, open.length ? `${open.length} of ${all.length} unlocked for their players` : 'All locked: only you move the characters'),
          h('span', { class: 'spacer' }),
          open.length < all.length ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Let every player move their own token on this scene', onclick: () => setPcLocked(all.map((c) => c.id), false, sceneId) }, icon('unlock'), 'Unlock all') : null,
          open.length ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Only you move the characters on this scene', onclick: () => setPcLocked(all.map((c) => c.id), true, sceneId) }, icon('lock'), 'Lock all') : null));
    }

    add(el, h('h3', { class: 'cr-sec-title' }, dm ? 'Characters' : 'The party'));
    if (!all.length) add(el, h('p', { class: 'muted' }, 'No characters in Stone Wardens yet. Each sheet made there appears here with its name, player and portrait.'));
    const list = h('ul', { class: 'cr-list', role: 'list' });
    for (const c of all) {
      const p = pcProfile(c.id);
      const pos = sceneId ? world.t(K.pct(sceneId, c.id)) : null;
      const can = dm || me.owns(c.id); // customize
      const handles = sceneId && (dm || canHandlePc(c.id, sceneId)); // place / move
      const open = sceneId && pcUnlocked(c.id, sceneId);
      const who = p.owner || 'its player';
      const li = h('li', { class: ['cr-row', pos && 'is-clickable'], onclick: (e) => { if (e.target.closest('button') || !pos) return; board.centerOn(pos.x, pos.y); select(`t:${K.pct(sceneId, c.id)}`); } },
        art(p),
        h('div', { class: 'cr-row-main' },
          h('div', { class: 'cr-row-title' }, p.name, online.has(c.id) ? h('span', { class: 'rg-dot cr-online', title: 'Online' }) : null),
          h('div', { class: 'cr-row-sub' }, [p.owner && `Played by ${p.owner}`, pos ? 'on the board' : 'not on the board', dm && sceneId ? (open ? `${who} can move it` : 'locked') : null].filter(Boolean).join(' · '))),
        dm && sceneId ? h('button', { class: ['btn-icon btn-sm', open && 'is-open'], type: 'button', title: open ? `Unlocked: ${who} can move it. Click to lock it.` : `Locked: only you move it. Click to let ${who} move it.`, 'aria-label': open ? `Lock ${p.name}` : `Unlock ${p.name} for ${who}`, onclick: () => setPcLocked(c.id, open, sceneId) }, icon(open ? 'unlock' : 'lock')) : null,
        handles && !pos ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Place on the board', 'aria-label': 'Place on the board', onclick: () => startPlacing({ kind: 'pc', charId: c.id, name: p.name }) }, icon('plus')) : null,
        can ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Customize the token', 'aria-label': 'Customize', onclick: () => openPcEditor(c.id) }, icon('edit')) : null);
      if (handles) draggable(li, { kind: 'pc', charId: c.id });
      add(list, li);
    }
    add(el, list);
    if (!dm) add(el, h('p', { class: 'muted text-xs cr-foot' }, 'Characters come from the Stone Wardens sheets. Hover a token on the board to see who it is.'));
    void setUi;
  },
};
