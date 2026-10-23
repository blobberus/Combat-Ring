// Dialogs: DM login (and first-time DM setup), the DM menu, settings, and "who are you" for players.
import { h, clear, add, mount } from '../core/dom.js';
import { openModal, field, toast, checkbox, segmented, select, promptDialog, icon } from '../core/ui.js';
import { getSetting, setSetting, applyTheme, currentTheme } from '../core/settings.js';
import { clearAuth, config } from '../core/auth.js';
import { repo } from '../core/repo.js';
import { world, me } from './world.js';
import { party } from './characters.js';
import { unlockDm, setupDm, lockDm, dmVaultExists, changeDmPassword } from './dm.js';
import { saveNow } from './persist.js';
import { setUi, ui } from './state.js';
import { mediaUrl } from './media.js';

export async function dmLoginDialog() {
  const exists = await dmVaultExists();
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', autofocus: true });
  const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const remember = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'field-error', hidden: true });
  const body = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); go(); } },
    h('input', { type: 'text', name: 'username', value: 'dungeon-master', autocomplete: 'username', hidden: true }),
    exists ? h('p', null, 'The DM sees and edits every scene, hidden creatures, fog and stat blocks. Players never receive them.')
      : h('p', null, 'No DM password is set up yet. Choose one now; it seals everything only the DM should see.'),
    field(exists ? 'DM password' : 'New DM password', pass),
    exists ? null : field('Repeat it', pass2),
    h('label', { class: 'checkbox' }, remember, h('span', null, 'Keep DM mode on this device')),
    err);
  let busy = false;
  const m = openModal({ title: 'DM login', body, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: exists ? 'Log in' : 'Set up DM mode', kind: 'primary', onClick: () => { go(); return false; } }] });
  async function go() {
    if (busy || !pass.value) return;
    if (!exists && pass.value !== pass2.value) { err.textContent = 'The two passwords differ.'; err.hidden = false; return; }
    busy = true;
    err.hidden = true;
    const btn = m.el.querySelector('.modal-foot .btn-primary');
    btn?.classList.add('is-loading');
    try {
      if (exists) await unlockDm(pass.value, remember.checked); else await setupDm(pass.value, remember.checked);
      m.close();
      toast('DM mode on. The players see only what you show them.', { type: 'success' });
    } catch (e) {
      err.textContent = e.message === 'bad-password' ? 'That is not the DM password.' : e.message;
      err.hidden = false;
      pass.select();
    } finally {
      busy = false;
      btn?.classList.remove('is-loading');
    }
  }
}

export function dmMenu(anchor) {
  const box = h('div', { class: 'rg-pop rg-float', role: 'menu' });
  const close = () => { box.remove(); removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  const item = (ic, label, fn) => h('button', { class: 'rg-pop-item', type: 'button', onclick: () => { close(); fn(); } }, icon(ic), label);
  const preview = getSetting('dmPreview');
  add(box, 
    h('div', { class: 'rg-pop-title' }, 'DM'),
    item(preview ? 'dm' : 'users', preview ? 'Back to the DM view' : 'See the players’ view', () => setSetting('dmPreview', !preview)),
    preview ? h('div', { class: 'rg-pop-field' }, field('Through the eyes of', select([{ value: '', label: 'The whole party' }, ...party.all().map((c) => ({ value: c.id, label: c.name }))], ui.previewChar || '', (v) => setUi({ previewChar: v || null })))) : null,
    item('save', 'Save a backup now', () => saveNow().then(() => toast('Backup saved.', { type: 'success' })).catch((e) => toast(`Backup failed: ${e.message}`, { type: 'error' }))),
    item('lock', 'Change the DM password…', async () => {
      const p = await promptDialog('New DM password', { type: 'password', label: 'New password', hint: 'Everything stays readable: the same key is re-sealed under the new password.' });
      if (!p) return;
      try { await changeDmPassword(p); toast('DM password changed.', { type: 'success' }); } catch (e) { toast(e.message, { type: 'error' }); }
    }),
    item('logout', 'Leave DM mode', () => lockDm().then(() => toast('DM mode off.'))));
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { position: 'fixed', top: `${r.bottom + 6}px`, right: `${Math.max(8, innerWidth - r.right)}px` });
  add(document.body, box);
  setTimeout(() => addEventListener('pointerdown', outside, true));
}

/** Checkboxes for the party; redraws when the sheets arrive or change. */
function charPicker(onChange, selected = me.chars()) {
  const chosen = new Set(selected);
  const list = h('div', { class: 'cr-chars' });
  const draw = () => {
    clear(list);
    const all = party.all();
    if (!all.length) add(list, h('p', { class: 'muted' }, party.loaded() ? 'No characters in Stone Wardens yet. Make one there and it appears here.' : 'Reading the party from Stone Wardens…'));
    for (const c of all) {
      const art = h('span', { class: 'cr-char-art', style: { '--accent-tok': c.accent || '' } }, c.name.slice(0, 1));
      if (c.portrait) mediaUrl(c.portrait).then((u) => { if (u) mount(art, h('img', { src: u, alt: '' })); }).catch(() => {});
      add(list, h('label', { class: ['cr-char', chosen.has(c.id) && 'is-on'] },
        h('input', { type: 'checkbox', checked: chosen.has(c.id), onchange: (e) => { if (e.target.checked) chosen.add(c.id); else chosen.delete(c.id); e.target.closest('.cr-char').classList.toggle('is-on', e.target.checked); onChange([...chosen]); } }),
        art, h('span', { class: 'cr-char-text' }, h('span', { class: 'cr-char-name' }, c.name), h('span', { class: 'muted text-xs' }, c.owner ? `Played by ${c.owner}` : ''))));
    }
  };
  draw();
  const off = party.on(() => { if (!list.isConnected) { off(); return; } draw(); }); // gone with its dialog
  return list;
}

