// ?sandbox: a stand-in Stone-Wardens party (and species) in the browser-only repo, so the ring can be tried and
// tested without the real site. Written once; the sandbox keeps whatever you change.
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

export async function seedSandbox() {
  await repo.tree(true);
  const dir = config.characters || 'content/characters/';
  if (repo.list(dir).length) return;
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
  repo.stage({ path: (config.species || ['srd/species.json'])[0], text: json(SPECIES) });
  for (const c of CHARS) repo.stage({ path: `${dir}${c.id}.json`, text: json({ portrait: null, ...c }) });
  repo.stage({ path: `${config.locations || 'content/locations/'}brinewick-s.json`, text: json({ id: 'brinewick-s', name: 'Brinewick' }) });
  await repo.flush('sandbox: sample party');
  await repo.tree(true);
}
