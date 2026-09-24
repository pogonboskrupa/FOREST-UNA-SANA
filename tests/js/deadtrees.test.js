'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../../static/js/deadtrees-layer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const root = {};
new Function('window', 'globalThis', SRC)(root, root);
const D = root.USFDeadtrees;

let pass = 0;
const _testovi = [];
function t(name, fn) { _testovi.push([name, fn]); }

console.log('Šumarstvo — Sušenje (deadtrees.earth COG):');

t('cogUrl gradi URL javnog COG-a i odbija nepoznatu godinu/vrstu', () => {
  assert.strictEqual(D.cogUrl('deadwood', '2025'),
    'https://data2.deadtrees.earth/assets/v1/dte_maps/run_v1004_v1000_crop_half_fold_None_checkpoint_199_deadwood_2025.cog.tif');
  assert.ok(D.cogUrl('forest', 2017).endsWith('_forest_2017.cog.tif'));
  assert.strictEqual(D.cogUrl('deadwood', '2016'), null);
  assert.strictEqual(D.cogUrl('x', '2025'), null);
});

t('boja: slabo sušenje prozirno, jako neprozirno (kao v1.4.10), monotono tamnija', () => {
  assert.strictEqual(D.boja(5, 'zuta'), null);
  const slabo = D.boja(20, 'zuta'), jako = D.boja(140, 'zuta');
  assert.ok(slabo[3] > 0 && slabo[3] <= 51, 'slabo sušenje mora biti blijedo (alfa ≤ 0.2)');
  for (const v of [74, 100, 140]) {
    const staro = Math.min(1, 0.5 + 0.47 * (v / 255 - 0.04) / 0.5);
    assert.ok(Math.abs(D.alfa(v) - staro) < 1e-9, 'jako sušenje nepromijenjeno na ' + v);
  }
  assert.ok(jako[3] >= 235, 'realni maksimum (~140/255) mora biti skoro neproziran');
  assert.ok(jako[1] < slabo[1], 'više sušenja = tamnija nijansa');
  assert.deepStrictEqual(D.boja(140, 'nepostojeca'), D.boja(140, 'zuta'));
  assert.ok(Object.keys(D.PALETE).includes('ljubicasta'));
});

t('obrubi dodaje tamnu konturu samo oko obojenih piksela', () => {
  const T = 4, px = new Uint8ClampedArray(T * T * 4);
  px[(1 * T + 1) * 4 + 3] = 255;
  D.obrubi(px, T);
  const a = (x, y) => px[(y * T + x) * 4 + 3];
  assert.strictEqual(a(1, 1), 255);
  assert.ok(a(0, 1) > 0 && a(2, 1) > 0 && a(1, 0) > 0 && a(1, 2) > 0);
  assert.strictEqual(a(3, 3), 0);
  assert.strictEqual(a(0, 0), 0, 'dijagonala ne dobija obrub');
  const slabo = new Uint8ClampedArray(T * T * 4);
  slabo[(1 * T + 1) * 4 + 3] = 40;
  D.obrubi(slabo, T);
  assert.strictEqual(slabo.filter((_, i) => i % 4 === 3 && slabo[i] > 0).length, 1, 'slabo sušenje bez obruba');
});

t('alfa: šum ispod ~4% prozirno, puna vrijednost neprozirna, monotono', () => {
  assert.strictEqual(D.alfa(0), 0);
  assert.strictEqual(D.alfa(10), 0);
  assert.strictEqual(D.alfa(255), 1);
  assert.ok(D.alfa(140) > 0.9);
  let prev = 0;
  for (let v = 0; v <= 255; v++) { const a = D.alfa(v); assert.ok(a >= prev - 1e-9, 'nije monotono na ' + v); prev = a; }
  assert.strictEqual(D.alfa(NaN), 0);
});

t('projDef pokriva WGS84, Web Mercator, LAEA Evropa i UTM', () => {
  for (const e of [4326, 3857, 3035, 32633, 32734]) assert.ok(D.projDef(e), 'EPSG:' + e);
  assert.ok(D.projDef(32633).includes('+zone=33'));
  assert.ok(D.projDef(32734).includes('+south'));
  assert.strictEqual(D.projDef(31276), null);
});

t('izaberiNivo uzima najgrublji overview koji nije grublji od traženog', () => {
  const f = [1, 2, 4, 8, 16];
  assert.strictEqual(D.izaberiNivo(f, 0.5), 0);
  assert.strictEqual(D.izaberiNivo(f, 1), 0);
  assert.strictEqual(D.izaberiNivo(f, 3), 1);
  assert.strictEqual(D.izaberiNivo(f, 8), 3);
  assert.strictEqual(D.izaberiNivo(f, 100), 4);
});