export function identityDialog() {
  let name = me.name();
  let chars = me.chars();
  const nameIn = h('input', { class: 'input', value: name, placeholder: 'Your name', autofocus: true, oninput: (e) => { name = e.target.value; } });
  // Tick the sheets whose player matches the typed name, a moment after leaving the field, unless the player has
  // picked one meanwhile (a click on a sheet right away must not be undone by the suggestion).
  const suggest = () => setTimeout(() => {
    const n = name.trim().toLowerCase();
    if (!n || chars.length || !pickWrap.isConnected) return;
    chars = party.all().filter((c) => c.owner && c.owner.toLowerCase() === n).map((c) => c.id);
    if (chars.length) mount(pickWrap, charPicker((v) => { chars = v; }, chars));
  }, 300);
  nameIn.addEventListener('blur', suggest);
  const pickWrap = h('div', null, charPicker((v) => { chars = v; }, chars));
  openModal({
    title: 'Who is at the table?',
    body: h('div', { class: 'stack' },
      field('Your name', nameIn, 'Shown on your pins and rulers.'),
      field('Your characters', pickWrap, 'You move these tokens and enter their initiative. From the Stone Wardens sheets.')),
    actions: [
      { label: 'I’m the DM', kind: 'ghost', onClick: () => { if (name.trim()) setSetting('playerName', name.trim()); dmLoginDialog(); } },
      { label: 'Take my seat', kind: 'primary', onClick: () => { setSetting('playerName', name.trim()); setSetting('chars', chars); } },
    ],
  });
}

export function settingsDialog() {
  const body = h('div', { class: 'stack cr-settings' });
  const draw = () => {
    clear(body);
    const hl = world.bus.health();
    add(body, 
      h('section', { class: 'stack stack-sm' }, h('h3', { class: 'cr-pc-h' }, 'You'),
        field('Your name', h('input', { class: 'input', value: me.name(), onchange: (e) => setSetting('playerName', e.target.value.trim()) })),
        field('Your characters', charPicker((v) => setSetting('chars', v)))),
      h('section', { class: 'stack stack-sm' }, h('h3', { class: 'cr-pc-h' }, 'The board'),
        field('Token names', segmented([{ value: 'hover', label: 'On hover' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], getSetting('names'), (v) => setSetting('names', v))),
        field('Diagonals', segmented([{ value: 'five', label: '5 ft each' }, { value: 'alternate', label: '5 · 10 · 5' }, { value: 'euclid', label: 'Straight line' }], getSetting('diagonals'), (v) => setSetting('diagonals', v)), 'How the ruler and movement count diagonal squares (the 2024 rules: 5 ft each).'),
        checkbox(getSetting('snap'), (v) => setSetting('snap', v), 'Snap tokens to the grid (hold Alt to place freely)'),
        field('Theme', segmented([{ value: 'light', label: 'Day vellum' }, { value: 'dark', label: 'Night basalt' }], currentTheme(), (v) => { setSetting('theme', v); applyTheme(v); })),
        checkbox(getSetting('reduceMotion'), (v) => setSetting('reduceMotion', v), 'Reduce motion (no slide animations)')),
      world.dm ? h('section', { class: 'stack stack-sm' }, h('h3', { class: 'cr-pc-h' }, 'DM'),
        checkbox(getSetting('placeHidden'), (v) => setSetting('placeHidden', v), 'New creatures start hidden from players')) : null,
      h('section', { class: 'stack stack-sm' }, h('h3', { class: 'cr-pc-h' }, 'Connection'),
        h('ul', { class: 'cr-conn' }, ...hl.urls.map((u) => h('li', null, h('span', { class: 'rg-dot', 'data-state': u.state }), `${u.url.replace(/^wss:\/\//, '').split('/')[0]} · ${u.state}`))),
        h('p', { class: 'muted text-sm' }, repo.mode === 'sandbox'
          ? 'Sandbox: this browser only. Open another tab to see the players’ side.'
          : `Live updates are encrypted and relayed through ${hl.total} public brokers at once; backups and images are kept in ${config.dataRoot} of the Stone Wardens repository.`)),
      h('section', { class: 'stack stack-sm' }, h('h3', { class: 'cr-pc-h' }, 'Shortcuts'),
        h('dl', { class: 'cr-keys' }, ...[
          ['V', 'Select and move'], ['Space + drag', 'Pan (also right or middle drag)'], ['Wheel', 'Zoom'], ['M', 'Measure'], ['P', 'Drop a pin'],
          ['Double-click', 'Ping the map, or open a token’s details'], ['Arrows', 'Nudge the selection (Shift: 5 squares)'], ['Delete', 'Delete the selection'],
          ['Alt', 'Place without snapping'], ['+ / − / 0', 'Zoom in, out, fit'], ['Esc', 'Cancel'],
          ...(world.dm ? [['F', 'Fog of war'], ['N', 'Interaction'], ['H', 'Hide / show the selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+D', 'Duplicate'], ['Ctrl+S', 'Save a backup now'], ['Shift+P', 'Players’ view']] : []),
        ].flatMap(([k, d]) => [h('dt', null, h('kbd', null, k)), h('dd', null, d)]))),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => { clearAuth(); sessionStorage.removeItem('cr:dm'); localStorage.removeItem('cr:dm'); location.reload(); } }, icon('logout'), 'Lock the ring on this device')),
      h('p', { class: 'muted text-xs' }, 'Locking also locks the Stone Wardens site on this device: they share one password.'));
  };
  draw();
  openModal({ title: 'Settings', body, actions: [{ label: 'Done', kind: 'primary' }] });
}
