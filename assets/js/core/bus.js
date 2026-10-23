// The live bus: named rooms of versioned objects, synced through public MQTT brokers and encrypted per room
// (docs/live-model.md).
//
// Every object is its own retained MQTT topic `cr1/<roomId>/o/<key>`, so the brokers hold the current table: a
// client that joins gets every object on subscribe, and a change reaches everyone in ~50 ms. Each write carries a
// hybrid-logical-clock version [ms, clientId]; the newest version wins everywhere (deletes are tombstones, d: null).
// Payloads are AES-GCM sealed with the room key (iv + ciphertext), so a broker (or anyone listening) sees noise.
// Several brokers are used at once for redundancy: writes go to all of them, and a broker that missed or kept an
// older copy of an object is healed by any client that holds the newer one. Short-lived messages (rulers, pings,
// presence) go to `cr1/<roomId>/x/<channel>` without being retained.
import { MqttClient, topicMatches } from './mqtt.js';
import { sealBytes, openBytes } from './crypto.js';
import { utf8, b64encode, b64decode } from './util.js';

const PREFIX = 'cr1';
const BURST_QUIET = 700; // ms without a retained message after subscribing = that broker's snapshot is in
const BURST_MAX = 6000;
const HEAL_WINDOW = 14 * 24 * 3600 * 1000; // objects newer than this are re-sent to a broker that lacks them
const BIG = 96 * 1024; // larger retained payloads may be dropped by some brokers

/** Is version a newer than b? Versions are [ms, clientId]. */
export const newer = (a, b) => !b || (!!a && (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]));

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

// Sandbox / one-browser transport: BroadcastChannel between tabs, retained messages in localStorage.
const RKEY = 'cr:sandbox:retained';
class LocalTransport {
  constructor(url, { onMessage, onStatus }) {
    this.url = 'this browser';
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.state = 'offline';
    this.subs = new Set();
    this.ch = new BroadcastChannel('cr-sandbox-bus');
    this.ch.onmessage = (ev) => this.deliver(ev.data.topic, ev.data.data, false);
  }

  connect() {
    setTimeout(() => {
      this.state = 'online';
      this.onStatus('online');
      for (const f of this.subs) this.replay(f);
    }, 30);
    return this;
  }

  retained() { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } }

  replay(filter) {
    for (const [t, b] of Object.entries(this.retained())) if (topicMatches(filter, t)) this.onMessage(t, b64decode(b), true);
  }

  subscribe(filter) {
    if (this.subs.has(filter)) return;
    this.subs.add(filter);
    if (this.state === 'online') setTimeout(() => this.replay(filter), 0);
  }

  unsubscribe(filter) { this.subs.delete(filter); }

  publish(topic, bytes, { retain = false } = {}) {
    if (retain) {
      const r = this.retained();
      if (bytes.length) r[topic] = b64encode(bytes); else delete r[topic];
      try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { console.warn('[bus] sandbox storage full', e); }
    }
    this.ch.postMessage({ topic, data: bytes });
    this.deliver(topic, bytes, false); // a broker echoes to the sender too
    return true;
  }

  deliver(topic, data, retained) {
    for (const f of this.subs) if (topicMatches(f, topic)) { this.onMessage(topic, data, retained); return; }
  }

  close() { this.ch.close(); this.state = 'offline'; }
}

