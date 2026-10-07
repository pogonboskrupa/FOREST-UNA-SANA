// Dodaje Drive kartu u static/data/karte_drive.json (šifrovano PIN-om). PIN i link se NE commituju.
//   USF_PIN=xxxx node tools/karta_drive_dodaj.mjs [--kml] "<drive link>" "Naziv karte" ["opis"] [MB]
// --kml: KML/KMZ poligoni (odjeli/odsjeci) — prikaz u KML pregledniku, ne među kartama.
// Drive fajl mora biti dijeljen "Svako s linkom — pregledač".
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../static/js/drive-karte.js');
const FAJL = new URL('../static/data/karte_drive.json', import.meta.url);
const argv = process.argv.slice(2), kml = argv[0] === '--kml';
const [link, naziv, opis = '', mb = ''] = kml ? argv.slice(1) : argv;
const pin = process.env.USF_PIN;
if (!pin || !/^\d{4}$/.test(pin)) { console.error('USF_PIN (4 cifre) nije postavljen'); process.exit(1); }
const fileId = D.driveId(link);
if (!fileId || !naziv) { console.error('Upotreba: USF_PIN=xxxx node tools/karta_drive_dodaj.mjs "<drive link>" "Naziv" ["opis"] [MB]'); process.exit(1); }
let lista = []; try { lista = JSON.parse(readFileSync(FAJL, 'utf8')); } catch (e) {}
const raw = await D.kljucIzPina(pin);
// postojeći zapisi moraju se dešifrovati istim PIN-om (inače bi lista bila mješavina PIN-ova)
for (const k of lista) if (!(await D.desifruj(raw, k.enc))) { console.error('Zapis "' + k.naziv + '" nije šifrovan ovim PIN-om — prekid.'); process.exit(1); }
const postoji = [];
for (const k of lista) { const o = await D.desifruj(raw, k.enc); if (o.fileId === fileId) postoji.push(k); }
const zapis = { id: postoji[0]?.id || 'k' + Date.now().toString(36), naziv, opis, mb: mb ? Number(mb) : null, ...(kml ? { vrsta: 'kml' } : {}), enc: await D.sifruj(raw, { fileId }) };
lista = lista.filter(k => !postoji.includes(k)).concat([zapis]);
writeFileSync(FAJL, JSON.stringify(lista, null, 1) + '\n');
console.log((postoji.length ? 'Ažurirano' : 'Dodano') + ': ' + naziv + (kml ? ' [KML]' : '') + ' (' + lista.length + ' zapisa)');
