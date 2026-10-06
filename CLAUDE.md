# UNA SANA FOREST — napomene za agente

- **Glavna grana je `codex-forest`** — s nje se gradi APK koji je na telefonima
  i s nje CI objavljuje GitHub Release (updater u app-u čita najnoviji release).
  Push na drugu granu koja objavljuje release sa nižom verzijom zbunjuje updater.
- **Verzija se podiže na 4 mjesta**: `.github/workflows/build-apk.yml`
  (`# APK_RELEASE_VERSION=`), `sw.js` (`APP_VERSION`), `static/js/terrain-layers.js`
  (dva stringa `v1.x.y`). `index.html` `APP_VER` je zasebna web oznaka.
- **Testovi**: `for f in tests/js/*.test.js; do node "$f"; done` i Java test
  offline karata (vidi docs ispod). Sintaksa inline skripti: `new Function(src)`
  nad svakim `<script>` blokom u `index.html`.
- **Offline karte (.sqlitedb / MBTiles)**: sve što treba da se `.sqlitedb`
  prikaže (obrnuti zoom 17 − z, šeme, pane-ovi, testovi) je u
  [`docs/offline-karte-sqlitedb.md`](docs/offline-karte-sqlitedb.md).
- **Prvi uvoz offline karte (APK)**: karta se odmah otvara iz IZVORNOG fajla (SAF uri →
  `openFileDescriptor` → SQLite na `/proc/self/fd/N`, samo čitanje, `otvoriIzIzvora`), a trajna
  kopija u `offline_maps` ide u pozadini (`trajnaKopija` + `KopijaKarte`: `.part`, provjera
  dužine i zaglavlja, rename; napredak `_sqlKopija` → status i lista). Gotova kopija zamijeni
  bazu u `mbtilesDatabases`, stara se zatvara poslije 5 s. `native_mbtiles_izvor` (id → uri)
  ⇒ poslije ubijanja app-a `listMaps` otvori iz izvora i kopira ispočetka. Bez fd-a / greške
  ⇒ stari tok (kopija pa otvaranje). Test: `android/test-java/KopijaKarteTest.java`.
- **Prikaz nativnih pločica (APK)**: `_NativeSqlTileLayer` (L.TileLayer, `<img>` sa
  `https://appassets.androidplatform.net/mbtiles/<id>/{z}/{x}/{y}` → `interceptMbtilesTile`,
  nema pločice = 204) — NE sinhroni `AndroidMbtiles.getTile` po pločici (blokirao zumiranje).
  sw.js `/mbtiles/` NE presreće (inače prazne pločice + keš raste); i SW klijent zove interceptor.
  Rezerva: dok nijedna pločica nije stigla URL-om, greška pita most `getTileDataUri`; ako most
  ima pločicu ⇒ `_mostSamo` (204 ne prebacuje). Java: do 3 read-only čitača po karti
  (`citac`/`noviCitaci`, ista putanja i za `/proc/self/fd`), `TileSchema.yRed` pamti orijentaciju Y.
- Leaflet: svaki `pane: 'x'` mora imati `map.createPane('x')`; sloj koji treba
  biti iznad offline podloge (`offlineBasePane`, z 210) mora imati vlastiti pane.
- **Ugrađeni podaci (static/data, 5 općina USK)**: `efda_opcine.*` (poremećaji
  šume, EFDA v3.0) i `dem_opcine.tif` (Copernicus DEM 30 m) prave se u CI-ju
  na grani `claude/practical-pasteur-p2npth` (`tools/efda_priprema.py`,
  `tools/dem_priprema.py`, workflowi `efda-priprema` / `dem-priprema`) —
  ovo okruženje nema pristup Zenodu/AWS-u. Granice odjela: `geo/odjeli.kml`
  (učitava `static/js/odjeli.js`; bez fajla rade KML-ovi iz "Učitaj KML").
