// node tools/test_model.mjs — the pure table model (assets/js/ring/model.js).
import assert from 'node:assert/strict';
import * as M from '../assets/js/ring/model.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

const scene = { grid: { size: 100, ft: 5 }, cols: 20, rows: 10 };

test('distances by rule', () => {
  const a = { x: 50, y: 50 };
  const b = { x: 350, y: 250 }; // 3 right, 2 down
  assert.equal(M.distanceFt(a, b, scene, 'five'), 15);
  assert.equal(M.distanceFt(a, b, scene, 'alternate'), 20); // 1 straight (5) + 2 diagonals (5 + 10)
  assert.equal(M.distanceFt(a, { x: 450, y: 450 }, scene, 'alternate'), 30); // 4 diagonals: 5+10+5+10
  assert.equal(M.distanceFt(a, { x: 450, y: 450 }, scene, 'five'), 20);
  assert.equal(M.distanceFt(a, { x: 350, y: 450 }, scene, 'euclid'), 25);
});

test('feet and pixels', () => {
  assert.equal(M.ftToPx(30, scene), 600);
  assert.equal(M.pxToFt(600, scene), 30);
  assert.deepEqual(M.sceneSize(scene), { w: 2000, h: 1000 });
});

test('snapping odd and even sizes', () => {
  assert.deepEqual(M.snapPoint(130, 170, 1, scene), { x: 150, y: 150 });
  assert.deepEqual(M.snapPoint(130, 170, 2, scene), { x: 100, y: 200 });
  assert.deepEqual(M.snapPoint(260, 240, 3, scene), { x: 250, y: 250 });
});

test('point in polygon', () => {
  const sq = M.rectPts(0, 0, 100, 100);
  assert.ok(M.pointInPolygon(50, 50, sq));
  assert.ok(!M.pointInPolygon(150, 50, sq));
  const tri = [0, 0, 100, 0, 0, 100];
  assert.ok(M.pointInPolygon(10, 10, tri));
  assert.ok(!M.pointInPolygon(90, 90, tri));
});

test('fog layers apply in order', () => {
  const cover = { pts: M.rectPts(0, 0, 1000, 1000), mode: 'hide', z: 1 };
  const hole = { pts: M.rectPts(100, 100, 300, 300), mode: 'reveal', z: 2 };
  const recover = { pts: M.rectPts(200, 200, 250, 250), mode: 'hide', z: 3 };
  const shapes = M.sortShapes([recover, hole, cover]);
  assert.ok(M.fogged(50, 50, shapes));
  assert.ok(!M.fogged(150, 150, shapes));
  assert.ok(M.fogged(225, 225, shapes));
  assert.ok(!M.fogged(50, 50, shapes.map((s) => (s === cover ? { ...s, on: false } : s))));
  assert.ok(!M.fogged(5000, 5000, shapes));
});

test('simplify keeps corners', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push(i, 0);
  for (let i = 1; i <= 100; i++) pts.push(100, i);
  const s = M.simplify(pts, 1);
  assert.deepEqual(s, [0, 0, 100, 0, 100, 100]);
});

