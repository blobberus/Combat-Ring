# The Combat Ring

The battle table of **The Stone Wardens** campaign: a live, password-gated virtual tabletop in the spirit of
Owlbear Rodeo, dressed like the [Stone Wardens site](https://blobberus.github.io/Stone-Wardens/) and synced with it.

**Live site:** https://blobberus.github.io/Combat-Ring/

## Getting in

- **Password:** the same one as the Stone Wardens site. The ring opens Stone-Wardens' own `vault.json`, so the two
  can never drift apart: change it there (Stone-Wardens `setup.html`) and the ring follows. Both sites live on
  `blobberus.github.io`, so "Remember this device" on either one unlocks (and "Lock" locks) both.
- **DM:** click **DM** (top right) and enter the DM password. Only the DM's browser can open the DM's state; players
  never receive hidden scenes, creatures, notes or stat blocks. Change the DM password from the DM menu.
- **Players:** on first visit, give your name and tick your character(s). Characters come straight from the
  Stone Wardens sheets: name, player and portrait. Stats are not copied.

## What the DM can do

- **Scenes** (Scenes panel): any number of maps. *New scene* sets the size in squares, feet per square, background
  and grid, and places an uploaded image on that grid: drag to move it, wheel or slider to scale it, *Fill* /
  *Fit whole image* / *Match shape*, or *Image pixels per square* to line up a battlemap's own grid. Whatever lies
  outside the frame is cropped. View and prepare any scene in secret; **Show this scene** makes it live. **Curtain**
  hides the board from everyone for a moment.
- **Fog of war** (F): lasso, polygon or rectangle, in *Hide* or *Reveal* mode (Alt flips it), show/hide or erase a
  shape, cover the whole map, lift or restore all fog. Players don't receive creatures or props under fog at all.
- **Creatures** (Creatures panel): the whole 5etools bestiary (about 4,500 creatures with their token art), with search
  and CR / type / size / book filters and the full stat block. *Place* (or drag a row onto the map). New creatures
  can start hidden. **Custom creatures** have their own editor: stat block with live preview, art (upload with a
  circle crop, a bestiary token, or a URL), and *Start from a bestiary creature*.
- **Token menu** (click a token): HP with Damage / Heal, roll HP, initiative (roll d20 + Dex), size, side (enemy,
  companion, neutral), **what players see of its stats** (nothing, a health bar, or the full stat block), conditions,
  the name players see (e.g. "Hooded figure"), a light it carries, hide / show, duplicate, order, lock, delete.
- **Props** (Props panel): crates, barrels, carts, a covered wagon, tables, doors, trapdoors, chests, boulders, trees,
  campfires and braziers (they give light), and more, plus your own uploaded art. Props can be resized, turned,
  made **movable by players**, hidden.
- **Interactions** (N): DM-only markers with notes, a text players see when it triggers, fog it lifts and hidden
  creatures or props it reveals. **Trigger** does all of it at once.
- **Scene settings** (Scene panel): light (bright / dim / dark) and shared party vision, fog and grid, scene notes,
  and the banner: **location name** and **time of day**, each hidden from players until you tick "Show".
- **Slides** (Slides panel): image decks for transitions, with titles and captions, slow zoom / pan / drift / pulse
  animations, crossfade / slow fade / slide / cut transitions, auto-advance and loop. GIFs and videos play as they
  are. Present, step through, or *Peek* to keep working on the board while it runs.
- **Player view** (Shift+P): the board exactly as players see it, through the whole party's eyes or one PC's.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z) for the DM's edits.

## What players can do

- Move their own token (snaps to the grid; Alt to place freely); the **movement circle** follows their speed, and
  they can add their own ranges (Longbow 150 ft, Fire Bolt 120 ft, Dash, anything) in *Customize*.
- **Darkvision:** in dim or dark scenes the board darkens beyond what they can see; darkvision (from the sheet's
  species, editable) shows a faded, grayer view whose edge softness, gray, dimness and tint each player sets.
  Light sources (torches, campfires) light the dark for everyone.
- **Token art:** upload any image and crop it into a circle; otherwise the sheet's portrait or initials.
- **Pins** (P) that everyone sees; the DM resolves them or clears them all.
- **Initiative:** type their own number; the list sorts itself and shows whose turn it is.
- Hover any token to see its name; the DM decides how much more they see.
- **Measure** (M) with the 2024 rule (every square 5 ft), 5-10-5 or straight line; everyone sees the ruler.
  Double-click the map to ping it.

## How it stays live

Moves reach everyone in about a tenth of a second. Each token, fog shape, pin and setting is a small object
published to **two public MQTT brokers at once** (HiveMQ and EMQX, over WebSocket), retained so a late joiner gets
the whole table, and **encrypted** (AES-GCM) with a key derived from the site's token (table) or the DM's key (DM
room), so the brokers relay noise. The newest version of each object wins; a broker that missed something is healed
by whoever has the newer copy. The DM's browser publishes what players may see (the *projection*). Backups go to the
Stone Wardens repository under `content/combat-ring/` every few minutes and on *Save* (Ctrl+S); uploaded images are
stored there too (the DM's sealed until shown). Details: [docs/live-model.md](docs/live-model.md).

## Bestiary data

`data/bestiary.json` is an index (names and game numbers only) built from the
[5etools data mirror](https://github.com/5etools-mirror-3/5etools-src) by `tools/build_bestiary.py`. Token art and
full stat blocks are loaded from the mirror at runtime, in the user's browser; no stat-block text is stored here.

## Development

No build step: plain HTML, CSS and ES modules. `python -m http.server 8791` in this folder, then open
`http://127.0.0.1:8791/?sandbox` (everything stays in that browser; open a second tab to play both sides).
Tests: `node tools/test_model.mjs` (model and projection), `node tools/test_live.mjs` (the live bus against the real
brokers; needs the network). See [CLAUDE.md](CLAUDE.md).
