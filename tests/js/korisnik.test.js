const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8');
const src = H.match(/const _KORISNIK_KEY[\s\S]*?\nfunction _renderPostavke/)[0].replace(/\nfunction _renderPostavke$/, '');
const mem = {}, box = { innerHTML: '' }, inp = { value: '  Nedim   Cehic ', focus() {}, select() {} };
const els = { 'set-korisnik-box': box, 'set-korisnik-ime': inp };
let toast; const api = new Function('localStorage', 'document', 'showToast', '_escHtml', src + '; return { _korisnikUi, _korisnikSpremi, _korisnikUredi, _korisnikCitaj };')(
  { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } },
  { getElementById: id => els[id] }, t => { toast = t; }, x => String(x).replace(/</g, '&lt;'));
api._korisnikUi(); assert(box.innerHTML.includes('id="set-korisnik-ime"') && !box.innerHTML.includes('Uredi'));   // prvi put: unos
api._korisnikSpremi();
assert.strictEqual(api._korisnikCitaj().ime, 'Nedim Cehic');
assert(box.innerHTML.includes('Nedim Cehic') && box.innerHTML.includes('✏ Uredi') && !box.innerHTML.includes('<input'));  // poslije spremanja: kartica + Uredi
api._korisnikUredi(true); assert(box.innerHTML.includes('value="Nedim Cehic"') && box.innerHTML.includes('Odustani'));  // greška → Uredi
inp.value = 'Nedim Čehić'; api._korisnikSpremi(); assert.strictEqual(api._korisnikCitaj().ime, 'Nedim Čehić');
api._korisnikUredi(true); api._korisnikUredi(false); assert(box.innerHTML.includes('✏ Uredi')); // Odustani vraća karticu
assert(/\^\(usf_\|tvlake_\)/.test(H));
console.log('korisnik ok');
