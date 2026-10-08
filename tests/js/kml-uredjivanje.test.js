'use strict';
// Učitani KML/SHP: objekti klikabilni, uređivanje (naziv/opis/oblik), brisanje, izvoz;
// otvorena kartica se dodirom na kartu samo zatvara. Plus: globalna imena iz index.html ne
// smiju se sudariti sa globalnim skriptama (sudar `_kmlKoord` je oborio odjeli.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const H = R('index.html');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('KML — uređivanje i zatvaranje kartice:');
const tijelo = (src, pocetak) => { const i = src.indexOf(pocetak); assert.ok(i >= 0, pocetak); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };

t('dodir na kartu dok je kartica otvorena samo je zatvara (capture prije Leaflet klika)', () => {
  const i = H.indexOf("map.getContainer().addEventListener('click', e => {");
  assert.ok(i > 0 && i < H.indexOf("map.on('click', e => {\n  if (_kmlUred"));
  const blok = H.slice(i, H.indexOf('}, true);', i));
  assert.ok(blok.includes('map.closePopup()') && blok.includes('e.stopPropagation()') && blok.includes(".leaflet-popup, .leaflet-control"));
});

t('pkml veže sloj s Placemark-om i geometrijom; kartica ima Uredi/Obriši (ne za ugrađene)', () => {
  const p = tijelo(H, 'function pkml(');
  assert.ok(p.includes("veza(l, 'Polygon', gi)") && p.includes("veza(l, 'LineString', gi)") && p.includes("veza(m, 'Point', gi)"));
  assert.ok(tijelo(H, 'function _kmlPopupHtml(').includes("if (sloj && !sloj._ugradjeno) dugmad.push({ t: '✏ Uredi'"));
});

t('KML sadržaj u IndexedDB (ne nestaje pri ažuriranju), SHP se čuva, kopija nosi KML', () => {
  const sp = tijelo(H, 'async function _kmlSpremi(');
  assert.ok(sp.includes("st.put(txt, ime)") && sp.includes('idb: 1') && sp.includes('content: txt'), 'IDB, rezerva localStorage');
  const rs = tijelo(H, 'async function _kmlRestore(');
  assert.ok(rs.includes("st.get(name)") && rs.includes('_kmlSpremi(name, txt, data)'), 'čitanje iz IDB + seoba starih zapisa');
  assert.ok(tijelo(H, 'async function _shpLoadFiles(').includes('_kmlSaveContent(k.name, _kmlIzGrupe(k), col)'), 'SHP se čuva kao KML');
  assert.ok(tijelo(H, 'async function _setBackup(').includes('d.content = t') && tijelo(H, 'function _setRestore(').includes('st.put(d.content, ime)'));
});

t('izmjene idu u KML tekst i čuvaju se; SHP se pri prvoj izmjeni pretvara u KML', () => {
  const pr = tijelo(H, 'function _kmlPrimijeniDoc(');
  assert.ok(pr.includes('_kmlParseDoc(_kmlSadrzaj(k))') && pr.includes('new XMLSerializer().serializeToString(doc)'));
  const ob = tijelo(H, 'function _kmlObnovi(');
  assert.ok(ob.includes('_kmlSpremi(k.name, txt, k)') && ob.includes('delete k._shp'));
  assert.ok(tijelo(H, 'function _kmlSadrzaj(').includes('return _kmlIzGrupe(k)'));
  const kr = tijelo(H, 'function _kmlUredKraj(');
  assert.ok(kr.includes("lls.concat([lls[0]])"), 'poligon se zatvara u KML-u');
  assert.ok(tijelo(H, 'async function _kmlObrisiObjekat(').includes("if (!pm.querySelector('Point, LineString, Polygon')) pm.remove()"));
});

t('stil: KML boja aabbggrr ↔ #rrggbb, vlastiti stil samo uz usf_stil, usf_* skriveni u kartici', () => {
  const izvuci = ime => /const NAME = ([^\n]+);/.source.replace('NAME', ime);
  const f = new Function([ '_kmlBojaUKml', '_kmlBojaIzKml' ].map(n => 'const ' + n + ' = ' + new RegExp(izvuci(n)).exec(H)[1] + ';').join('\n') + '\nreturn { u: _kmlBojaUKml, iz: _kmlBojaIzKml };')();
  assert.strictEqual(f.u('#ff8000'), 'ff0080ff'); assert.strictEqual(f.u('#ff8000', 0.35), '590080ff');
  assert.deepStrictEqual(f.iz('ff0080ff'), { hex: '#ff8000', a: 1 }); assert.strictEqual(f.iz('nije'), null);
  assert.ok(tijelo(H, 'function _kmlStilPlacemarka(').includes("ext.usf_stil !== '1'"), 'tuđi KML stilovi ne mijenjaju izgled');
  assert.ok(tijelo(H, 'function _kmlPopupHtml(').includes("filter(k => !k.startsWith('usf_'))"));
  assert.ok(tijelo(H, 'function _kmlUpisiStil(').includes("_kmlPostaviExt(doc, pm, 'usf_stil', col ? '1' : null)"));
  assert.ok(tijelo(H, 'async function _kmlSpremi(').includes('stil: meta.stil') && tijelo(H, 'function _kmlRestore(').includes('pkml(doc, col, undefined, data.stil)'));
});

