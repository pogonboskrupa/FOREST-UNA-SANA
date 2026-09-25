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


const DST = "function dst(la1,lo1,la2,lo2){const R=6371000,a=Math.sin((la2-la1)*Math.PI/360)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin((lo2-lo1)*Math.PI/360)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}\n";
const JEZGRO = DST + "const _SJE_PIKSEL_DEG = 0.00025, _SJE_GRUPA_M = 300;\n" +
  ['_sjePouzdanost', '_sjePikselHa', '_sjePikselKljuc', '_sjeGrupisi'].map(extractFn).join('\n');
const tacka = (la, lo, dt, conf) => ({ la, lo, dt: dt + 'T00:00:00Z', conf: conf || 'high' });

t('_sjeGrupisi: ista sječa kroz sedmice je JEDNA zona (bez ±1 dan pravila iz Požara)', () => {
  const _sjeGrupisi = new Function(JEZGRO + '\nreturn _sjeGrupisi;')();
  const pts = [
    tacka(44.80000, 16.00000, '2026-08-01'), tacka(44.80025, 16.00000, '2026-08-20'),
    tacka(44.80050, 16.00025, '2026-09-10', 'nominal'),
    tacka(44.85000, 16.10000, '2026-09-01')           // ~9 km dalje → druga zona
  ];
  const z = _sjeGrupisi(pts);
  assert.strictEqual(z.length, 2);
  const velika = z.find(g => g.broj === 3);
  assert.ok(velika, 'tri alarma u razmaku od 3 sedmice moraju biti jedna zona');
  assert.strictEqual(new Date(velika.prvi).toISOString().slice(0, 10), '2026-08-01');
  assert.strictEqual(new Date(velika.zadnji).toISOString().slice(0, 10), '2026-09-10');
  assert.strictEqual(velika.conf, 'high', 'zona nosi najveću pouzdanost');
});

t('_sjeGrupisi: isti piksel viđen više puta broji se jednom; površina = pikseli × ~0,055 ha', () => {
  const f = new Function(JEZGRO + '\nreturn { _sjeGrupisi, _sjePikselHa };')();
  const pts = [tacka(44.80001, 16.00001, '2026-09-01'), tacka(44.80002, 16.00002, '2026-09-05'), tacka(44.80026, 16.00001, '2026-09-05')];
  const [z] = f._sjeGrupisi(pts);
  assert.strictEqual(z.broj, 2);
  const ha1 = f._sjePikselHa(44.8);
  assert.ok(ha1 > 0.05 && ha1 < 0.06, 'piksel 0.00025° na 45° ≈ 0,055 ha, dobijeno ' + ha1);
  assert.ok(Math.abs(z.ha - 2 * ha1) < 1e-6);
  assert.deepStrictEqual(f._sjeGrupisi([]), []);
});

t('_sjeStarost: svježe / srednje / staro po danima', () => {
  const src = "const _SJE_STAROST = " + HTML.match(/const _SJE_STAROST = (\[[\s\S]*?\]);/)[1] + ";\n" + extractFn('_sjeStarost') + '\nreturn _sjeStarost;';
  const _sjeStarost = new Function(src)();
  const sad = Date.parse('2026-09-25T00:00:00Z');
  assert.strictEqual(_sjeStarost(sad - 3 * 86400000, sad).id, 'novo');
  assert.strictEqual(_sjeStarost(sad - 30 * 86400000, sad).id, 'srednje');
  assert.strictEqual(_sjeStarost(sad - 80 * 86400000, sad).id, 'staro');
  assert.strictEqual(_sjeStarost(NaN, sad).id, 'staro');
});

