// Images: resize and convert uploads (WebP), seal the DM's (maps, slides, custom art) so players can't open them
// early, publish a plain copy when the DM shows them, and turn any image reference into something an <img> can load.
//
// References: a plain URL string; {url}; a repo file {p, s (blob sha), m (mime)}; or a DM media id (`media.<id>` in
// the DM room: {name, mime, w, h, sealed: {p, s}, pub: {p, s, m} | null}).
import { repo, mimeOf } from '../core/repo.js';
import { dataPath } from '../core/auth.js';
import { sealBytes, openBytes, randomId } from '../core/crypto.js';
import { kv, safe } from '../core/idb.js';
import { world } from './world.js';
import { dmSession } from './dm.js';
import { K } from './model.js';

const plainCache = safe(kv('cr-media', 'plain')); // media id -> {bytes, mime} (the DM's own uploads, unsealed)
const idUrls = new Map(); // media id -> objectURL
const publishing = new Map(); // media id -> Promise

export const isUrl = (s) => typeof s === 'string' && /^(https?:|data:|blob:|assets\/|\.\.?\/)/.test(s);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be read.'));
    img.src = src;
  });
}

/** Decode any image file/blob -> {img (drawable), w, h, revoke()} */
export async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return { img, w: img.naturalWidth, h: img.naturalHeight, revoke: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Render (part of) an image to a new WebP.
 * opts: {crop: {x, y, w, h} in source pixels, outW, outH, maxSide, quality, circle (transparent outside a circle)}
 * -> {bytes, mime, w, h}
 */
export async function renderImage(blob, { crop = null, outW = 0, outH = 0, maxSide = 4096, quality = 0.88, circle = false } = {}) {
  const { img, w, h, revoke } = await decodeImage(blob);
  try {
    const c = crop || { x: 0, y: 0, w, h };
    let ow = outW || c.w, oh = outH || c.h;
    const scale = Math.min(1, maxSide / Math.max(ow, oh));
    ow = Math.max(1, Math.round(ow * scale));
    oh = Math.max(1, Math.round(oh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (circle) {
      g.beginPath();
      g.arc(ow / 2, oh / 2, Math.min(ow, oh) / 2, 0, Math.PI * 2);
      g.clip();
    }
    g.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, ow, oh);
    let out = await canvasBlob(canvas, 'image/webp', quality);
    let mime = 'image/webp';
    if (!out || out.type !== 'image/webp') { out = await canvasBlob(canvas, 'image/png'); mime = 'image/png'; }
    return { bytes: new Uint8Array(await out.arrayBuffer()), mime, w: ow, h: oh };
  } finally { revoke(); }
}

const ANIMATED = new Set(['image/gif', 'video/mp4', 'video/webm']);
const extFor = (mime) => ({ 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/svg+xml': 'svg' }[mime] || 'bin');

/** Prepare an upload: animations and videos stay as they are (up to 20 MB), stills become WebP. */
export async function prepareUpload(file, { maxSide = 4096, keepAnimated = true } = {}) {
  const mime = file.type || mimeOf(file.name || '');
  if (keepAnimated && ANIMATED.has(mime)) {
    if (file.size > 20 * 1024 * 1024) throw new Error('That file is over 20 MB. Use a smaller one, or link it by URL.');
    let w = 0, h = 0;
    if (mime.startsWith('image/')) { const d = await decodeImage(file); w = d.w; h = d.h; d.revoke(); }
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime, w, h };
  }
  return renderImage(file, { maxSide });
}

/** DM: store an image sealed (only the DM can open it until it is published). -> media id */
export async function addMedia({ bytes, mime, w, h }, { name = '', kind = 'image' } = {}) {
  if (!dmSession.dataKey) throw new Error('DM mode is locked');
  const id = randomId(8);
  const sealed = await sealBytes(dmSession.dataKey, bytes);
  const ref = await repo.upload(dataPath(`dm/media/${id}.bin`), sealed, 'application/octet-stream');
  await plainCache.set(id, { bytes, mime });
  world.dPut(K.media(id), { name, kind, mime, w, h, size: bytes.length, sealed: { p: ref.p, s: ref.s }, pub: null, at: Date.now() });
  return id;
}

async function plainBytes(id) {
  const hit = await plainCache.get(id);
  if (hit) return hit;
  const m = world.d(K.media(id));
  if (!m?.sealed || !dmSession.dataKey) return null;
  const sealed = await repo.bytesBySha(m.sealed.s);
  const bytes = await openBytes(dmSession.dataKey, sealed);
  const out = { bytes, mime: m.mime };
  plainCache.set(id, out);
  return out;
}

/** DM: make a plain copy players can load (once; later calls reuse it). -> pub ref */
export function publishMedia(id) {
  const m = world.d(K.media(id));
  if (!m) return Promise.resolve(null);
  if (m.pub) return Promise.resolve(m.pub);
  if (!publishing.has(id)) {
    publishing.set(id, (async () => {
      const plain = await plainBytes(id);
      if (!plain) throw new Error('The image is missing');
      const ref = await repo.upload(dataPath(`media/${id}.${extFor(plain.mime)}`), plain.bytes, plain.mime);
      world.patch('dm', K.media(id), { pub: ref });
      return ref;
    })().finally(() => publishing.delete(id)));
  }
  return publishing.get(id);
}

/** Anyone: store an image in the clear (a player's token art). -> {p, s, m} */
export async function uploadPlain(prepared, name) {
  const path = dataPath(`media/${name}-${randomId(4)}.${extFor(prepared.mime)}`);
  return repo.upload(path, prepared.bytes, prepared.mime);
}

/** Any image reference -> URL for <img> (or null). */
export async function mediaUrl(src) {
  if (!src) return null;
  if (isUrl(src)) return src;
  if (typeof src === 'object') {
    if (src.url) return src.url;
    if (src.p || src.s) return repo.url(src);
    return null;
  }
  // a DM media id
  if (idUrls.has(src)) return idUrls.get(src);
  const m = world.d(K.media(src));
  let url = null;
  if (dmSession.dataKey) {
    const plain = await plainBytes(src).catch((e) => { console.warn('[media]', e); return null; });
    if (plain) url = URL.createObjectURL(new Blob([plain.bytes], { type: plain.mime }));
  }
  if (!url && m?.pub) url = await repo.url(m.pub);
  if (url) idUrls.set(src, url);
  return url;
}

/** Synchronous lookup for URLs already resolved (avoids flicker on re-render). */
export function cachedUrl(src) {
  if (!src) return null;
  if (isUrl(src)) return src;
  if (typeof src === 'object') return src.url || (src.s && repo.urls.get(src.s)) || null;
  return idUrls.get(src) || null;
}

export const mediaKey = (src) => (!src ? '' : typeof src === 'string' ? src : src.url || src.s || src.p || '');