export class Bus {
  /** opts: {brokers: [wss urls], local: bool (sandbox), name: shown as the author of writes} */
  constructor({ brokers = [], local = false, name = '' } = {}) {
    this.cid = rid();
    this.name = name;
    this.clock = 0;
    this.rooms = new Map(); // name -> {name, key, id, objects: Map(key -> {t, d, by, raw})}
    this.byId = new Map();
    this.listeners = new Set();
    this.seen = new Set(); // ids of recent transient messages (each broker delivers its own copy)
    this.seenOrder = [];
    this.out = Promise.resolve(); // publishes are sealed and sent in order
    this.healing = new Set();
    this.waiters = new Map(); // room -> [resolve]
    const Transport = local ? LocalTransport : MqttClient;
    const urls = local ? ['local'] : brokers;
    this.transports = urls.map((url, idx) => {
      const tr = { idx, url, bursts: new Map(), chain: Promise.resolve(), client: null };
      tr.client = new Transport(url, {
        clientId: `cr-${this.cid}-${idx}`,
        onMessage: (topic, bytes, retained) => { tr.chain = tr.chain.then(() => this.receive(tr, topic, bytes, retained)).catch((e) => console.error('[bus]', e)); },
        onStatus: (state) => this.status(tr, state),
      });
      return tr;
    });
  }

  start() { for (const t of this.transports) t.client.connect(); return this; }

