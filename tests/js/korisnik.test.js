const fs = require('fs'), assert = require('assert');
const H = fs.readFileSync('index.html', 'utf8');
const src = H.match(/const _KORISNIK_KEY[\s\S]*?\nif \(typeof document/)[0].replace(/\nif \(typeof document$/, '');
const mem = {}, el = id => ({ innerHTML: '', hidden: false, value: '', focus() {}, select() {}, id });
const els = { 'set-profil': el(), 'set-korisnik-dno': el(), 'set-korisnik-box': el(), 'meni-korisnik': el(), 'set-korisnik-ime': el() };
let toast, potvrda = true;
const api = new Function('localStorage', 'document', 'showToast', '_escHtml', 'confirm', src + '; return { _korisnikUi, _korisnikSpremi, _korisnikUredi, _korisnikUkloni, _korisnikCitaj };')(
  { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } },
  { getElementById: id => els[id], activeElement: null }, t => { toast = t; }, x => String(x).replace(/</g, '&lt;').replace(/"/g, '&quot;'), () => potvrda);
// bez imena: unos gore, kartica dolje i Meni chip skriveni
api._korisnikUi();
assert(els['set-profil'].innerHTML.includes('id="set-korisnik-ime"') && els['set-korisnik-dno'].hidden && els['meni-korisnik'].hidden);
els['set-korisnik-ime'].value = '  Nedim   Čehić ';
api._korisnikSpremi();
const k = api._korisnikCitaj(); assert.strictEqual(k.ime, 'Nedim Čehić');
// s imenom: profil gore (inicijali NČ), chip u Meniju, uređivanje samo u kartici na dnu
assert(els['set-profil'].innerHTML.includes('class="kor-ime">Nedim Čehić<') && !els['set-profil'].innerHTML.includes('<input'));
// samo ime i prezime preko cijele širine: bez „Korisnik aplikacije”, datuma i inicijala
for (const h of [els['set-profil'].innerHTML, els['meni-korisnik'].innerHTML]) assert(!/Korisnik aplikacije|\d{1,2}\.\d{1,2}\.\d{4}|kor-av|set-hero-av/.test(h), h);
assert(!els['meni-korisnik'].hidden && els['meni-korisnik'].innerHTML.includes('Nedim Čehić'));
assert(!els['set-korisnik-dno'].hidden && els['set-korisnik-box'].innerHTML.includes('✏ Uredi') && !els['set-korisnik-box'].innerHTML.includes('<input'));
api._korisnikUredi(true); assert(els['set-korisnik-box'].innerHTML.includes('value="Nedim Čehić"') && els['set-korisnik-box'].innerHTML.includes('Ukloni korisnika'));
els['set-korisnik-ime'].value = 'Nedim Cehic'; api._korisnikSpremi();
assert.strictEqual(api._korisnikCitaj().ime, 'Nedim Cehic'); assert.strictEqual(api._korisnikCitaj().datum, k.datum, 'datum prvog upisa ostaje');
els['set-korisnik-ime'].value = '   '; api._korisnikUredi(true); api._korisnikSpremi(); assert.strictEqual(api._korisnikCitaj().ime, 'Nedim Cehic', 'prazno ne briše');
potvrda = false; api._korisnikUkloni(); assert(api._korisnikCitaj());
potvrda = true; api._korisnikUkloni(); assert.strictEqual(api._korisnikCitaj(), null); assert(els['meni-korisnik'].hidden && els['set-korisnik-dno'].hidden);
assert(/\^\(usf_\|tvlake_\)/.test(H));
console.log('korisnik ok');
