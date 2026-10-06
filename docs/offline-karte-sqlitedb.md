# Offline karte: kako se prikazuje `.sqlitedb` (i MBTiles)

Checklist kad `.sqlitedb` karta "ne radi" (prazna canvas karta, krivo mjesto,
fajl se ne može izabrati). Stanje od v1.4.5.

## 1. Tok podataka (APK)

1. **Izbor fajla** — `index.html`, `#sqlmap-file-input`: `accept` MORA sadržati
   `.sqlitedb` (inače ga Android birač može zatamniti).
   `MainActivity.isOfflineMapChooser()` prepoznaje birač po `sqlite`/`mbtiles`/
   `sqlmap`/`.db` u accept listi i otvara `ACTION_OPEN_DOCUMENT` sa `*/*`.
2. **Uvoz** — `MainActivity.importOfflineMap()` kopira fajl u
   `files/offline_maps/<uuid>.sqlite` (jednom; poslije se otvara direktno, bez
   učitavanja u RAM) i javlja JS-u `_nativeSqlmapImported(ok, b64json)`.
3. **Šema** — `MainActivity.tileSchema()` traži bilo koju tabelu sa kolonama
   z/x/y + slika (ne samo `tiles`):
   - MBTiles: `tiles(zoom_level, tile_column, tile_row, tile_data)` — y je **TMS**.
   - `.sqlitedb` (RMaps/Locus/OsmAnd/MOBAC): `tiles(x, y, z, s, image)` — y je **XYZ**.
4. **Pločice** — JS sloj `_NativeSqlCanvasLayer` (index.html, override u
   `static/js/terrain-layers.js` → `getTileDataUri`) poziva
   `AndroidMbtiles.getTileDataUri(id, z, x, y)` → `MainActivity.tileBytes()`.
   MIME se čita iz zaglavlja bajtova (`tileMime`): `.sqlitedb` je često JPEG/WebP
   bez `metadata.format`.

## 2. Obrnuti zoom — najčešći uzrok prazne karte

`.sqlitedb` u "BigPlanet" numeraciji čuva **`z_u_bazi = 17 − zoom`**
(zoom 14 je u bazi `z = 3`). Ako se traži direktno sa Leaflet zoomom, ne nađe
se nijedna pločica → prazna karta, a min/max zoom i granice su pogrešni.

Odluka (`SqliteTileMath.decideInverted`, redom):
1. Ako je `z` u bazi izvan `0..17` → **nije** obrnut.
2. **Iz podataka**: viši stvarni zoom ima više pločica (~4× po nivou). Ako nivo
   sa najmanjim `z` u bazi ima više pločica od nivoa sa najvećim → obrnut.
3. Ako se iz podataka ne može odlučiti (jedan nivo / isti broj) → OsmAnd pravilo:
   `info.tilenumbering` = `BigPlanet` ili kolona ne postoji → obrnut; bilo šta
   drugo (npr. `simple`) → normalan.

Obrtanje važi za: traženje pločice (`storedZoom`), zoom raspon karte
(`realZoomRange`, min/max se zamijene) i granice (`boundsFromTiles` uzima nivo
sa najmanje pločica = `MAX(z)` kod obrnutog).

## 3. Ostale zamke (već popravljene — ne vraćati)

- `boundsFromTiles` podupit NE smije imati zakucano `FROM tiles` — koristi
  `q(s.table)`.
- `interceptMbtilesTile` mora ići kroz `tileBytes()` (ne vlastiti MBTiles upit).
- Offline podloga je u pane-u `offlineBasePane` (z 210). Svaki sloj koji mora
  biti IZNAD nje treba vlastiti pane (npr. `sumarstvoPane` z 420).
  `L.tileLayer` bez `pane` ide u `tilePane` (z 200) → ISPOD offline karte.
- Web put (bez APK-a, sql.js u `_SqlTileLayer`) zna OBJE šeme: `_sqlSema`
  (index.html) je JS kopija pravila iz `SqliteTileMath` (obrnuti zoom, granice
  iz pločica), `_sqlMime` čita MIME iz bajtova. Mijenjaš jedno — mijenjaj oba.
- Zoom opcije sloja idu ISKLJUČIVO kroz `_sqlZoomOpts(minzoom, maxzoom)`:
  `maxZoom` = zoom karte (22), a raspon fajla u `maxNativeZoom`/`minNativeZoom`.
  Ako je `maxZoom` = najveći zoom fajla, Leaflet cijeli sloj ukloni čim se
  zumira dalje → siva pozadina dok se ne odzumira (prijavljen bug, v1.4.7).
  Odzumiranje: najviše 2 nivoa ispod fajla (svaki nivo = 4× više pločica).

