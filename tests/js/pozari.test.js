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

console.log('Požari — CSV parsiranje, pouzdanost, grupisanje detekcija:');

const dstSrc = extractFn('dst');

t('_poziParseCsv čita FIRMS VIIRS CSV zaglavlje i redove', () => {
  const src = extractFn('_poziParseCsv') + '\nreturn _poziParseCsv;';
  const _poziParseCsv = new Function(src)();
  const csv = 'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight,instrument\n' +
    '44.8000,16.0000,2026-09-15,1234,N,n,12.3,D,VIIRS\n' +
    '44.8010,16.0010,2026-09-15,0130,N,h,45.6,N,VIIRS';
  const pts = _poziParseCsv(csv);
  assert.strictEqual(pts.length, 2);
  assert.strictEqual(pts[0].la, 44.8);
  assert.strictEqual(pts[0].lo, 16.0);
  assert.strictEqual(pts[0].dt, '2026-09-15T12:34:00Z');
  assert.strictEqual(pts[1].noc, true); // daynight 'N' → noć
  assert.strictEqual(pts[0].rez, 375); // VIIRS, ne MODIS
});

t('_poziParseCsv vraća prazno za tekst koji nije FIRMS CSV (nedostaju kolone)', () => {
  const src = extractFn('_poziParseCsv') + '\nreturn _poziParseCsv;';
  const _poziParseCsv = new Function(src)();
  assert.deepStrictEqual(_poziParseCsv('<html>error page</html>'), []);
  assert.deepStrictEqual(_poziParseCsv(''), []);
});

t('_poziPouzdanost normalizuje VIIRS slovni i MODIS brojčani kod', () => {
  const src = extractFn('_poziPouzdanost') + '\nreturn _poziPouzdanost;';
  const _poziPouzdanost = new Function(src)();
  assert.strictEqual(_poziPouzdanost('h').rang, 3);
  assert.strictEqual(_poziPouzdanost('l').rang, 1);
  assert.strictEqual(_poziPouzdanost('85').rang, 3);
  assert.strictEqual(_poziPouzdanost('30').rang, 1);
});

t('_poziGrupisi spaja bliske detekcije (isti požar, više satelita) u jednu grupu', () => {
  const src = dstSrc + '\n' +
    "function _poziLinijskePrepreke(){return [];}\n" +
    "function _poziPragIzmedju(a,b,prag){return prag;}\n" +
    extractFn('_poziSatelit') + '\n' + extractFn('_poziPouzdanost') + '\n' + extractFn('_poziGrupisi') +
    '\nreturn _poziGrupisi;';
  const _poziGrupisi = new Function(src)();
  // Dvije tačke ~50m razmaknute (isti požar, dva satelita) + jedna udaljena
  // tačka ~5km dalje (drugi, nepovezan požar).
  const pts = [
    { la: 44.8000, lo: 16.0000, dt: '2026-09-15T01:00:00Z', sat: 'N', conf: 'h', frp: 10 },
    { la: 44.8004, lo: 16.0000, dt: '2026-09-15T02:00:00Z', sat: '1', conf: 'n', frp: 12 },
    { la: 44.8450, lo: 16.0450, dt: '2026-09-15T01:30:00Z', sat: 'N', conf: 'l', frp: 5 }
  ];
  const grupe = _poziGrupisi(pts, 450);
  assert.strictEqual(grupe.length, 2, 'blisko treba spojiti, udaljeno ostaje odvojeno');
  const veca = grupe.find(g => g.broj === 2);
  assert.ok(veca, 'grupa od dvije bliske detekcije mora postojati');
  assert.strictEqual(veca.sateliti.length, 2);
});

