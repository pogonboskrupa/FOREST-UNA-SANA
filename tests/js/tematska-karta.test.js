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

console.log('Tematska karta — GPKG WKB parsiranje, kvantili, boje:');

t('_temColLabel pretvara donju crtu u razmak', () => {
  const src = extractFn('_temColLabel') + '\nreturn _temColLabel;';
  const _temColLabel = new Function(src)();
  assert.strictEqual(_temColLabel('povrsina_ha'), 'povrsina ha');
  assert.strictEqual(_temColLabel(''), '');
});

t('_temQuantiles dijeli sortiran niz na n-1 rastućih granica (deduplikovano)', () => {
  const src = extractFn('_temQuantiles') + '\nreturn _temQuantiles;';
  const _temQuantiles = new Function(src)();
  const vals = Array.from({ length: 100 }, (_, i) => i);
  const breaks = _temQuantiles(vals, 5);
  assert.strictEqual(breaks.length, 4);
  for (let i = 1; i < breaks.length; i++) assert.ok(breaks[i] > breaks[i-1]);
  // Konstantan niz — sve granice bi bile iste vrijednost, dedup zadrži samo prvu.
  assert.deepStrictEqual(_temQuantiles(new Array(20).fill(5), 5), [5]);
});

t('_temRampFor vraća n boja, prva/zadnja su krajevi rampe', () => {
  const src = "const _TEM_RAMP = ['#1a9641','#a6d96a','#ffffbf','#fdae61','#d7191c'];\n" +
    extractFn('_temRampFor') + '\nreturn _temRampFor;';
  const _temRampFor = new Function(src)();
  const c5 = _temRampFor(5);
  assert.strictEqual(c5.length, 5);
  assert.strictEqual(c5[0].toLowerCase(), '#1a9641');
  assert.strictEqual(c5[4].toLowerCase(), '#d7191c');
  assert.strictEqual(_temRampFor(2).length, 2);
  assert.strictEqual(_temRampFor(1).length, 1);
});

// WKB builder — ručno sastavlja minimalan GPKG geometrijski blob (GP header +
// standard WKB Polygon) da _parseGpkgGeom može biti testiran bez pravog .gpkg fajla.
function buildGpkgPolygonBlob(ring) {
  const flags = 0x01; // little-endian header, envelope indicator 0 (bez envelope-a)
  const headerLen = 8;
  const nPoints = ring.length;
  const wkbLen = 1 + 4 + 4 + (4 + nPoints * 16); // byteOrder+wkbType+numRings+(numPoints+pts)
  const buf = Buffer.alloc(headerLen + wkbLen);
  buf.write('GP', 0, 'ascii');
  buf.writeUInt8(flags, 3);
  buf.writeInt32LE(4326, 4); // srsId
  let pos = headerLen;
  buf.writeUInt8(1, pos); pos += 1;       // WKB byte order: little-endian
  buf.writeUInt32LE(3, pos); pos += 4;    // wkbType = Polygon (2D)
  buf.writeUInt32LE(1, pos); pos += 4;    // numRings = 1
  buf.writeUInt32LE(nPoints, pos); pos += 4;
  for (const [x, y] of ring) { buf.writeDoubleLE(x, pos); pos += 8; buf.writeDoubleLE(y, pos); pos += 8; }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

t('_parseGpkgGeom čita WGS84 (srsId 4326) Polygon iz GPKG WKB bloba', () => {
  const src = extractFn('_parseGpkgGeom') + '\nreturn _parseGpkgGeom;';
  const _parseGpkgGeom = new Function(src)();
  const ring = [[16.0, 44.8], [16.01, 44.8], [16.01, 44.81], [16.0, 44.81], [16.0, 44.8]];
  const blob = buildGpkgPolygonBlob(ring);
  const g = _parseGpkgGeom(blob);
  assert.ok(g, 'parser mora vratiti rezultat za ispravan blob');
  assert.strictEqual(g.srsId, 4326);
  assert.strictEqual(g.polys.length, 1);
  assert.strictEqual(g.polys[0][0].length, 5);
  assert.deepStrictEqual(g.polys[0][0][0], [16.0, 44.8]);
});

t('_parseGpkgGeom vraća null za bajtove bez "GP" magic broja', () => {
  const src = extractFn('_parseGpkgGeom') + '\nreturn _parseGpkgGeom;';
  const _parseGpkgGeom = new Function(src)();
  assert.strictEqual(_parseGpkgGeom(new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0])), null);
  assert.strictEqual(_parseGpkgGeom(new Uint8Array([1,2,3])), null);
});

console.log('\n' + pass + ' prošlo, 0 palo — tematska karta');