- **Podloge cijelog USK (8 općina)** u Šumarstvu (`static/js/usk-slojevi.js`):
  `opcine_usk.geojson` + `usk_granica.geojson` (OSM admin granice iz Geofabrik
  izvoda, `tools/granice_priprema.py`; geoBoundaries odstupa 1,5–3,7 km — ne koristiti),
  `tlo_usk.*` (HWSD v2, `tools/tlo_priprema.py`), `zima/{z}/{x}/{y}.webp` +
  `zima.json` (Sentinel-2 dec–mart, `tools/zima_priprema.py`, ~20 min u CI-ju).
  Prave se na istoj data grani; poslije CI-ja fajlove prekopirati na `codex-forest`
  (`git show origin/<grana>:static/data/...`).
- **Zimski snimak u APK-u je samo pregled z8–11.** Detalj z12–14 se preuzima u app-u
  (`static/js/zima.js`): paketi `paketi/zima/{područje}_z{12,13,14}.zip` na data grani
  (`tools/zima_paketi.py`, manifest `static/data/zima_paketi.json`) sa
  raw.githubusercontent.com (CORS *) → Cache Storage `usf-zima-<područje>`. Nove
  pločice na data grani ⇒ ponovo napraviti pakete i manifest kopirati na `codex-forest`.
- **Klik na kartu** ide kroz `_kartaKlikIzvor` (index.html), ne kroz DOM
  događaje slojeva: u canvas modu gornji pane pojede dodir donjeg. Novi sloj koji
  treba popup registruje izvor i ima `pointerEvents='none'` na svom pane-u.
- `map` je `const`, `lastP` je `let` — leksički globalni; `window.map` je
  `<div id="map">`. U modulima koristiti gola imena (`typeof map !== 'undefined'`).
- **Snimanje traga na slabijem telefonu**: paket iz native bafera (npr. sat pod zaključanim
  ekranom ≈ 1800 tačaka) ide uz `_tragSerija` — bez crtanja/statistike po tački, linija
  `setLatLngs` jednom (prije ~26 s zamrzavanja na 4× sporijem CPU-u). Dužina u traci je
  inkrementalna (`_tragDuzina`), NE `_tragCalcLen(_tragPts)` po tački. Xiaomi/HyperOS: osim
  baterije treba Autostart (`AndroidGps.jeXiaomi/otvoriAutostart`, jednokratni savjet + Postavke).
  Mrežni zahtjevi bez `reliableFetch` moraju imati istek (AbortController), inače slab signal visi.
  Serija ide kroz `_tragDodajSeriju` (drain I oporavak `_crashCheck`); snimak samo `_tragSnimak()`.
  Prekidi GPS-a (> 60 s bez fiksa ≤ 50 m, pauza ne broji): `_tragPrekidi` u snimku → `t.prekidi`
  {n, maxS} u popup-u traga i toastu „Trag sačuvan“ — dokaz s terena. Prije starta probni upis
  0,9 M znakova (`_tragProvjeriProstor`, nudi brisanje `usf_tlo_klima_*`). GpsService: odbijen
  `startForeground` (Android 12+ restart iz pozadine) ⇒ uredno `stopSelf`, ne pad; `onTaskRemoved`
  samo osvježi obavijest. Test bafera: `android/test-java/NativeGpsBufferTest.java`.
- Terenske tačke (`static/js/tacke.js`): localStorage `usf_tacke`, fotografije u
  IndexedDB `usf_foto`; APK kamera ide kroz `imageIntent()` u MainActivity.
  `nova(la, lo, {gps, foto})`: gps/foto su ZASTAVICE — ne smiju u tačku (`foto:true` je gazio niz
  fotografija ⇒ „Slikaj” nije otvarao ništa); test `tests/js/tacke.test.js`.
