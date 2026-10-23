// Local-only backend with the same interface as GitHubBackend (IndexedDB). Used for ?sandbox and local dev.
import { kv, safe } from './idb.js';
import { gitBlobSha } from './util.js';

const files = safe(kv('cr-sandbox', 'files')); // path -> {sha, bytes}
const blobs = safe(kv('cr-sandbox-blobs', 'blobs')); // sha -> bytes (uploaded before their commit, like git blobs)

export class SandboxBackend {
  constructor() { this.mode = 'sandbox'; }

  async tree() {
    const all = (await files.values()) || [];
    return {
      head: { commit: 'sandbox', tree: 'sandbox' },
      files: all.map((f) => ({ path: f.path, sha: f.sha, size: f.bytes.length })),
    };
  }

  /** Same answer as GitHubBackend.listDir (files: null when unchanged since etag). */
  async listDir(dir, etag = null) {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const { files: all } = await this.tree();
    const here = all.filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/')).sort((a, b) => a.path.localeCompare(b.path));
    const tag = here.map((f) => f.sha).join(',');
    return tag === etag ? { etag, files: null } : { etag: tag, files: here };
  }

  async readBytes(sha) {
    const b = await blobs.get(sha);
    if (b) return b;
    const all = (await files.values()) || [];
    const f = all.find((x) => x.sha === sha);
    if (!f) throw new Error(`sandbox: missing blob ${sha}`);
    return f.bytes;
  }

  async createBlob(bytes) {
    const sha = await gitBlobSha(bytes);
    await blobs.set(sha, bytes);
    return sha;
  }

  async commit(changes) {
    for (const c of changes) {
      if (c.delete) { await files.del(c.path); continue; }
      const bytes = c.sha && !c.bytes && c.text == null ? await this.readBytes(c.sha) : c.bytes || new TextEncoder().encode(c.text);
      await files.set(c.path, { path: c.path, bytes, sha: await gitBlobSha(bytes) });
    }
    return this.tree();
  }
}
