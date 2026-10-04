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
- Terenske tačke (`static/js/tacke.js`): localStorage `usf_tacke`, fotografije u
  IndexedDB `usf_foto`; APK kamera ide kroz `imageIntent()` u MainActivity.
- **Zdravlje šume** (Šumarstvo): `static/js/tlo-potkornjak.js` — Open-Meteo (CORS *,
  bez ključa): ERA5-Land tlo + klimatologija 1991–2020 (kvantili po ćeliji 0,1° u
  localStorage `usf_tlo_klima_*`), IFS prognoza, PHENIPS; zadnji rezultat
  `usf_tlo_zadnje` za offline. `static/js/vegetacija.js` — NDVI/EVI/NDMI preko CDSE
  Sentinel Hub WMS s našim EVALSCRIPT-om (diskretna paleta → dodir dekodira raspon);
  ID konfiguracije unosi korisnik (localStorage `usf_veg`), NIKAD u repozitorij;
  pločice 512 px u Cache Storage `usf-veg` (svježe 5 dana). Kvota CDSE: 10 000
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
  na toj liniji; numeracija ide preko oba dijela. GPS vodič snima trag (`lin.trag`),
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
  Sačuvana mjerenja NEMAJU bindPopup (zaustavlja dodir) — popup ide kroz `_kartaKlikIzvor`.
- **Ikona**: izvor `FOREST_IKONA.png` (Grmeč Navigator); iz njega `icon-192/512`,
  `icon-maskable-512` (80 % sigurna zona), `apple-touch-icon`, mipmap `ic_launcher*`
  (adaptivna pozadina `#02341C`, umetak 17dp za kružnu masku), splash s ikonom.
- JS `alert/confirm/prompt` u APK-u: MainActivity `onJs*` s naslovom `app_name`
  ("Grmeč Navigator") — bez override-a WebView piše appassets.androidplatform.net.
