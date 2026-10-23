// The table's shell (Owlbear-style): the board fills the screen; the top bar (scene), the top-right status and people,
// the tool rail on the left, zoom bottom-left, the DM bar bottom-center and the side panel on the right float over it.
import { h, clear, add, mount } from '../core/dom.js';
import { icon, toast, segmented } from '../core/ui.js';
import { getSetting, setSetting, onSetting } from '../core/settings.js';
import { config } from '../core/auth.js';
import { world, me } from './world.js';
import { ui, setUi, onUi, clearSelection, parseKey } from './state.js';
import { createBoard, isTyping } from './board.js';
import { buildView, dmScenes, dmViewingId, previewing, playersSee, playersSeeLine } from './view.js';
import { handleTool, setToolHooks, setCurrentView, finishPoly, cancelPoly, polyActive, ping } from './tools.js';
import * as A from './actions.js';
import { presence, startPresence, announce } from './presence.js';
import { onDm } from './dm.js';
import { openMenu, closeMenu, refreshMenu, openDetails, openPinEditor } from './menu.js';
import { createPanel } from './panels/index.js';
import { createSlideshow } from './slideshow.js';
import { dmLoginDialog, dmMenu, settingsDialog, identityDialog } from './dialogs.js';
import { saveNow, onSaveState, saveState } from './persist.js';
import { party } from './characters.js';
import { cellPx, K } from './model.js';
import { mediaUrl } from './media.js';
import { repo } from '../core/repo.js';

let board = null;

export function getBoard() { return board; }

