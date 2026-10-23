// A player's token settings (pc.<charId> on the table): token art, color and size, hit points and who sees its health
// bar, speed and ranges (movement, weapons, spells), darkvision (radius and how it looks to this player) and a light
// they carry. Changes apply live.
import { h, clear, add } from '../../core/dom.js';
import { openModal, field, segmented, checkbox, pickFile, toast, select, icon } from '../../core/ui.js';
import { world, me } from '../world.js';
import { party, pcProfile } from '../characters.js';
import { K, safeKeyPart } from '../model.js';
import { uploadPlain, mediaUrl } from '../media.js';
import { cropDialog } from './crop.js';
import { lightSelect, sizeControl, hpBlock } from '../menu.js';
import { canHandlePc } from '../actions.js';

const COLORS = ['#8e1b1b', '#a8321c', '#22507c', '#23675f', '#3b6b2a', '#82600f', '#8f6a14', '#6e3a5c', '#465266', '#5c4a36', '#1f1a14'];
const PRESETS = [
  ['Dash', null], ['Shortbow', 80], ['Longbow', 150], ['Light crossbow', 80], ['Hand crossbow', 30], ['Javelin', 30], ['Dagger (thrown)', 20],
  ['Fire Bolt', 120], ['Eldritch Blast', 120], ['Sacred Flame', 60], ['Healing Word', 60], ['Misty Step', 30], ['Fireball', 150], ['Reach', 10],
];