- **Meni → Praćenje šume**: Šumarstvo, Sušenje-potkornjak (`susenje-panel`: Tlo i potkornjak,
  Vitalnost krošnje NDVI/EVI/NDMI, sušenje deadtrees.earth s projekcijom), Požari. Elementi su
  zadržali ID-ove (`tp-*`, `uk-veg-*`/`veg-*`, `sum-*`); oba panela osvježava `_sumPanelOsvjezi()`.
  Dugme ✕ `#tem-x` ispod 🗂 (`#layer-btn`): vidljivo dok je uključen bilo koji sloj tih sekcija
  (`_tematskiUkljuceni`: `_SUM_LAYERS`, `USKSlojevi`, `USFVeg`); `_tematskiIskljuci` ih gasi i
  vraća zadnju offline kartu (`_SQL_ACTIVE_KEY` → `_sqlmapSelect`). Legenda požara je zadano niže (112px).
  Offline (samo USK): tlo — svako očitanje po ćeliji 0,1° (`usf_tlo_mjesta`, ≤ 160, bez mreže
  najbliže ≤ 15 km); NDVI — Cache `usf-veg` (sloj ima bounds USK); sušenje — COG blokovi 64 KB
  u Cache `usf-susenje` (`kesCitaj` prije mreže, `kesPisi` samo uz Content-Range s ukupnom dužinom,
  centar karte u USK, zaglavlje uvijek, ≤ 4000 blokova). Pregled/brisanje: `_susKesStat`/`_susKesObrisi`.
- **Zdravlje šume** (panel Sušenje-potkornjak): `static/js/tlo-potkornjak.js` — Open-Meteo (CORS *,
  bez ključa): ERA5-Land tlo + klimatologija 1991–2020 (kvantili po ćeliji 0,1° u
  localStorage `usf_tlo_klima_*`), IFS prognoza, PHENIPS; zadnji rezultat
  `usf_tlo_zadnje` za offline. `static/js/vegetacija.js` — NDVI/EVI/NDMI preko CDSE
  Sentinel Hub WMS s našim EVALSCRIPT-om (diskretna paleta → dodir dekodira raspon);
  ID konfiguracije unosi korisnik (localStorage `usf_veg`), NIKAD u repozitorij;
  pločice 512 px u Cache Storage `usf-veg` (svježe 5 dana). Pokretna legenda na karti `#veg-map-leg`
  (opis po klasi `INDEKSI[k].klase`, stanje/položaj `usf_veg_leg`), vidljiva dok je sloj uključen. Kvota CDSE: 10 000
  zahtjeva/mj po računu. GEE nije ugrađen (tile URL ističe, traži server/ključ).
