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

// ── v2.6.1: vrste, EXIF GPS, trag ──
{
  const assert = require('assert');
  const { jpegSaGps, KATEGORIJE } = require('../../static/js/tacke.js');
  assert.deepStrictEqual(KATEGORIJE.map(k => k.k), ['suho', 'potkornjak', 'sjeca', 'imela', 'vlaka', 'red', 'granica', 'ostalo'], '8 vrsta');
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]);
  const o = jpegSaGps(jpg, { la: 44.8765, lo: 16.1234, al: 812, datum: '2026-10-20T08:00:00Z' });
  assert.ok(o.length > jpg.length && o[2] === 0xff && o[3] === 0xe1 && String.fromCharCode(...o.slice(6, 10)) === 'Exif');
  assert.deepStrictEqual([...o.slice(-8)], [...jpg.slice(-8)], 'ostatak JPEG-a netaknut');
  const dv = new DataView(o.buffer), t = 12, gps = t + dv.getUint32(t + 18), n = dv.getUint16(gps);
  const e = {}; for (let i = 0; i < n; i++) e[dv.getUint16(gps + 2 + 12 * i)] = gps + 2 + 12 * i;
  assert.strictEqual(String.fromCharCode(o[e[1] + 8]), 'N'); assert.strictEqual(String.fromCharCode(o[e[3] + 8]), 'E');
  const rat = off => { const p = t + dv.getUint32(off + 8); return dv.getUint32(p) / dv.getUint32(p + 4) + dv.getUint32(p + 8) / dv.getUint32(p + 12) / 60 + dv.getUint32(p + 16) / dv.getUint32(p + 20) / 3600; };
  assert.ok(Math.abs(rat(e[2]) - 44.8765) < 1e-5 && Math.abs(rat(e[4]) - 16.1234) < 1e-5, 'koordinate u EXIF-u');
  const al = t + dv.getUint32(e[6] + 8); assert.strictEqual(dv.getUint32(al) / dv.getUint32(al + 4), 812);
  assert.strictEqual(jpegSaGps(new Uint8Array([1, 2, 3, 4]), { la: 1, lo: 1 }).length, 4, 'ne-JPEG se ne dira');
  const H = require('fs').readFileSync(__dirname + '/../../index.html', 'utf8'), J = require('fs').readFileSync(__dirname + '/../../android/app/src/main/java/ba/spd/usf/forest/MainActivity.java', 'utf8');
  ['map.on(\'dragstart\'', '_recFreeView = true', '_tragFotoShare', 'USFTacke.zaVrijeme('].forEach(x => assert.ok(H.includes(x), x));
  assert.ok(J.includes('public void shareFiles(') && J.includes('ACTION_SEND_MULTIPLE'));
  console.log('  ✔ v2.6.1: vrste, EXIF GPS, slobodan pogled, trag + foto');
}
