// Dodaje Drive kartu u static/data/karte_drive.json (PIN po mjesecu, vidi static/js/drive-karte.js). PIN, format PIN-a i link se NE commituju.
//   USF_PIN_FORMAT=<format> node tools/karta_drive_dodaj.mjs [--kml] "<drive link>" "Naziv karte" ["opis"] [MB]
// Format se piše tokenima YY / YYYY / MM; zapis dobija šifrate za 13 mjeseci od tekućeg (poslije zadnjeg važi zadnji PIN).
// --kml: KML/KMZ poligoni (odjeli/odsjeci) — prikaz u KML pregledniku, ne među kartama.
// Drive fajl mora biti dijeljen "Svako s linkom — pregledač".
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../static/js/drive-karte.js');
const argv = process.argv.slice(2), kml = argv[0] === '--kml';
const [link, naziv, opis = '', mb = ''] = kml ? argv.slice(1) : argv;
// KML ima svoju listu: stariji APK-ovi čitaju karte_drive.json i prikazali bi ga kao kartu
const FAJL = new URL(kml ? '../static/data/kml_drive.json' : '../static/data/karte_drive.json', import.meta.url);
const format = process.env.USF_PIN_FORMAT;
if (!format) { console.error('USF_PIN_FORMAT nije postavljen'); process.exit(1); }
const fileId = D.driveId(link);
if (!fileId || !naziv) { console.error('Upotreba: USF_PIN_FORMAT=… node tools/karta_drive_dodaj.mjs "<drive link>" "Naziv" ["opis"] [MB]'); process.exit(1); }
let lista = []; try { lista = JSON.parse(readFileSync(FAJL, 'utf8')); } catch (e) {}
const raw = await D.kljucIzPina(D.pinIzFormata(format));
const postoji = [];
for (const k of lista) { const o = await D.desifruj(raw, D.encZaMjesec(k) || ''); if (!o) { console.error('Zapis "' + k.naziv + '" se ne dešifruje PIN-om ovog mjeseca — pogrešan format ili istekli šifrati.'); process.exit(1); } if (o.fileId === fileId) postoji.push(k); }
const zapis = { id: postoji[0]?.id || 'k' + Date.now().toString(36), naziv, opis, mb: mb ? Number(mb) : null, ...(kml ? { vrsta: 'kml' } : {}), encm: await D.sifrujMjesecno({ fileId }, format) };
lista = lista.filter(k => !postoji.includes(k)).concat([zapis]);
writeFileSync(FAJL, JSON.stringify(lista, null, 1) + '\n');
console.log((postoji.length ? 'Ažurirano' : 'Dodano') + ': ' + naziv + (kml ? ' [KML]' : '') + ' (' + lista.length + ' zapisa)');
