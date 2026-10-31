'use strict';
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const U = require('../../static/js/put-izvjestaj.js');
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('  ✔ ' + n); } catch (e) { console.error('  ✘ ' + n + '\n      ' + e.message); process.exitCode = 1; } };
console.log('Izvještaj trase:');
t('metrike: uspon/silazak, postojeći put se ne naplaćuje, trošak', () => {
  const m = U.metrike([{ elev: 100 }, { elev: 110 }, { elev: 105 }], { totalDist: 1000, maxSlopePct: 7, avgSlopePct: 3, segments: [{ level: 'ex', distM: 200 }] }, { iskop: 500, nasip: 100, zidM: 10 }, { zemljani: 10 });
  assert.strictEqual(m.up, 10); assert.strictEqual(m.dn, 5); assert.strictEqual(m.nova, 800);
  assert.strictEqual(m.trosak, 600 * 10 + 800 * 20 + 10 * 120);
});
t('najbolji bira najjeftiniju', () => assert.strictEqual(U.najbolji([{ m: { trosak: 5 } }, { m: { trosak: 2 } }, { m: { trosak: 9 } }], 'trosak'), 1));
t('PDF: zaglavlje, jedna A4 stranica, JPEG ugrađen, xref pokazuje na obj', () => {
  const j = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), p = U.pdfIzJpeg(j, 100, 50), s = Buffer.from(p).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.includes('/MediaBox [0 0 595 842]') && s.includes('/DCTDecode') && s.endsWith('%%EOF'));
  const x = +s.match(/startxref\n(\d+)/)[1]; assert.ok(s.slice(x).startsWith('xref'));
  const o4 = +s.match(/xref\n0 6\n.*\n.*\n.*\n.*\n(\d{10})/)[1]; assert.ok(s.slice(o4).startsWith('4 0 obj'));
});
t('UI: modul uključen, SW i APK paket, poređenje + izvještaj', () => {
  const R = f => fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');
  assert.ok(R('index.html').includes('<script src="static/js/put-izvjestaj.js">') && R('index.html').includes('_rdVarRegistruj') && R('index.html').includes('_rdIzvjestaj'));
  assert.ok(R('sw.js').includes("'./static/js/put-izvjestaj.js'") && R('android/copy-assets.sh').includes('static/js/put-izvjestaj.js'));
});
console.log('\n' + pass + ' prošlo, 0 palo — izvještaj trase');
