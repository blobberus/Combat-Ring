// node tools/make_dm_vault.mjs <DM password> [out=dm-vault.json]
// Writes a fresh DM vault: a random data key wrapped by the password (PBKDF2-SHA256 600k, AES-GCM), the same format
// the app creates on first DM login. Only the wrapped key is written; the password and the raw key are not.
// Replacing the vault makes earlier DM backups unreadable, so do this once, before the first session.
import fs from 'node:fs';
import { createDmVault } from '../assets/js/core/crypto.js';

const [password, out = 'dm-vault.json'] = process.argv.slice(2);
if (!password) { console.error('usage: node tools/make_dm_vault.mjs <DM password> [out]'); process.exit(1); }
if (fs.existsSync(out)) { console.error(`${out} exists; delete it first if you really want a new DM key`); process.exit(1); }
const { vault } = await createDmVault(password);
fs.writeFileSync(out, `${JSON.stringify(vault, null, 2)}\n`);
console.log(`wrote ${out}`);
