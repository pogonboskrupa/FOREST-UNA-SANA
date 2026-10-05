'use strict';
// PIN za Šumarstvo, Sušenje-potkornjak, Požari i Projektovanje puta. U repou je samo heš;
// test provjerava mehaniku (heš, kapija u sve 4 sekcije, ključ vezan za heš), ne sam PIN.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
let pass = 0;
const testovi = [];
const t = (ime, fn) => testovi.push([ime, fn]);
console.log('PIN zaštita sekcija:');

const sol = /_PIN_SOL = '([^']+)'/.exec(HTML)[1], hes = /_PIN_HES = '([0-9a-f]{64})'/.exec(HTML)[1];
const fnSrc = name => { const i = HTML.indexOf('async function ' + name + '('), j = HTML.indexOf('\n}', i); return HTML.slice(i, j + 2); };

t('heš u kodu je SHA-256 (64 hex), funkcija se slaže s Node crypto', async () => {
  const _pinHes = new Function('_PIN_SOL', fnSrc('_pinHes') + '\nreturn _pinHes;')(sol);
  const ocek = nodeCrypto.createHash('sha256').update(sol + '1234').digest('hex');
  assert.strictEqual(await _pinHes('1234'), ocek);
  for (const pogresan of ['0000', '1234', '9999', '1111']) assert.notStrictEqual(await _pinHes(pogresan), hes, 'očiti PIN-ovi ne prolaze');
});

t('kapija na početku sve 4 sekcije, ostale sekcije bez PIN-a', () => {
  for (const f of ['openSumarstvoSection', 'openSusenjeSection', 'openPozariSection', 'openPutSection']) {
    const i = HTML.indexOf('function ' + f + '()'), tijelo = HTML.slice(i, i + 160);
    assert.ok(tijelo.includes(`if (!_pinOtkljucano()) { _pinTrazi(${f}); return; }`), f);
  }
  for (const f of ['openTematskaSection', 'openTragoviPanel']) {
    const i = HTML.indexOf('function ' + f + '('); assert.ok(i > 0 && !HTML.slice(i, i + 200).includes('_pinOtkljucano'), f + ' bez PIN-a');
  }
});

t('otključanost vezana za heš (promjena PIN-a ponovo zaključa), pauza poslije 5 grešaka', () => {
  assert.ok(HTML.includes("localStorage.getItem(_PIN_KLJUC) === _PIN_HES.slice(0, 16)"));
  assert.ok(HTML.includes('n >= 5 ? { n: 0, do: Date.now() + 30000 }'));
  assert.ok(HTML.includes('id="set-pin-zakljucaj"') && HTML.includes("['sumarstvo', 'susenje', 'pozari', 'put'].forEach(k => { s[k] = { t: '🔒'"));
});

(async () => {
  for (const [ime, fn] of testovi) { try { await fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; } }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — PIN');
})();
