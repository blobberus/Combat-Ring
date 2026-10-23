// Who is at the table: every client says hello on the table room every HELLO_MS; a peer unseen for 3 rounds is gone.
// Also relays the short-lived things others draw: rulers and pings.
import { world, me } from './world.js';
import { colorFor } from './tools.js';

const HELLO_MS = 15000;
const peers = new Map(); // client id -> {name, chars, dm, color, seen}
const listeners = new Set();
let timer = 0;
let replyTimer = 0;

export const presence = {
  list: () => [...peers.values()].sort((a, b) => (b.dm - a.dm) || a.name.localeCompare(b.name)),
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
const notify = () => { for (const fn of listeners) fn(); };

function hello() {
  world.send('table', 'hello', { name: me.name() || 'A Warden', chars: me.chars(), dm: world.dm, color: colorFor(me.name()) });
}

export function startPresence({ onRuler, onPing } = {}) {
  hello();
  clearInterval(timer);
  timer = setInterval(() => {
    hello();
    const cut = Date.now() - HELLO_MS * 3;
    let changed = false;
    for (const [k, p] of peers) if (p.seen < cut) { peers.delete(k); changed = true; }
    if (changed) notify();
  }, HELLO_MS);
  world.bus.on((ev) => {
    if (ev.type !== 'msg' || ev.room !== 'table') return;
    if (ev.channel === 'hello') {
      const isNew = !peers.has(ev.from);
      peers.set(ev.from, { id: ev.from, name: ev.data?.name || ev.by || 'A Warden', chars: ev.data?.chars || [], dm: !!ev.data?.dm, color: ev.data?.color, seen: Date.now() });
      if (isNew) { clearTimeout(replyTimer); replyTimer = setTimeout(hello, 300 + Math.random() * 700); }
      notify();
    } else if (ev.channel === 'bye') {
      if (peers.delete(ev.from)) notify();
    } else if (ev.channel === 'ruler') onRuler?.(ev.from, ev.data);
    else if (ev.channel === 'ping') onPing?.(ev.from, ev.data);
  });
  addEventListener('pagehide', () => world.send('table', 'bye', {}));
}

/** Say hello now (after the name, characters or DM mode change). */
export const announce = () => hello();
