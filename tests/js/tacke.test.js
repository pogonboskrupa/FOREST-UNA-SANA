'use strict';
// Terenske tačke: "Slikaj" (naGps(true)) šalje zastavice {gps, foto} u nova() — one ne
// smiju završiti u tački (foto:true je pregazio listu fotografija i forma se nije otvarala).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '../../static/js/tacke.js'), 'utf8');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('Terenske tačke — Slikaj:');
const fnSrc = ime => { const i = SRC.indexOf('function ' + ime + '('); let d = 0, j = SRC.indexOf('{', i); for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}' && --d === 0) break; } return SRC.slice(i, j + 1); };

const okolina = poz => {
  const uhvaceno = [];
  const f = new Function('gp', 'otvoriUred', fnSrc('nova') + '\n' + fnSrc('naGps') + '\nreturn { nova, naGps };');
  return { uhvaceno, api: f(() => poz, (tacka, novo, foto) => uhvaceno.push({ tacka, novo, foto })) };
};

t('Slikaj na GPS poziciji: forma dobija niz fotografija i nalog za kameru', () => {
  const o = okolina({ la: 44.8, lo: 16.0, al: 512, ac: 4 });
  assert.strictEqual(o.api.naGps(true), true);
  const { tacka, novo, foto } = o.uhvaceno[0];
  assert.ok(Array.isArray(tacka.foto) && tacka.foto.length === 0, 'foto je prazan niz');
  assert.strictEqual(foto, true, 'kamera se otvara odmah');
  assert.strictEqual(novo, true);
  assert.ok(!('gps' in tacka), 'zastavica gps nije u tački');
  assert.deepStrictEqual([tacka.la, tacka.lo, tacka.al, tacka.ac], [44.8, 16.0, 512, 4]);
  assert.doesNotThrow(() => [...tacka.foto]);
});

t('Tačka ovdje (bez slikanja) i tačka na karti', () => {
  const o = okolina({ la: 44.8, lo: 16.0, al: 0, ac: 7 });
  o.api.naGps(false); o.api.nova(44.9, 16.1);
  assert.strictEqual(o.uhvaceno[0].foto, false); assert.strictEqual(o.uhvaceno[1].foto, false);
  assert.ok(o.uhvaceno.every(u => Array.isArray(u.tacka.foto)));
});

t('bez GPS-a nema forme; otvoriUred podnosi pogrešan foto iz starog zapisa', () => {
  const o = okolina(null);
  assert.strictEqual(o.api.naGps(true), false); assert.strictEqual(o.uhvaceno.length, 0);
  assert.ok(fnSrc('otvoriUred').includes('Array.isArray(t.foto) ? [...t.foto] : []'));
});
console.log(`  ${pass} testova prošlo`);
