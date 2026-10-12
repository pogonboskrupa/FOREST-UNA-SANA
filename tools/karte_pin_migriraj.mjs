// JEDNOKRATNO: prebacuje zapise iz { enc } (jedan PIN) u { encm } (PIN po mjesecu, 13 mjeseci od tekućeg (poslije zadnjeg važi zadnji PIN)).
//   USF_PIN_STARI=xxxx USF_PIN_FORMAT=<format> node tools/karte_pin_migriraj.mjs
// Format se piše tokenima YY / YYYY / MM; NE commituje se (kao ni PIN). Drive ID se nigdje ne ispisuje.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../static/js/drive-karte.js');
const stari = process.env.USF_PIN_STARI, format = process.env.USF_PIN_FORMAT;
if (!stari || !format) { console.error('Treba USF_PIN_STARI i USF_PIN_FORMAT'); process.exit(1); }
const raw = await D.kljucIzPina(stari);
for (const ime of ['karte_drive.json', 'kml_drive.json']) {
  const f = new URL('../static/data/' + ime, import.meta.url);
  const lista = JSON.parse(readFileSync(f, 'utf8'));
  for (const k of lista) {
    if (k.encm) continue;
    const o = await D.desifruj(raw, k.enc);
    if (!o || !o.fileId) { console.error('Zapis "' + k.naziv + '" se ne dešifruje starim PIN-om'); process.exit(1); }
    k.encm = await D.sifrujMjesecno(o, format); delete k.enc;
  }
  writeFileSync(f, JSON.stringify(lista, null, 1) + '\n');
  console.log(ime + ': ' + lista.length + ' zapisa → encm');
}