  stop() { for (const t of this.transports) t.client.close(); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(ev) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.error('[bus] listener failed', e); }
    }
  }

  /** {online, total, urls: [{url, state}]} */
  health() {
    return {
      online: this.transports.filter((t) => t.client.state === 'online').length,
      total: this.transports.length,
      urls: this.transports.map((t) => ({ url: t.client.url || t.url, state: t.client.state })),
    };
  }

  // ---------- rooms ----------

  /** Join a room: {key: CryptoKey, id: hex}. Resolves when its objects are in (or a timeout passes). */
  addRoom(name, { key, id }) {
    if (this.rooms.has(name)) this.removeRoom(name);
    const room = { name, key, id, objects: new Map() };
    this.rooms.set(name, room);
    this.byId.set(id, room);
    for (const t of this.transports) {
      if (t.client.state === 'online') this.startBurst(t, room);
      t.client.subscribe(`${PREFIX}/${id}/#`);
    }
    return this.ready(name);
  }

  removeRoom(name) {
    const room = this.rooms.get(name);
    if (!room) return;
    for (const t of this.transports) {
      t.client.unsubscribe(`${PREFIX}/${room.id}/#`);
      t.bursts.delete(name);
    }
    this.rooms.delete(name);
    this.byId.delete(room.id);
    this.emit({ type: 'room', room: name, removed: true });
  }

  hasRoom(name) { return this.rooms.has(name); }

  /** Resolves once some broker has delivered the room's snapshot (or after BURST_MAX when none can). */
  ready(name) {
    const room = this.rooms.get(name);
    if (!room) return Promise.resolve(false);
    if (room.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const list = this.waiters.get(name) || [];
      list.push(resolve);
      this.waiters.set(name, list);
      setTimeout(() => this.markReady(name, false), BURST_MAX + 500);
    });
  }

  markReady(name, synced = true) {
    const room = this.rooms.get(name);
    if (!room) return;
    if (synced) room.ready = true;
    const list = this.waiters.get(name) || [];
    this.waiters.delete(name);
    for (const fn of list) fn(synced);
    if (list.length || synced) this.emit({ type: 'room', room: name, ready: synced });
  }

  // ---------- reading ----------

  get(room, key) {
    const e = this.rooms.get(room)?.objects.get(key);
    return e ? e.d : undefined;
  }

  entry(room, key) { return this.rooms.get(room)?.objects.get(key) || null; }

  /** [[key, value]] of live (not deleted) objects whose key starts with prefix. */
  entries(room, prefix = '') {
    const out = [];
    const r = this.rooms.get(room);
    if (!r) return out;
    for (const [k, e] of r.objects) if (e.d != null && k.startsWith(prefix)) out.push([k, e.d]);
    return out;
  }

  /** Every object with its version (persistence): {key: {t, d}} including tombstones. */
  dump(room) {
    const out = {};
    const r = this.rooms.get(room);
    if (r) for (const [k, e] of r.objects) out[k] = { t: e.t, d: e.d, by: e.by };
    return out;
  }

  // ---------- writing ----------

  stamp() {
    const ms = Math.max(Date.now(), this.clock + 1);
    this.clock = ms;
    return [ms, this.cid];
  }

  observe(t) {
    if (Array.isArray(t) && typeof t[0] === 'number' && t[0] > this.clock && t[0] < Date.now() + 864e5) this.clock = t[0];
  }

  /** Write (or with value null, delete) an object. Applies locally at once; sealed and published in order. */
  put(roomName, key, value) {
    const room = this.rooms.get(roomName);
    if (!room) { console.warn('[bus] no room', roomName); return; }
    if (/[/#+]/.test(key)) throw new Error(`bad key ${key}`);
    const prev = room.objects.get(key);
    const entry = { t: this.stamp(), d: value ?? null, by: this.name };
    room.objects.set(key, entry);
    this.emit({ type: 'obj', room: roomName, key, value: entry.d, prev: prev?.d ?? null, by: this.name, local: true });
    this.out = this.out.then(async () => {
      const bytes = await this.seal(room, { k: key, t: entry.t, by: entry.by, d: entry.d });
      if (room.objects.get(key) === entry) entry.raw = bytes;
      if (bytes.length > BIG) console.warn(`[bus] ${key} is ${Math.round(bytes.length / 1024)} KB; some brokers keep only smaller ones`);
      this.publishAll(`${PREFIX}/${room.id}/o/${key}`, bytes, true);
    }).catch((e) => console.error('[bus] publish failed', e));
  }

  del(roomName, key) {
    if (this.get(roomName, key) == null) return;
    this.put(roomName, key, null);
  }

  /**
   * Merge objects from elsewhere (GitHub backup): newer versions replace ours and are re-published so the brokers
   * catch up. objs: {key: {t, d, by}}. -> number applied
   */
  merge(roomName, objs) {
    const room = this.rooms.get(roomName);
    if (!room || !objs) return 0;
    let n = 0;
    for (const [key, o] of Object.entries(objs)) {
      if (!o || !Array.isArray(o.t) || /[/#+]/.test(key)) continue;
      const cur = room.objects.get(key);
      if (cur && !newer(o.t, cur.t)) continue;
      this.observe(o.t);
      const entry = { t: o.t, d: o.d ?? null, by: o.by || '' };
      room.objects.set(key, entry);
      n++;
      this.emit({ type: 'obj', room: roomName, key, value: entry.d, prev: cur?.d ?? null, by: entry.by, local: false, restored: true });
      this.out = this.out.then(async () => {
        const bytes = await this.seal(room, { k: key, t: entry.t, by: entry.by, d: entry.d });
        if (room.objects.get(key) === entry) entry.raw = bytes;
        this.publishAll(`${PREFIX}/${room.id}/o/${key}`, bytes, true);
      }).catch((e) => console.error('[bus] restore publish failed', e));
    }
    return n;
  }

  /** Clear tombstones older than ms from the brokers and from memory. */
  purge(roomName, olderThanMs) {
    const room = this.rooms.get(roomName);
    if (!room) return 0;
    const cut = Date.now() - olderThanMs;
    let n = 0;
    for (const [k, e] of room.objects) {
      if (e.d == null && e.t[0] < cut) {
        room.objects.delete(k);
        this.publishAll(`${PREFIX}/${room.id}/o/${k}`, new Uint8Array(0), true);
        n++;
      }
    }
    return n;
  }

  /** A short-lived message to everyone in the room (not retained, not versioned). */
  send(roomName, channel, data) {
    const room = this.rooms.get(roomName);
    if (!room) return;
    const msg = { c: channel, i: rid(), f: this.cid, by: this.name, d: data };
    this.out = this.out.then(async () => {
      this.publishAll(`${PREFIX}/${room.id}/x/${channel}`, await this.seal(room, msg), false);
    }).catch((e) => console.error('[bus] send failed', e));
  }

  async seal(room, value) { return sealBytes(room.key, utf8.encode(JSON.stringify(value))); }

  publishAll(topic, bytes, retain) {
    for (const t of this.transports) t.client.publish(topic, bytes, { retain });
  }

  // ---------- receiving ----------

  status(tr, state) {
    if (state === 'online') for (const room of this.rooms.values()) this.startBurst(tr, room);
    this.emit({ type: 'status', ...this.health() });
  }

  startBurst(tr, room) {
    const b = { keys: new Set(), done: false, timer: 0, max: 0 };
    const finish = () => {
      if (b.done) return;
      b.done = true;
      clearTimeout(b.timer);
      clearTimeout(b.max);
      this.markReady(room.name, true);
      this.antiEntropy(tr, room, b.keys);
    };
    b.bump = () => { clearTimeout(b.timer); b.timer = setTimeout(finish, BURST_QUIET); };
    b.bump();
    b.max = setTimeout(finish, BURST_MAX);
    tr.bursts.set(room.name, b);
  }

  async receive(tr, topic, bytes, retained) {
    const parts = topic.split('/');
    if (parts[0] !== PREFIX || parts.length < 4) return;
    const room = this.byId.get(parts[1]);
    if (!room || !bytes.length) return;
    let env;
    try { env = JSON.parse(utf8.decode(await openBytes(room.key, bytes))); } catch { return; } // not ours / tampered
    if (parts[2] === 'o') {
      const key = parts.slice(3).join('/');
      if (env.k !== key || !Array.isArray(env.t)) return;
      this.observe(env.t);
      const burst = retained ? tr.bursts.get(room.name) : null;
      if (burst && !burst.done) { burst.keys.add(key); burst.bump(); }
      const cur = room.objects.get(key);
      if (!cur || newer(env.t, cur.t)) {
        room.objects.set(key, { t: env.t, d: env.d ?? null, by: env.by || '', raw: bytes });
        this.emit({ type: 'obj', room: room.name, key, value: env.d ?? null, prev: cur?.d ?? null, by: env.by || '', local: false });
      } else if (retained && newer(cur.t, env.t)) {
        this.heal(tr, room, key); // this broker kept an older copy
      }
    } else if (parts[2] === 'x') {
      if (env.f === this.cid || !env.i || this.seen.has(env.i)) return;
      this.seen.add(env.i);
      this.seenOrder.push(env.i);
      if (this.seenOrder.length > 600) this.seen.delete(this.seenOrder.shift());
      this.emit({ type: 'msg', room: room.name, channel: env.c, data: env.d, from: env.f, by: env.by || '' });
    }
  }

  async rawOf(room, key) {
    const e = room.objects.get(key);
    if (!e) return null;
    if (!e.raw) e.raw = await this.seal(room, { k: key, t: e.t, by: e.by, d: e.d });
    return e.raw;
  }

  heal(tr, room, key) {
    const id = `${tr.idx}|${room.name}|${key}`;
    if (this.healing.has(id)) return;
    this.healing.add(id);
    setTimeout(async () => {
      this.healing.delete(id);
      const raw = await this.rawOf(room, key);
      if (raw) tr.client.publish(`${PREFIX}/${room.id}/o/${key}`, raw, { retain: true });
    }, 300 + Math.random() * 1500);
  }

  /** After a broker's snapshot: send it the recent objects it doesn't have (it was down, or lost them). */
  antiEntropy(tr, room, have) {
    const cut = Date.now() - HEAL_WINDOW;
    const missing = [...room.objects.entries()].filter(([k, e]) => !have.has(k) && e.t[0] > cut).map(([k]) => k);
    if (!missing.length) return;
    setTimeout(async () => {
      for (let i = 0; i < missing.length; i++) {
        if (!this.rooms.has(room.name) || tr.client.state !== 'online') return;
        const raw = await this.rawOf(room, missing[i]);
        if (raw) tr.client.publish(`${PREFIX}/${room.id}/o/${missing[i]}`, raw, { retain: true });
        if (i % 25 === 24) await new Promise((r) => setTimeout(r, 60));
      }
    }, 400 + Math.random() * 1600);
  }
}
