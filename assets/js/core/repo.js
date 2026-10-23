// The data repository (by default Stone-Wardens, under content/combat-ring/): durable backups of the table, uploaded
// images, and the characters this app reads from Stone-Wardens. Live play runs on the bus (core/bus.js); the repo is
// where things are kept between sessions, so writes here are few and batched.
import { kv, safe } from './idb.js';
import { utf8, gitBlobSha } from './util.js';
import { GitHubBackend } from './github.js';
import { SandboxBackend } from './sandbox.js';

const blobCache = safe(kv('cr-cache', 'blobs')); // sha -> Uint8Array (content-addressed, never stale)
const MAX_CACHE_BYTES = 30 * 1024 * 1024;
const TREE_GAP = 4000;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', json: 'application/json', bin: 'application/octet-stream',
};
export const mimeOf = (p) => MIME[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream';

class Repo {
  constructor() {
    this.backend = null;
    this.files = new Map(); // path -> {path, sha, size}
    this.treeAt = 0;
    this.treeP = null;
    this.urls = new Map(); // sha -> objectURL
    this.queue = Promise.resolve();
    this.pending = []; // changes waiting for the next commit
    this.commitTimer = 0;
    this.listeners = new Set();
  }

  get mode() { return this.backend?.mode || 'none'; }

  use(backend) { this.backend = backend; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch (e) { console.error(e); } } }

  /** The file listing, refreshed at most every TREE_GAP ms unless forced. */
  async tree(force = false) {
    if (this.treeP) return this.treeP;
    if (!force && this.treeAt && Date.now() - this.treeAt < TREE_GAP) return this.files;
    this.treeP = this.backend.tree().then(({ files }) => {
      this.files = new Map(files.map((f) => [f.path, f]));
      this.treeAt = Date.now();
      this.emit({ type: 'tree' });
      return this.files;
    }).finally(() => { this.treeP = null; });
    return this.treeP;
  }

  /**
   * Re-list one folder (its direct files) without the whole tree: true when it changed since the last look (the first
   * look counts as a change). Cheap enough to run every few seconds (see GitHubBackend.listDir).
   */
  async refreshDir(dir) {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    this.dirTags ||= new Map();
    const { etag, files, left } = await this.backend.listDir(prefix, this.dirTags.get(prefix) || null);
    if (left != null) this.rateLeft = left; // GitHub requests left this hour (callers slow down when it runs low)
    if (!files) return false;
    this.dirTags.set(prefix, etag);
    const direct = (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/');
    for (const p of [...this.files.keys()]) if (direct(p)) this.files.delete(p);
    for (const f of files) this.files.set(f.path, f);
    return true;
  }

  has(path) { return this.files.has(path); }
  sha(path) { return this.files.get(path)?.sha || null; }
  list(prefix) { return [...this.files.values()].filter((f) => f.path.startsWith(prefix)); }

  async bytesBySha(sha, size = 0) {
    const hit = await blobCache.get(sha);
    if (hit) return hit;
    const bytes = await this.backend.readBytes(sha);
    if (size < MAX_CACHE_BYTES) blobCache.set(sha, bytes);
    return bytes;
  }

  /** Bytes of a file by path (null when the repo doesn't have it). */
  async bytes(path) {
    let f = this.files.get(path);
    if (!f) { await this.tree(); f = this.files.get(path); }
    return f ? this.bytesBySha(f.sha, f.size) : null;
  }

  async text(path) { const b = await this.bytes(path); return b ? utf8.decode(b) : null; }

  async json(path) {
    const t = await this.text(path);
    if (t == null) return null;
    try { return JSON.parse(t); } catch (e) { console.warn('[repo] bad JSON', path, e); return null; }
  }

  /** An object URL for a stored file: ref = {s: sha, p: path, m: mime}. Retries briefly for brand-new uploads. */
  async url(ref) {
    if (!ref) return null;
    let sha = ref.s || this.sha(ref.p);
    if (!sha && ref.p) { await this.tree(true).catch(() => {}); sha = this.sha(ref.p); }
    if (!sha) return null;
    if (this.urls.has(sha)) return this.urls.get(sha);
    let bytes = null;
    for (let i = 0; i < 6 && !bytes; i++) {
      try { bytes = await this.bytesBySha(sha); } catch (e) {
        if (e.status !== 404 && !/missing blob/.test(e.message || '')) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    if (!bytes) return null;
    const u = URL.createObjectURL(new Blob([bytes], { type: ref.m || mimeOf(ref.p || '') }));
    this.urls.set(sha, u);
    return u;
  }

  /**
   * Upload bytes as a blob now (readable by sha at once) and commit them to path with the next batch.
   * -> {p, s, m} reference for the bus.
   */
  async upload(path, bytes, mime) {
    let sha;
    if (this.backend.createBlob) sha = await this.backend.createBlob(bytes);
    else sha = await gitBlobSha(bytes);
    blobCache.set(sha, bytes);
    this.stage({ path, sha });
    return { p: path, s: sha, m: mime || mimeOf(path) };
  }

  /** Stage a change ({path, text} | {path, sha} | {path, bytes} | {path, delete}) for a commit shortly. */
  stage(change, { delay = 1200, message } = {}) {
    this.pending = this.pending.filter((c) => c.path !== change.path);
    this.pending.push(change);
    if (message) this.pendingMessage = message;
    clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.flush().catch((e) => this.emit({ type: 'error', error: e })), delay);
  }

  /** Commit everything staged (one commit). Commits run one at a time. */
  flush(message) {
    clearTimeout(this.commitTimer);
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (!this.pending.length) return null;
      const changes = this.pending;
      const msg = message || this.pendingMessage || 'Combat Ring: update';
      this.pending = [];
      this.pendingMessage = null;
      this.emit({ type: 'saving' });
      try {
        const res = await this.backend.commit(changes, msg);
        if (res?.files) { this.files = new Map(res.files.map((f) => [f.path, f])); this.treeAt = Date.now(); }
        this.emit({ type: 'saved', count: changes.length });
        return res;
      } catch (e) {
        // Put them back (unless newer versions were staged meanwhile) so the next flush retries.
        for (const c of changes) if (!this.pending.some((p) => p.path === c.path)) this.pending.push(c);
        this.emit({ type: 'error', error: e });
        throw e;
      }
    });
    return this.queue;
  }

  dirty() { return this.pending.length > 0; }
}

export const repo = new Repo();

export function backendFor(auth, sandbox) {
  return sandbox ? new SandboxBackend() : new GitHubBackend(auth);
}
