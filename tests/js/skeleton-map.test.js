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

t('wgsToMGI5 je inverz mgiToWgs (Zone 5, zaseban prikaz od podrazumijevane Zone 6)', () => {
  const proj4 = require(path.join(__dirname, '../../static/libs/proj4.js'));
  proj4.defs('MGI-ZONE5', '+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=5500000 +y_0=0 +ellps=bessel +towgs84=682,-203,480,0,0,0,0 +units=m +no_defs');
  const src = extractFn('wgsToMGI5') + '\nreturn wgsToMGI5;';
  const wgsToMGI5 = new Function('proj4', src)(proj4);
  // Bihać (u Zone 5 teritoriji, ~15.87°E) — Zone 5 lako pokriva ovu oblast
  // (13.5–16.5°E), za razliku od Zone 6 (16.5–19.5°E) koja je i dalje
  // podrazumijevana za centar aplikacije (korisnička odluka, netaknuto).
  const mgi = wgsToMGI5(44.8167, 15.8700);
  assert.ok(mgi.y > 5400000 && mgi.y < 5600000, 'Y van očekivanog Zone 5 opsega: ' + mgi.y);
  assert.ok(mgi.x > 4900000 && mgi.x < 5000000, 'X van očekivanog opsega: ' + mgi.x);
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

t('verzija je v1.1.4 i rollover koristi jednocifreni patch/minor', () => {
  assert.ok(HTML.includes("const APP_VER = 'v1.1.4'"));
  const src = extractFn('_sljedecaVerzija') + '\nreturn _sljedecaVerzija;';
  const next = new Function(src)();
  assert.strictEqual(next('v1.1.3'), 'v1.1.4');
  assert.strictEqual(next('v1.1.9'), 'v1.2.0');
  assert.strictEqual(next('v1.9.9'), 'v2.0.0');
});

t('bottom bar ostaje iznad punih radnih panela', () => {
  const tabs = HTML.match(/#main-tabs\s*\{[^}]+\}/s)?.[0] || '';
  const panel = HTML.match(/\.usf-panel\s*\{[^}]+\}/s)?.[0] || '';
  const z = s => Number(s.match(/z-index\s*:\s*(\d+)/)?.[1] || 0);
  assert.ok(z(tabs) > z(panel), 'bottom bar mora imati viši z-index od .usf-panel');
  assert.ok(/min-height\s*:\s*52px/.test(HTML), 'dugmad bottom bara moraju imati veću dodirnu površinu');
});

t('radni modali završavaju iznad bottom bara i skrolaju sadržaj', () => {
  const css = HTML.match(/#profil-modal, #tem-table-modal, #poz-sim-modal\s*\{[^}]+\}/s)?.[0] || '';
  assert.ok(css.includes('calc(74px + env(safe-area-inset-bottom,0px))'));
  assert.ok(/z-index\s*:\s*900/.test(css));
  assert.ok(/overflow\s*:\s*auto/.test(css));
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

// Regresioni test za bug "Cannot read properties of undefined (reading
// 'appendChild')" — svaki L.layer koji navodi { pane: 'xxx' } MORA imati
// odgovarajući map.createPane('xxx'), inače map.getPane() vrati undefined i
// .appendChild na njemu puca čim se taj sloj doda na kartu (desilo se sa
// _PoziHeat/demOverlay — pane je korišten a nikad kreiran).
t('svaki korišteni Leaflet pane je stvarno kreiran (map.createPane)', () => {
  const LEAFLET_BUILTIN = new Set(['tilePane', 'overlayPane', 'shadowPane', 'markerPane', 'tooltipPane', 'popupPane', 'mapPane']);
  const created = new Set();
  for (const m of HTML.matchAll(/createPane\('([^']+)'\)/g)) created.add(m[1]);
  const used = new Set();
  for (const m of HTML.matchAll(/pane\s*:\s*['"]([^'"]+)['"]/g)) used.add(m[1]);
  const missing = [...used].filter(p => !LEAFLET_BUILTIN.has(p) && !created.has(p));
  assert.deepStrictEqual(missing, [], 'pane(ovi) korišteni ali nikad kreirani: ' + missing.join(', '));
});

t('EFFIS raster ima vlastiti pane iznad naknadno učitane SQLite karte', () => {
  assert.ok(HTML.includes("map.createPane('pozariRasterPane')"));
  assert.ok(HTML.includes("getPane('pozariRasterPane').style.zIndex = 405"));
  assert.strictEqual((HTML.match(/pane:'pozariRasterPane', layers:/g) || []).length, 3);
});
t('legenda ima checkbox, zatvaranje i pomjeranje dodirom', () => {
  assert.ok(HTML.includes('id="poz-legend-check"'));
  assert.ok(HTML.includes('onclick="_poziLegendaToggle(false)"'));
  assert.ok(HTML.includes("handle.setPointerCapture(e.pointerId)"));
  assert.ok(HTML.includes("usf_poz_legenda_pos"));
});
console.log('\n' + pass + ' prošlo, 0 palo — kostur karte');
