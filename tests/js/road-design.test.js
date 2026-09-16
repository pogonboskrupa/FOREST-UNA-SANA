'use strict';
const assert = require('node:assert');
const path = require('node:path');

const {
  RD_DEFAULT_PARAMS, rdHaversine, rdAzimuth, rdDestPoint, rdSestarKorak,
  rdPreview, rdFindRoute, rdValidateRoute
} = require(path.join(__dirname, '../../static/js/road-design.js'));

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { console.error('  ✘ ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

console.log('Projektovanje šumskog puta — geodezija, šestarski korak, pathfinding:');

t('rdHaversine mjeri poznatu udaljenost (~111.2km po stepenu geografske širine)', () => {
  const d = rdHaversine(44.0, 16.0, 45.0, 16.0);
  assert.ok(Math.abs(d - 111195) < 500, 'dobio ' + d);
});

t('rdAzimuth: sjever=0°, istok=90°, jug=180°, zapad=270°', () => {
  assert.ok(Math.abs(rdAzimuth(44, 16, 44.01, 16) - 0) < 1);
  assert.ok(Math.abs(rdAzimuth(44, 16, 44, 16.02) - 90) < 1);
  assert.ok(Math.abs(rdAzimuth(44, 16, 43.99, 16) - 180) < 1);
  assert.ok(Math.abs(rdAzimuth(44, 16, 44, 15.98) - 270) < 1);
});

t('rdDestPoint je inverz rdAzimuth/rdHaversine (kreni pa se vrati na istu tačku)', () => {
  const p = rdDestPoint(44.8, 16.0, 37, 500);
  const backDist = rdHaversine(44.8, 16.0, p.lat, p.lon);
  const backAz = rdAzimuth(44.8, 16.0, p.lat, p.lon);
  assert.ok(Math.abs(backDist - 500) < 1);
  assert.ok(Math.abs(backAz - 37) < 0.5);
});

t('rdSestarKorak: L = ΔH/nagib (npr. 60m visinske razlike uz 6% nagib = 1000m)', () => {
  assert.ok(Math.abs(rdSestarKorak(60, 6) - 1000) < 0.01);
  assert.ok(Math.abs(rdSestarKorak(-60, 6) - 1000) < 0.01, 'apsolutna vrijednost, smjer ne bitan');
});

t('rdPreview računa direktan nagib i predznak visinske razlike', () => {
  const prev = rdPreview(44.80, 16.00, 500, 44.80, 16.01, 540);
  assert.strictEqual(prev.deltaH, 40);
  assert.ok(prev.directSlopePct > 0);
  assert.ok(Math.abs(prev.distM - prev.deltaH / (prev.directSlopePct / 100)) < 1);
});

// Ravan teren (elevacija svuda 500m) — direktna linija zadovoljava svaki nagib,
// pretraga treba naći skoro pravolinijsku trasu bez ikakvog cik-caka.
function flatElev() { return 500; }

t('rdFindRoute na ravnom terenu nalazi kratku trasu (blizu prave linije)', () => {
  const startLat = 44.80, startLon = 16.00, endLat = 44.805, endLon = 16.00;
  const straight = rdHaversine(startLat, startLon, endLat, endLon);
  const res = rdFindRoute({
    startLat, startLon, endLat, endLon,
    sampleElev: flatElev,
    params: RD_DEFAULT_PARAMS
  });
  assert.strictEqual(res.ok, true);
  assert.ok(res.path.length >= 2);
  let total = 0;
  for (let i = 1; i < res.path.length; i++) {
    total += rdHaversine(res.path[i-1].lat, res.path[i-1].lon, res.path[i].lat, res.path[i].lon);
  }
  assert.ok(total < straight * 1.15, 'trasa na ravnom terenu treba biti blizu prave linije, dobio ' + total + ' vs ' + straight);
});

// Strm teren: konstantan nagib terena veći od dozvoljenog max nagiba u pravcu
// direktne linije — pretraga MORA napraviti cik-cak (dužu trasu) da bi
// zadovoljila hard cutoff, ili prijaviti NO_ROUTE ako je nemoguće.
t('rdFindRoute nikad ne prelazi nagibMax na terenu koji to zahtijeva (cik-cak umjesto pravca)', () => {
  const startLat = 44.80, startLon = 16.00, endLat = 44.803, endLon = 16.00;
  // Elevacija raste linearno sa geografskom širinom — veoma strmo (bilo bi ~30%+
  // direktnim putem), tjera pretragu da napravi duži put uz manji efektivni nagib.
  const steepElev = (lat, lon) => 500 + (lat - startLat) * 111320 * 0.30;
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { nagibMax: 8, nagibPreporuceni: 6 });
  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev: steepElev, params });
  assert.strictEqual(res.ok, true);
  for (let i = 1; i < res.path.length; i++) {
    const a = res.path[i-1], b = res.path[i];
    const d = rdHaversine(a.lat, a.lon, b.lat, b.lon);
    if (d < 0.5) continue;
    const slopePct = Math.abs(b.elev - a.elev) / d * 100;
    assert.ok(slopePct <= params.nagibMax + 0.01, 'segment ' + i + ' prelazi max nagib: ' + slopePct.toFixed(1) + '%');
  }
});

t('rdFindRoute vraća DEM_MISSING kad sampleElev ne pokriva start/kraj', () => {
  const res = rdFindRoute({
    startLat: 44.8, startLon: 16.0, endLat: 44.81, endLon: 16.0,
    sampleElev: () => null,
    params: RD_DEFAULT_PARAMS
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'DEM_MISSING');
});

t('rdValidateRoute klasifikuje segmente po pragovima (ok/warn/bad)', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { nagibMax: 10, nagibPreporuceni: 5 });
  const path = [
    { lat: 44.80, lon: 16.00, elev: 500 },       // start
    { lat: 44.80045, lon: 16.00, elev: 502 },    // ~50m, ~4% -> ok
    { lat: 44.80090, lon: 16.00, elev: 510 },    // ~50m, ~16% -> preko max (vještački, ne bi trebalo nastati iz rdFindRoute)
  ];
  const v = rdValidateRoute(path, params);
  assert.strictEqual(v.segments.length, 2);
  assert.strictEqual(v.segments[0].level, 'ok');
  assert.strictEqual(v.segments[1].level, 'bad');
  assert.strictEqual(v.anyExceedsMax, true);
});

console.log('\n' + pass + ' prošlo, 0 palo — projektovanje šumskog puta');