export function openPcEditor(charId) {
  if (!world.dm && !me.owns(charId)) { toast('Only this character’s player (or the DM) can change it.'); return; }
  const c = party.get(charId);
  const prefs = () => world.t(K.pc(charId)) || {};
  const set = (fields) => world.tPut(K.pc(charId), { ...prefs(), ...fields });
  const body = h('div', { class: 'cr-pc' });
  let timer = 0;
  const later = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 160); };

  function draw() {
    const p = pcProfile(charId);
    const raw = prefs();
    clear(body);
    // --- art ---
    const preview = h('div', { class: 'cr-pc-art', style: { '--accent-tok': p.accent || '' } });
    if (p.img) mediaUrl(p.img).then((u) => { if (u) add(preview, h('img', { src: u, alt: '' })); }).catch(() => {});
    else add(preview, h('span', null, p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()));
    add(body, h('section', { class: 'cr-pc-sec cr-pc-top' }, preview, h('div', { class: 'stack stack-sm' },
      h('div', { class: 'cr-pc-name' }, p.name), h('div', { class: 'muted text-sm' }, [p.owner && `Played by ${p.owner}`, c ? 'From the Stone Wardens sheet' : 'Sheet not found'].filter(Boolean).join(' · ')),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: uploadArt }, 'Upload token art…'),
        raw.img ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { set({ img: null }); draw(); } }, c?.portrait ? 'Use the sheet portrait' : 'Use initials') : null))));
    // --- color & size ---
    add(body, h('section', { class: 'cr-pc-sec' },
      field('Token ring', h('div', { class: 'rg-swatches' }, ...COLORS.map((col) => h('button', { class: ['rg-swatch', p.accent === col && 'is-active'], type: 'button', style: { background: col }, 'aria-label': col, onclick: () => { set({ color: col }); draw(); } })),
        h('input', { type: 'color', class: 'rg-color', value: p.accent || '#22507c', 'aria-label': 'Custom color', oninput: (e) => later(() => set({ color: e.target.value })) }))),
      canHandlePc(charId)
        ? field('Size', sizeControl(p.size, (v) => { set({ size: v }); draw(); }),
          `From the sheet: ${c?.size || 'medium'}. Small and Medium both fill one 5-ft square; Custom draws the token any number of squares across (0.8, 1.5…).`)
        : field('Size', h('p', { class: 'muted text-sm' }, `${typeof p.size === 'number' ? `${p.size} squares` : p.size}. The DM sets it while your token is locked.`))));
    // --- hit points ---
    add(body, h('section', { class: 'cr-pc-sec' },
      h('h3', { class: 'cr-pc-h' }, 'Hit points and health bar'),
      ...hpBlock(() => prefs().hp, (hp) => { set({ hp: hp.max || hp.cur ? hp : null }); draw(); }),
      field('Other players see', segmented([{ value: 'numbers', label: 'Bar and HP' }, { value: 'bar', label: 'Bar only' }, { value: 'private', label: 'Nothing' }], p.hpShow, (v) => set({ hpShow: v })),
        'You and the DM always see your numbers. Optional: the sheet’s HP isn’t copied, so type it here or in the token menu. How bars look (place, thickness, color) is under Settings.')));
    // --- movement & ranges ---
    const ranges = raw.ranges || [{ id: 'move', label: 'Move', ft: null, on: true }];
    const rlist = h('div', { class: 'cr-ranges' });
    const saveRanges = (list) => set({ ranges: list });
    ranges.forEach((r, i) => {
      const isMove = r.id === 'move';
      add(rlist, h('div', { class: 'cr-range-row' },
        h('input', { type: 'checkbox', checked: r.on !== false, 'aria-label': 'Show', onchange: (e) => saveRanges(ranges.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x))) }),
        h('input', { class: 'input', value: r.label, 'aria-label': 'Name', disabled: isMove, onchange: (e) => saveRanges(ranges.map((x, j) => (j === i ? { ...x, label: e.target.value || 'Range' } : x))) }),
        h('input', { class: 'input input-number', type: 'number', min: 0, step: 5, value: r.ft ?? '', placeholder: isMove ? String(p.speed) : 'ft', 'aria-label': 'Feet', onchange: (e) => saveRanges(ranges.map((x, j) => (j === i ? { ...x, ft: e.target.value === '' ? null : Number(e.target.value) } : x))) }),
        h('span', { class: 'muted text-sm' }, 'ft'),
        h('input', { type: 'color', class: 'rg-color', value: r.color || p.accent || '#22507c', 'aria-label': 'Color', onchange: (e) => saveRanges(ranges.map((x, j) => (j === i ? { ...x, color: e.target.value } : x))) }),
        isMove ? h('span', { class: 'cr-range-x' }) : h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: () => { saveRanges(ranges.filter((_, j) => j !== i)); draw(); } }, icon('trash'))));
    });
    const addRange = select([{ value: '', label: 'Add a range…' }, ...PRESETS.map(([l, ft]) => ({ value: l, label: ft ? `${l} (${ft} ft)` : l === 'Dash' ? `Dash (${p.speed * 2} ft)` : l })), { value: '__custom', label: 'Custom…' }], '', (v) => {
      if (!v) return;
      const pre = PRESETS.find(([l]) => l === v);
      const ft = v === 'Dash' ? p.speed * 2 : pre?.[1] ?? 30;
      saveRanges([...ranges, { id: `r-${Date.now().toString(36)}`, label: v === '__custom' ? 'Range' : v, ft, on: true }]);
      draw();
    });
    add(body, h('section', { class: 'cr-pc-sec' },
      h('h3', { class: 'cr-pc-h' }, 'Movement and ranges'),
      field('Speed', h('div', { class: 'row row-nowrap' }, h('input', { class: 'input input-number', type: 'number', min: 0, step: 5, value: raw.speed ?? '', placeholder: String(c?.speed ?? 30), onchange: (e) => { set({ speed: e.target.value === '' ? null : Number(e.target.value) }); draw(); } }), h('span', { class: 'muted text-sm' }, 'ft')), `From the sheet: ${c?.speed ?? 30} ft. The Move circle follows it unless you type a number there.`),
      rlist, addRange,
      field('Show the circles', segmented([{ value: 'selected', label: 'When selected' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], p.showRanges, (v) => set({ showRanges: v })))));
    // --- vision ---
    const v = p.vision;
    const slider = (label, key, val, hint) => field(label, h('input', { type: 'range', min: 0, max: 100, value: val, class: 'cr-range', oninput: (e) => later(() => set({ vision: { ...(prefs().vision || {}), [key]: Number(e.target.value) } })) }), hint);
    add(body, h('section', { class: 'cr-pc-sec' },
      h('h3', { class: 'cr-pc-h' }, 'Darkvision'),
      field('Range', h('div', { class: 'row row-nowrap' }, h('input', { class: 'input input-number', type: 'number', min: 0, step: 5, value: raw.darkvision ?? '', placeholder: String(c?.darkvision ?? 0), onchange: (e) => { set({ darkvision: e.target.value === '' ? null : Number(e.target.value) }); draw(); } }), h('span', { class: 'muted text-sm' }, 'ft')), `From the sheet’s species: ${c?.darkvision ? `${c.darkvision} ft` : 'none'}. In dim or dark scenes you see this far, in fading gray.`),
      checkbox(!!v.show, (on) => set({ vision: { ...(prefs().vision || {}), show: on } }), 'Show my darkvision edge on the map'),
      slider('Edge softness', 'soft', v.soft ?? 45, 'How gradually the darkvision fades out at its edge.'),
      slider('Gray', 'gray', v.gray ?? 85, 'How colorless darkvision looks in darkness.'),
      slider('Dimness', 'dim', v.dim ?? 25, 'How dark it stays inside your darkvision.'),
      field('Tint', h('div', { class: 'row row-nowrap' },
        h('input', { type: 'color', class: 'rg-color', value: v.tint || '#3a5f8f', oninput: (e) => later(() => set({ vision: { ...(prefs().vision || {}), tint: e.target.value } })) }),
        h('input', { type: 'range', min: 0, max: 60, value: v.tintStrength ?? 0, class: 'cr-range', 'aria-label': 'Tint strength', oninput: (e) => later(() => set({ vision: { ...(prefs().vision || {}), tintStrength: Number(e.target.value), tint: prefs().vision?.tint || '#3a5f8f' } })) })), 'A faint color over what you see in the dark (0 = none).'),
      field('Light you carry', lightSelect(p.light, (l) => set({ light: l })))));
  }

  async function uploadArt() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const out = await cropDialog(file, { title: 'Token art', circle: true, out: 512 });
      if (!out) return;
      toast('Uploading your token…');
      const ref = await uploadPlain(out, `tokens/${safeKeyPart(charId)}`);
      set({ img: ref });
      draw();
      toast('Token art saved.', { type: 'success' });
    } catch (e) { toast(`Could not use that image: ${e.message}`, { type: 'error' }); }
  }

  draw();
  openModal({ title: `${pcProfile(charId)?.name || 'Character'} · token`, body, wide: true, className: 'modal-pc', actions: [{ label: 'Done', kind: 'primary' }] });
}

