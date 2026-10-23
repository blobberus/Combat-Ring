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

const CHARS = [
  { id: 'brannoc-stoneheart-s1', name: 'Brannoc Stoneheart', player: 'Mira', species: { id: 'dwarf' }, classes: [{ id: 'fighter', level: 3 }], style: { accent: '#8e1b1b' } },
  { id: 'ilyra-vael-s2', name: 'Ilyra Vael', player: 'Tomas', species: { id: 'elf', subspecies: 'elven-lineage-drow' }, classes: [{ id: 'rogue', level: 3 }], style: { accent: '#22507c' } },
  { id: 'pell-underbough-s3', name: 'Pell Underbough', player: 'Ana', species: { id: 'halfling' }, classes: [{ id: 'cleric', level: 3 }], style: { accent: '#23675f' } },
  { id: 'sera-quill-s4', name: 'Sera Quill', player: 'Jun', species: { id: 'human' }, classes: [{ id: 'wizard', level: 3 }], overrides: { speed: 35 }, style: { accent: '#6e3a5c' } },
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
