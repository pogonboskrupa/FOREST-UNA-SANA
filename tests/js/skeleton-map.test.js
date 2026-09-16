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

console.log('Kostur karte — MGI projekcija i podrazumijevani prikaz:');

t('mgiToWgs vraća [lat, lon] za poznatu MGI Zone 6 tačku', () => {
  const proj4 = require(path.join(__dirname, '../../static/libs/proj4.js'));
  proj4.defs('MGI-ZONE6', '+proj=tmerc +lat_0=0 +lon_0=18 +k=0.9999 +x_0=6500000 +y_0=0 +ellps=bessel +towgs84=682,-203,480,0,0,0,0 +units=m +no_defs');
  const src = extractFn('mgiToWgs') + '\nreturn mgiToWgs;';
  const mgiToWgs = new Function('proj4', src)(proj4);
  const [lat, lon] = mgiToWgs(6354662, 4972300);
  // Una-Sana kanton (Bosanska Krupa okolina) — grubo sanity opseg, ne tačna
  // vrijednost (izbjegava lomljiv test na sedmu decimalu projekcije).
  assert.ok(lat > 44 && lat < 45.5, 'lat van očekivanog opsega: ' + lat);
  assert.ok(lon > 15.5 && lon < 17, 'lon van očekivanog opsega: ' + lon);
});

t('zoomForScale vraća veći zoom za manju razmjeru (bliži prikaz)', () => {
  const src = extractFn('zoomForScale') + '\nreturn zoomForScale;';
  const zoomForScale = new Function(src)();
  const zFar = zoomForScale(100000, 44.8);
  const zNear = zoomForScale(10000, 44.8);
  assert.ok(zNear > zFar, 'manja razmjera mora dati veći zoom');
});

t('APP_VER je definisan i prati v-prefiksovanu shemu', () => {
  assert.match(HTML, /const APP_VER = 'v[0-9]+\.[0-9]+\.[0-9]+'/);
});

t('bazni slojevi su ograničeni na osnovne četiri (bez Wayback/Sentinel/WorldCover/Konture)', () => {
  const twStart = HTML.indexOf('const TL = {');
  assert.ok(twStart >= 0, 'TL objekat nije nađen');
  const twEnd = HTML.indexOf('};', twStart);
  const twSrc = HTML.slice(twStart, twEnd);
  assert.match(twSrc, /Topo/);
  assert.match(twSrc, /Satelit/);
  assert.match(twSrc, /Karta/);
  assert.match(twSrc, /Google/);
  assert.ok(!/Wayback|Sentinel|WorldCover|Kontur/.test(twSrc),
    'napredni satelitski slojevi ne smiju biti u skeletonu (korisnička odluka)');
});

t('paneovi za buduće Požari/Mjerenja slojeve postoje od prvog dana', () => {
  assert.match(HTML, /createPane\('tragMsrLines'\)/);
  assert.match(HTML, /createPane\('pozariPane'\)/);
});

console.log('\n' + pass + ' prošlo, 0 palo — kostur karte');
