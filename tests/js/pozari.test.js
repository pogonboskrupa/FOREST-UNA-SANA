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

console.log('\n' + pass + ' prošlo, 0 palo — požari');
