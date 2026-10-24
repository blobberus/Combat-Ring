# Combat Ring — battle table (CLAUDE.md)

Live, password-gated virtual tabletop (Owlbear-Rodeo-like) for the Stone Wardens campaign, on GitHub Pages for repo
`blobberus/Combat-Ring` (https://blobberus.github.io/Combat-Ring/). Companion to `blobberus/Stone-Wardens` (local
clone `Documents/Stone-Wardens/Stone-Wardens`): same password, same look, same party. User guide: `README.md`;
live model: `docs/live-model.md`.

## Hard rules
- **No build step.** Plain HTML/CSS + native ES modules, no runtime deps (MQTT client is our own `core/mqtt.js`).
- All paths relative (served from `/Combat-Ring/`). Never absolute `/` URLs in the app.
- Look: Stone-Wardens' design system. `assets/css/tokens.css`, `base.css`, `assets/img/icons.svg` are copies of
  Stone-Wardens' files (icons.svg adds the board-tool symbols at the end); keep them in step when SW changes them.
  Tokens only in CSS (token/prop art carries its own pigments). See SW `docs/design.md`.
- Windows box: Controlled Folder Access blocks Git Bash writes and the portable Node from writing in `Documents`;
  use the Write/Edit tools or Python for files here; Node scripts write to the scratchpad. Commit from PowerShell
  with `git commit -F <msgfile>`.
- Copyright: `data/bestiary.json` holds names and numbers only; stat-block text and token art are read from the
  5etools mirror at runtime. Never commit 5etools text or images.
