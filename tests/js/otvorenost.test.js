'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../../static/js/otvorenost.js');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✔ ' + ime); };
console.log('Otvorenost odjela ŠKP-om:');

const kv = (x0, y0, a, b) => [[[x0, y0], [x0 + a, y0], [x0 + a, y0 + b], [x0, y0 + b]]];
const ob = { x0: -1000, y0: -1000, x1: 3000, y1: 3000 };

t('raster udaljenosti: tačan do pola ćelije, i dijagonalno', () => {
  const R = O.otvRaster([[[0, 0], [2000, 0]]], ob, 20);
  const D = (x, y) => R.D[Math.floor((y - R.y0) / R.k) * R.nx + Math.floor((x - R.x0) / R.k)];
  for (const [x, y, ok] of [[500, 10, 10], [500, 410, 410], [1000, 1990, 1990], [2500, 1500, Math.hypot(500, 1500)], [-500, -500, Math.hypot(500, 500)]])
    assert.ok(Math.abs(D(x, y) - ok) <= 15, `(${x},${y}) ${D(x, y)} ≈ ${ok}`);
  const duz = R.Lp.reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(duz - 2000) < 1, 'dužina puta u ćelijama = 2000 m');
});

t('bez puteva: udaljenost beskonačna, odjel neotvoren', () => {
  const R = O.otvRaster([], ob, 25), o = O.otvOdjel(R, kv(0, 0, 500, 500), O.OTV_ZADANO);
  assert.strictEqual(o.klasa, 'neotvoren'); assert.strictEqual(o.pct, 0); assert.strictEqual(o.sr, 3000); assert.strictEqual(o.gust, 0);
});

t('odjel uz put: otvoren; djelimično; daleko: neotvoren; gustoća m/ha', () => {
  const R = O.otvRaster([[[-500, 0], [2500, 0]]], ob, 20), z = { zona: 400, pragOtv: 70, pragDj: 30 };
  const uz = O.otvOdjel(R, kv(0, -200, 500, 400), z); // put kroz sredinu, sve ≤ 200 m
  assert.strictEqual(uz.klasa, 'otvoren'); assert.strictEqual(uz.pct, 100);
  assert.ok(Math.abs(uz.gust - 500 / 20) < 1.5, 'gustoća ~25 m/ha: ' + uz.gust);
  const dj = O.otvOdjel(R, kv(0, 100, 500, 600), z); // y 100–700: ≤ 400 m je 300 od 600
  assert.strictEqual(dj.klasa, 'djelimicno'); assert.ok(Math.abs(dj.pct - 50) < 4, dj.pct);
  const da = O.otvOdjel(R, kv(0, 1000, 500, 500), z);
  assert.strictEqual(da.klasa, 'neotvoren'); assert.strictEqual(da.pct, 0); assert.ok(Math.abs(da.sr - 1250) < 15, da.sr);
  assert.strictEqual(O.otvKlasa(69.9, z), 'djelimicno'); assert.strictEqual(O.otvKlasa(70, z), 'otvoren'); assert.strictEqual(O.otvKlasa(29.9, z), 'neotvoren');
});

t('poligon s rupom: ćelije rupe se ne broje', () => {
  const R = O.otvRaster([[[0, -100], [1000, -100]]], ob, 10);
  let n1 = 0, n2 = 0;
  O.otvCelijeUnutra(R, kv(0, 0, 400, 400), () => n1++);
  O.otvCelijeUnutra(R, kv(0, 0, 400, 400).concat(kv(100, 100, 200, 200)), () => n2++);
  assert.strictEqual(n1, 1600); assert.strictEqual(n2, 1600 - 400);
});

t('UI: sekcija u projektovanju puta, skripta u APK-u i SW, red u kartici poligona', () => {
  const H = R('index.html');
  assert.ok(H.includes('id="otv-sekcija"') && H.includes('<script src="static/js/otvorenost.js"></script>') && H.includes('if (window.USFOtv) USFOtv.render();'));
  assert.ok(H.includes("['Otvorenost ŠKP',"));
  assert.ok(R('sw.js').includes("'./static/js/otvorenost.js'") && R('android/copy-assets.sh').includes('static/js/otvorenost.js'));
  const js = R('static/js/otvorenost.js');
  assert.ok(js.includes("map.getPane('otvPane').style.pointerEvents = 'none'") && js.includes('interactive: false'), 'prikaz ne krade dodir');
  // globalna imena ne smiju se poklopiti s index.html
  const imena = [...js.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  imena.forEach(i => assert.ok(!new RegExp('(?:const|let|function)\\s+' + i + '\\b').test(H), 'sudar imena: ' + i));
});

console.log('\n' + pass + ' prošlo, 0 palo — otvorenost');