- **Sjekačke linije** (Planiranje, `static/js/sjekacke.js`): poligon (crtanje dodirom/
  GPS-om, mjerenje, KML, odjel) → paralelne linije u smjeru dominantnog pada (DEM preko
  `npVisinaNa` iz nagib-poligon.js); linija = granica sjekačke partije, UVIJEK uz
  padinu (obaranje). Prva linija 1 širinu od granice, dublje (≤ 1,6×) ako je rub
  uzak; preuska zadnja partija → `slRaspored`; nema linija/komada < 100 m. Obrisane
  linije: `p.izbrisane` (ključ = udaljenost od ruba), id linije = položaj, ne broj.
  Brojanje `p.brojanje` 'L'/'D' (gledano uzbrdo). Ručni lom: `lin.geo` [dno…vrh]
  (`slGeo`, vodič po segmentima) — čuva se uz id kroz brisanja i prenumeraciju.
  Provjera izohipse: uzorak svakih 40 m, pad zaglađen ~150 m (`padGlatko`), nagib < 8 %
  se ne broji; > 25 % dužine s odstupanjem > 45° ⇒ `lin.izo`. Plan 'teren' = lepeza
  pravih linija (`slLepeza`: svaka svoj pad, skretanje susjeda ograničeno, provjera
  stvarnog razmaka ≥ 60 % `slMinRazmak`) → `lin.teren`. Linije pada (flow lines)
  NE koristiti: slijevaju se u jarke i sabijaju partije. localStorage `usf_sjekacke`; izvoz KML:
  linije po statusu + tačke-natpisi (`ExtendedData usf_oznaka`) koje "Učitaj KML"
  crta kao stalnu etiketu. Uvoz projekta i "odjel pod centrom" su uklonjeni.
  Drugi pad (`p.zona` {lid, strana, az}): poligon se dijeli sjekačkom linijom
  (`slPodijeli`), drugi dio dobija svoj pad i linije s id prefiksom `z:` koje završavaju
  na toj liniji; numeracija ide preko oba dijela. Pri pravljenju korisnik bira „prema liniji prije/poslije”
  (`zonaSusjedi` po `br`, `slZonaStrane` = strana koja sadrži sredinu prethodne linije) → `zona.smjer`. GPS vodič snima trag (`lin.trag`),
  „Završi liniju“ ⇒ `lin.stvarna` (slGeo je preferira). Površina partije po liniji
  (`lin.ha`): od granice do L1, L1–L2 … (`slPoljaTeren` po dijelu, `slSpojiTrake`,
  `slTrakeULinije`); stvarna linija se računa kao produžena do granice.
  Vodič snima preko native GpsService (`window.usfPozadina.pocni/zavrsi`, isti zajednički
  bafer kao "Snimi trag" — `_drainNativeGpsBuffer` predaje tačke svim slušaocima
  `_bgSnimanja`): radi pod zaključanim ekranom; `usf_sjek_vodic` nastavlja vodič poslije
  ubijanja app-a. Površina (ha) samo u popup-u linije, ne na karti.
  Alternativni prikaz (`p.prikaz='padine'`, `p.padine` {dijelovi, granice}): `citajPadine` čita
  DEM mrežu 12–25 m → `slPadineMreza` (zaglađivanje, vrhovi histograma ekspozicije ≥ 60°
  razmaka + k-means, modus, komponente, spajanje malih/sličnih < 35°) → granice greben/jarak
  (`slGranicaLinija`) → `slRazdijeli` (slPodijeli redom; granica s krajem dalje od ruba čeka).
  Svaka padina svoj pad, linije id `pN:`, `izbrisane` po padini; padina s izo linijama
  dobija lepezu; partije se NE spajaju preko grebena (ostatak po padini). Računa se pri
  pravljenju projekta, prekidač Osnovni/Alternativni u panelu.
  Natpisi (`postaviNatpise`): prioritet + 4 položaja (van kraja linije, dalje, bočno), sakrij
  ako nema mjesta; preračun na zoomend. Klik na liniju crta poligon partije (`slPartija` →
  `slTrakaObris`: ista mreža/klasifikacija kao `slPoljaTeren`, pa površina = `lin.ha`).
  Dijeljenje: KML nosi cijeli projekat (Document ExtendedData `usf_sjekacke` = base64 JSON,
  `usf_fokus` = linija za "📤 Pošalji liniju"); "Učitaj KML"/primljeni fajl → `USFSjek.izKml`
  (otvori ili spoji; Odustani = obični KML sloj). Spajanje `slSpojiProjekte`: plan iz novijeg
  `p.tPlan` (`planIzmjena` pri promjeni rasporeda), stanje linije iz novijeg `lin.t` (`dodirni`
  pri statusu/radniku/lomu/GPS-u). APK prima KML/KMZ iz drugih app-ova (intent VIEW/SEND,
  `launchMode singleTask`, `primiFajl` → `AndroidShare.uzmiDolazni()` → JS `_dolazniFajl`).
  Sačuvana mjerenja NEMAJU bindPopup (zaustavlja dodir) — popup ide kroz `_kartaKlikIzvor`.