t('index.html: sloj je u sumarstvoPane (iznad offline karte) i ograničen na kanton', () => {
  assert.ok(HTML.includes('src="static/js/deadtrees-layer.js"'));
  const blok = HTML.slice(HTML.indexOf('_SUM_LAYERS.susenje = new Sloj('), HTML.indexOf('_SUM_LAYERS.susenje = new Sloj(') + 400);
  assert.ok(blok.includes("pane: 'sumarstvoPane'"));
  assert.ok(blok.includes('bounds: L.latLngBounds([_USK_BBOX.latMin'));
  assert.ok(HTML.includes("susenje: 'sum-susenje-switch'"));
  assert.ok(HTML.includes('id="sum-susenje-switch"'));
});

t('geotiff.js je lokalno (offline APK) i lijeno učitan', () => {
  assert.ok(fs.statSync(path.join(__dirname, '../../static/libs/geotiff.js')).size > 100000);
  assert.ok(SRC.includes("const LIB = 'static/libs/geotiff.js'"));
  assert.ok(!HTML.includes('src="static/libs/geotiff.js"'), 'ne učitavati 300 KB pri startu');
});

// Regresija (v1.4.8 na telefonu): "4702962233905250000 exceeds MAX_SAFE_INTEGER"
// — 206 odgovor nije sadržavao traženi opseg pa je geotiff čitao double kao offset.
t('provjeriOdgovor odbija pomjeren opseg, 200 i krivu dužinu', () => {
  assert.deepStrictEqual(D.parsirajOpseg('bytes=0-65535'), { start: 0, end: 65535, total: null });
  assert.deepStrictEqual(D.parsirajOpseg('bytes 10-19/100'), { start: 10, end: 19, total: 100 });
  const t0 = { start: 0, end: 65535 };
  D.provjeriOdgovor(t0, 206, 'bytes 0-65535/9000000', 65536);
  assert.throws(() => D.provjeriOdgovor(t0, 206, 'bytes 8-65543/9000000', 65536), /umjesto 0-65535/);
  assert.throws(() => D.provjeriOdgovor(t0, 200, null, 9000000), /range/);
  assert.throws(() => D.provjeriOdgovor(t0, 206, 'bytes 0-65535/9000000', 100), /dužina/);
  // kraj fajla: server skrati opseg na total-1
  D.provjeriOdgovor({ start: 90, end: 199 }, 206, 'bytes 90-99/100', 10);
  // bez izloženog Content-Range (CORS) prihvati kraći odgovor, ne duži
  D.provjeriOdgovor({ start: 90, end: 199 }, 206, null, 10);
  assert.throws(() => D.provjeriOdgovor({ start: 0, end: 9 }, 206, null, 11), /dužina/);
});

t('rangeKlijent ide preko AndroidRange mosta i vraća provjeren odgovor', async () => {
  const pozivi = [];
  root.AndroidRange = { get(url, a, e, id) { pozivi.push([a, e]); setTimeout(() => root._usfRangeCb(id, 206, 'bytes ' + a + '-' + e + '/1000', Buffer.alloc(+e - +a + 1, 7).toString('base64'), ''), 0); } };
  root.atob = s => Buffer.from(s, 'base64').toString('binary');
  const r = await D.rangeKlijent('https://data2.deadtrees.earth/x.tif').request({ headers: { Range: 'bytes=100-199' } });
  assert.deepStrictEqual(pozivi, [['100', '199']]);
  assert.strictEqual(r.status, 206);
  assert.strictEqual(r.getHeader('Content-Range'), 'bytes 100-199/1000');
  assert.strictEqual((await r.getData()).byteLength, 100);
  delete root.AndroidRange;
});

t('APK: Range ide kroz nativni most, ne kroz WebView intercept', () => {
  const J = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), 'utf8');
  assert.ok(J.includes('addJavascriptInterface(new RangeBridge(), "AndroidRange")'));
  assert.ok(J.includes('RANGE_HOST = "data2.deadtrees.earth"'));
  assert.ok(!J.includes('proxyCorsRange'));
  assert.ok(SRC.includes('fromCustomClient(rangeKlijent(url)'));
});

(async () => {
  for (const [name, fn] of _testovi) {
    try { await fn(); pass++; console.log('  ✔ ' + name); }
    catch (e) { console.error('  ✘ ' + name + '\n      ' + e.message); process.exitCode = 1; }
  }
  console.log('\n' + pass + ' prošlo, ' + (_testovi.length - pass) + ' palo — sušenje');
})();