export function mountRing(app, { sandbox = false } = {}) {
  const stage = h('div', { class: 'rg-stage' });
  const boardEl = h('div');
  add(stage, boardEl);
  add(app, stage);
  app.classList.toggle('reduce-motion', !!getSetting('reduceMotion'));

  let zoom = null; // the zoom box (created below; the board reports its first transform before that)
  board = createBoard(boardEl, {
    onTool: (type, ctx) => handleTool(type, ctx),
    onHover: (e) => tip(e),
    onViewChange: () => { refreshMenu(); zoomLabel(); },
  });
  board.setTool(ui.tool);

  // ---------- top left: brand + scene ----------
  const sceneBtn = h('button', { class: 'btn btn-ghost btn-sm rg-scene-btn', type: 'button', onclick: (e) => scenePicker(e.currentTarget) });
  const liveBadge = h('span', { class: 'rg-live-badge' });
  const top = h('header', { class: 'rg-top rg-float' },
    h('a', { class: 'rg-brand', href: config.stoneWardens || '../Stone-Wardens/', title: 'Open the Stone Wardens codex' },
      h('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true' }, h('use', { href: 'assets/img/icons.svg#i-emblem' })),
      h('span', { class: 'rg-brand-name' }, 'Combat Ring')),
    h('span', { class: 'divider-v' }), sceneBtn, liveBadge);

  // ---------- top right: status, people, DM, settings ----------
  const status = h('span', { class: 'rg-status', 'data-state': 'connecting', title: '' }, h('span', { class: 'rg-dot' }), h('span', { class: 'rg-status-text' }, 'Connecting…'));
  const people = h('div', { class: 'rg-people' });
  const dmBtn = h('button', { class: 'btn btn-ghost btn-sm rg-dm-badge', type: 'button', onclick: (e) => (world.dm ? dmMenu(e.currentTarget) : dmLoginDialog()) }, icon('dm'), h('span', null, 'DM'));
  const gear = h('button', { class: 'btn-icon', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => settingsDialog() }, icon('settings'));
  const topright = h('div', { class: 'rg-topright rg-float' }, status, people, dmBtn, gear);

  // ---------- tools ----------
  const toolsEl = h('nav', { class: 'rg-tools rg-float', 'aria-label': 'Tools' });
  const sub = h('div', { class: 'rg-subtools rg-float', hidden: true });
  zoom = h('div', { class: 'rg-zoom rg-float' },
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => board.zoomBy(1 / 1.25) }, icon('minus')),
    h('span', { class: 'rg-zoom-level num' }, '100%'),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => board.zoomBy(1.25) }, icon('plus')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Fit the map (0)', 'aria-label': 'Fit the map', onclick: () => board.fit() }, icon('fit')));
  const dmbar = h('div', { class: 'rg-dmbar rg-float', hidden: true });
  const placingBar = h('div', { class: 'rg-placing rg-float', hidden: true });
  const banner = h('div', { class: 'rg-banner rg-float', hidden: true });
  const tipEl = h('div', { class: 'rg-tip', hidden: true });
  add(stage, top, banner, topright, toolsEl, sub, zoom, dmbar, placingBar);
  add(document.body, tipEl);

  const show = createSlideshow(stage);
  const panel = createPanel(app, { board });
  app.classList.toggle('has-panel', panel.isOpen());

  // ---------- rendering ----------
  let view = null;
  function render() {
    view = buildView();
    setCurrentView(view);
    board.render(view);
    board.root.classList.toggle('is-placing', !!ui.placing);
    renderTop();
    renderBanner();
    renderDmBar();
    renderPlacing();
    refreshMenu(view);
    show.update();
  }
  world.on((p) => { render(); panel.refresh(p); });
  onUi((patch) => {
    if ('tool' in patch || 'fogShape' in patch || 'fogMode' in patch) { board.setTool(ui.tool); drawTools(); }
    if ('selected' in patch) { render(); if (ui.selected.size === 1) openMenu([...ui.selected][0]); else closeMenu(); }
    if ('placing' in patch || 'viewing' in patch || 'previewChar' in patch) { render(); panel.refresh({ table: new Set(['#']), dm: new Set() }); }
  });
  onSetting((k) => {
    if (k === 'dmPreview') { clearSelection(); closeMenu(); drawTools(); } // no DM menu or DM tools in the player view
    if (['names', 'dmPreview', 'snap', 'diagonals', 'playerName', 'chars'].includes(k)) { render(); panel.refresh({ table: new Set(['#']), dm: new Set() }); }
    if (k === 'reduceMotion') app.classList.toggle('reduce-motion', !!getSetting('reduceMotion'));
    if (k === 'playerName' || k === 'chars') { world.setName(me.name()); announce(); }
  });
  onDm(() => { drawTools(); render(); panel.rebuild(); announce(); });
  party.on(() => { render(); panel.refresh({ table: new Set(['#']), dm: new Set() }); });

  function renderTop() {
    const dm = world.dm;
    const scenes = dm ? dmScenes() : [];
    const vid = dm ? dmViewingId() : null;
    const live = dm ? world.d('dmeta')?.live : world.t('meta')?.live;
    const name = dm ? scenes.find((s) => s.id === vid)?.name || 'No scene' : (live && world.t(K.scene(live))?.name) || (world.t('meta')?.blackout ? 'Curtain' : 'Waiting');
    mount(sceneBtn, h('span', { class: 'truncate' }, name), dm ? icon('chevron-down') : null);
    sceneBtn.disabled = !dm;
    sceneBtn.title = dm ? 'Switch the scene you are viewing' : '';
    clear(liveBadge);
    if (dm && vid) add(liveBadge, sceneBadge(vid));
    dmBtn.classList.toggle('is-on', world.dm);
    dmBtn.title = world.dm ? 'DM tools' : 'Log in as the DM';
  }

  // Location and time of day: players see only what the DM shows (hidden by default); the DM sees both, dashed
  // while hidden, with a note saying what the players don't see.
  function renderBanner() {
    let place = null, time = null, note = '', dashed = false;
    if (world.dm) {
      const bn = world.d('dmeta')?.banner || {};
      if (previewing()) {
        place = bn.showLocation ? bn.location || null : null;
        time = bn.showTime ? bn.time || null : null;
      } else {
        place = bn.location || null;
        time = bn.time || null;
        const hidden = [place && !bn.showLocation && 'Place', time && !bn.showTime && 'time'].filter(Boolean);
        dashed = hidden.length > 0 && hidden.length === [place, time].filter(Boolean).length;
        note = dashed ? 'Hidden from players' : hidden.length ? `${hidden.join(' and ')} hidden from players` : '';
      }
    } else {
      const b = world.t('meta')?.banner;
      place = b?.location || null;
      time = b?.time || null;
    }
    if (!place && !time) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.classList.toggle('is-dm-only', dashed);
    mount(banner, 
      place ? h('div', { class: 'rg-banner-place' }, place) : null,
      time ? h('div', { class: 'rg-banner-time' }, icon(/night|midnight|evening|dusk/i.test(time) ? 'moon' : 'sun'), time) : null,
      note ? h('div', { class: 'rg-banner-note' }, note) : null);
  }

  /** The badge beside a scene's name: Live, Hidden (live behind the curtain) or Not shown. */
  function sceneBadge(id) {
    const ps = playersSee();
    if (ps.id !== id) return h('span', { class: 'badge', title: 'Players can’t see this scene' }, 'Not shown');
    return ps.state === 'scene'
      ? h('span', { class: 'badge badge-ok', title: 'Players see this scene' }, 'Live')
      : h('span', { class: 'badge badge-warn', title: 'Live, but hidden: players see the curtain' }, 'Hidden');
  }

  // Left: what the players see (always the truth). Then only verbs: "Show this scene" when the scene on the board
  // isn't what they see, "Hide from players" while they see one. Right: DM view / Player view.
  function renderDmBar() {
    if (!world.dm) { dmbar.hidden = true; return; }
    const vid = dmViewingId();
    const ps = playersSee();
    dmbar.hidden = false;
    dmbar.classList.toggle('is-preview', previewing());
    dmbar.classList.toggle('is-hidden-scene', ps.state === 'curtain');
    clear(dmbar);
    if (!vid) { add(dmbar, h('span', null, 'Create a scene to begin.'), h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => panel.open('scenes') }, 'Scenes')); return; }
    add(dmbar, playersSeeLine(ps));
    const onBoard = ps.state === 'scene' && ps.id === vid;
    if (previewing() && !(ps.state === 'curtain' && ps.id === vid)) {
      add(dmbar, h('span', { class: 'rg-dmbar-note' }, ui.previewChar ? `Through ${party.get(ui.previewChar)?.name || 'a PC'}` : 'Whole party', onBoard ? '' : ' · how this scene will look once shown'));
    }
    if (!onBoard) add(dmbar, h('button', { class: 'btn btn-primary btn-sm', type: 'button', title: 'Players see this scene now', onclick: () => A.goLive(vid) }, icon('eye'), 'Show this scene'));
    if (ps.state === 'scene') add(dmbar, h('button', { class: 'btn btn-sm', type: 'button', title: `Hide “${ps.name}”: players see the curtain until you show a scene (Shift+H)`, onclick: () => A.setBlackout(true) }, icon('eye-off'), 'Hide from players'));
    add(dmbar, segmented([{ value: 'dm', label: 'DM view', icon: 'dm' }, { value: 'players', label: 'Player view', icon: 'users', title: 'See the board as the players do (Shift+P)' }],
      previewing() ? 'players' : 'dm', (v) => setSetting('dmPreview', v === 'players'), { className: 'rg-viewseg' }));
    const ss = saveState;
    add(dmbar, h('button', { class: 'btn-icon btn-sm', type: 'button', title: ss.saving ? 'Saving the backup…' : ss.error ? `Backup failed: ${ss.error}` : ss.dirty ? 'Save a backup to the repo now (Ctrl+S)' : 'Backed up', 'aria-label': 'Save backup', onclick: () => saveNow().then(() => toast('Backup saved.', { type: 'success' })).catch((e) => toast(`Backup failed: ${e.message}`, { type: 'error' })) }, icon(ss.error ? 'warning' : ss.dirty ? 'save' : 'check')));
  }
  onSaveState(() => renderDmBar());

  function renderPlacing() {
    const p = ui.placing;
    placingBar.hidden = !p;
    if (!p) return;
    mount(placingBar, 
      h('span', null, 'Click the map to place ', h('strong', null, p.name || 'it'), p.kind === 'pc' ? '' : '. Shift-click to place more.'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setUi({ placing: null }) }, 'Done'));
  }

  // ---------- scene picker (DM) ----------
  function scenePicker(anchor) {
    if (!world.dm) return;
    const scenes = dmScenes();
    const shown = playersSee().id;
    const box = h('div', { class: 'rg-pop rg-float', role: 'menu' });
    const close = () => { box.remove(); removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!box.contains(e.target) && e.target !== anchor) close(); };
    add(box, h('div', { class: 'rg-pop-title' }, 'Scenes'));
    for (const s of scenes) {
      add(box, h('button', { class: ['rg-pop-item', s.id === dmViewingId() && 'is-active'], type: 'button', onclick: () => { setUi({ viewing: s.id }); clearSelection(); close(); } },
        h('span', { class: 'truncate' }, s.name || 'Scene'), s.id === shown ? sceneBadge(s.id) : null));
    }
    add(box, h('button', { class: 'rg-pop-item', type: 'button', onclick: () => { close(); panel.open('scenes'); } }, icon('plus'), 'Manage scenes…'));
    const r = anchor.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.bottom + 6}px`, position: 'fixed' });
    add(document.body, box);
    setTimeout(() => addEventListener('pointerdown', outside, true));
  }

  // ---------- tools ----------
  function drawTools() {
    clear(toolsEl);
    const dm = world.dm && !previewing();
    const tools = [
      ['select', 'Select and move', 'V', 'pointer'],
      ['pan', 'Pan (or hold Space)', '', 'hand'],
      ['measure', 'Measure distance', 'M', 'ruler'],
      ['pin', 'Place a pin everyone sees', 'P', 'pin'],
      ...(dm ? [['fog', 'Fog of war', 'F', 'fog'], ['note', 'Interaction (DM only)', 'N', 'mk-quest']] : []),
    ];
    if (!tools.some((t) => t[0] === ui.tool)) setUi({ tool: 'select' });
    for (const [id, title, key, ic] of tools) {
      add(toolsEl, h('button', { class: ['rg-tool', ui.tool === id && 'is-active'], type: 'button', title: key ? `${title} (${key})` : title, 'aria-label': title, 'aria-pressed': String(ui.tool === id), onclick: () => setUi({ tool: id }) },
        icon(ic), key ? h('span', { class: 'rg-tool-key' }, key) : null));
    }
    if (dm) {
      add(toolsEl, h('hr', { class: 'divider' }),
        h('button', { class: 'rg-tool', type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => undo() }, icon('undo')),
        h('button', { class: 'rg-tool', type: 'button', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', onclick: () => redo() }, h('span', { class: 'rg-flip' }, icon('undo'))));
    }
    drawSub(dm);
  }

  function drawSub(dm) {
    sub.hidden = !(dm && ui.tool === 'fog');
    if (sub.hidden) { cancelPoly(board); return; }
    clear(sub);
    const shapes = [
      ['lasso', 'Lasso', 'lasso'], ['poly', 'Polygon', 'polygon'], ['rect', 'Rectangle', 'square'],
      ['toggle', 'Show / hide a shape', 'eye'], ['erase', 'Erase a shape', 'trash'],
    ];
    add(sub, h('div', { class: 'rg-subtools-title' }, 'Fog of war'));
    const seg = h('div', { class: 'seg' },
      ...[['hide', 'Hide'], ['reveal', 'Reveal']].map(([m, l]) => h('button', { class: ['seg-btn', ui.fogMode === m && 'is-active'], type: 'button', onclick: () => setUi({ fogMode: m }) }, l)));
    add(sub, seg);
    for (const [id, label, ic] of shapes) add(sub, h('button', { class: ['rg-sub-btn', ui.fogShape === id && 'is-active'], type: 'button', onclick: () => setUi({ fogShape: id }) }, icon(ic), label));
    add(sub, h('hr', { class: 'divider' }),
      h('button', { class: 'rg-sub-btn', type: 'button', onclick: () => A.coverAll() }, icon('layers'), 'Cover the whole map'),
      h('button', { class: 'rg-sub-btn', type: 'button', onclick: () => A.setFogOn(false) }, icon('eye'), 'Lift all fog'),
      h('button', { class: 'rg-sub-btn', type: 'button', onclick: () => A.setFogOn(true) }, icon('eye-off'), 'Restore all fog'),
      h('button', { class: 'rg-sub-btn', type: 'button', onclick: () => A.clearFog() }, icon('trash'), 'Delete all fog'),
      h('p', { class: 'rg-sub-hint' }, ui.fogShape === 'poly' ? 'Click points; click the first one, double-click or press Enter to close.' : 'Hold Alt to draw the other mode. Fog hides creatures and props beneath it from the players.'));
  }

  function zoomLabel() { const z = zoom?.querySelector('.rg-zoom-level'); if (z) z.textContent = `${Math.round(board.scale * 100)}%`; }

  // ---------- tooltip ----------
  function tip(e) {
    const el = e.target.closest?.('.rg-tok, .rg-mark');
    if (!el || ui.placing) { tipEl.hidden = true; return; }
    const t = view?.tokens?.find((x) => x.key === el.dataset.key) || view?.marks?.find((x) => x.key === el.dataset.key);
    if (!t) { tipEl.hidden = true; return; }
    const lines = [];
    let name = t.name || t.label || '';
    if (t.kind === 'pc') lines.push(t.owner ? `Played by ${t.owner}` : 'Adventurer');
    if (t.kind === 'creature') {
      lines.push(t.disp === 'ally' ? 'Companion' : t.disp === 'neutral' ? 'Neutral' : 'Enemy');
      if (t.health) lines.push(world.dm && !previewing() ? `HP ${t.health.text || t.health.word}` : t.health.word);
      if (world.dm && !previewing() && t.data?.alias && t.data.alias !== t.data.name) lines.push(`Players see “${t.data.alias}”`);
      if (t.hidden) lines.push('Hidden from players');
    }
    if (t.kind === 'pin') { name = t.text || 'Pin'; lines.push(`${t.by || 'Someone'}${t.resolved ? ' · resolved' : ''}`); }
    if (t.kind === 'notice') { name = t.label || 'Notice'; }
    if (t.kind === 'note') { name = t.label || 'Interaction'; lines.push(t.hidden ? 'DM only' : 'Shown to players'); }
    if (t.kind === 'prop' && t.hidden) lines.push('Hidden from players');
    mount(tipEl, h('div', { class: 'rg-tip-name' }, name || '—'), ...lines.map((l) => h('div', { class: 'rg-tip-meta' }, l)),
      t.kind === 'notice' && t.text ? h('div', { class: 'rg-tip-text' }, t.text) : null);
    tipEl.hidden = false;
    const x = Math.min(innerWidth - tipEl.offsetWidth - 8, e.clientX + 14);
    const y = Math.min(innerHeight - tipEl.offsetHeight - 8, e.clientY + 16);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  }
  boardEl.addEventListener('pointerleave', () => { tipEl.hidden = true; });
  boardEl.addEventListener('pointerdown', () => { tipEl.hidden = true; });

  // ---------- status & people ----------
  function drawStatus() {
    const hl = world.bus.health();
    const state = hl.online === hl.total ? 'live' : hl.online ? 'partial' : 'offline';
    status.dataset.state = state;
    status.lastChild.textContent = state === 'live' ? 'Live' : state === 'partial' ? 'Live (one relay down)' : 'Reconnecting…';
    status.title = hl.urls.map((u) => `${u.url.replace(/^wss:\/\//, '').split('/')[0]}: ${u.state}`).join('\n') + (sandbox ? '\n(sandbox: this browser only)' : '');
  }
  world.bus.on((ev) => { if (ev.type === 'status') drawStatus(); });
  drawStatus();
  function drawPeople() {
    clear(people);
    const list = presence.list();
    for (const p of list.slice(0, 8)) {
      const char = p.chars?.[0] ? party.get(p.chars[0]) : null;
      const el = h('span', { class: ['rg-person', p.dm && 'is-dm'], title: `${p.name}${p.dm ? ' (DM)' : ''}${p.chars?.length ? ` · ${p.chars.map((c) => party.get(c)?.name).filter(Boolean).join(', ')}` : ''}`, style: { '--person': p.color || '' } },
        (p.name || '?').slice(0, 1).toUpperCase());
      if (char?.portrait) mediaUrl(char.portrait).then((u) => { if (u) mount(el, h('img', { src: u, alt: '' })); }).catch(() => {});
      add(people, el);
    }
    if (list.length > 8) add(people, h('span', { class: 'rg-person' }, `+${list.length - 8}`));
    people.hidden = !list.length;
  }
  presence.on(drawPeople);
  startPresence({
    onRuler: (from, d) => {
      if (!view || d?.scene !== view.sceneId) return;
      if (d.end) board.setOverlay(`ruler-${from}`, { kind: 'ruler', points: d.points, name: d.name, color: d.color, until: Date.now() + 1500 });
      else board.setOverlay(`ruler-${from}`, { kind: 'ruler', points: d.points, name: d.name, color: d.color, until: Date.now() + 5000 });
    },
    onPing: (from, d) => {
      if (!view || d?.scene !== view.sceneId) return;
      board.setOverlay(`ping-${from}-${Date.now()}`, { kind: 'ping', x: d.x, y: d.y, at: Date.now(), until: Date.now() + 1500, color: d.color });
    },
  });

  // ---------- tool hooks ----------
  setToolHooks({
    openMenu: (key) => openMenu(key),
    openPinEditor: (key, opts) => openPinEditor(key, opts),
    openDetails: (key) => openDetails(key),
    afterPlace: () => render(),
    ghost: () => {},
  });

  // ---------- keyboard ----------
  function undo() { const l = world.undo(); if (l) toast(`Undid ${l}.`, { timeout: 1500 }); }
  function redo() { const l = world.redo(); if (l) toast(`Redid ${l}.`, { timeout: 1500 }); }
  addEventListener('keydown', (e) => {
    if (isTyping(e) || document.querySelector('.modal-backdrop')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const dm = world.dm && !previewing();
    if (mod && k === 'z' && dm) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y' && dm) { e.preventDefault(); redo(); return; }
    if (mod && k === 's' && world.dm) { e.preventDefault(); saveNow().then(() => toast('Backup saved.', { type: 'success' })).catch((er) => toast(er.message, { type: 'error' })); return; }
    if (mod && k === 'd' && dm) { e.preventDefault(); const keys = A.duplicateKeys([...ui.selected]); if (keys.length) { ui.selected.clear(); keys.forEach((x) => ui.selected.add(x)); render(); } return; }
    if (mod) return;
    if (k === 'escape') {
      if (ui.placing) setUi({ placing: null });
      else if (polyActive()) cancelPoly(board);
      else { clearSelection(); closeMenu(); }
      return;
    }
    if (k === 'enter' && polyActive()) { finishPoly(board); return; }
    if ((k === 'delete' || k === 'backspace') && ui.selected.size) { e.preventDefault(); A.deleteKeys([...ui.selected]); return; }
    if (k === 'v') setUi({ tool: 'select' });
    else if (k === 'm') setUi({ tool: 'measure' });
    else if (k === 'p' && e.shiftKey && world.dm) setSetting('dmPreview', !previewing());
    else if (k === 'p') setUi({ tool: 'pin' });
    else if (k === 'f' && dm) setUi({ tool: 'fog' });
    else if (k === 'n' && dm) setUi({ tool: 'note' });
    else if (k === 'h' && e.shiftKey && world.dm) hideOrShowLive();
    else if (k === 'h' && dm && ui.selected.size) toggleHidden();
    else if (k === '+' || k === '=') board.zoomBy(1.25);
    else if (k === '-') board.zoomBy(0.8);
    else if (k === '0') board.fit();
    else if (k.startsWith('arrow') && ui.selected.size) { e.preventDefault(); nudge(k, e.shiftKey ? 5 : 1); }
  });

  /** Shift+H: hide the live scene from the players, or show the hidden live scene again. */
  function hideOrShowLive() {
    const ps = playersSee();
    if (ps.state === 'scene') A.setBlackout(true);
    else if (ps.state === 'curtain' && ps.id) A.setBlackout(false);
  }

  function toggleHidden() {
    const keys = [...ui.selected].map(parseKey).filter((x) => x.room === 'dm');
    const anyShown = keys.some(({ key }) => !world.d(key)?.hidden);
    for (const { key } of keys) { const it = world.d(key); if (it) world.dPut(key, { ...it, hidden: anyShown }, { undo: true, label: anyShown ? 'hide' : 'show' }); }
  }

  function nudge(k, n) {
    const c = cellPx(view?.scene) * n;
    const dx = k === 'arrowleft' ? -c : k === 'arrowright' ? c : 0;
    const dy = k === 'arrowup' ? -c : k === 'arrowdown' ? c : 0;
    for (const vk of ui.selected) {
      if (!A.canMove(vk)) continue;
      const t = view?.tokens?.find((x) => x.key === vk) || view?.marks?.find((x) => x.key === vk);
      if (!t) continue;
      const { room, key } = parseKey(vk);
      const before = world.bus.get(room, key) ?? null;
      A.moveTo(vk, t.x + dx, t.y + dy, { final: true, before });
    }
  }

  // GitHub saves (backups, uploads) failing: say so, at most once a minute
  let lastRepoError = 0;
  repo.on((ev) => {
    if (ev.type !== 'error' || Date.now() - lastRepoError < 60000) return;
    lastRepoError = Date.now();
    toast(`Could not save to GitHub: ${ev.error?.message || ev.error}. The table itself stays live; it will retry.`, { type: 'error' });
  });

  drawTools();
  render();
  if (!me.name() || (!world.dm && !me.chars().length && party.all().length)) setTimeout(() => { if (!world.dm) identityDialog(); }, 600);
  void ping;
  return { board, render, panel };
}
