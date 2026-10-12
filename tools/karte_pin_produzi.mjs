// Produžuje šifrate postojećih zapisa na 60 mjeseci od tekućeg (pokreni npr. jednom godišnje, prije nego istekne zadnji mjesec).
//   USF_PIN_FORMAT=<format> node tools/karte_pin_produzi.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../static/js/drive-karte.js');
const format = process.env.USF_PIN_FORMAT;
if (!format) { console.error('USF_PIN_FORMAT nije postavljen'); process.exit(1); }
const raw = await D.kljucIzPina(D.pinIzFormata(format));
for (const ime of ['karte_drive.json', 'kml_drive.json']) {
  const f = new URL('../static/data/' + ime, import.meta.url), lista = JSON.parse(readFileSync(f, 'utf8'));
  for (const k of lista) {
    const o = await D.desifruj(raw, D.encZaMjesec(k) || '');
    if (!o) { console.error('Zapis "' + k.naziv + '" se ne dešifruje PIN-om ovog mjeseca'); process.exit(1); }
    k.encm = await D.sifrujMjesecno(o, format);
  }
  writeFileSync(f, JSON.stringify(lista, null, 1) + '\n'); console.log(ime + ': produženo (' + lista.length + ')');
}
