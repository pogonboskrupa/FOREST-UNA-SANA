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

t('preporuka: najkraći krak od puta koji otvara odjel; nagib kraka u savjetu', () => {
  const R = O.otvRaster([[[-500, 0], [2500, 0]]], ob, 20), z = { zona: 300, pragOtv: 70, pragDj: 30 };
  const odj = kv(0, 600, 500, 400); // y 600–1000: daleko od puta (0 %)
  const p = O.otvPreporuka(R, odj, z);
  assert.strictEqual(p.pctPrije, 0); assert.strictEqual(p.klasa, 'otvoren'); assert.ok(p.pctPoslije >= 70);
  assert.ok(Math.abs(p.S[1]) < 15, 'krak počinje na putu (y ≈ 0)');
  assert.ok(p.T[1] > 600 && p.T[1] < 1000 && p.len >= 600 && p.len < 1000, 'kraj u odjelu, dužina ' + p.len);
  assert.ok(p.haNovo > 10 && p.haNovo <= 20.5, 'novo otvoreno ' + p.haNovo + ' ha');
  assert.strictEqual(p.dMin > 580, true);
  const blago = O.otvSavjet(p, z, 40, 8).join(' '), strmo = O.otvSavjet(p, z, 150, 8).join(' ');
  assert.ok(/u granici od 8 %/.test(blago), blago);
  assert.ok(/serpentine/.test(strmo) && /najmanje ~1875 m/.test(strmo), strmo);
  // bez puteva u rasteru
  assert.ok(O.otvPreporuka(O.otvRaster([], ob, 25), odj, z).bezPuta);
  assert.ok(/glavni ŠKP/.test(O.otvSavjet({ bezPuta: true }, z, null, 8)[0]));
});

t('preporuka: velik odjel — jedan krak nije dovoljan, savjet za drugi krak / vlake', () => {
  const R = O.otvRaster([[[-500, 0], [3500, 0]]], { x0: -1000, y0: -1000, x1: 4000, y1: 4000 }, 25), z = { zona: 200, pragOtv: 70, pragDj: 30 };
  const p = O.otvPreporuka(R, kv(0, 300, 2500, 2500), z);
  assert.ok(p.klasa !== 'otvoren' && p.pctPoslije > p.pctPrije);
  assert.ok(O.otvSavjet(p, z, null, 8).some(t => /drugim krakom|traktorskim vlakama/.test(t)));
});

t('UI: sekcija u projektovanju puta, skripta u APK-u i SW, red u kartici poligona', () => {
  const H = R('index.html'), js = R('static/js/otvorenost.js');
  assert.ok(H.includes('id="otv-sekcija"') && H.includes('<script src="static/js/otvorenost.js"></script>') && H.includes('if (window.USFOtv) USFOtv.render();'));
  assert.ok(H.includes("['Otvorenost ŠKP',") && H.includes("USFOtv.preporukaId(${id})") && H.includes('id="otv-drive"'), 'kartica → preporuka, Drive u sekciji');
  assert.ok(js.includes('function prepHtml()') && js.includes("_rdSetPoint('start', a[0], a[1]); _rdSetPoint('end', b[0], b[1]);"), 'preporuka → projektovanje trase');
  const kmlLista = JSON.parse(R('static/data/kml_drive.json'));
  assert.ok(kmlLista.some(k => /putevi/i.test(k.naziv)), 'ŠKP s Drive-a u listi');
  assert.ok(R('sw.js').includes("'./static/js/otvorenost.js'") && R('android/copy-assets.sh').includes('static/js/otvorenost.js'));
  assert.ok(js.includes("map.getPane('otvPane').style.pointerEvents = 'none'") && js.includes('interactive: false'), 'prikaz ne krade dodir');
  // globalna imena ne smiju se poklopiti s index.html
  const imena = [...js.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  imena.forEach(i => assert.ok(!new RegExp('(?:const|let|function)\\s+' + i + '\\b').test(H), 'sudar imena: ' + i));
});

console.log('\n' + pass + ' prošlo, 0 palo — otvorenost');
