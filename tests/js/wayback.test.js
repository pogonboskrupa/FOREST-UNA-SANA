const assert = require('assert');
const W = require('../../static/js/wayback.js');
const lista = require('../../static/data/wayback_izdanja.json');
assert.ok(lista.length > 100 && lista[0][0] < '2015' && /^\d{4}-\d{2}-\d{2}$/.test(lista[0][0]));
const g = W.poGodinama(lista, 10, 2026);
assert.ok(g.length >= 9 && g[0].godina === 2026, 'najnovija godina prva');
g.forEach(x => { assert.strictEqual(x.datum.slice(0, 4), String(x.godina)); assert.strictEqual(x.datum, x.svi[x.svi.length - 1][0], 'zadnje izdanje godine'); });
assert.ok(g[g.length - 1].godina >= 2017, 'najviše 10 godina');
assert.deepStrictEqual(W.parsirajKonfig({ 5: { itemTitle: 'World Imagery (Wayback 2020-03-04)' }, 6: { itemTitle: 'x' } }), [['2020-03-04', 5]]);
assert.ok(W.urlZa(32553).includes('/tile/32553/{z}/{y}/{x}'));
console.log('wayback ok');

{
  const { udioOblaka } = require('../../static/js/wayback.js');
  const px = (r, g, b, a = 255) => [r, g, b, a];
  const d = Uint8ClampedArray.from([...px(250, 250, 250), ...px(30, 90, 40), ...px(60, 100, 50), ...px(0, 0, 0, 0)]);
  console.assert(Math.abs(udioOblaka(d) - 1 / 3) < 1e-9, 'udio oblaka');
  console.assert(udioOblaka(new Uint8ClampedArray(0)) === null, 'prazno');
  console.log('wayback oblaci ok');
}

{
  const lj = W.poGodinama(lista, 10, 2026, 'ljeto'), zi = W.poGodinama(lista, 10, 2026, 'zima');
  assert.ok(lj.length > 3 && zi.length > 3, 'obje sezone imaju godine');
  lj.forEach(x => x.svi.forEach(([d]) => assert.ok([5, 6, 7, 8, 9].includes(+d.slice(5, 7)), 'ljeto ' + d)));
  zi.forEach(x => x.svi.forEach(([d]) => assert.ok([12, 1, 2, 3].includes(+d.slice(5, 7)), 'zima ' + d)));
  assert.strictEqual(W.poGodinama(lista, 10, 2026, 'sve').length, g.length, 'sve = bez filtera');
  console.log('wayback sezone ok');
}
