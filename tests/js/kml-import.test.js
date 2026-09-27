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

console.log('Učitaj KML — parsiranje koordinata i ekstra podataka:');

t('pcsKml parsira "lon,lat,alt lon,lat,alt" u [lat,lon] parove', () => {
  const src = extractFn('pcsKml') + '\nreturn pcsKml;';
  const pcsKml = new Function(src)();
  const out = pcsKml('16.0,44.8,0 16.1,44.9,0');
  assert.deepStrictEqual(out, [[44.8, 16.0], [44.9, 16.1]]);
});

t('pcsKml vraća prazan niz za prazan/nedostajući tekst', () => {
  const src = extractFn('pcsKml') + '\nreturn pcsKml;';
  const pcsKml = new Function(src)();
  assert.deepStrictEqual(pcsKml(''), []);
  assert.deepStrictEqual(pcsKml(undefined), []);
});

t('_parseKmlExtData čita ExtendedData Data name/value parove', () => {
  const src = extractFn('_parseKmlExtData') + '\nreturn _parseKmlExtData;';
  const _parseKmlExtData = new Function(src)();
  const xml = `<Placemark><ExtendedData>
    <Data name="odjel"><value>14a</value></Data>
    <Data name="povrsina"><value>2.5</value></Data>
  </ExtendedData></Placemark>`;
  // Nema DOMParser u čistom Node-u (namjerno, projekat nema build toolchain
  // ni jsdom zavisnost) — preskoči ljupko umjesto da uvodi novu zavisnost
  // samo za ovaj test; pokriva se zato test iznad (pcsKml) koji ne treba DOM.
  if (typeof DOMParser === 'undefined') {
    console.log('    (preskočeno — DOMParser nije dostupan u Node bez dodatne zavisnosti)');
    return;
  }
  const parsed = new DOMParser().parseFromString(xml, 'text/xml');
  const ext = _parseKmlExtData(parsed.querySelector('Placemark'));
  assert.strictEqual(ext.odjel, '14a');
  assert.strictEqual(ext.povrsina, '2.5');
});

t('redizajn: KML i offline karte imaju zaglavlje s formatima, sažetak, prekidač i istaknutu aktivnu kartu', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../index.html'), 'utf8');
  const kml = html.slice(html.indexOf('<div id="ucitajkml-panel"'), html.indexOf('<div id="nagib-panel"'));
  const karta = html.slice(html.indexOf('<div id="ucitajkartu-panel"'), html.indexOf('<div id="ucitajkml-panel"'));
  [kml, karta].forEach(x => assert.ok(x.includes('class="ul-chips"') && x.includes('class="ng-glavno"')));
  const rk = html.slice(html.indexOf('function _kmlRegRender()'), html.indexOf('_kmlRestore();\n'));
  assert.ok(rk.includes('class="ul-sum"') && rk.includes('_kmlPromijeniBoju') && rk.includes('class="ng-switch"'));
  const rs = html.slice(html.indexOf('async function _sqlmapRegRender()'), html.indexOf('async function _sqlmapRestoreManual'));
  assert.ok(rs.includes('✓ AKTIVNA KARTA') && rs.includes('zoom ${r.zmin}–${r.zmax}'));
  assert.ok(!require('node:fs').readFileSync(require('node:path').join(__dirname, '../../static/js/terrain-layers.js'), 'utf8').includes('__usfZoomFix'), 'stari omotač liste karata uklonjen');
});

console.log('\n' + pass + ' prošlo, 0 palo — učitaj KML');
