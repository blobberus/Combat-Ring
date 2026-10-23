// Creatures: the committed index (data/bestiary.json, tools/build_bestiary.py) for search and token defaults, the
// 5etools token art, and full stat blocks read from the 5etools mirror at runtime (cached on this device).
import { config } from '../core/auth.js';
import { kv, safe } from '../core/idb.js';
import { h } from '../core/dom.js';
import { escapeHtml } from '../core/util.js';
import { SIZE_FROM_LETTER, crValue, abilityMod, fmtMod } from './model.js';

const fileCache = safe(kv('cr-5etools', 'files')); // url -> {at, json}
const FILE_TTL = 7 * 864e5;
let index = null;
let indexP = null;
let sources = {};
let fileIndex = null;

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** -> [{id, name, src, size, type, cr, crNum, ac, hp, hpf, speed, abilities, flags, token, page, alias, key}] */
export function loadIndex() {
  if (index) return Promise.resolve(index);
  if (!indexP) {
    indexP = fetch(config.bestiary.index).then((r) => r.json()).then((d) => {
      const c = Object.fromEntries(d.cols.map((n, i) => [n, i]));
      sources = d.sources || {};
      index = d.rows.map((r) => {
        const m = {
          name: r[c.name], src: r[c.src], size: r[c.size], type: r[c.type], cr: r[c.cr], ac: r[c.ac], hp: r[c.hp], hpf: r[c.hpf],
          speed: r[c.speed], flags: r[c.flags] || '', tokenName: r[c.token] || r[c.name], page: r[c.page], alias: r[c.alias] || [],
          abilities: Object.fromEntries(ABILITIES.map((a) => [a, r[c[a]] ?? null])),
        };
        m.id = `${m.src}|${m.name}`;
        m.crNum = crValue(m.cr);
        m.key = `${m.name} ${m.alias.join(' ')} ${m.type} ${m.src}`.toLowerCase();
        return m;
      });
      return index;
    }).catch((e) => { indexP = null; throw e; });
  }
  return indexP;
}

export const sourceName = (code) => sources[code] || code;
export const sourceList = () => Object.entries(sources).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
export const hasToken = (m) => m.flags.includes('t');
export const isSrd = (m) => m.flags.includes('s');

/** First-letter size -> our size name (largest when a creature can be more than one). */
export function sizeOf(m) {
  const letters = String(m.size || 'M').split('/');
  return SIZE_FROM_LETTER[letters[letters.length - 1]] || 'medium';
}

/** Token art URLs, best first (the <img> falls back through them). */
export function tokenUrls(m) {
  if (!m || !hasToken(m)) return [];
  const file = `${encodeURIComponent(m.src)}/${encodeURIComponent(m.tokenName || m.name)}.webp`;
  return (config.bestiary.tokens || []).map((base) => base + file);
}

/** Search the index. filters: {crMin, crMax, type, size, src, srd} -> up to `limit` matches, best first. */
export function search(q, filters = {}, limit = 200) {
  if (!index) return [];
  const term = String(q || '').trim().toLowerCase();
  const words = term.split(/\s+/).filter(Boolean);
  const out = [];
  for (const m of index) {
    if (filters.srd && !isSrd(m)) continue;
    if (filters.src && m.src !== filters.src) continue;
    if (filters.type && !String(m.type).toLowerCase().startsWith(filters.type)) continue;
    if (filters.size && sizeOf(m) !== filters.size) continue;
    if (filters.crMin != null && (m.crNum == null || m.crNum < filters.crMin)) continue;
    if (filters.crMax != null && (m.crNum == null || m.crNum > filters.crMax)) continue;
    if (words.length && !words.every((w) => m.key.includes(w))) continue;
    const name = m.name.toLowerCase();
    const score = !term ? 0 : name === term ? 0 : name.startsWith(term) ? 1 : name.includes(term) ? 2 : 3;
    out.push([score, m]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name) || (a[1].src === 'XMM' ? -1 : b[1].src === 'XMM' ? 1 : 0));
  return out.slice(0, limit).map((x) => x[1]);
}