- **Ikona**: izvor `FOREST_IKONA.png` (Grmeč Navigator); iz njega `icon-192/512`,
  `icon-maskable-512` (80 % sigurna zona), `apple-touch-icon`, mipmap `ic_launcher*`. Sve
  NEPROVIDNO do ruba (providni uglovi ⇒ Xiaomi/HyperOS crta bijeli okvir i smanjuje ikonu);
  adaptivni foreground: sadržaj ~83 % vidljivih 72dp, umetak 0, pozadina `#02341C`;
  splash `drawable-nodpi/splash_logo.png`
  — `<bitmap>` NIKAD na `@mipmap/ic_launcher` (adaptive XML na API 26+ ⇒ pad pri pokretanju).
- **PIN za Šumarstvo, Sušenje-potkornjak, Požari, Projektovanje puta**: kapija
  `if (!_pinOtkljucano()) { _pinTrazi(<fn>); return; }` na vrhu `open*Section`. U kodu samo
  `_PIN_HES` = sha256(`_PIN_SOL` + PIN) — PIN NIKAD u repo/commit/test. Otključano:
  localStorage `usf_pin_ok` = `_PIN_HES.slice(0,16)` (preživi update; novi PIN ⇒ ponovo zaključa).
  5 grešaka ⇒ pauza 30 s (`usf_pin_greske`); Postavke → „Zaključaj zaštićene sekcije” (gasi i karte).
  Zajednički unos `_pinUnos(poruka, ključGrešaka, provjeri)`. Karte imaju DRUGI PIN (vidi ispod).
- **Drive karte za preuzimanje** (Učitaj kartu → „☁ Karte za preuzimanje”): lista
  `static/data/karte_drive.json` (app je čita s raw.githubusercontent codex-forest → nove karte
  bez APK-a). Drive fajl ID šifrovan: PBKDF2-SHA256(PIN, `usf-karte-v1`, 250k) → AES-GCM
  (`static/js/drive-karte.js`, isti kod app/alat/test). Dodavanje: `USF_PIN=xxxx node
  tools/karta_drive_dodaj.mjs "<link>" "Naziv" ["opis"] [MB]` — PIN i link NIKAD u repo/commit.
  PIN karata je odvojen od PIN-a sekcija i nema heš: `_dkOtkljucaj` ga provjerava dešifrovanjem
  prvog zapisa liste (greške `usf_karte_greske`); čuva se samo ključ u `usf_karte_kljuc`. APK: `AndroidKarta.preuzmi`
  → `drive.usercontent.google.com/download?…&confirm=t`, `.part` + Range nastavak, provjera
  „SQLite format 3”, pa uvoz kao `importOfflineMap`. Drive fajl mora biti „Svako s linkom”.
- **Birač fajlova u APK-u** (`onShowFileChooser`): offline karta se prepoznaje u
  `IzborFajla.jeOfflineKarta` po CIJELIM tokenima accept-a (`.dbf` iz KML/SHP birača sadrži
  `.db` — podstring je slao svaki KML u uvoz offline karte). Test: `android/test-java/IzborFajlaTest.java`.
- **Otvorena kartica (popup)**: dodir na kartu je SAMO zatvara (capture `click` listener na
  `map.getContainer()` prije Leaflet-a) — inače dodir unutar odjela odmah otvori novu karticu.
