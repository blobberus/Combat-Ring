// Custom creatures (cre.<id> in the DM room): a stat block form with a live preview, token art (upload, a bestiary
// token, or a URL), and "start from a bestiary creature" to copy its numbers and text as a base.
import { h, clear, add, mount } from '../../core/dom.js';
import { openModal, field, toast, pickFile, pickFromList, select, confirmDialog } from '../../core/ui.js';
import { world } from '../world.js';
import { K, newId, SIZE_NAMES } from '../model.js';
import { addMedia, mediaUrl } from '../media.js';
import { cropDialog } from './crop.js';
import { statBlock, loadIndex, search, fetchMonster, plainEntries, tokenUrls, sizeOf, ABILITIES, sourceName } from '../bestiary.js';

const BLOCKS = [['traits', 'Traits'], ['actions', 'Actions'], ['bonus', 'Bonus actions'], ['reactions', 'Reactions'], ['legendary', 'Legendary actions']];

const toText = (list) => (list || []).map((t) => (t.name ? `${t.name}. ${t.text || ''}` : t.text || '')).join('\n\n');
function fromText(s) {
  return String(s || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^([^.\n]{1,60})\.\s+([\s\S]*)$/.exec(p);
    return m ? { name: m[1].trim(), text: m[2].trim() } : { name: '', text: p };
  });
}

