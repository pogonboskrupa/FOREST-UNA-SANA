'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'nije nađena funkcija ' + name);
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error('nezatvorena funkcija ' + name);
}

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

console.log('Sječa i vjetroizvale — GFW DIST-ALERT parsiranje, pouzdanost, upit:');

t('_sjeParse svodi GFW integrated-alerts JSON na isti oblik tačke kao požari', () => {
  const src = extractFn('_sjeParse') + '\nreturn _sjeParse;';
  const _sjeParse = new Function(src)();
  const json = JSON.stringify({ data: [
    { longitude: 16.0, latitude: 44.8, gfw_integrated_alerts__date: '2026-06-01', gfw_integrated_alerts__confidence: 'high' },
    { longitude: 16.01, latitude: 44.81, gfw_integrated_alerts__date: '2026-06-03', gfw_integrated_alerts__confidence: 'nominal' }
  ] });
  const pts = _sjeParse(json);
  assert.strictEqual(pts.length, 2);
  assert.strictEqual(pts[0].la, 44.8);
  assert.strictEqual(pts[0].lo, 16.0);
  assert.strictEqual(pts[0].dt, '2026-06-01T00:00:00Z');
  assert.strictEqual(pts[0].rez, 30, 'DIST-ALERT piksel je 30m, ne 375m kao VIIRS');
  assert.ok(Number.isNaN(pts[0].frp));
});

t('_sjeParse vraća prazno za neispravan/nedostajući JSON', () => {
  const src = extractFn('_sjeParse') + '\nreturn _sjeParse;';
  const _sjeParse = new Function(src)();
  assert.deepStrictEqual(_sjeParse('<html>error</html>'), []);
  assert.deepStrictEqual(_sjeParse('{}'), []);
});

t('_sjePouzdanost mapira GFW nivoe (highest/high/nominal/low) na tekst+boju', () => {
  const src = extractFn('_sjePouzdanost') + '\nreturn _sjePouzdanost;';
  const _sjePouzdanost = new Function(src)();
  assert.strictEqual(_sjePouzdanost('highest').txt, 'visoka');
  assert.strictEqual(_sjePouzdanost('high').rang, 3);
  assert.strictEqual(_sjePouzdanost('nominal').txt, 'srednja');
  assert.strictEqual(_sjePouzdanost('low').rang, 1);
});

t('_sjeUrl gradi bbox oko referentne tačke sa gfw_integrated_alerts datasetom', () => {
  const src = "const _SJE_RADIUS_KM = 50;\n" + extractFn('_sjeUrl') + '\nreturn _sjeUrl;';
  const _sjeUrl = new Function(src)();
  const url = _sjeUrl({ la: 44.8, lo: 16.0 }, 30);
  assert.ok(url.startsWith('https://data-api.globalforestwatch.org/dataset/gfw_integrated_alerts/latest/query/json?sql='));
  const sql = decodeURIComponent(url.split('sql=')[1]);
  assert.ok(sql.includes('gfw_integrated_alerts__date >='));
  assert.ok(sql.includes('latitude >='));
  assert.ok(sql.includes('longitude >='));
  assert.ok(/LIMIT \d+/.test(sql));
});

console.log('\n' + pass + ' prošlo, 0 palo — sječa i vjetroizvale');
