const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8');
const src = H.match(/const _KORISNIK_KEY[\s\S]*?\nfunction _renderPostavke/)[0].replace(/\nfunction _renderPostavke$/, '');
const mem = {}, els = { 'set-korisnik-ime': { value: '  Nedim   Cehic ', blur() {} }, 'set-korisnik-info': {} };
const run = new Function('localStorage', 'document', 'showToast', src + '; return { _korisnikSpremi, _korisnikCitaj };');
let toast; const api = run({ getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } },
  { getElementById: id => els[id], activeElement: null }, t => { toast = t; });
api._korisnikSpremi();
assert.strictEqual(api._korisnikCitaj().ime, 'Nedim Cehic'); assert(/Nedim Cehic/.test(toast) && /Zapisano: Nedim Cehic/.test(els['set-korisnik-info'].textContent));
els['set-korisnik-ime'].value = ''; api._korisnikSpremi(); assert.strictEqual(api._korisnikCitaj(), null);
assert(H.includes('id="set-korisnik-ime"') && /\^\(usf_\|tvlake_\)/.test(H)); // usf_ ključ ide u rezervnu kopiju
console.log('korisnik ok');