test('initiative order and turns', () => {
  const order = M.sortInitiative([
    { id: 'a', value: 12, name: 'Ash' }, { id: 'b', value: 18, name: 'Bram' }, { id: 'c', value: 12, tie: 16, name: 'Cael' },
    { id: 'd', value: null, name: 'Dun' },
  ]);
  assert.deepEqual(order.map((e) => e.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(M.nextTurn(order, null, 1), { current: 'b', round: 1 });
  assert.deepEqual(M.nextTurn(order, 'a', 1), { current: 'b', round: 2 });
  assert.deepEqual(M.nextTurn(order, 'b', 2, -1), { current: 'a', round: 1 });
});

test('dice and CR', () => {
  assert.equal(M.rollFormula('7'), 7);
  const r = M.rollFormula('2d6+3', () => 0.999);
  assert.equal(r, 15);
  assert.equal(M.rollFormula('1d20-1', () => 0), 0);
  assert.equal(M.crValue('1/4'), 0.25);
  assert.equal(M.crValue({ cr: '5' }), 5);
});

function dmState() {
  return new Map([
    ['dmeta', { live: 's1', banner: { time: 'Dusk', location: 'Brinewick', showTime: false, showLocation: true }, turn: { active: true, round: 2, current: 'dm-g2' } }],
    ['scene.s1', { id: 's1', name: 'Docks', cols: 10, rows: 10, grid: { size: 100, ft: 5 }, map: { media: 'm1' }, light: { level: 'dark' } }],
    ['scene.s2', { id: 's2', name: 'Secret lair', cols: 10, rows: 10 }],
    ['media.m1', { w: 1000, h: 1000, pub: { p: 'content/combat-ring/media/m1.webp', s: 'abc', m: 'image/webp' } }],
    ['fog.s1.f1', { pts: M.rectPts(600, 0, 1000, 1000), mode: 'hide', z: 1 }],
    ['fog.s1.f2', { pts: M.rectPts(0, 0, 100, 100), mode: 'hide', z: 2, on: false }],
    ['item.g1', { scene: 's1', kind: 'creature', name: 'Goblin 1', alias: 'Small figure', x: 250, y: 250, hp: { cur: 3, max: 7 }, statsVisible: 'hp', init: 14, stats: { ac: 15 } }],
    ['item.g2', { scene: 's1', kind: 'creature', name: 'Goblin boss', x: 750, y: 250, init: 17 }],
    ['item.g3', { scene: 's1', kind: 'creature', name: 'Hidden one', x: 150, y: 150, hidden: true, init: 20 }],
    ['item.o1', { scene: 's1', kind: 'creature', name: 'Ogre', x: 350, y: 350, statsVisible: 'full', hp: { cur: 59, max: 59 }, stats: { ac: 11, cr: '2' } }],
    ['item.c1', { scene: 's1', kind: 'prop', prop: 'crate', name: 'Crate', x: 50, y: 50, movable: true }],
    ['item.n1', { scene: 's1', kind: 'note', title: 'Trap', notes: 'DC 13', x: 450, y: 450 }],
    ['item.n2', { scene: 's1', kind: 'note', title: 'Old sign', playerText: 'Beware', revealed: true, x: 550, y: 450 }],
    ['item.x1', { scene: 's2', kind: 'creature', name: 'Lich', x: 50, y: 50 }],
  ]);
}

test('projection shows only what players may see', () => {
  const out = M.project(dmState());
  const meta = out.get('meta');
  assert.equal(meta.live, 's1');
  assert.deepEqual(meta.banner, { location: 'Brinewick' }); // time hidden
  const sc = out.get('scene.s1');
  assert.equal(sc.map.s, 'abc');
  assert.equal(sc.light.level, 'dark');
  assert.ok(!out.has('scene.s2'));
  assert.ok(out.has('fog.s1.f1'));
  assert.ok(!out.has('fog.s1.f2')); // turned off
  const g1 = out.get('it.g1');
  assert.equal(g1.name, 'Small figure');
  assert.equal(g1.health.word, 'Bloodied');
  assert.equal(g1.stats, undefined);
  assert.ok(!out.has('it.g2')); // under fog
  assert.ok(!out.has('it.g3')); // hidden
  assert.ok(!out.has('it.x1')); // other scene
  assert.equal(out.get('it.o1').stats.ac, 11);
  assert.equal(out.get('it.o1').stats.hp.max, 59);
  assert.ok(out.get('it.c1').movable);
  assert.ok(!out.has('it.n1')); // DM note
  assert.equal(out.get('it.n2').kind, 'notice');
  assert.equal(out.get('it.n2').text, 'Beware');
  assert.equal(out.get('ini.dm-g1').value, 14);
  assert.ok(!out.has('ini.dm-g2'));
  assert.ok(!out.has('ini.dm-g3'));
  assert.deepEqual(out.get('turn'), { active: true, round: 2, current: 'hidden' });
  assert.deepEqual(out.get('show'), { on: false });
  for (const [, v] of out) assert.ok(!JSON.stringify(v).includes('DC 13'));
});

test('blackout and pending media', () => {
  const dm = dmState();
  dm.set('media.m1', { w: 1000, h: 1000 });
  let out = M.project(dm);
  assert.deepEqual(out.get('scene.s1').map, { pending: true });
  dm.set('dmeta', { ...dm.get('dmeta'), blackout: true });
  out = M.project(dm);
  assert.equal(out.get('meta').live, null);
  assert.ok(![...out.keys()].some((k) => k.startsWith('it.') || k.startsWith('scene.')));
});

test('slideshow projection', () => {
  const dm = dmState();
  dm.set('deck.d1', { title: 'Arrival', slides: [{ media: 'm1', caption: 'The docks', anim: 'zoom-in', dur: 6 }, { url: 'https://x/y.gif' }], loop: true });
  dm.set('dmeta', { ...dm.get('dmeta'), presenting: { deck: 'd1', index: 5, at: 1 } });
  const show = M.project(dm).get('show');
  assert.equal(show.on, true);
  assert.equal(show.index, 1);
  assert.equal(show.slides[0].img.s, 'abc');
  assert.equal(show.slides[1].img.url, 'https://x/y.gif');
});

test('characters are locked unless the DM unlocks them on the live scene', () => {
  const dm = new Map([
    ['dmeta', { live: 's1', unlocked: { s1: { ana: true, bo: false }, s2: { cy: true } } }],
    ['scene.s1', { id: 's1', name: 'Yard', cols: 10, rows: 10, grid: { size: 100, ft: 5 } }],
  ]);
  assert.deepEqual(M.project(dm).get('meta').unlocked, ['ana']);
  dm.set('dmeta', { live: 's1' });
  assert.deepEqual(M.project(dm).get('meta').unlocked, []);
});

test('slide titles and descriptions the DM keeps back', () => {
  const dm = new Map([
    ['dmeta', { presenting: { deck: 'd1', index: 0 } }],
    ['deck.d1', { title: 'The Vision', hideTitle: true, slides: [
      { url: 'https://x/a.jpg', title: 'Ash', caption: 'Smoke rises', hideCaption: true },
      { url: 'https://x/b.jpg', title: 'The Spire', hideTitle: true, caption: 'It calls' },
    ] }],
  ]);
  const show = M.project(dm).get('show');
  assert.equal(show.title, '');
  assert.deepEqual(show.slides.map((s) => [s.title, s.caption]), [['Ash', ''], ['', 'It calls']]);
  assert.ok(!/Vision|Smoke|Spire/.test(JSON.stringify(show)));
});

test('initiative ties without the Dexterity scores', () => {
  const dm = new Map([
    ['dmeta', { live: 's1' }],
    ['scene.s1', { id: 's1', name: 'Yard', cols: 10, rows: 10, grid: { size: 100, ft: 5 } }],
    ['item.a', { scene: 's1', kind: 'creature', name: 'Ogre', x: 150, y: 150, init: 12, tie: 8, statsVisible: 'none' }],
    ['item.b', { scene: 's1', kind: 'creature', name: 'Goblin', x: 350, y: 150, init: 12, tie: 14, statsVisible: 'none' }],
    ['item.c', { scene: 's1', kind: 'creature', name: 'Wolf', x: 550, y: 150, init: 12, tie: 15, hidden: true }],
  ]);
  const out = M.project(dm);
  assert.equal(out.get('ini.dm-a').tie, 1);
  assert.equal(out.get('ini.dm-b').tie, 2); // ranks among what players see: the hidden wolf leaves no gap
  for (const [, v] of out) assert.ok(!/"tie":(8|14|15)\b/.test(JSON.stringify(v)));
  const players = M.sortInitiative([...out].filter(([k]) => k.startsWith('ini.')).map(([k, v]) => ({ id: k, ...v })));
  const dmOrder = M.sortInitiative([{ id: 'ini.dm-a', name: 'Ogre', value: 12, tie: 8 }, { id: 'ini.dm-b', name: 'Goblin', value: 12, tie: 14 }]);
  assert.deepEqual(players.map((e) => e.id), dmOrder.map((e) => e.id));
});

test('projection diff', () => {
  const next = new Map([['meta', { live: 'a' }], ['it.x', { x: 1 }]]);
  const cur = [['meta', { live: 'a' }], ['it.y', { x: 2 }], ['pin.p', { t: 1 }]];
  const d = M.diffProjection(cur, next);
  assert.deepEqual(d, [['it.x', { x: 1 }], ['it.y', null]]);
});

console.log(`\n${n} tests passed`);
