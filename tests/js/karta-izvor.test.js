'use strict';
// Prvi uvoz offline karte: karta se otvara iz izvornog fajla odmah, trajna kopija ide
// u pozadini (MainActivity.trajnaKopija / KopijaKarte) — uvoz NE smije čekati kopiranje.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const H = R('index.html'), J = R('android/app/src/main/java/ba/spd/usf/forest/MainActivity.java');
let pass = 0;
const t = (ime, fn) => { fn(); pass++; console.log('  ✓ ' + ime); };
console.log('Offline karta — otvaranje iz izvora:');
const tijelo = (src, pocetak) => { const i = src.indexOf(pocetak); assert.ok(i >= 0, pocetak); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };

t('uvoz: izvor → info → javi JS-u → tek onda kopija; rezerva = stari tok', () => {
  const imp = tijelo(J, 'private void importOfflineMap(Uri uri)');
  const iOtv = imp.indexOf('otvoriIzIzvora(id)'), iJavi = imp.indexOf('javiUvoz(true, info.toString())'), iKop = imp.indexOf('pokreniKopiju(id)');
  assert.ok(iOtv > 0 && iOtv < iJavi && iJavi < iKop, 'redoslijed');
  assert.ok(imp.indexOf('new KopijaKarte().kopiraj(') > iKop, 'rezervni tok kopira tek ako izvor ne uspije');
  assert.ok(imp.includes('takePersistableUriPermission') && imp.includes('info.put("cuvanje", true)'));
});

t('izvor preko /proc/self/fd, samo čitanje; openMbtiles bez fajla pada na izvor', () => {
  assert.ok(J.includes('"/proc/self/fd/" + pfd.getFd()') && /otvoriIzIzvora[\s\S]{0,800}OPEN_READONLY/.test(J));
  assert.ok(tijelo(J, 'private SQLiteDatabase openMbtiles(String id)').includes('if (!file.isFile()) return otvoriIzIzvora(id);'));
});

t('zamjena na kopiju odgođeno zatvara staru bazu; ubijen app nastavlja; brisanje prekida kopiju', () => {
  const tk = tijelo(J, 'private void trajnaKopija(String id, KopijaKarte k)');
  assert.ok(tk.includes('mbtilesDatabases.put(id, nova)') && tk.includes('postDelayed') && tk.includes('getUsableSpace()'));
  assert.ok(tk.includes('zaboraviIzvor(id)'), 'po završetku izvor se zaboravlja');
  const lm = tijelo(J, 'public String listMaps()');
  assert.ok(lm.includes('izvorKarte(id) != null') && lm.includes('pokreniKopiju(id)'));
  const dm = tijelo(J, 'public boolean deleteMap(String id)');
  assert.ok(dm.includes('k.prekini()') && dm.includes('KopijaKarte.part(mbtilesFile(id)).delete()') && dm.includes('zaboraviIzvor(id)'));
});

t('JS: _sqlKopija prikazuje napredak i ishod, lista pokazuje stanje čuvanja', () => {
  assert.ok(H.includes('function _sqlKopija(nid, p, stanje, poruka)') && H.includes("'💾 Trajno čuvanje karte: '"));
  assert.ok(H.includes("cuvanje: info.cuvanje ? { p: 0 } : null") && H.includes("'💾 trajno čuvanje '"));
  const wf = R('.github/workflows/build-apk.yml');
  assert.ok(wf.includes('android/test-java/KopijaKarteTest.java'), 'Java test u CI-ju');
});
console.log(`  ${pass} testova prošlo`);