export function openCreatureEditor(id = null, { onSaved } = {}) {
  const existing = id ? world.d(K.cre(id)) : null;
  const c = structuredClone(existing || { name: 'New creature', size: 'medium', type: 'humanoid', alignment: '', cr: '1', ac: 12, hp: 11, hpFormula: '2d8+2', speed: '30 ft.', abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, disp: 'enemy', traits: [], actions: [] });
  const preview = h('div', { class: 'cr-ce-preview' });
  const art = h('div', { class: 'cr-ce-art' });
  const form = h('div', { class: 'cr-ce-form' });
  let dirty = false;

  const drawPreview = () => {
    mount(preview, statBlock({ ...c, hp: Number(c.hp) || 0, size: c.size ? c.size[0].toUpperCase() + c.size.slice(1) : '' }));
  };
  const drawArt = async () => {
    clear(art);
    const src = c.media || c.img || c.tokens?.[0];
    if (src) { const u = await mediaUrl(src).catch(() => null); if (u) add(art, h('img', { src: u, alt: '' })); }
    else add(art, h('span', null, (c.name || '?').slice(0, 1).toUpperCase()));
  };
  const set = (k, v) => { c[k] = v; dirty = true; drawPreview(); };
  const text = (label, k, props = {}) => field(label, h('input', { class: 'input', value: c[k] ?? '', ...props, oninput: (e) => set(k, e.target.value) }));
  const num = (label, k) => field(label, h('input', { class: 'input input-number', type: 'number', value: c[k] ?? '', oninput: (e) => set(k, e.target.value === '' ? null : Number(e.target.value)) }));

  function drawForm() {
    clear(form);
    add(form, 
      h('div', { class: 'cr-ce-top' }, art, h('div', { class: 'stack stack-sm' },
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: uploadArt }, 'Upload art…'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: bestiaryArt }, 'Bestiary token…'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: urlArt }, 'Image URL…')),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: startFrom }, 'Start from a bestiary creature…'))),
      h('div', { class: 'field-grid' },
        text('Name', 'name'),
        field('Size', select(SIZE_NAMES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })), c.size || 'medium', (v) => set('size', v))),
        text('Type', 'type', { placeholder: 'beast, undead (zombie)…' }),
        text('Alignment', 'alignment'),
        text('Challenge rating', 'cr'),
        field('Side', select([{ value: 'enemy', label: 'Enemy' }, { value: 'ally', label: 'Companion' }, { value: 'neutral', label: 'Neutral' }], c.disp || 'enemy', (v) => set('disp', v))),
        num('Armor class', 'ac'), text('AC note', 'acNote', { placeholder: 'natural armor' }),
        num('Hit points', 'hp'), text('HP dice', 'hpFormula', { placeholder: '4d8+4' }),
        text('Speed', 'speed', { placeholder: '30 ft., fly 60 ft.' })),
      h('div', { class: 'cr-ce-abil' }, ABILITIES.map((a) => field(a.toUpperCase(), h('input', { class: 'input input-number', type: 'number', value: c.abilities?.[a] ?? 10, oninput: (e) => { c.abilities = { ...(c.abilities || {}), [a]: Number(e.target.value) || 10 }; dirty = true; drawPreview(); } })))),
      h('div', { class: 'field-grid' },
        text('Saving throws', 'saves', { placeholder: 'Dex +5, Wis +3' }), text('Skills', 'skills', { placeholder: 'Stealth +6' }),
        text('Resistances', 'resist'), text('Immunities', 'immune'),
        text('Senses', 'senses', { placeholder: 'darkvision 60 ft., passive Perception 12' }), text('Languages', 'languages')),
      ...BLOCKS.map(([k, label]) => field(label, h('textarea', { class: 'textarea', rows: k === 'traits' || k === 'actions' ? 4 : 2, value: toText(c[k]), placeholder: 'Name. What it does…  (blank line between entries)', oninput: (e) => set(k, fromText(e.target.value)) }))),
      field('DM notes', h('textarea', { class: 'textarea', rows: 2, value: c.notes || '', oninput: (e) => set('notes', e.target.value) })));
  }

  async function uploadArt() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const out = await cropDialog(file, { title: 'Creature art', circle: true, out: 512 });
      if (!out) return;
      const mid = await addMedia(out, { name: `${c.name} token`, kind: 'token' });
      Object.assign(c, { media: mid, img: null, tokens: null });
      dirty = true;
      drawArt();
    } catch (e) { toast(`Could not use that image: ${e.message}`, { type: 'error' }); }
  }

  async function bestiaryArt() {
    const m = await pickCreature('Use the token of…');
    if (!m) return;
    Object.assign(c, { tokens: tokenUrls(m), media: null, img: null });
    dirty = true;
    drawArt();
  }

  async function urlArt() {
    const { promptDialog } = await import('../../core/ui.js');
    const u = await promptDialog('Image URL', { label: 'A PNG, WebP, JPG or GIF on the web', value: c.img || '', placeholder: 'https://…' });
    if (u == null) return;
    Object.assign(c, { img: u.trim() || null, media: null, tokens: null });
    dirty = true;
    drawArt();
  }

  async function startFrom() {
    const m = await pickCreature('Start from…');
    if (!m) return;
    if (dirty && !(await confirmDialog('Replace what you have typed with this creature’s stat block?', { okLabel: 'Replace' }))) return;
    try {
      const full = await fetchMonster(m);
      Object.assign(c, {
        name: c.name === 'New creature' ? `${m.name} (variant)` : c.name, size: sizeOf(m), type: m.type, cr: m.cr, ac: m.ac, hp: m.hp, hpFormula: m.hpf,
        speed: m.speed, abilities: { ...m.abilities }, tokens: c.media || c.img ? c.tokens : tokenUrls(m),
        saves: Object.entries(full.save || {}).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v}`).join(', '),
        skills: Object.entries(full.skill || {}).filter(([k]) => k !== 'other').map(([k, v]) => `${k.replace(/\b\w/g, (x) => x.toUpperCase())} ${v}`).join(', '),
        senses: [...(full.senses || []), full.passive != null ? `passive Perception ${full.passive}` : ''].filter(Boolean).join(', ').replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1'),
        languages: (full.languages || []).join(', '),
        traits: plainEntries(full.trait), actions: plainEntries(full.action), bonus: plainEntries(full.bonus), reactions: plainEntries(full.reaction), legendary: plainEntries(full.legendary),
      });
      dirty = true;
      drawForm();
      drawPreview();
      drawArt();
    } catch (e) { toast(`Could not read ${m.name}: ${e.message}`, { type: 'error' }); }
  }

  drawForm();
  drawPreview();
  drawArt();
  openModal({
    title: existing ? `Edit ${existing.name}` : 'New creature',
    wide: true,
    className: 'modal-creature',
    body: h('div', { class: 'cr-ce' }, form, preview),
    beforeClose: async () => !dirty || confirmDialog('Close without saving this creature?', { okLabel: 'Discard', danger: true }),
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: async () => (!dirty || (await confirmDialog('Discard your changes?', { okLabel: 'Discard', danger: true }))) },
      {
        label: 'Save creature', kind: 'primary', onClick: () => {
          if (!String(c.name || '').trim()) { toast('Give it a name.'); return false; }
          const cid = id || newId('cre');
          world.dPut(K.cre(cid), { ...c, name: c.name.trim(), updated: Date.now() }, { undo: true, label: 'creature' });
          dirty = false;
          toast(`${c.name} saved. Find it under Creatures → Custom.`, { type: 'success' });
          onSaved?.(cid);
          return true;
        },
      },
    ],
  });
}

export async function pickCreature(title = 'Pick a creature') {
  const idx = await loadIndex();
  return pickFromList({
    title,
    items: idx,
    search: (m) => m.key,
    render: (m) => h('div', { class: 'picker-item-main' }, h('span', { class: 'picker-item-title' }, m.name), h('span', { class: 'muted' }, `${m.type || ''} · CR ${m.cr || '—'} · ${sourceName(m.src)}`)),
  }).then((m) => m || null).catch(() => null);
}

export { search };