- **Uređivanje KML/SHP** (`_kmlUrediMeni`, `_kmlUrediPodatke`, `_kmlUrediOblik`, `_kmlObrisiObjekat`,
  lista „▸ Objekti” i 📤 u KML sekciji): `pkml` veže sloj s `<Placemark>` (`_kmlPm`/`_kmlTip`/`_kmlGi`);
  izmjena ide u KML DOM → `XMLSerializer` → `_kmlObnovi` (sloj iznova, `usf_kml_layers`). Stilovi,
  ExtendedData i KMZ slike ostaju. SHP se pri prvoj izmjeni pretvara u KML (`_kmlIzGrupe`). Ugrađeni
  odjeli se ne uređuju. Stil sloja (`_kmlStilOtvori`: paleta/vlastita boja, debljina, puna/isprek/tačk,
  ispuna %) u `usf_kml_layers[ime].stil` → `pkml(doc, col, op, stil)` / `_kmlLeafletStil`. Stil objekta:
  inline `<Style>` + ExtendedData `usf_stil=1`/`usf_crta` (`_kmlUpisiStil`) — `pkml` ga poštuje SAMO uz
  `usf_stil` (tuđi KML stilovi ne mijenjaju izgled); `usf_*` se ne prikazuju u kartici. Uređivanje oblika:
  ↶ poništi (`istorija`), dodir na kartu dodaje tačku (`_kmlUredDodaj`), živa dužina/ha; ➕ novi objekat u
  sloju (`_kmlNoviObjekat`). Ikona Sakrij/Prikaži: `_okoDugme` (SVG oko), ne 🙈. Globalna const/let imena u index.html se NE smiju poklopiti sa static/js
  (`_kmlKoord` u odjeli.js) — test `tests/js/kml-uredjivanje.test.js`.
- **Više odsjeka jednog odjela** (kartica poligona → „☑ Više odsjeka”, `_odsPocni`): dodir na kartu
  uključuje/isključuje poligon (`_odsIzbor`, grana u `map.on('click')`), „Cijeli odjel” bira odsjeke istog
  broja (`_odsOdjel`: atribut ODJEL… ili prvi broj u nazivu) u istom sloju. `_odsSpoji`: `_turfUnija`
  (turf v6 `union(a,b)` / v7 `union(fc)`), pukotine ±1 m bafer; razdvojeni ⇒ samo izvještaj. Predaja:
  `npIzPrstena`, `USFSjek.izPrstena`, `_odjelIzvjestajGj` (odjeli.js `_odjelIzvjestajZa`).
- **Tab Karte** (`karte-panel`): grupe Podloga (Bazna karta, Offline karte) → Moji podaci (KML — preglednik
  poligona, Tematska) → Teren (Nagib, Ekspozicija i sjenčenje); stanje na karticama `_khStat()` pri
  `switchMainTab('karte')`. KML panel = „KML — preglednik poligona”: pretraga `#kml-trazi` (`_kmlTraziHtml`,
  naziv + atributi bez dijakritika, ≤ 100 rezultata), red objekta `_kmlObjekatRed`.
- **Primka** (Meni ispod Sjekačkih linija, `static/js/primka.js`, panel `primka-panel`, localStorage
  `usf_primka`): projekat = sjekački projekat (`sid`) + izabrane partije (`partije[lid].primljeno`) →
  zelena/crvena ispuna, `prov` % po projektu (pane `primkaPane` z 412, dodir kroz `_kartaKlikIzvor`);
  unosi {datum, lid, m3, sortiment, odKoga, napomena} po danima/partiji; fotografije zapažanja u IDB
  terenskih tačaka (`USFTacke.dodajFoto/obrisiFoto/fotoUrl`) s GPS/centar pozicijom; CSV (`pkCsv`, ;).
  Geometrija: `USFSjek.projekti()` / `USFSjek.partije(sid)` (mreža `slTrakeMreza` jednom po dijelu —
  11× brže od obrisa po partiji), keš po dužini `usf_sjekacke`. Kartica linije ima „📦 Primka”
  (`USFPrimka.dugmad`). CSS klase `pkm-*` (NE `pk-*` — `.pk-red`/`.pk-traka` su od `_popKartica`).
  Količina je `type=text inputmode=decimal` (number odbija decimalni zarez). Test `tests/js/primka.test.js`.
- JS `alert/confirm/prompt` u APK-u: MainActivity `onJs*` s naslovom `app_name`
  ("Grmeč Navigator") — bez override-a WebView piše appassets.androidplatform.net.