export const TYPES = ['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'];

/** The numbers kept on a placed creature (also what players see when the DM shows its stats). */
export function statsFromIndex(m) {
  return {
    ref: { src: m.src, name: m.name },
    size: sizeOf(m), type: m.type, cr: m.cr, ac: m.ac, speed: m.speed, abilities: m.abilities,
  };
}

// ---------- full stat blocks from the mirror ----------

async function cachedJson(url) {
  const hit = await fileCache.get(url);
  if (hit && Date.now() - hit.at < FILE_TTL) return hit.json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    fileCache.set(url, { at: Date.now(), json });
    return json;
  } catch (e) {
    if (hit) return hit.json; // stale but better than nothing (offline)
    throw e;
  }
}

async function fileFor(src) {
  if (!fileIndex) fileIndex = await cachedJson(`${config.bestiary.data}index.json`);
  const name = fileIndex[src] || Object.entries(fileIndex).find(([k]) => k.toLowerCase() === String(src).toLowerCase())?.[1];
  if (!name) throw new Error(`No bestiary file for ${src}`);
  return cachedJson(config.bestiary.data + name);
}

async function findMonster(src, name) {
  const file = await fileFor(src);
  const n = String(name).toLowerCase();
  return (file.monster || []).find((m) => m.name.toLowerCase() === n && m.source.toLowerCase() === String(src).toLowerCase()) || null;
}

function walkStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => walkStrings(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'name' && typeof x === 'string' ? x : walkStrings(x, fn)]));
  return v;
}

const namesOf = (r) => (Array.isArray(r) ? r : [r]).map((x) => (typeof x === 'object' ? x.name : x));

function applyMod(out, prop, op) {
  if (!op || typeof op !== 'object') return;
  const arr = () => { if (!Array.isArray(out[prop])) out[prop] = []; return out[prop]; };
  const items = op.items == null ? [] : Array.isArray(op.items) ? op.items : [op.items];
  switch (op.mode) {
    case 'appendArr': arr().push(...items); break;
    case 'prependArr': arr().unshift(...items); break;
    case 'insertArr': arr().splice(op.index ?? 0, 0, ...items); break;
    case 'appendIfNotExistsArr': for (const it of items) if (!arr().some((x) => JSON.stringify(x) === JSON.stringify(it))) arr().push(it); break;
    case 'removeArr': { const rm = new Set(namesOf(op.names ?? op.items)); out[prop] = arr().filter((x) => !rm.has(typeof x === 'object' ? x.name : x)); break; }
    case 'replaceArr':
    case 'replaceOrAppendArr': {
      const a = arr();
      const target = typeof op.replace === 'object' ? op.replace.index : op.replace;
      const i = typeof target === 'number' ? target : a.findIndex((x) => (typeof x === 'object' ? x.name : x) === target);
      if (i >= 0) a.splice(i, 1, ...items); else if (op.mode === 'replaceOrAppendArr') a.push(...items);
      break;
    }
    case 'replaceTxt': {
      const re = new RegExp(op.replace, op.flags || 'g');
      const re2 = op.flags?.includes('g') ? re : new RegExp(op.replace, `${op.flags || ''}g`);
      const fn = (s) => s.replace(re2, op.with ?? '');
      if (prop === '*') for (const k of ['trait', 'action', 'bonus', 'reaction', 'legendary', 'mythic', 'spellcasting']) { if (out[k]) out[k] = walkStrings(out[k], fn); }
      else if (out[prop]) out[prop] = walkStrings(out[prop], fn);
      break;
    }
    case 'scalarAddProp': if (typeof out[prop] === 'number') out[prop] += Number(op.scalar) || 0; break;
    case 'addSenses': out.senses = [...(out.senses || []), ...(Array.isArray(op.senses) ? op.senses : [op.senses]).map((s) => `${s.type} ${s.range} ft.`)]; break;
    case 'addSkills': out.skill = { ...(out.skill || {}), ...Object.fromEntries(Object.keys(op.skills || {}).map((k) => [k, '+?'])) }; break;
    default: break; // other generator modes are rare; the copied stat block stays readable without them
  }
}

