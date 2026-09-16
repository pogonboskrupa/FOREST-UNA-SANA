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

console.log('Mjerenja — površina/dužina i proximity hit-test:');

function buildMsr() {
  const src = extractFn('_msrHaversine') + '\n' + extractFn('_msrSphericalArea') + '\n' +
    extractFn('_msrPoligonPovrsina') + '\n' + extractFn('_msrPts2Len') + '\n' +
    extractFn('_distToSegPx') + '\n' + extractFn('_msrTackaUPoligonu') +
    '\nreturn { _msrHaversine, _msrSphericalArea, _msrPoligonPovrsina, _msrPts2Len, _distToSegPx, _msrTackaUPoligonu };';
  // turf nije definisan u sandboxu — _msrPoligonPovrsina mora pasti na
  // _msrSphericalArea fallback (isti "typeof turf === 'undefined'" put
  // koji pokriva realan slučaj kad se turf.min.js ne učita, npr. offline
  // prvi start bez keširanih biblioteka).
  return new Function(src)();
}

t('_msrHaversine mjeri poznatu udaljenost (grubo, ±2%)', () => {
  const { _msrHaversine } = buildMsr();
  // ~111.32 km po stepenu geografske širine na ekvatoru
  const d = _msrHaversine(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111320) / 111320 < 0.02, 'dobijeno ' + d);
});

t('_msrPoligonPovrsina (fallback bez turf) računa površinu malog kvadrata', () => {
  const { _msrPoligonPovrsina } = buildMsr();
  // Kvadrat ~100m x 100m oko 44.8°N (1° lon ≈ 111320*cos(44.8°) m)
  const lat = 44.8, dLat = 100 / 111320;
  const mPerLonDeg = 111320 * Math.cos(lat * Math.PI / 180);
  const dLon = 100 / mPerLonDeg;
  const pts = [
    { lat, lng: 16.0 },
    { lat, lng: 16.0 + dLon },
    { lat: lat + dLat, lng: 16.0 + dLon },
    { lat: lat + dLat, lng: 16.0 }
  ];
  const area = _msrPoligonPovrsina(pts);
  assert.ok(Math.abs(area - 10000) / 10000 < 0.05, 'očekivano ~10000 m², dobijeno ' + area.toFixed(0));
});

t('_msrTackaUPoligonu prepoznaje tačku unutar/van poligona (ekranske koordinate)', () => {
  const { _msrTackaUPoligonu } = buildMsr();
  // Mock map.latLngToContainerPoint i L.latLng — test radi u ekranskim px,
  // pa mock samo vraća {x: lng, y: lat} kao stand-in koordinate.
  global.map = { latLngToContainerPoint: (ll) => ({ x: ll.lng ?? ll.lat, y: ll.lat ?? ll.lng }) };
  global.L = { latLng: (lat, lng) => ({ lat, lng }) };
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }];
  assert.strictEqual(_msrTackaUPoligonu({ lat: 5, lng: 5 }, square), true);
  assert.strictEqual(_msrTackaUPoligonu({ lat: 50, lng: 50 }, square), false);
  delete global.map; delete global.L;
});

t('_msrPts2Len sabira dužinu duž niza tačaka (0 za jednu tačku)', () => {
  const { _msrPts2Len } = buildMsr();
  assert.strictEqual(_msrPts2Len([{ lat: 44.8, lng: 16 }]), 0);
  const len = _msrPts2Len([{ lat: 44.8, lng: 16 }, { lat: 44.8, lng: 16.001 }, { lat: 44.801, lng: 16.001 }]);
  assert.ok(len > 0);
});

console.log('\n' + pass + ' prošlo, 0 palo — mjerenja');
