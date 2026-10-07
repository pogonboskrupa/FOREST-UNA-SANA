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
  const l = JSON.parse(R('static/data/karte_drive.json')).concat(JSON.parse(R('static/data/kml_drive.json')));
  assert.ok(Array.isArray(l) && l.length >= 1);
  for (const k of l) {
    assert.deepStrictEqual(Object.keys(k).filter(x => x !== 'vrsta').sort(), ['enc', 'id', 'mb', 'naziv', 'opis']);
    assert.ok(k.vrsta === undefined || k.vrsta === 'kml');
    assert.ok(/^[A-Za-z0-9+/=]{40,}$/.test(k.enc) && D.izB64(k.enc).length > 28, 'iv + šifrat + GCM tag');
  }
  for (const f of ['index.html', 'static/data/karte_drive.json', 'static/data/kml_drive.json', 'static/js/drive-karte.js', 'CLAUDE.md'])
    assert.ok(!/drive\.google\.com\/file\/d\/[\w-]{20,}|[?&]id=[\w-]{25,}/.test(R(f)), f + ' bez Drive linka');
});

t('app: zaseban PIN karata (provjera dešifrovanjem), nativno preuzimanje, provjera SQLite zaglavlja', () => {
  const H = R('index.html'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
  const fn = ime => { const i = H.indexOf('async function ' + ime + '('); return H.slice(i, H.indexOf('\n}', i)); };
  assert.ok(fn('_dkOtkljucaj').includes("'usf_karte_greske'") && fn('_dkOtkljucaj').includes('USFDriveKarte.desifruj(k, l[0].enc)'), 'PIN karata se provjerava dešifrovanjem');
  assert.ok(!fn('_pinTrazi').includes('usf_karte') && !fn('_pinTrazi').includes('USFDriveKarte'), 'PIN sekcija ne otključava karte');
  assert.ok(H.includes('const kljuc = _dkKljuc();') && H.includes("localStorage.removeItem('usf_karte_kljuc')"));
  assert.ok(H.includes('AndroidKarta.preuzmi(id, USFDriveKarte.urlPreuzimanja(o.fileId), k.naziv)') && H.includes('id="drive-karte"'));
  assert.ok(J.includes('new KartaBridge(), "AndroidKarta"') && J.includes('equals("SQLite format 3")') && J.includes('"Range", "bytes=" + imam + "-"'));
  assert.ok(J.includes('url.startsWith("https://drive.usercontent.google.com/")'), 'most skida samo s Drive-a');
  assert.ok(R('sw.js').includes("'./static/js/drive-karte.js'") && R('android/copy-assets.sh').includes('static/data/karte_drive.json'));
});

t('KML poligoni s Drive-a: ista lista (vrsta kml), KML preglednik, nativno u cache pa uvoz kao ručni KML', () => {
  const H = R('index.html'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java'), lista = JSON.parse(R('static/data/kml_drive.json'));
  assert.ok(lista.length && lista.every(k => k.vrsta === 'kml'), 'KML u svojoj listi');
  assert.ok(JSON.parse(R('static/data/karte_drive.json')).every(k => !k.vrsta), 'stari APK-ovi (karte_drive.json) ne vide KML');
  assert.ok(R('sw.js').includes('kml_drive.json') && R('android/copy-assets.sh').includes('static/data/kml_drive.json'));
  assert.ok(H.includes('id="drive-kml"') && H.includes('AndroidKarta.preuzmiKml(id, USFDriveKarte.urlPreuzimanja(o.fileId))') && H.includes('AndroidKarta.uzmiKml(id)'));
  assert.ok(H.includes("_vectorFileChosen({ target: { files: [new File([u8], ime)], value: '' } })"), 'isti tok kao ručni uvoz (KMZ, IDB)');
  assert.ok(J.includes('public void preuzmiKml(String kid, String url)') && J.includes('public String uzmiKml(String kid)') && J.includes('private void skiniDrive('));
  assert.ok(J.includes('nije KML (Drive je vratio stranicu umjesto fajla)'), 'HTML umjesto KML-a se odbija');
  assert.ok(R('tools/karta_drive_dodaj.mjs').includes("vrsta: 'kml'"));
});

(async () => {
  for (const [ime, fn] of testovi) { try { await fn(); pass++; console.log('  ✔ ' + ime); } catch (e) { console.error('  ✘ ' + ime + '\n      ' + e.message); process.exitCode = 1; } }
  console.log('\n' + pass + ' prošlo, ' + (process.exitCode ? 'IMA PALIH' : '0 palo') + ' — Drive karte');
})();
