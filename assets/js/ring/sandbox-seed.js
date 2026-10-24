// ?sandbox: a stand-in Stone-Wardens party (and species) and a small atlas (a region map with places, as Stone
// Wardens stores them) in the browser-only repo, so the ring can be tried and tested without the real site. Written
// once; the sandbox keeps whatever you change.
import { repo } from '../core/repo.js';
import { config } from '../core/auth.js';

const SPECIES = [
  { id: 'dwarf', name: 'Dwarf', size: 'Medium', speed: 30, darkvision: 120 },
  { id: 'elf', name: 'Elf', size: 'Medium', speed: 30, darkvision: 60, subspecies: [{ id: 'elven-lineage-drow', darkvision: 120 }] },
  { id: 'human', name: 'Human', size: 'Medium', speed: 30, darkvision: null },
  { id: 'halfling', name: 'Halfling', size: 'Small', speed: 30, darkvision: null },
];

// hit points, conditions and exhaustion as Stone Wardens stores them (the table reads them live)
const AT = '2026-10-01T12:00:00.000Z';
const CHARS = [
  { id: 'brannoc-stoneheart-s1', name: 'Brannoc Stoneheart', player: 'Mira', species: { id: 'dwarf' }, classes: [{ id: 'fighter', level: 3, hp: [10, 6, 7] }], baseAbilities: { str: 16, dex: 12, con: 16, int: 8, wis: 12, cha: 10 }, hp: { current: 22, temp: 0 }, conditions: [], exhaustion: 0, style: { accent: '#8e1b1b' }, updated: AT },
  { id: 'ilyra-vael-s2', name: 'Ilyra Vael', player: 'Tomas', species: { id: 'elf', subspecies: 'elven-lineage-drow' }, classes: [{ id: 'rogue', level: 3, hp: [8, 5, 4] }], baseAbilities: { str: 8, dex: 16, con: 12, int: 12, wis: 14, cha: 10 }, hp: { current: 20, temp: 0 }, conditions: [], exhaustion: 0, style: { accent: '#22507c' }, updated: AT },
  { id: 'pell-underbough-s3', name: 'Pell Underbough', player: 'Ana', species: { id: 'halfling' }, classes: [{ id: 'cleric', level: 3, hp: [8, 5, 6] }], baseAbilities: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 12 }, hp: { current: 12, temp: 0 }, conditions: ['poisoned'], exhaustion: 0, style: { accent: '#23675f' }, updated: AT },
  { id: 'sera-quill-s4', name: 'Sera Quill', player: 'Jun', species: { id: 'human' }, classes: [{ id: 'wizard', level: 3, hp: [6, 4, 3] }], baseAbilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, hp: { current: 16, temp: 3 }, conditions: [], exhaustion: 1, overrides: { speed: 35 }, style: { accent: '#6e3a5c' }, updated: AT },
];

// a region map (an original drawing) and places on it and on the main map
const VALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
<rect width="1600" height="1200" fill="#e8dcc0"/>
<path d="M0 820 C300 760 520 900 760 840 S1180 700 1600 760 L1600 1200 L0 1200 Z" fill="#9fb7b0"/>
<path d="M760 0 C720 220 860 380 800 560 S700 760 760 840" fill="none" stroke="#6f93a0" stroke-width="18"/>
<g fill="#7d8b5a"><circle cx="300" cy="300" r="70"/><circle cx="380" cy="260" r="60"/><circle cx="340" cy="380" r="64"/><circle cx="1180" cy="320" r="80"/><circle cx="1260" cy="400" r="66"/></g>
<g fill="#8a7a63"><path d="M1000 600 l60 -120 l60 120 z"/><path d="M1090 620 l50 -100 l50 100 z"/></g>
<circle cx="760" cy="830" r="16" fill="#5b3a29"/><circle cx="1090" cy="560" r="12" fill="#5b3a29"/>
<text x="790" y="820" font-family="serif" font-size="40" fill="#3b2c20">Brinewick</text>
<text x="1110" y="545" font-family="serif" font-size="34" fill="#3b2c20">The Warden Stones</text>
<text x="80" y="110" font-family="serif" font-size="64" fill="#3b2c20">Starfall Vale</text>
</svg>
`;

export async function seedSandbox() {
  await repo.tree(true);
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
  const places = config.locations || 'content/locations/';
  const maps = config.maps || 'content/maps/';
  const dir = config.characters || 'content/characters/';
  let staged = false;
  if (!repo.list(dir).length) {
    repo.stage({ path: (config.species || ['srd/species.json'])[0], text: json(SPECIES) });
    for (const c of CHARS) repo.stage({ path: `${dir}${c.id}.json`, text: json({ portrait: null, ...c }) });
    staged = true;
  }
  if (!repo.list(maps).length) {
    repo.stage({ path: `${maps}starfall-vale-s/vale.svg`, text: VALE_SVG });
    repo.stage({ path: `${maps}starfall-vale-s.json`, text: json({ id: 'starfall-vale-s', name: 'Starfall Vale', parent: 'main', image: `${maps}starfall-vale-s/vale.svg`, width: 1600, height: 1200 }) });
    repo.stage({ path: `${places}brinewick-s.json`, text: json({ id: 'brinewick-s', name: 'Brinewick', type: 'port', map: 'starfall-vale-s', x: 760, y: 830, description: 'Fishing town where the river meets the bay. The old road climbs to [[map:The Warden Stones]].' }) });
    repo.stage({ path: `${places}warden-stones-s.json`, text: json({ id: 'warden-stones-s', name: 'The Warden Stones', type: 'landmark', map: 'starfall-vale-s', x: 1090, y: 560, description: 'A ring of standing stones on the ridge.' }) });
    repo.stage({ path: `${places}kingshold-s.json`, text: json({ id: 'kingshold-s', name: 'Kingshold', type: 'city', x: 1800, y: 900, description: 'The capital.' }) });
    repo.stage({ path: `${places}barrow-deeps-s.json`, text: json({ id: 'barrow-deeps-s', name: 'The Barrow Deeps', type: 'dungeon', x: 2400, y: 1500 }) });
    staged = true;
  }
  if (!staged) return;
  await repo.flush('sandbox: sample party and atlas');
  await repo.tree(true);
}
