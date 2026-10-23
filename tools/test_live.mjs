// node tools/test_live.mjs [broker-url…] — the live bus against real public brokers (needs the network).
// Two clients share a throwaway room: writes arrive, the newest version wins, a late joiner gets the retained
// snapshot, transient messages arrive once, a wrong key reads nothing, and the room is cleaned up afterwards.
import assert from 'node:assert/strict';
import { Bus } from '../assets/js/core/bus.js';
import { roomKeys } from '../assets/js/core/crypto.js';

const brokers = process.argv.slice(2).length ? process.argv.slice(2) : ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(40); } return false; };

const secret = `test-${Math.random().toString(36).slice(2)}`;
const room = await roomKeys(secret, 'table');
const other = await roomKeys(`${secret}-x`, 'table');

const a = new Bus({ brokers, name: 'A' }).start();
const b = new Bus({ brokers, name: 'B' }).start();
await Promise.all([a.addRoom('table', room), b.addRoom('table', room)]);
console.log('rooms ready', a.health(), b.health());

a.put('table', 'tok.one', { x: 1 });
assert.ok(await until(() => b.get('table', 'tok.one')?.x === 1), 'B sees A\'s write');
const t0 = Date.now();
a.put('table', 'tok.one', { x: 2 });
assert.ok(await until(() => b.get('table', 'tok.one')?.x === 2));
console.log('update latency', Date.now() - t0, 'ms');

// concurrent writes: both converge on the same (newest) value
a.put('table', 'tok.two', { by: 'a' });
b.put('table', 'tok.two', { by: 'b' });
assert.ok(await until(() => a.get('table', 'tok.two')?.by && a.get('table', 'tok.two')?.by === b.get('table', 'tok.two')?.by));
console.log('converged on', a.get('table', 'tok.two'));

// transient messages: delivered once even with two brokers, not to the sender
let got = 0;
b.on((ev) => { if (ev.type === 'msg' && ev.channel === 'ping') got++; });
a.send('table', 'ping', { x: 5 });
await wait(1500);
assert.equal(got, 1, 'one ping');

// delete = tombstone
a.del('table', 'tok.two');
assert.ok(await until(() => b.get('table', 'tok.two') === null));

// late joiner gets the snapshot; a wrong key gets nothing
const c = new Bus({ brokers, name: 'C' }).start();
await c.addRoom('table', room);
assert.equal(c.get('table', 'tok.one')?.x, 2, 'late joiner has the retained object');
assert.equal(c.get('table', 'tok.two'), null, 'and the tombstone');
const d = new Bus({ brokers, name: 'D' }).start();
await d.addRoom('table', { key: other.key, id: room.id });
assert.equal(d.entries('table').length, 0, 'wrong key reads nothing');

// clean the throwaway room off the brokers
for (const bus of [a]) {
  for (const k of Object.keys(bus.dump('table'))) bus.put('table', k, null);
  await wait(500);
  bus.purge('table', -1);
}
await wait(800);
for (const bus of [a, b, c, d]) bus.stop();
console.log('live bus ok');
process.exit(0);
