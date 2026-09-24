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
- Web put (bez APK-a, sql.js u `_SqlTileLayer`) zna samo MBTiles šemu.
- Zoom opcije sloja idu ISKLJUČIVO kroz `_sqlZoomOpts(minzoom, maxzoom)`:
  `maxZoom` = zoom karte (22), a raspon fajla u `maxNativeZoom`/`minNativeZoom`.
  Ako je `maxZoom` = najveći zoom fajla, Leaflet cijeli sloj ukloni čim se
  zumira dalje → siva pozadina dok se ne odzumira (prijavljen bug, v1.4.7).
  Odzumiranje: najviše 2 nivoa ispod fajla (svaki nivo = 4× više pločica).

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
