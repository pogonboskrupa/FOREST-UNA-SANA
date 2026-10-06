'use strict';
// Primka drvne mase: zbirovi po partiji/danu/sortimentu, CSV izvoz, povezivanje s app-om.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../static/js/primka.js');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('Primka:');

const pr = { naziv: 'Odjel 12; primka', izvodjac: 'Šumar d.o.o.', partije: { a: { primljeno: true }, b: { primljeno: false }, c: { primljeno: false } },
  unosi: [
    { datum: '2026-10-06', lid: 'a', m3: 12.5, sortiment: 'Trupci', odKoga: 'Marko' },
    { datum: '2026-10-06', lid: 'b', m3: 3.25, sortiment: 'Ogrjevno drvo' },
    { datum: '2026-10-07', lid: 'a', m3: 7.1, sortiment: 'Trupci', napomena: 'kiša; blato' }] };

t('zbir po partiji, danu i sortimentu; primljene partije', () => {
  const s = P.pkSume(pr);
  assert.strictEqual(s.ukupno, 22.85);
  assert.deepStrictEqual(s.poPartiji, { a: 19.6, b: 3.25 });
  assert.deepStrictEqual(s.poDanu, { '2026-10-06': 15.75, '2026-10-07': 7.1 });
  assert.deepStrictEqual(s.poSortimentu, { Trupci: 19.6, 'Ogrjevno drvo': 3.25 });
  assert.deepStrictEqual([s.partija, s.primljeno, s.dana], [3, 1, 2]);
  assert.deepStrictEqual(P.pkSume({}).ukupno, 0);
});

t('CSV: zarez za decimale, navodnici za ; u tekstu, oznake partija, zbir', () => {
  const c = P.pkCsv(pr, { a: 'L1', b: 'L2', c: 'L3' });
  assert.ok(c.startsWith('﻿'), 'BOM za Excel');
  assert.ok(c.includes('"Odjel 12; primka"') && c.includes('2026-10-06;L1;12,5;Trupci;Marko;') && c.includes('"kiša; blato"'));
  assert.ok(c.includes('L1;primljeno;19,6') && c.includes('L3;neprimljeno;0') && c.includes('UKUPNO m3;22,85'));
  assert.ok(c.indexOf('2026-10-06;L1') < c.indexOf('2026-10-07;L1'), 'po datumu');
  assert.match(P.pkDanas(), /^\d{4}-\d{2}-\d{2}$/);
});

t('povezano: meni ispod Sjekačkih linija, panel, skripta, offline keš, API sjekačkih i fotografija', () => {
  const H = R('index.html');
  const i = H.indexOf('id="mc-sjekacke"'), j = H.indexOf('id="mc-primka"');
  assert.ok(i > 0 && j > i && j < H.indexOf('<h3>Podaci i karte</h3>'), 'kartica odmah ispod Sjekačkih linija');
  assert.ok(H.includes('id="primka-panel"') && H.includes("'primka-panel']") && H.indexOf('<script src="static/js/sjekacke.js">') < H.indexOf('<script src="static/js/primka.js">'));
  assert.ok(R('sw.js').includes("'./static/js/primka.js'") && R('android/copy-assets.sh').includes('static/js/primka.js'));
  const S = R('static/js/sjekacke.js'), T = R('static/js/tacke.js'), J = R('static/js/primka.js');
  assert.ok(S.includes('partije(pid) {') && S.includes('projekti() {') && T.includes('fotoUrl, dodajFoto, obrisiFoto'));
  assert.ok(J.includes("map.getPane('primkaPane').style.pointerEvents = 'none'") && J.includes('_kartaKlikIzvor'), 'dodir ide kroz _kartaKlikIzvor');
  assert.ok(J.includes("#22c55e") && J.includes("#ef4444") && J.includes('fillOpacity: prov'), 'zeleno / crveno, providnost po projektu');
});
console.log(`  ${pass} testova prošlo`);
