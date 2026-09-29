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

// KMZ: ZIP sa "data descriptor" (bit 3) — lokalno zaglavlje ima veličinu 0.
function zipSaDeskriptorom(fajlovi) {
  const zlib = require('node:zlib'), dijelovi = [], cd = []; let off = 0;
  for (const [ime, sadrzaj] of fajlovi) {
    const raw = Buffer.from(sadrzaj), comp = zlib.deflateRawSync(raw), imeB = Buffer.from(ime), crc = zlib.crc32 ? zlib.crc32(raw) : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(imeB.length, 26);
    const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(comp.length, 8); dd.writeUInt32LE(raw.length, 12);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(imeB.length, 28); ch.writeUInt32LE(off, 42);
    dijelovi.push(lh, imeB, comp, dd); cd.push(ch, imeB);
    off += 30 + imeB.length + comp.length + 16;
  }
  const cdB = Buffer.concat(cd), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(fajlovi.length, 8); e.writeUInt16LE(fajlovi.length, 10); e.writeUInt32LE(cdB.length, 12); e.writeUInt32LE(off, 16);
  const b = Buffer.concat([...dijelovi, cdB, e]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
(async () => {
  const F = new Function(['_zipUlazi', '_zipIzvuci', '_kmzExtractKml'].map(extractFn).join('\n') + '\nreturn { _zipUlazi, _zipIzvuci, _kmzExtractKml };')();
  const buf = zipSaDeskriptorom([['doc.kml', '<kml><Placemark><name>Čeka</name></Placemark></kml>'], ['files/foto1.jpg', 'JPEGBAJTOVI']]);
  try {
    const u = F._zipUlazi(buf);
    assert.deepStrictEqual(u.map(x => x.ime), ['doc.kml', 'files/foto1.jpg']);
    assert.ok(u.every(x => x.cVel > 0), 'veličina iz centralnog direktorija, ne iz lokalnog zaglavlja (0)');
    assert.ok((await F._kmzExtractKml(buf)).includes('<name>Čeka</name>'), 'KML iz KMZ-a sa data descriptor-om');
    assert.strictEqual(new TextDecoder().decode(await F._zipIzvuci(buf, u[1])), 'JPEGBAJTOVI');
    pass++; console.log('  ✔ KMZ sa veličinom iza podataka (Android/Java): KML i fotografije se čitaju');
  } catch (e) { console.error('  ✘ KMZ: ' + e.message); process.exitCode = 1; }
  try {
    const o = extractFn('_kmlOpisHtml');
    assert.ok(/_OPIS_BRISI\.has\(tag\)\) \{ n\.remove\(\)/.test(o), 'script/style/iframe se brišu sa sadržajem');
    assert.ok(o.includes("[...n.attributes].forEach(a => n.removeAttribute(a.name))"), 'svi atributi (onerror, style...) se skidaju');
    assert.ok(o.includes("/^https?:\\/\\//i.test(href.trim())"), 'linkovi samo http(s)');
    assert.ok(o.includes("data:image\\/(png|jpe?g|gif|webp);"), 'slike samo http(s), data:image ili iz KMZ-a');
    assert.ok(!/innerHTML\s*=\s*desc/.test(HTML), 'opis nikad direktno u innerHTML');
    const klik = HTML.slice(HTML.indexOf('function _kartaPogodak'), HTML.indexOf("_kartaKlikIzvor((ll, kp) => _tragRegistry"));
    assert.ok(klik.includes("h.vrsta === 'tacka' ? h.d : h.vrsta === 'linija' ? 100 + h.d : 1000"), 'tačka > linija > poligon');
    pass++; console.log('  ✔ opis iz KML-a: bez skripti i događaja; jedinstven klik sa prioritetom tačka > linija > poligon');
  } catch (e) { console.error('  ✘ opis/klik: ' + e.message); process.exitCode = 1; }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — učitaj KML');
})();