t('_poziGrupisi NE spaja detekcije udaljenije od praga (dva odvojena požara)', () => {
  const src = dstSrc + '\n' +
    "function _poziLinijskePrepreke(){return [];}\n" +
    "function _poziPragIzmedju(a,b,prag){return prag;}\n" +
    extractFn('_poziSatelit') + '\n' + extractFn('_poziPouzdanost') + '\n' + extractFn('_poziGrupisi') +
    '\nreturn _poziGrupisi;';
  const _poziGrupisi = new Function(src)();
  const pts = [
    { la: 44.80, lo: 16.00, dt: '2026-09-15T01:00:00Z', sat: 'N', conf: 'h', frp: 10 },
    { la: 44.90, lo: 16.10, dt: '2026-09-15T01:00:00Z', sat: 'N', conf: 'h', frp: 10 }
  ];
  const grupe = _poziGrupisi(pts, 450);
  assert.strictEqual(grupe.length, 2);
  assert.ok(grupe.every(g => g.broj === 1));
});

t('_poziParseGfwJson svodi GFW JSON odgovor na isti oblik tačke kao FIRMS CSV', () => {
  const src = extractFn('_poziParseGfwJson') + '\nreturn _poziParseGfwJson;';
  const _poziParseGfwJson = new Function(src)();
  const json = JSON.stringify({ data: [
    { longitude: 16.0, latitude: 44.8, alert__date: '2026-09-15', alert__time_utc: '01:23:00', confidence__cat: 'high' },
    { longitude: 16.01, latitude: 44.81, alert__date: '2026-09-15', alert__time_utc: '1405', confidence__cat: 'nominal' }
  ] });
  const pts = _poziParseGfwJson(json);
  assert.strictEqual(pts.length, 2);
  assert.strictEqual(pts[0].la, 44.8);
  assert.strictEqual(pts[0].lo, 16.0);
  assert.strictEqual(pts[0].dt, '2026-09-15T01:23:00Z');
  assert.strictEqual(pts[0].sat, 'VIIRS (GFW)');
  assert.ok(Number.isNaN(pts[0].frp), 'GFW ne vraća FRP — mora ostati NaN, ne 0');
  assert.strictEqual(pts[1].dt, '2026-09-15T14:05:00Z');
});

t('_poziParseGfwJson vraća prazno za neispravan/nedostajući JSON', () => {
  const src = extractFn('_poziParseGfwJson') + '\nreturn _poziParseGfwJson;';
  const _poziParseGfwJson = new Function(src)();
  assert.deepStrictEqual(_poziParseGfwJson('<html>error</html>'), []);
  assert.deepStrictEqual(_poziParseGfwJson('{}'), []);
});

t('_poziGfwUrl gradi bbox oko referentne tačke i SQL upit kao query string', () => {
  const src = "const _POZ_RADIUS_KM = 100;\n" + extractFn('_poziGfwUrl') + '\nreturn _poziGfwUrl;';
  const _poziGfwUrl = new Function(src)();
  const url = _poziGfwUrl('24h', { la: 44.8, lo: 16.0 });
  assert.ok(url.startsWith('https://data-api.globalforestwatch.org/dataset/nasa_viirs_fire_alerts/latest/query/json?sql='));
  const sql = decodeURIComponent(url.split('sql=')[1]);
  assert.ok(sql.includes('latitude >='), 'mora ograničiti bbox po latitude');
  assert.ok(sql.includes('longitude >='), 'mora ograničiti bbox po longitude');
  assert.ok(/LIMIT \d+/.test(sql));
});

t('_poziPixelHa računa poznatu površinu piksela (VIIRS 375m i MODIS 1km)', () => {
  const src = extractFn('_poziPixelHa') + '\nreturn _poziPixelHa;';
  const _poziPixelHa = new Function(src)();
  assert.ok(Math.abs(_poziPixelHa(375) - 14.0625) < 0.001);
  assert.strictEqual(_poziPixelHa(1000), 100);
});

