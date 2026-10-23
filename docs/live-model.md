# The live table (bus, rooms, projection, backups)

## Why it works this way

The site is static (GitHub Pages) and every player shares one GitHub token, which allows only a few hundred writes an
hour. A battle table needs every move on every screen within a fraction of a second. So live play runs through
**public MQTT brokers** (no account, WebSocket, ~50 ms), and GitHub is only the durable backup and the image store.

## The bus (`assets/js/core/bus.js`, `mqtt.js`)

- **Objects.** Each object is its own retained topic `cr1/<roomId>/o/<key>`; the payload is AES-GCM sealed
  `{k, t: [ms, clientId], by, d}`. `d: null` is a delete (tombstone). New subscribers get every retained object.
- **Versions.** Hybrid logical clock: a write is stamped `max(now, newest seen + 1)`; the newest `t` wins everywhere
  (ties by client id), so clock skew can't make a later edit lose.
- **Two brokers** (`config.json` `brokers`): writes go to both; reads merge by version. After a broker's snapshot
  arrives, a client re-sends the recent objects that broker lacks, and any retained copy older than ours is re-sent
  ("heal"), so a broker that restarted catches up.
- **Transient messages** `cr1/<roomId>/x/<channel>` (not retained): `hello`/`bye` (presence), `ruler`, `ping`, `req`
  (a player asking the DM's client to move a movable prop). Each carries a random id; duplicates are dropped.
- **Sizes.** EMQX keeps retained payloads only up to about 100 KB; keep objects small (one fog shape, one token).
- **Sandbox** (`?sandbox`): a BroadcastChannel between tabs with retained messages in localStorage, same interface.

## Rooms and keys

| Room | Key from | Who joins |
|---|---|---|
| `table` | HKDF of the GitHub token (`roomKeys(token, 'table')`) | everyone with the site password |
| `dm` | HKDF of the DM data key (`roomKeys(raw, 'dm')`) | the DM only |

The DM data key is a random 256-bit key wrapped by the DM password (`dm-vault.json` in this site, or
`content/combat-ring/dm/vault.json` in the data repo once the password is changed). Changing the token (re-running
Stone-Wardens setup) moves the table to a new room; the DM's client restores it from the backup.

## Object keys

Table room (players read; `world.t`):

| Key | Written by | What |
|---|---|---|
| `meta` | projector | `{live, blackout, banner: {location?, time?}}` (only what the DM shows) |
| `scene.<id>` | projector | the live scene: size, grid, light, map image reference, `fogOn` |
| `fog.<scene>.<shape>` | projector | active fog shapes `{pts, mode: hide|reveal, z}` |
| `it.<item>` | projector | what players see of a creature / prop / triggered notice (name = alias, health or stats if shown) |
| `ini.dm-<item>` | projector | visible creatures' initiative |
| `turn`, `show` | projector | combat turn, the slideshow being presented |
| `pc.<char>` | player / DM | token settings: image, color, size (name or squares), speed, ranges, vision look, light, conditions, `hp` {cur, max, temp} and `hpShow` (`numbers` / `bar` / `private`: what the other players' screens show) |
| `pct.<scene>.<char>` | player / DM | a PC's position on a scene |
| `pin.<id>` | anyone | `{scene, x, y, text, color, by, resolved}` |
| `ini.pc-<char>`, `ini.x-<id>` | player / DM | PC initiative, DM extras (lair actions) |

DM room (`world.d`): `dmeta` (live scene, banner with show flags, curtain, turn, presenting), `scene.<id>` (all
scenes), `fog.<scene>.<shape>` (with `on`), `item.<id>` (creatures, props, notes; with `hidden`, stats, HP),
`cre.<id>` (custom creatures), `cprop.<id>` (custom props), `media.<id>` (image registry), `deck.<id>` (slideshows).

## The projection (`ring/model.js` `project`, `ring/projector.js`)

The DM's client turns the DM room into the table room's projected keys after every change (a lone moved item takes a
fast path). Players get only: the live scene (none behind the curtain), active fog, items that are not hidden and not
under fog, a creature's alias and only the stats the DM shows, triggered notices, visible creatures' initiative, the
banner parts marked "Show", and the slideshow being presented. Everything else stays sealed in the DM room.
A slide's `title` / `caption` and the deck title are left out when the DM unticks "Players see" (`hideTitle`,
`hideCaption`). A creature's initiative line carries no Dexterity: its `tie` is the rank of that score among the listed creatures
(`tieRanks`), so players sort ties like the DM without learning the stat. A fast-path change that adds, removes or
renumbers a line triggers the full projection so the ranks are recomputed.

## Images (`ring/media.js`)

- DM uploads (maps, custom art, slides) are WebP-converted, **sealed** with the DM data key and stored as
  `content/combat-ring/dm/media/<id>.bin`; `media.<id>` records them. When a scene or slide is shown, the projector
  publishes a plain copy `content/combat-ring/media/<id>.<ext>` once (`media.<id>.pub`).
- Player uploads (token art) are plain: `content/combat-ring/media/tokens/<char>-<rand>.webp`.
- References carry the git blob sha (`{p, s, m}`): the blob is created first (`POST /git/blobs`), so other clients
  can read it by sha at once, before the commit lands.
- Bestiary tokens are hot-linked from the 5etools image mirror (two bases, the `<img>` falls back).

## Backups (`ring/persist.js`)

The DM's client commits, at most every 3 minutes while things change (and on Ctrl+S / leaving DM mode):
`content/combat-ring/dm/state.bin` (both rooms, sealed) and `content/combat-ring/table.json` (the table room, plain).
On DM login it merges `state.bin` (newer versions win, the brokers catch up). A player whose brokers have no table
at all merges `table.json`. Tombstones older than 14 days are purged.
