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
  Stone Wardens sheets: name, player and portrait, and live hit points, conditions, darkvision and speed.

## What the DM can do

- **Scenes** (Scenes panel): any number of maps. *New scene* sets the size in squares, feet per square, background
  and grid, and places an uploaded image on that grid: drag to move it, wheel or slider to scale it, *Fill* /
  *Fit whole image* / *Match shape*, or *Image pixels per square* to line up a battlemap's own grid. Whatever lies
  outside the frame is cropped. View and prepare any scene in secret; **Show this scene** makes it live. The DM bar
  always says what the players see (green dot: a scene; amber: hidden). **Hide from players** (DM bar, the live
  scene's row in Scenes, or Shift+H) lowers the curtain over the live scene until you show it again.
- **Fog of war** (F): drag to draw fog with the lasso, polygon or rectangle (or a *Clearing*, a hole in fog; Alt
  flips it), then **click a fog area to reveal it** to the players and click again to hide it. Cover the whole map,
  reveal or hide everything, erase areas. Players see opaque **black or white fog** (per scene) with soft, misty
  edges, and don't receive creatures or props under fog at all. The fog controls fold to a small tab (the tool stays
  on).
- **Characters are locked:** only the DM places, moves, resizes or removes the party's tokens, until the DM unlocks
  a character for its player on that scene (its token menu, or the lock buttons and *Unlock all* in Party). New
  scenes start locked.
- **Creatures** (Creatures panel): the whole 5etools bestiary (about 4,500 creatures with their token art), with search
  and CR / type / size / book filters and the full stat block. *Place* (or drag a row onto the map). New creatures
  can start hidden. **Custom creatures** have their own editor: stat block with live preview, art (upload with a
  circle crop, a bestiary token, or a URL), and *Start from a bestiary creature*.
- **Initiative for creatures:** *Add to initiative* in a creature's menu rolls d20 + Dex (or type the number). The
  Initiative panel lists the creatures on the board that aren't in the order, each with *Add*, plus *Add all*.
  Select several (Shift+drag a box, or Shift+click) for a group menu: add them all at once, optionally with **one
  roll for the group** so they act together; it also hides, shows or deletes them. Shortcut: **I** adds the selected
  creatures. Creatures on a scene that isn't live keep their number and join the order once it is.
- **Creature menu** (click a creature's token): HP with Damage / Heal, roll HP, initiative (add / roll again / take out), **size** (Tiny to
  Gargantuan, or Custom: any number of squares across, e.g. 2.5), side (enemy,
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
  are. The deck title and each slide's title and description can be kept from the players ("Players see …"
  boxes; the text isn't sent to them). Present and step through it; on your own screen switch it between
  **Full screen**, **Corner** and **Hidden** to keep working on other scenes while the players watch.
- **Player view** (DM view / Player view switch at the left of the bottom bar, or Shift+P): the live scene exactly as players see it (the curtain
  while it is hidden), or how another scene will look once shown; through the whole party's eyes or one PC's.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z) for the DM's edits.

## What players can do

- Move their own token once the DM unlocks it (snaps to the grid; Alt to place freely). While it is locked,
  **dragging it measures** how far a move or a shot reaches and the token stays put. The **movement circle** follows
  their speed, and they can add their own ranges (Longbow 150 ft, Fire Bolt 120 ft, Dash, anything) in *Customize*.
- **From the character sheet, live:** hit points (current, max, temp), conditions and Exhaustion, darkvision and
  speed come from the Stone Wardens sheet and change there, not here (the token menu has *Open the sheet*). An edit
  shows up at once on a screen where Stone Wardens is open in another tab of the same browser, and on every other
  screen within a few seconds (the DM's browser checks for new sheet commits every 4 s and shares them). The numbers
  are worked out with Stone Wardens' own rules, so Exhaustion slows the Move circle and Grappled stops it, as the
  sheet shows.
- **Darkvision:** in dim or dark scenes the board darkens beyond what they can see; darkvision (from the sheet;
  Truesight counts too) shows a faded, grayer view whose edge softness, gray, dimness and tint each player sets.
  Light sources (torches, campfires) light the dark for everyone.
- **Token art:** upload any image and crop it into a circle; otherwise the sheet's portrait or initials.
- **Size:** Tiny to Gargantuan, or Custom (any number of squares across), in the token menu or *Customize*.
- **Health bar:** they and the DM always see their numbers; the other players see the bar with HP, the bar only, or
  nothing, as the player chooses in *Customize*.
- **Health bar look** (Settings, per device): bar, bar with HP, or off; below or above the token; thin, normal or
  thick; colored by health or one color. HP numbers show only where that person may see them.
- **Pins** (P) that everyone sees; the DM resolves them or clears them all.
- **Initiative:** type their own number; the list sorts itself and shows whose turn it is. During combat,
  *Minimize* folds it into a small card at the top of the board: whose turn it is and who is next (the DM's has
  Previous / Next). Whoever's turn it is, character or creature, has a dashed gold ring on the board (the DM sees it on
  hidden creatures too; players only on what they can see).
- **Fit to the screen** (the corner button, or 0) fits the map into the part of the screen the bars leave free. For
  players it fits what isn't under fog, and until they pan or zoom their view follows what the DM reveals. Opening or
  closing the side panel keeps the middle of the view where it was.
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