t('_sjeFiltriraj + _sjeStatusZa: filter pouzdanosti, sakrivanje provjerenih, sortiranje', () => {
  const src = DST + "const _SJE_STATUSI = { legalna:{}, bespravna:{}, vjetroizvala:{}, lazni:{} };\n" +
    ['_sjePouzdanost', '_sjeStatusZa', '_sjeFiltriraj'].map(extractFn).join('\n') + '\nreturn { _sjeFiltriraj, _sjeStatusZa };';
  const f = new Function(src)();
  const zone = [
    { la: 44.80, lo: 16.00, conf: 'high', zadnji: 3, d: 900, ha: 1 },
    { la: 44.90, lo: 16.10, conf: 'low', zadnji: 9, d: 100, ha: 5 },
    { la: 44.70, lo: 15.90, conf: 'highest', zadnji: 1, d: 500, ha: 2 }
  ];
  const statusi = [{ la: 44.8005, lo: 16.0005, st: 'legalna' }];      // ~70 m od zone 0
  assert.strictEqual(f._sjeStatusZa(zone[0], statusi).st, 'legalna');
  assert.strictEqual(f._sjeStatusZa(zone[1], statusi), null);
  const ids = (r) => r.map(g => zone.indexOf(g));
  assert.deepStrictEqual(ids(f._sjeFiltriraj(zone, { sort: 'novo' }, statusi)), [1, 0, 2]);
  assert.deepStrictEqual(ids(f._sjeFiltriraj(zone, { sort: 'blizu' }, statusi)), [1, 2, 0]);
  assert.deepStrictEqual(ids(f._sjeFiltriraj(zone, { sort: 'vece' }, statusi)), [1, 2, 0]);
  assert.deepStrictEqual(ids(f._sjeFiltriraj(zone, { samoVisoka: true, sort: 'novo' }, statusi)), [0, 2]);
  assert.deepStrictEqual(ids(f._sjeFiltriraj(zone, { sakrijProvjerene: true, sort: 'novo' }, statusi)), [1, 2]);
});

t('keš čuva do 5000 alarma u kompaktnom obliku i vraća isti oblik tačke', () => {
  const mem = {};
  const ls = { setItem: (k, v) => { mem[k] = v; }, getItem: k => mem[k] ?? null };
  const src = "const _SJE_CACHE_KEY='k';\n" + extractFn('_sjeSaveCache') + '\n' + extractFn('_sjeLoadCache') + '\nreturn { _sjeSaveCache, _sjeLoadCache };';
  const f = new Function('localStorage', src)(ls);
  const pts = Array.from({ length: 6000 }, (_, i) => ({ la: 44.8 + i * 1e-5, lo: 16, dt: '2026-09-01T00:00:00Z', conf: 'high' }));
  f._sjeSaveCache(pts, '30d');
  const c = f._sjeLoadCache();
  assert.strictEqual(c.pts.length, 5000);
  assert.strictEqual(c.okvir, '30d');
  assert.deepStrictEqual(Object.keys(c.pts[0]).slice(0, 4), ['la', 'lo', 'dt', 'conf']);
  assert.strictEqual(c.pts[0].dt, '2026-09-01T00:00:00Z');
  assert.ok(mem.k.length < 250000, 'keš mora ostati mali za localStorage');
});

t('_sjeKml: validan KML sa poligonom po pikselu i statusom u opisu', () => {
  const src = DST + "const _SJE_PIKSEL_DEG = 0.00025;\nconst _SJE_STATUSI = { bespravna:{ txt:'Bespravna sječa', boja:'#f87171' } };\n" +
    "const _SJE_STAROST = [{ id:'novo', maxD:Infinity, boja:'#fb923c' }];\n" +
    "function _sjeStatusLista(){ return [{ la:44.8, lo:16, st:'bespravna' }]; }\n" +
    ['_escHtml', '_escXml', '_hexToKmlColor', '_sjePouzdanost', '_sjeStatusZa', '_sjeStarost', '_poziPovrsTxt', '_sjeDatum', '_sjeKml'].map(extractFn).join('\n') + '\nreturn _sjeKml;';
  const _sjeKml = new Function(src)();
  const kml = _sjeKml([{ la: 44.8, lo: 16, ha: 0.11, prvi: Date.parse('2026-09-01'), zadnji: Date.parse('2026-09-10'), conf: 'high',
    pts: [{ la: 44.8, lo: 16 }, { la: 44.80025, lo: 16 }] }]);
  assert.ok(kml.startsWith('<?xml'));
  assert.strictEqual((kml.match(/<Polygon>/g) || []).length, 2);
  assert.ok(kml.includes('Bespravna sječa'));
  assert.ok(/<coordinates>15\.999875,44\.799875,0 /.test(kml));
});

t('panel ima filtere, sortiranje, legendu i izvoz; stari 500-tačkasti keš je uklonjen', () => {
  for (const id of ['sje-f-visoka', 'sje-f-provjerene', 'sje-sort', 'sje-kpi', 'sje-izvoz-wrap']) assert.ok(HTML.includes('id="' + id + '"'), id);
  assert.ok(!HTML.includes('pts: pts.slice(0, 500)'));
  assert.ok(HTML.includes("map.on('zoomend', () => {\n  if (!_sjeOn"));
});

console.log('\n' + pass + ' prošlo, 0 palo — sječa i vjetroizvale');