t('uređivanje: poništi, dodir dodaje tačku, novi objekat u sloju', () => {
  assert.ok(H.includes("if (_kmlUred && !_msrOn && !window._npHvataKlik) { _kmlUredDodaj(e.latlng); return; }"));
  assert.ok(tijelo(H, 'function _kmlUredVrati(').includes('u.istorija.pop()'));
  const kr = tijelo(H, 'async function _kmlUredKraj(');
  assert.ok(kr.includes('if (u.novi)') && kr.includes("doc.createElementNS(ns, 'Placemark')") && kr.includes('_kmlPrimijeniDoc(u.k'));
  assert.ok(H.includes("_kmlNoviObjekat('${k.id}')"));
});

t('ikona oka umjesto 🙈 (sjekačke, tragovi, tematska)', () => {
  assert.ok(!/'🙈 Sakrij'/.test(H.replace(/\/\/[^\n]*/g, '')), 'nema 🙈 dugmadi u index.html');
  assert.ok(R('static/js/sjekacke.js').includes("ik('oko-off', 19) + ' Sakrij' : ik('oko', 19) + ' Prikaži'"), 'sjekačke: ikona iz ikone.js, ne emoji');
});

t('više odsjeka: izbor dodirom, cijeli odjel, spajanje → nagib / sjekačke / izvještaj', () => {
  const f = new Function(tijelo(H, 'function _odsOdjel(') + '\nreturn _odsOdjel;')();
  assert.strictEqual(f({ _kmlExtData: { ODJEL: '012' }, _kmlName: 'x' }), '12', 'atribut ODJEL');
  assert.strictEqual(f({ _kmlExtData: {}, _kmlName: 'Odjel 7 odsjek b' }), '7', 'broj iz naziva');
  assert.strictEqual(f({ _kmlExtData: {}, _kmlName: 'bez broja' }), null);
  assert.ok(H.includes("if (_odsIzbor && !_msrOn && !window._npHvataKlik) { _odsDodir(e.latlng); return; }"));
  assert.ok(tijelo(H, 'function _kmlPopupHtml(').includes("_odsPocni(${id})"));
  const sp = tijelo(H, 'function _odsSpoji(');
  assert.ok(sp.includes('_turfUnija(f)') && sp.includes("turf.buffer(x, 1, { units: 'meters' })"), 'spajanje + zatvaranje pukotina');
  const ak = tijelo(H, 'function _odsAkcija(');
  assert.ok(ak.includes('npIzPrstena(s.ring, s.ime)') && ak.includes('USFSjek.izPrstena(s.ring, s.ime)') && ak.includes('_odjelIzvjestajGj(s.gj, s.ime, s.izvor)'));
  assert.ok(R('static/js/nagib-poligon.js').includes('window.npIzPrstena =') && R('static/js/sjekacke.js').includes('izPrstena(ring, naziv)') && R('static/js/odjeli.js').includes('function _odjelIzvjestajGj('));
});

t('lista objekata u KML sekciji + izvoz', () => {
  const rr = tijelo(H, 'function _kmlRegRender(');
  assert.ok(rr.includes('_kmlObjektiToggle(') && rr.includes('_kmlIzvoz(') && rr.includes('_kmlObjektiHtml(k)'));
});

t('globalna const/let imena index.html se ne sudaraju sa učitanim static/js skriptama', () => {
  // dvije `function` deklaracije su dozvoljene; const/let + bilo šta = SyntaxError i skripta se ne učita
  const imena = src => { const m = new Map(); for (const x of src.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(const|let|class)\s+([A-Za-z_$][\w$]*))/gm)) m.set(x[1] || x[3], x[2] || 'function'); return m; };
  const skripte = [...H.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const glavna = imena(skripte);
  const ucitane = [...H.matchAll(/<script[^>]*src="(static\/js\/[^"?]+)"/g)].map(m => m[1]);
  assert.ok(ucitane.includes('static/js/odjeli.js'));
  for (const f of ucitane) {
    const sudar = [...imena(R(f))].filter(([n, v]) => glavna.has(n) && (v !== 'function' || glavna.get(n) !== 'function')).map(([n]) => n);
    assert.deepStrictEqual(sudar, [], f + ' dijeli globalno const/let ime s index.html: ' + sudar.join(', '));
  }
});
console.log(`  ${pass} testova prošlo`);