- The password and DM password are never stored in the repo: only `vault.json` (Stone-Wardens') and `dm-vault.json`
  (wrapped DM key; regenerating it orphans every DM backup).

## Layout
```
index.html          gate + #app (the ring mounts into it); loads assets/js/main.js
config.json         data root, Stone-Wardens paths, vault URLs, auth key, brokers, bestiary URLs
dm-vault.json       DM data key wrapped by the DM password (tools/make_dm_vault.mjs; overridden by
                    content/combat-ring/dm/vault.json in the data repo after "Change the DM password")
data/bestiary.json  creature index (tools/build_bestiary.py)
assets/css/         tokens, base (SW copies), gate (SW gate), ring (board + floating UI), panels (panel, editors)
assets/js/main.js   boot: config -> gate -> repo -> table room -> mountRing -> restoreDm
assets/js/core/     dom, util, idb, github, sandbox (SW copies, adapted), crypto (SW dm-crypto + site vault + room
                    keys), auth (config, vaults, sw:auth), settings (cr:settings), ui, mqtt, bus, repo
assets/js/ring/     the table (below)
tools/              build_bestiary.py, make_dm_vault.mjs, test_model.mjs, test_live.mjs
```
`ring/`: `model.js` (pure: keys, geometry, fog, distances, initiative, **project()**), `world.js` (rooms, batching,
undo, `me`), `state.js` (local UI state), `view.js` (view model per role), `board.js` (renderer + pan/zoom),
`tools.js` (pointer tools), `actions.js` (every mutation), `menu.js` (token menu, stat block modal), `app.js`
(shell: top bar, tools, zoom, DM bar, banner, tooltip, keys), `panels/` (party, initiative, pins; DM: scenes (short
list) + `scene-library.js` (the wide library: tree, cards, drag and drop), creatures, props, slides, table = scene
settings), `editors/` (scene/map, creature, PC token, crop), `slideshow.js`,
`projector.js`, `persist.js`, `media.js`, `characters.js`, `sheets.js` (live HP / conditions / senses / speed from
the SW sheets), `library.js` (the DM's map library: folders, pins, recent, the SW atlas), `bestiary.js`, `props.js`
(built-in prop art), `dm.js`,
`presence.js`, `dialogs.js`, `sandbox-seed.js`.

## Data flow
- **Auth:** the gate opens Stone-Wardens' `vault.json` (`config.vaults`: `../Stone-Wardens/` on Pages, raw GitHub
  locally; list an own vault first to give the ring its own token) -> `{token, owner, repo}`; saved under SW's own key
  `sw:auth` (same origin = one login for both sites).
- **Data repo** = Stone-Wardens (the token only covers it). Combat-Ring writes only under `content/combat-ring/`
  (SW's Pages workflow ignores `content/**`). It reads `content/characters/*.json`, `srd/species.json` +
  `srd/stubs/species.json` (+ `content/library/species/`) for speed/darkvision defaults, and SW's atlas for the map
  library: `content/map/config.json` (main map, id `main`), `content/maps/<id>.json` (sub-maps: `name`, `parent`,
  `image`), `content/locations/<id>.json` (places: `name`, `type`, `map`), per SW `docs/map-model.md`. If SW changes
  that layout, update `library.js` (`loadAtlas`). SW's DM-hidden maps and places are sealed there and don't show.
- **Sheets, live** (`sheets.js`): PC hit points, conditions + Exhaustion, senses and speed are SW's and read-only
  here. Computed with **SW's own rules engine**, imported at runtime from the SW site
  (`config.stoneWardens` + `assets/js/views/characters/engine.js`: `buildRules`, `derive`; SRD from its `srd/`):
  if SW moves or renames that file or changes those two functions, update `sheets.js` (it falls back to rough numbers,
  `model.sheetVitals`). Copies: the repo file (DM polls `content/characters/` every 4 s via ETag, players 20 s), SW's
  drafts in the same browser (`localStorage` `sw:drafts:<owner>/<repo>`, `storage` event), and `sheet.<char>` on the
  table (first to see a newer one publishes). Locally, the engine loads only when both repos are served side by side
  (`/Combat-Ring/` and `/Stone-Wardens/` under one server root).
- **Live:** `core/bus.js` over two public MQTT brokers; rooms `table` (key from token) and `dm` (key from DM data
  key). Everything on the board is a bus object; see docs/live-model.md for keys. Writes go through `world.put`
  (`actions.js` for app logic). The DM's `projector.js` publishes what players may see (`model.project`).
- **Backups:** DM client commits `dm/state.bin` (sealed) + `table.json` at most every 3 min (`persist.js`); restored
  on DM login / when brokers are empty. Images: `media.js` (DM's sealed until shown; references carry blob shas).
- Sandbox: `?sandbox` = IndexedDB repo + BroadcastChannel bus + sample party and atlas (`sandbox-seed.js`).

## Conventions
- `h()` / `add()` / `mount()` from core/dom.js; never native `el.append(x, maybeNull)` (it prints "null").
- Panels: `{id, title, icon, dm?, relevant(changes), render(el, ctx), headExtra?, wide?}`; they re-render on world
  changes except while a text field inside has focus (`typingIn`); a committed field blurs itself. `wide()` true opens
  the pane out over the board (`.rg-panel.is-wide`, negative margin: the stage keeps its size).
- The token menu never takes focus on open (keyboard stays on the board).
- The board holds pointer capture during presses: find targets with `elementFromPoint`, not `e.target`, in
  click/dblclick handlers.
- UI state that must not sync (tool, selection, viewing scene) lives in `state.js`; per-device prefs in settings.
- Fog is one layer (`model.js`: `cutFog`, `flattenFog`, `oneLayer`, `inArea`): never stack shapes; read fog through
  `oneLayer` (older saves are stacks). What a player can't see (other PCs under fog; in dark scenes anything outside
  light and their darkvision) is dropped in `view.js` (`unseen`), so it is neither drawn nor hoverable. A light source
  is `{bright, dim}` (feet); a viewer's sight is `{sight: true, darkvision, fade, …}` (`fade` is a percent): keep the
  two apart (a sight's old `dim` field was once read as a 25 ft light).
- Redraws (players' moves arrive many times a second): `world.on` changes carry `moved` (`room:key` of
  position-only changes; panels' `hasChanges` and the token menu ignore them), `structural` (a room joined: the
  projector re-projects; it ignores `'#'`) and `view`. Use `world.invalidate('view')` for board-only redraws (hover,
  drag end); plain `invalidate()` (`'#'`) redraws every panel. Board layers, tokens, marks and app.js bars rebuild only
  when their signature changed; never rebuild a control under the pointer on every frame.

## Testing
- `node tools/test_model.mjs` (pure model + projection) and `node tools/test_live.mjs` (real brokers).
- Browser QA: headless Chrome via CDP on its own port (another session may own 9333) and the local server on a free
  port (8765 is often Stone-Wardens'); `?sandbox`, two tabs = DM + player. Close leftover tabs first: live sandbox
  tabs share the bus and re-publish stale state. Disable the HTTP cache (modules are cached otherwise).
- Syntax: portable `node --check`.

## Status (2026-10-23)
Built and QA'd in headless Chrome (sandbox: DM setup and login, scenes with uploaded maps, fog, bestiary, custom
creatures, props, interactions, light and darkvision, initiative, pins, banner, slideshow, token art, undo, reload,
backups; real mode: the shared password opens SW's vault and loads the real party). Known gaps: fog is visual on top
of a public map image once a scene is shown (players could fetch the image); creatures in the dark (not under fog)
still reach players' browsers, only undrawn; `hello` presence names are self-reported;
no dice roller; no walls / dynamic line of sight.