- Pozicija se NE mijenja pri uvozu/izboru offline karte ni pri startu
  (korisnik ostaje gdje je bio, `usf_last_pos`): `_sqlmapSelect` nema
  `fitBounds`; skok na obuhvat je samo dugme "⤢ Obuhvat" (`_sqlmapZoom`).
  Karta MORA imati eksplicitan `minZoom: 0` — inače Leaflet uzima minZoom
  iz offline sloja i prisilno zumira (v1.4.15).

## 4. Testovi

- `android/test-java/SqliteTileMathTest.java` — pokreće se u CI-ju prije
  Gradle builda (javac/java, bez Androida). Lokalno:
  ```
  javac -encoding UTF-8 -d /tmp/jt android/app/src/main/java/ba/spd/usf/forest/SqliteTileMath.java android/test-java/SqliteTileMathTest.java
  java -ea -cp /tmp/jt ba.spd.usf.forest.SqliteTileMathTest
  ```
- Za realnu provjeru napravi test bazu u MOBAC/RMaps šemi
  (`CREATE TABLE tiles (x int, y int, z int, s int, image blob, PRIMARY KEY (x,y,z,s))`,
  `CREATE TABLE info (maxzoom Int, minzoom Int)`, z = 17 − zoom, piramida 4× po
  nivou) i provjeri da se pločica na stvarnom zoomu nađe.

## 5. Kad korisnik i dalje prijavi problem, pitaj

- Kojim programom je fajl napravljen (MOBAC / Locus / OsmAnd / drugo)?
- Tačnu poruku (toast) ili screenshot; da li se karta uveze a ostane prazna,
  ili uvoz padne ("SQLite nema raster pločice")?

## Prvi uvoz bez čekanja kopiranja (v1.8.9)

Ranije je `importOfflineMap` prvo kopirao cijeli fajl (1–2 GB) u `files/offline_maps`,
pa tek onda prikazao kartu. Sada:

1. `takePersistableUriPermission` + `openFileDescriptor(uri, "r")`; SQLite otvara
   `/proc/self/fd/<fd>` (`OPEN_READONLY | NO_LOCALIZED_COLLATORS`) — `otvoriIzIzvora`.
2. `readMbtilesInfo` → `_nativeSqlmapImported(true, info)` uz `info.cuvanje = true` — karta
   se vidi odmah, pločice idu istim putem (`tileBytes` → `openMbtiles` iz keša).
3. `trajnaKopija` (pozadinska nit): provjera prostora (veličina + 200 MB), `KopijaKarte`
   piše `<id>.sqlite.part`, provjeri dužinu i „SQLite format 3”, preimenuje; zatim nova baza
   ide u `mbtilesDatabases`, stara baza i fd se zatvaraju poslije 5 s.
4. Napredak/ishod: JS `_sqlKopija(id, p, 'kopija'|'gotovo'|'prostor'|'greska', poruka)`.
5. `native_mbtiles_izvor` (id → uri) čuva izvor dok kopija nije gotova: poslije ubijanja
   app-a `listMaps` (i `openMbtiles` bez fajla) otvara iz izvora i kopiju pokreće ispočetka.
   Brisanje karte prekida kopiju i briše `.part`.
6. Ako izvor ne može da se otvori direktno (provajder bez fd-a, WAL baza…), koristi se
   stari tok — kopija (s napretkom u statusu), pa otvaranje.

## Brzi prikaz pločica pri zumiranju (v1.9.0)

Do v1.8.9 je APK crtao pločice kroz canvas sloj: po pločici sinhroni `AndroidMbtiles.getTile`
(blokira glavnu JS nit, pozivi serijski), base64 (+33 %), data-URI dekodiranje, pa canvas.
Sada `_NativeSqlTileLayer` (`L.TileLayer`) učitava `<img>` sa
`https://appassets.androidplatform.net/mbtiles/<id>/{z}/{x}/{y}`:

- `MainActivity.interceptMbtilesTile` servira binarno, paralelno, van glavne niti; pločica koje
  nema = 204; `Cache-Control: max-age=86400`.
- **sw.js mora preskočiti `/mbtiles/`** (isti origin): SW klijent servira samo assete — to je
  razlog zašto je v1.3.1 prešao na canvas. Za svaki slučaj i `ServiceWorkerClientCompat` zove
  interceptor.
- Android SQLite bez WAL-a = jedna konekcija ⇒ do 3 read-only čitača po karti (`citac`,
  `noviCitaci`, vezani za trenutnu glavnu bazu; stari se zatvaraju odgođeno pri zamjeni
  izvor → kopija i odmah pri brisanju).
- `TileSchema.yRed`: poslije prvog pogotka zna se orijentacija Y (TMS/XYZ), pa pločica koje
  nema košta jedan upit; SQL string se gradi jednom.
- `updateWhenZooming:false`: tokom pinch animacije nema zahtjeva, sloj se puni na kraju.
- Rezerva: dok nijedna pločica nije stigla URL-om, greška pita most `getTileDataUri`; ako most
  vrati pločicu, sloj trajno prelazi na most (`_mostSamo`). 204 ne izaziva prelazak.
