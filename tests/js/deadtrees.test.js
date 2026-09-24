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
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

console.log('Šumarstvo — Sušenje (deadtrees.earth COG):');

t('cogUrl gradi URL javnog COG-a i odbija nepoznatu godinu/vrstu', () => {
  assert.strictEqual(D.cogUrl('deadwood', '2025'),
    'https://data2.deadtrees.earth/assets/v1/dte_maps/run_v1004_v1000_crop_half_fold_None_checkpoint_199_deadwood_2025.cog.tif');
  assert.ok(D.cogUrl('forest', 2017).endsWith('_forest_2017.cog.tif'));
  assert.strictEqual(D.cogUrl('deadwood', '2016'), null);
  assert.strictEqual(D.cogUrl('x', '2025'), null);
});

t('alfa: šum ispod ~4% prozirno, puna vrijednost neprozirna, monotono', () => {
  assert.strictEqual(D.alfa(0), 0);
  assert.strictEqual(D.alfa(10), 0);
  assert.strictEqual(D.alfa(255), 1);
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

console.log('\n' + pass + ' prošlo, 0 palo — sušenje');