async function resolveCopy(m, depth = 0) {
  if (!m?._copy || depth > 5) return m;
  const c = m._copy;
  const base = await resolveCopy(await findMonster(c.source, c.name), depth + 1);
  if (!base) return m;
  const out = structuredClone(Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith('_'))));
  for (const [k, v] of Object.entries(m)) if (k !== '_copy') out[k] = v;
  for (const [prop, ops] of Object.entries(c._mod || {})) for (const op of Array.isArray(ops) ? ops : [ops]) applyMod(out, prop, typeof op === 'string' ? { mode: op } : op);
  return out;
}

/** The full 5etools creature (with _copy resolved) for an index entry or {src, name}. */
export async function fetchMonster(ref) {
  const m = await findMonster(ref.src, ref.name);
  if (!m) throw new Error(`${ref.name} is not in the bestiary`);
  return resolveCopy(m);
}

// ---------- rendering 5etools text ----------

const ATK = { mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:' };
const ATKR = { m: 'Melee Attack Roll:', r: 'Ranged Attack Roll:', 'm,r': 'Melee or Ranged Attack Roll:' };
const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/** 5etools {@tag …} markup -> safe HTML. */
export function renderTags(s) {
  let out = '';
  let i = 0;
  const str = String(s ?? '');
  while (i < str.length) {
    const j = str.indexOf('{@', i);
    if (j < 0) { out += escapeHtml(str.slice(i)); break; }
    out += escapeHtml(str.slice(i, j));
    let depth = 0, k = j;
    for (; k < str.length; k++) {
      if (str[k] === '{') depth++;
      else if (str[k] === '}') { depth--; if (!depth) break; }
    }
    const inner = str.slice(j + 2, k);
    i = k + 1;
    const sp = inner.indexOf(' ');
    const tag = sp < 0 ? inner : inner.slice(0, sp);
    const body = sp < 0 ? '' : inner.slice(sp + 1);
    const text = body.split('|')[0];
    const parts = body.split('|');
    switch (tag) {
      case 'atk': out += `<em>${escapeHtml(ATK[text] || 'Attack:')}</em>`; break;
      case 'atkr': out += `<em>${escapeHtml(ATKR[text] || 'Attack Roll:')}</em>`; break;
      case 'h': out += '<em>Hit:</em> '; break;
      case 'm': out += '<em>Miss:</em> '; break;
      case 'hom': out += '<em>Hit or Miss:</em> '; break;
      case 'hit': out += escapeHtml(`${Number(text) >= 0 ? '+' : ''}${text}`); break;
      case 'dc': out += `DC ${escapeHtml(text)}`; break;
      case 'recharge': out += `(Recharge ${escapeHtml(text ? `${text}–6` : '6')})`; break;
      case 'actSave': out += `<em>${escapeHtml(ABIL[text] || text)} Saving Throw:</em>`; break;
      case 'actSaveFail': out += `<em>${text ? `${escapeHtml(text)} ` : ''}Failure:</em>`; break;
      case 'actSaveSuccess': out += '<em>Success:</em>'; break;
      case 'actSaveSuccessOrFail': out += '<em>Failure or Success:</em>'; break;
      case 'actTrigger': out += '<em>Trigger:</em>'; break;
      case 'actResponse': out += '<em>Response:</em>'; break;
      case 'hitYourSpellAttack': out += 'your spell attack modifier'; break;
      case 'b': case 'bold': out += `<strong>${renderTags(body)}</strong>`; break;
      case 'i': case 'italic': out += `<em>${renderTags(body)}</em>`; break;
      case 'note': out += `<em>${renderTags(body)}</em>`; break;
      case 'chance': out += escapeHtml(parts[1] || `${text} percent`); break;
      case 'damage': case 'dice': case 'd20': case 'scaledice': case 'scaledamage': out += escapeHtml(tag === 'd20' ? fmtMod(Number(text) || 0) : (parts[tag.startsWith('scale') ? 1 : 0] || text)); break;
      default: out += escapeHtml(parts.length > 2 && parts[2] ? parts[2] : text); break;
    }
  }
  return out;
}

function entriesHtml(entries) {
  return (entries || []).map((e) => {
    if (typeof e === 'string') return `<p>${renderTags(e)}</p>`;
    if (!e || typeof e !== 'object') return '';
    if (e.type === 'list') return `<ul>${(e.items || []).map((it) => `<li>${typeof it === 'string' ? renderTags(it) : `${it.name ? `<strong>${renderTags(it.name)}.</strong> ` : ''}${renderTags(it.entry || '')}${entriesHtml(it.entries).replace(/^<p>|<\/p>$/g, '')}`}</li>`).join('')}</ul>`;
    if (e.type === 'table') return `<table class="table table-dense"><thead><tr>${(e.colLabels || []).map((c) => `<th>${renderTags(c)}</th>`).join('')}</tr></thead><tbody>${(e.rows || []).map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'string' ? renderTags(c) : renderTags(c?.roll ? `${c.roll.exact ?? `${c.roll.min}–${c.roll.max}`}` : '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (e.entries) return `${e.name ? `<p><strong>${renderTags(e.name)}.</strong></p>` : ''}${entriesHtml(e.entries)}`;
    if (e.entry) return `<p>${renderTags(e.entry)}</p>`;
    return '';
  }).join('');
}

function blockHtml(list) {
  return (list || []).map((t) => {
    const body = entriesHtml(t.entries);
    const name = t.name ? `<strong><em>${renderTags(t.name)}.</em></strong> ` : '';
    return body.startsWith('<p>') ? body.replace('<p>', `<p>${name}`) : `<p>${name}</p>${body}`;
  }).join('');
}

function spellcastingHtml(list) {
  return (list || []).map((sc) => {
    let s = `${entriesHtml(sc.headerEntries).replace('<p>', `<p><strong><em>${renderTags(sc.name || 'Spellcasting')}.</em></strong> `)}`;
    const lines = [];
    if (sc.will) lines.push(`At will: ${sc.will.map(renderTags).join(', ')}`);
    for (const [k, v] of Object.entries(sc.daily || {})) lines.push(`${k.replace('e', '')}/day${k.endsWith('e') ? ' each' : ''}: ${v.map(renderTags).join(', ')}`);
    for (const [lvl, v] of Object.entries(sc.spells || {})) lines.push(`${lvl === '0' ? 'Cantrips (at will)' : `Level ${lvl}${v.slots != null ? ` (${v.slots} slot${v.slots === 1 ? '' : 's'})` : ''}`}: ${(v.spells || []).map(renderTags).join(', ')}`);
    if (lines.length) s += `<ul class="cr-spells">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
    s += entriesHtml(sc.footerEntries);
    return s;
  }).join('');
}

const listText = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.special || [x?.resist, x?.immune, x?.vulnerable, x?.conditionImmune].flat().filter(Boolean).join(', ') + (x?.note ? ` ${x.note}` : ''))).join('; ') : v || '');