t('_poziPovrsinaGrupe dedupira detekcije iz ISTOG piksela (više satelita/preleta)', () => {
  const src = extractFn('_poziPixelHa') + '\n' + extractFn('_poziPovrsinaGrupe') + '\nreturn _poziPovrsinaGrupe;';
  const _poziPovrsinaGrupe = new Function(src)();
  // Dvije detekcije ~15m razmaknute (isti fizički piksel, viđen 2x) → 1 piksel.
  const isti = { pts: [
    { la: 44.8000, lo: 16.0000, rez: 375 },
    { la: 44.80013, lo: 16.00013, rez: 375 }
  ] };
  assert.ok(Math.abs(_poziPovrsinaGrupe(isti) - 14.0625) < 0.001, 'blisko = isti piksel, ne smije se duplo brojati');
  // Dvije detekcije daleko razmaknute (različiti pikseli) → 2 piksela.
  const razlicito = { pts: [
    { la: 44.8000, lo: 16.0000, rez: 375 },
    { la: 44.8100, lo: 16.0100, rez: 375 }
  ] };
  assert.ok(Math.abs(_poziPovrsinaGrupe(razlicito) - 14.0625 * 2) < 0.001, 'daleko = odvojeni pikseli, moraju se sabrati');
  assert.strictEqual(_poziPovrsinaGrupe({ pts: [] }), 0);
});

t('_poziPovrsTxt formatira hektare (decimala ispod 100, zaokruženo iznad)', () => {
  const src = extractFn('_poziPovrsTxt') + '\nreturn _poziPovrsTxt;';
  const _poziPovrsTxt = new Function(src)();
  assert.strictEqual(_poziPovrsTxt(0), '0 ha');
  assert.strictEqual(_poziPovrsTxt(14.0625), '14.1 ha');
  assert.strictEqual(_poziPovrsTxt(1234), '1.234 ha');
});

t('_povGodUrl gradi bbox+cijela-godina SQL upit kao query string', () => {
  const src = "const _POZ_RADIUS_KM = 100;\n" + extractFn('_povGodUrl') + '\nreturn _povGodUrl;';
  const _povGodUrl = new Function(src)();
  const url = _povGodUrl({ la: 44.8, lo: 16.0 }, 2026);
  assert.ok(url.startsWith('https://data-api.globalforestwatch.org/dataset/nasa_viirs_fire_alerts/latest/query/json?sql='));
  const sql = decodeURIComponent(url.split('sql=')[1]);
  assert.ok(sql.includes("alert__date >= '2026-01-01'"), 'mora tražiti od 1. januara te godine');
  assert.ok(sql.includes('LIMIT 5000'));
});

t('_povGodGrupisiPoMjesecu raspoređuje grupe po mjesecu zadnje detekcije i sabira površinu', () => {
  const src = extractFn('_poziPixelHa') + '\n' + extractFn('_poziPovrsinaGrupe') + '\n' + extractFn('_povGodGrupisiPoMjesecu') + '\nreturn _povGodGrupisiPoMjesecu;';
  const _povGodGrupisiPoMjesecu = new Function(src)();
  const grupe = [
    { zadnji: Date.parse('2026-03-15T10:00:00Z'), pts: [{ la: 44.80, lo: 16.00, rez: 375 }] },
    { zadnji: Date.parse('2026-03-20T10:00:00Z'), pts: [{ la: 44.90, lo: 16.10, rez: 375 }] },
    { zadnji: Date.parse('2026-07-01T10:00:00Z'), pts: [{ la: 45.00, lo: 16.20, rez: 1000 }] }
  ];
  const mjeseci = _povGodGrupisiPoMjesecu(grupe);
  assert.strictEqual(mjeseci.length, 2);
  assert.strictEqual(mjeseci[0].mjesec, 2); // mart = index 2
  assert.strictEqual(mjeseci[0].broj, 2);
  assert.ok(Math.abs(mjeseci[0].ha - 14.0625 * 2) < 0.001);
  assert.strictEqual(mjeseci[1].mjesec, 6); // juli = index 6
  assert.strictEqual(mjeseci[1].broj, 1);
  assert.ok(Math.abs(mjeseci[1].ha - 100) < 0.001);
});

console.log('\n' + pass + ' prošlo, 0 palo — požari');
