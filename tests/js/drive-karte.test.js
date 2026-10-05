'use strict';
// Drive karte uz PIN: šifrovanje Drive ID-a (PBKDF2 → AES-GCM), isti kod u app-u i alatu.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../../static/js/drive-karte.js');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
let pass = 0;
const testovi = [];
const t = (ime, fn) => testovi.push([ime, fn]);
console.log('Drive karte (PIN):');

t('šifrovanje/dešifrovanje: tačan ključ vraća Drive ID, pogrešan PIN ne', async () => {
  const k = await D.kljucIzPina('1357'), enc = await D.sifruj(k, { fileId: 'ABCdefGHIjklMNOpqrSTUvwxYZ012345' });
  assert.deepStrictEqual(await D.desifruj(k, enc), { fileId: 'ABCdefGHIjklMNOpqrSTUvwxYZ012345' });
  assert.strictEqual(await D.desifruj(await D.kljucIzPina('1358'), enc), null);
  assert.notStrictEqual(await D.sifruj(k, { fileId: 'x' }), await D.sifruj(k, { fileId: 'x' }), 'nasumičan IV');
  assert.strictEqual(D.uB64(D.izB64('AAEC')), 'AAEC');
});

t('Drive link → ID → URL preuzimanja (confirm=t za velike fajlove)', () => {
  const id = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
  for (const l of ['https://drive.google.com/file/d/' + id + '/view?usp=drivesdk', 'https://drive.google.com/open?id=' + id, id]) assert.strictEqual(D.driveId(l), id, l);
  assert.strictEqual(D.driveId('https://example.com/x'), null);
  assert.strictEqual(D.urlPreuzimanja(id), 'https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t');
});

t('lista karata: samo šifrovani zapisi, bez linka i PIN-a u čistom tekstu', () => {
  const l = JSON.parse(R('static/data/karte_drive.json'));
  assert.ok(Array.isArray(l) && l.length >= 1);
  for (const k of l) {
    assert.deepStrictEqual(Object.keys(k).sort(), ['enc', 'id', 'mb', 'naziv', 'opis']);
    assert.ok(/^[A-Za-z0-9+/=]{40,}$/.test(k.enc) && D.izB64(k.enc).length > 28, 'iv + šifrat + GCM tag');
  }
  for (const f of ['index.html', 'static/data/karte_drive.json', 'static/js/drive-karte.js', 'CLAUDE.md'])
    assert.ok(!/drive\.google\.com\/file\/d\/[\w-]{20,}|[?&]id=[\w-]{25,}/.test(R(f)), f + ' bez Drive linka');
});

t('app: ključ iz PIN-a pri otključavanju, nativno preuzimanje, provjera SQLite zaglavlja', () => {
  const H = R('index.html'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
  assert.ok(H.includes('USFDriveKarte.kljucIzPina(String(unos).trim())') && H.includes("localStorage.removeItem('usf_karte_kljuc')"));
  assert.ok(H.includes('AndroidKarta.preuzmi(id, USFDriveKarte.urlPreuzimanja(o.fileId), k.naziv)') && H.includes('id="drive-karte"'));
  assert.ok(J.includes('new KartaBridge(), "AndroidKarta"') && J.includes('equals("SQLite format 3")') && J.includes('"Range", "bytes=" + imam + "-"'));
  assert.ok(J.includes('url.startsWith("https://drive.usercontent.google.com/")'), 'most skida samo s Drive-a');
  assert.ok(R('sw.js').includes("'./static/js/drive-karte.js'") && R('android/copy-assets.sh').includes('static/data/karte_drive.json'));
});

(async () => {
  for (const [ime, fn] of testovi) { try { await fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; } }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — Drive karte');
})();