function acText(ac) {
  return (ac || []).map((a) => (typeof a === 'number' ? String(a) : a?.special ? a.special : `${a.ac}${a.from ? ` (${a.from.map((f) => f.replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1')).join(', ')})` : ''}${a.condition ? ` ${a.condition.replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1')}` : ''}`)).join(', ');
}

function speedText(sp) {
  if (!sp || typeof sp !== 'object') return sp ? `${sp} ft.` : '';
  return ['walk', 'burrow', 'climb', 'fly', 'swim'].filter((k) => sp[k] != null).map((k) => {
    const v = sp[k];
    const n = typeof v === 'object' ? `${v.number} ft.${v.condition ? ` ${v.condition}` : ''}` : `${v} ft.`;
    return k === 'walk' ? n : `${k} ${n}${k === 'fly' && sp.canHover ? ' (hover)' : ''}`;
  }).join(', ');
}

const typeText = (t) => (typeof t === 'string' ? t : t ? `${t.type?.choose ? t.type.choose.join(' or ') : t.type || ''}${t.tags ? ` (${t.tags.map((x) => (typeof x === 'string' ? x : x.tag)).join(', ')})` : ''}` : '');
const ALIGN = { L: 'lawful', N: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any alignment' };
const alignText = (a) => (Array.isArray(a) ? a.map((x) => (typeof x === 'string' ? ALIGN[x] || x : x?.special || '')).join(' ') : '');

/**
 * A stat block element. src: a 5etools creature (full) or our custom creature / stats object
 * ({name, size, type, alignment, cr, ac, hp: {cur?, max} | number, hpFormula, speed, abilities, traits: [{name, text}], …}).
 */
export function statBlock(src, { title = null } = {}) {
  const el = h('article', { class: 'cr-stat' });
  if (!src) return el;
  const is5e = !!src.source && (src.str != null || src.action || src.trait);
  const name = title || src.name || 'Creature';
  const size = is5e ? (src.size || []).map((l) => SIZE_FROM_LETTER[l] || l).join(' or ') : src.size || '';
  const type = is5e ? typeText(src.type) : src.type || '';
  const align = is5e ? alignText(src.alignment) : src.alignment || '';
  const ac = is5e ? acText(src.ac) : src.ac != null ? `${src.ac}${src.acNote ? ` (${src.acNote})` : ''}` : '';
  const hpv = is5e ? (src.hp?.average != null ? `${src.hp.average} (${src.hp.formula})` : src.hp?.special || '') : hpText(src);
  const speed = is5e ? speedText(src.speed) : src.speed || '';
  const ab = Object.fromEntries(ABILITIES.map((a) => [a, is5e ? src[a] : src.abilities?.[a]]));
  const cr = is5e ? (typeof src.cr === 'object' ? src.cr?.cr : src.cr) : src.cr;
  const lines = [];
  const add = (label, v) => { if (v) lines.push(`<p><strong>${label}</strong> ${v}</p>`); };
  if (is5e) {
    add('Saving Throws', escapeHtml(Object.entries(src.save || {}).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v}`).join(', ')));
    add('Skills', escapeHtml(Object.entries(src.skill || {}).filter(([k]) => k !== 'other').map(([k, v]) => `${k.replace(/\b\w/g, (c) => c.toUpperCase())} ${v}`).join(', ')));
    add('Vulnerabilities', escapeHtml(listText(src.vulnerable)));
    add('Resistances', escapeHtml(listText(src.resist)));
    add('Immunities', escapeHtml([listText(src.immune), listText(src.conditionImmune)].filter(Boolean).join('; ')));
    add('Senses', renderTags([...(src.senses || []), src.passive != null ? `passive Perception ${src.passive}` : ''].filter(Boolean).join(', ')));
    add('Languages', renderTags((src.languages || []).join(', ') || '—'));
  } else {
    for (const [label, key] of [['Saving Throws', 'saves'], ['Skills', 'skills'], ['Resistances', 'resist'], ['Immunities', 'immune'], ['Senses', 'senses'], ['Languages', 'languages']]) add(label, escapeHtml(src[key] || ''));
  }
  if (cr != null && cr !== '') add('Challenge', escapeHtml(String(cr)));
  const head = `
    <header class="cr-stat-head"><h3 class="cr-stat-name">${escapeHtml(name)}</h3>
    <p class="cr-stat-meta">${escapeHtml([size, type].filter(Boolean).join(' '))}${align ? `, ${escapeHtml(align)}` : ''}</p></header>
    <div class="cr-stat-core">${ac ? `<p><strong>AC</strong> ${escapeHtml(ac)}</p>` : ''}${hpv ? `<p><strong>HP</strong> ${escapeHtml(hpv)}</p>` : ''}${speed ? `<p><strong>Speed</strong> ${escapeHtml(speed)}</p>` : ''}</div>`;
  const abil = ABILITIES.some((a) => ab[a] != null) ? `<table class="cr-stat-abil"><tr>${ABILITIES.map((a) => `<th>${a.toUpperCase()}</th>`).join('')}</tr><tr>${ABILITIES.map((a) => `<td class="num">${ab[a] ?? '—'}${ab[a] != null ? ` <span class="muted">(${fmtMod(abilityMod(ab[a]))})</span>` : ''}</td>`).join('')}</tr></table>` : '';
  let body = '';
  if (is5e) {
    body += blockHtml(src.trait) + spellcastingHtml((src.spellcasting || []).filter((s) => !s.displayAs || s.displayAs === 'trait'));
    const section = (label, list, extra = '') => (list?.length || extra ? `<h4 class="cr-stat-sec">${label}</h4>${blockHtml(list)}${extra}` : '');
    body += section('Actions', src.action, spellcastingHtml((src.spellcasting || []).filter((s) => s.displayAs === 'action')));
    body += section('Bonus Actions', src.bonus, spellcastingHtml((src.spellcasting || []).filter((s) => s.displayAs === 'bonus')));
    body += section('Reactions', src.reaction);
    body += section('Legendary Actions', src.legendary, src.legendaryHeader ? '' : '');
    body += section('Mythic Actions', src.mythic);
  } else {
    const sec = (label, list) => (list?.length ? `<h4 class="cr-stat-sec">${label}</h4>${list.map((t) => `<p>${t.name ? `<strong><em>${escapeHtml(t.name)}.</em></strong> ` : ''}${escapeHtml(t.text || '').replace(/\n/g, '<br>')}</p>`).join('')}` : '');
    body += sec('', src.traits).replace('<h4 class="cr-stat-sec"></h4>', '') + sec('Actions', src.actions) + sec('Bonus Actions', src.bonus) + sec('Reactions', src.reactions) + sec('Legendary Actions', src.legendary);
    if (src.notes) body += `<p class="muted">${escapeHtml(src.notes).replace(/\n/g, '<br>')}</p>`;
  }
  el.innerHTML = head + abil + (lines.length ? `<div class="cr-stat-props">${lines.join('')}</div>` : '') + (body ? `<div class="cr-stat-body">${body}</div>` : '');
  return el;
}

function hpText(src) {
  const hp = src.hp;
  if (hp == null) return '';
  if (typeof hp === 'number') return `${hp}${src.hpFormula ? ` (${src.hpFormula})` : ''}`;
  const max = hp.max ?? hp.average;
  const cur = hp.cur;
  return cur != null && cur !== max ? `${cur} / ${max}${hp.temp ? ` (+${hp.temp} temp)` : ''}` : `${max ?? '—'}${src.hpFormula ? ` (${src.hpFormula})` : ''}`;
}

/** Plain-text traits/actions from a 5etools creature (to start a custom creature from it). */
export function plainEntries(list) {
  const strip = (s) => renderTags(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return (list || []).map((t) => ({ name: t.name ? strip(t.name) : '', text: (t.entries || []).map((e) => (typeof e === 'string' ? strip(e) : e?.items ? e.items.map((x) => (typeof x === 'string' ? strip(x) : `${x.name || ''} ${strip(x.entry || '')}`)).join('\n') : '')).join('\n') }));
}
