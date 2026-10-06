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
  assert.ok(i > 0 && i < H.indexOf("map.on('click', e => {\n  if (_msrOn"));
  const blok = H.slice(i, H.indexOf('}, true);', i));
  assert.ok(blok.includes('map.closePopup()') && blok.includes('e.stopPropagation()') && blok.includes(".leaflet-popup, .leaflet-control"));
});

t('pkml veže sloj s Placemark-om i geometrijom; kartica ima Uredi/Obriši (ne za ugrađene)', () => {
  const p = tijelo(H, 'function pkml(');
  assert.ok(p.includes("veza(l, 'Polygon', gi)") && p.includes("veza(l, 'LineString', gi)") && p.includes("veza(m, 'Point', gi)"));
  assert.ok(tijelo(H, 'function _kmlPopupHtml(').includes("if (sloj && !sloj._ugradjeno) dugmad.push({ t: '✏ Uredi'"));
});

t('izmjene idu u KML tekst i čuvaju se; SHP se pri prvoj izmjeni pretvara u KML', () => {
  const pr = tijelo(H, 'function _kmlPrimijeni(');
  assert.ok(pr.includes('_kmlParseDoc(_kmlSadrzaj(k))') && pr.includes('new XMLSerializer().serializeToString(doc)'));
  const ob = tijelo(H, 'function _kmlObnovi(');
  assert.ok(ob.includes('localStorage.setItem(_LOCAL_KML_KEY') && ob.includes('delete k._shp'));
  assert.ok(tijelo(H, 'function _kmlSadrzaj(').includes('return _kmlIzGrupe(k)'));
  const kr = tijelo(H, 'function _kmlUredKraj(');
  assert.ok(kr.includes("lls.concat([lls[0]])"), 'poligon se zatvara u KML-u');
  assert.ok(tijelo(H, 'async function _kmlObrisiObjekat(').includes("if (!pm.querySelector('Point, LineString, Polygon')) pm.remove()"));
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
