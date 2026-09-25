'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../../static/js/efda-layer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const root = {};
new Function('window', 'globalThis', SRC)(root, root);
const E = root.USFEfda;

function extractFn(name) {
  const i = HTML.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('nema ' + name);
  let d = 0, j = HTML.indexOf('{', i);
  for (; j < HTML.length; j++) { if (HTML[j] === '{') d++; else if (HTML[j] === '}' && --d === 0) break; }
  return HTML.slice(i, j + 1);
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✔ ' + name); };
console.log('Šumarstvo — Poremećaji šume (EFDA v3.0, 5 općina):');

t('dekodiraj: v = uzrok*50 + (godina-1984), 0 i van opsega = nema', () => {
  assert.deepStrictEqual(E.dekodiraj(3 * 50 + 35), { uzrok: 3, godina: 2019 });
  assert.deepStrictEqual(E.dekodiraj(1 * 50 + 40), { uzrok: 1, godina: 2024 });
  assert.deepStrictEqual(E.dekodiraj(1), { uzrok: 0, godina: 1985 });
  assert.strictEqual(E.dekodiraj(0), null);
  assert.strictEqual(E.dekodiraj(50), null, 'godina 0 ne postoji');
  assert.strictEqual(E.dekodiraj(255), null);
});

t('boja: po uzroku, noviji jači, filter uzroka i perioda', () => {
  const novo = E.boja(2 * 50 + 40), staro = E.boja(2 * 50 + 1);
  assert.deepStrictEqual(novo.slice(0, 3), E.UZROCI[2].boja);
  assert.ok(novo[3] > staro[3], 'noviji poremećaj mora biti neprozirniji');
  assert.strictEqual(E.boja(3 * 50 + 35, { uzroci: new Set([1, 2]) }), null, 'sječa isključena filterom');
  assert.strictEqual(E.boja(3 * 50 + 10, { odGodine: 2000 }), null, '1994. je prije perioda');
  assert.ok(E.boja(3 * 50 + 36, { odGodine: 2020 }), '2020. je u periodu');
});

t('statistika po općini poštuje period i uzroke, sortirano po površini', () => {
  const f = new Function(extractFn('_sumPorStatistika') + '\nreturn _sumPorStatistika;')();
  const meta = { opcine: {
    'Bihać': { po_godini_ha: { '2010': { '3': 10, '1': 2 }, '2021': { '3': 5, '2': 1 } } },
    'Cazin': { po_godini_ha: { '2022': { '3': 30 } } }
  } };
  const r = f(meta, { od: 2020, uzroci: [1, 2, 3] });
  assert.strictEqual(r[0].ime, 'Cazin');
  const b = r.find(x => x.ime === 'Bihać');
  assert.strictEqual(b.ukupno, 6, 'samo 2021: sječa 5 + požar 1');
  assert.strictEqual(f(meta, { od: 1985, uzroci: [1] }).find(x => x.ime === 'Bihać').ukupno, 2);
});

t('integracija: prekidač u Šumarstvu, sloj u sumarstvoPane, fajlovi u APK-u i SW kešu', () => {
  assert.ok(HTML.includes('id="sum-poremecaji-switch"'));
  assert.ok(HTML.includes("poremecaji: 'sum-poremecaji-switch'"));
  assert.ok(/new Por\(\{ pane: 'sumarstvoPane'/.test(HTML));
  assert.ok(HTML.includes('src="static/js/efda-layer.js"'));
  const sw = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
  const kopija = fs.readFileSync(path.join(__dirname, '../../android/copy-assets.sh'), 'utf8');
  ['static/js/efda-layer.js', 'static/data/efda_opcine.tif', 'static/data/efda_opcine.json', 'static/data/opcine5.geojson'].forEach(f => {
    assert.ok(sw.includes("'./" + f + "'"), 'SW precache: ' + f);
    assert.ok(kopija.includes(f), 'APK provjera: ' + f);
  });
});

console.log('\n' + pass + ' prošlo, 0 palo — poremećaji šume');
