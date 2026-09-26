'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const O = require('../../static/js/odjeli.js');
const root = {};
new Function('window', 'globalThis', fs.readFileSync(path.join(__dirname, '../../static/js/dem-local.js'), 'utf8'))(root, root);
const D = root.USFDem;
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✔ ' + name); };
console.log('Odjeli — izvještaj, praćenje, izvoz, lokalni DEM:');

t('KML izvoz: poligon sa rupom, tačka, ExtendedData i stil; interna svojstva se ne izvoze', () => {
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[16, 44], [16.1, 44], [16.1, 44.1], [16, 44]], [[16.02, 44.02], [16.03, 44.02], [16.03, 44.03], [16.02, 44.02]]] },
      properties: { naziv: 'Ploha 1', ha: 12.5, _boja: '#d99a32' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [16.05, 44.05] }, properties: { naziv: 'A & B <x>' } }
  ] };
  const k = O._gjUKml(fc, 'Test');
  assert.ok(k.includes('<outerBoundaryIs>') && k.includes('<innerBoundaryIs>'));
  assert.ok(k.includes('<Data name="ha"><value>12.5</value></Data>'));
  assert.ok(!k.includes('_boja'), 'interna svojstva ne idu u ExtendedData');
  assert.ok(k.includes('<color>ff329ad9</color>'), 'KML boja je AABBGGRR');
  assert.ok(k.includes('A &amp; B &lt;x&gt;'));
  assert.ok(k.includes('<Point><coordinates>16.050000,44.050000</coordinates></Point>'));
});

t('CSV izvoz: BOM za Excel, navodnici za zarez i navodnike', () => {
  const c = O._uCsv(['a', 'b'], [['x,y', 'rekao "da"'], [1, null]]);
  assert.ok(c.startsWith('﻿a,b\n'));
  assert.ok(c.includes('"x,y","rekao ""da"""'));
  assert.ok(c.endsWith('\n1,'));
});

t('praćenje: prva provjera postavlja početno stanje, kasnije se javljaju samo noviji alarmi', () => {
  const kes = {};
  const a = (dt, lo) => ({ la: 44.88, lo, dt, conf: 'high' });
  assert.strictEqual(O._odjeliNoviAlarmi(kes, 'k', [a('2026-09-10T00:00:00Z', 16.1)]).length, 0, 'bez obavijesti za stare alarme');
  assert.strictEqual(kes.k.vidjeno, '2026-09-10T00:00:00Z');
  const novi = O._odjeliNoviAlarmi(kes, 'k', [a('2026-09-10T00:00:00Z', 16.1), a('2026-09-20T00:00:00Z', 16.2)]);
  assert.deepStrictEqual(novi.map(x => x.dt), ['2026-09-20T00:00:00Z']);
  assert.strictEqual(O._odjeliNoviAlarmi(kes, 'k', [a('2026-09-20T00:00:00Z', 16.2)]).length, 0, 'isti alarm se ne javlja dvaput');
  assert.strictEqual(kes.k.pts.length, 2);
});

t('praćenje: GFW upit je ograničen na obuhvat praćenih odjela', () => {
  const u = decodeURIComponent(O._odjeliAlarmUrl([16.14, 44.878, 16.17, 44.892], '2026-08-27'));
  assert.ok(u.includes('gfw_integrated_alerts'));
  assert.ok(u.includes("gfw_integrated_alerts__date >= '2026-08-27'"));
  assert.ok(u.includes('latitude >= 44.8780 AND latitude <= 44.8920 AND longitude >= 16.1400 AND longitude <= 16.1700'));
});

t('lokalni DEM: bilinearna visina, nodata, Terrarium kodiranje i nagib/ekspozicija', () => {
  // 4×4 DEM, 1" piksel, visina raste 10 m po pikselu prema istoku.
  const W = 4, H = 4, data = new Int16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = 100 + 10 * x;
  const d = { data, W, H, ox: 16, oy: 45, rx: 1 / 3600, ry: -1 / 3600 };
  assert.ok(Math.abs(D.visina(d, 45 - 1.5 / 3600, 16 + 1.5 / 3600) - 110) < 1e-6);
  assert.strictEqual(D.visina(d, 44, 17), null);
  data[5] = D.NODATA;
  assert.strictEqual(D.visina(d, 45 - 1.5 / 3600, 16 + 1.5 / 3600), null);
  data[5] = 110;
  const ne = D.nagibEkspozicija(d, 1, 1, 45);
  assert.ok(ne.eksp > 265 && ne.eksp < 275, 'teren raste prema istoku → strana okrenuta zapadu');
  assert.ok(ne.nagib > 20 && ne.nagib < 30, 'nagib ~24° (10 m na ~21,9 m)');
  // Terrarium: R*256 + G + B/256 − 32768 = visina
  const big = { data: new Int16Array(4 * 4).fill(523), W: 4, H: 4, ox: 15.9, oy: 45.1, rx: 0.1, ry: -0.1 };
  const rgba = D.terrariumRGBA(big, 12, Math.floor((16 + 180) / 360 * 4096), Math.floor((1 - Math.log(Math.tan(45 * Math.PI / 180) + 1 / Math.cos(45 * Math.PI / 180)) / Math.PI) / 2 * 4096));
  assert.ok(rgba, 'pločica unutar obuhvata');
  assert.strictEqual(rgba[0] * 256 + rgba[1] + rgba[2] / 256 - 32768, 523);
  assert.strictEqual(D.terrariumRGBA(big, 12, 0, 0), null, 'pločica van obuhvata');
});

t('integracija: DEM rezerva u Terrarium dohvatu, dugme izvještaja, izvoz u panelima, fajlovi u APK-u i kešu', () => {
  const terr = HTML.slice(HTML.indexOf('async function _getTerrariumTile'), HTML.indexOf('function _terrariumDecodeTile'));
  assert.ok(terr.includes('USFDem.terrariumPlocica') && terr.includes('if (!blob) return lokalno();'));
  assert.ok(HTML.includes('📊 Izvještaj odjela') && HTML.includes('_odjelIzvjestaj(${L.stamp(layer)})'));
  ["_izvoz('pozari','kml')", "_izvoz('poremecaji','geojson')", "_izvozDugmad('susenje')", 'id="odjeli-pracenje"'].forEach(x => assert.ok(HTML.includes(x), x));
  const sw = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
  const kop = fs.readFileSync(path.join(__dirname, '../../android/copy-assets.sh'), 'utf8');
  ['static/js/dem-local.js', 'static/js/odjeli.js', 'static/data/dem_opcine.tif'].forEach(f => {
    assert.ok(sw.includes("'./" + f + "'"), 'SW: ' + f);
    assert.ok(kop.includes(f), 'APK: ' + f);
  });
  assert.ok(sw.includes("'./geo/odjeli.kml'"), 'ugrađeni odjeli se keširaju ako postoje');
});

console.log('\n' + pass + ' prošlo, 0 palo — odjeli');
