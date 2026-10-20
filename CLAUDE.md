# UNA SANA FOREST — napomene za agente

- **Glavna grana je `codex-forest`** — s nje se gradi APK koji je na telefonima
  i s nje CI objavljuje GitHub Release (updater u app-u čita najnoviji release).
  Push na drugu granu koja objavljuje release sa nižom verzijom zbunjuje updater.
- **Šema verzija (od 2.0.0)**: x.y.z, svaka cifra ide 0–9 — poslije `z`=9 raste `y` (2.0.9 → 2.1.0), poslije `y`=9 raste `x`
  (2.9.9 → 3.0.0). versionCode = x·10000 + y·100 + z (CI), pa je poredak ispravan.
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
- **Požari — performanse otvaranja**: godišnje plohe (`_povGodPloheZa`) se računaju JEDNOM po skupu podataka (ključ = niz
  `evts` + sadržaj `_poziEvts`), u pozadini (`_poziPloheAsync`, komadi ~25 ms), ne u `_povGodRenderSve` (zvan 3× pri otvaranju —
  ~15 s blokade na 4× sporijem CPU-u s 1500 detekcija). `_poziUnija` spaja u parovima (stablo), krugovi `steps: 16`.
  `_poziRenderPanel` crta historiju/simulaciju samo kad je taj podtab otvoren.
- **Zdravlje šume** (panel Sušenje-potkornjak): `static/js/tlo-potkornjak.js` — Open-Meteo (CORS *,
  bez ključa): ERA5-Land tlo + klimatologija 1991–2020 (kvantili po ćeliji 0,1° u
  localStorage `usf_tlo_klima_*`), IFS prognoza, PHENIPS; zadnji rezultat
  `usf_tlo_zadnje` za offline. `static/js/vegetacija.js` — NDVI/EVI/NDMI preko CDSE
  Sentinel Hub WMS s našim EVALSCRIPT-om (diskretna paleta → dodir dekodira raspon);
  ID konfiguracije unosi korisnik (localStorage `usf_veg`), NIKAD u repozitorij;
  pločice 512 px u Cache Storage `usf-veg` (svježe 5 dana). Pokretna legenda na karti `#veg-map-leg`
  (opis po klasi `INDEKSI[k].klase`, stanje/položaj `usf_veg_leg`), vidljiva dok je sloj uključen. Kvota CDSE: 10 000
  zahtjeva/mj po računu. GEE nije ugrađen (tile URL ističe, traži server/ključ).
  Indeksi (`INDEKSI`): stanje NDVI, EVI, NDMI, GNDVI, NBR, MSAVI, MNDWI; promjena dNDVI (sada − lani) i dNBR (lani − sada,
  USGS pragovi) — `baza` + `znak`, `evalscriptPromjena`: mosaicking ORBIT, `preProcessScenes` ostavi ≤ 4 snimka po periodu
  (zadnjih n dana i isti datumi lani, `periodPromjene`; 'pg' ⇒ 30), prosjek čistih piksela, MAXCC 40 — više PU po pločici.
  Tasseled Cap Wetness/Greenness/Brightness (`tcw/tcg/tcb`): koeficijenti Baig 2014 (OLI) na B02 B03 B04 B08 B11 B12 — približno.
  LSWI = NDMI, ARVI (L2A već korigovan), NDBI i BAI namjerno nisu dodani.
  Legenda na karti `#veg-map-leg` (200 px, zadano dolje lijevo iznad zooma — gore desno je legenda požara): ▾ skupi, ✕ sakrije
  SAMO legendu i ostavi čip `#veg-leg-chip` „🛰 Legenda …” za vraćanje; sloj ostaje uključen.
  CDSE konfiguracija pogona: „🔑 Otključaj konfiguraciju pogona (PIN)” (`USFVeg.otkljucaj`) — `CDSE_ENC` = ID šifrovan AES-GCM
  ključem iz PIN-a (`USFDriveKarte.kljucIzPina`/`desifruj`), `_pinUnos` s greškama `usf_veg_greske`. ID i PIN NIKAD u repo/commit/test;
  novi šifrat: `node -e` sa `sifruj(await kljucIzPina(PIN), {id})` iz env varijabli.
- **Sjekačke linije** (Planiranje, `static/js/sjekacke.js`): poligon (crtanje dodirom/
  GPS-om, mjerenje, KML, odjel) → paralelne linije u smjeru dominantnog pada (DEM preko
  `npVisinaNa` iz nagib-poligon.js); linija = granica sjekačke partije, UVIJEK uz
  padinu (obaranje). Prva linija 1 širinu od granice, dublje (≤ 1,6×) ako je rub
  uzak; preuska zadnja partija → `slRaspored`; nema linija/komada < 100 m. Obrisane
  linije: `p.izbrisane` (ključ = udaljenost od ruba), id linije = položaj, ne broj.
  Brojanje `p.brojanje` 'L'/'D' (gledano uzbrdo). Ručni lom: `lin.geo` [dno…vrh]
  (`slGeo`, vodič po segmentima) — čuva se uz id kroz brisanja i prenumeraciju.
  Provjera izohipse: uzorak svakih 40 m, pad zaglađen ~150 m (`padGlatko`), nagib < 8 %
  se ne broji; > 25 % dužine s odstupanjem > 45° ⇒ `lin.izo`. Crveno se crta SAMO dio koji ne ide uz
  padinu (`lin.izoGeo` iz `slIzoDijelovi`; bez `lin.izo` samo komadi ≥ 80 m). Checkbox „Plohe gdje linije ne idu
  uz stranu” (`p.plohe`, providnost `p.plohaOp`): `racunajPlohe` — mreža 20–40 m, pravac najbliže linije vs
  zaglađen pad → `p.izoPlohe` (obris `slTrakaObris`), računa se pri uključivanju i u `generisi`. Plan 'teren' = lepeza
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
  Spajanje (`spojiPadine` → `slSpojiLinije`/`slSpojiGeo`): linije susjednih padina čiji su krajevi ≤ `p.spoj`×razmak
  (zadano ½; Ne/Blizu/Srednje/Šire u panelu) i uz granicu padina postaju JEDNA krivudava linija (id `m:<id>+<id>`,
  `spoj` geometrija, `komp` [{id, padina, k, geo}]); spajaju se samo linije bez stanja. Spoj je glatak
  (`slSpojiGlatko`: krajevi skraćeni ≤ 30 m, kubna Bezier tangentna na oba dijela — ne oštar lom). Slobodni kraj
  na granici padina produži se pravo do ruba poligona (`slProduzi`: ≤ 2×razmak, ≥ 0,4×razmak od drugih linija;
  i nespojene linije, u `spoj`). Površine `slPoljaPadine`: po padini, ćelija susjedne padine bliža produžetku nego
  vlastitim linijama (≤ razmak) ide partijama izvorne; spojena = zbir dijelova; obris/brisanje po `komp`, izo = najgori dio.
  Partija = od prethodne linije do linije (L1 od granice), zadnja partija = od zadnje linije do granice (`p.ostatakHa`,
  popup zadnje linije). Padine: spojena linija preko grebena ide u jednoj padini uzbrdo, u drugoj nizbrdo ⇒ ta padina
  se gleda obrnuto (`slOrijentacija` → flip); numeracija preko padina `slRedoslijed` (topološki iz nizova po padini);
  traka m u redu numeracije → m-ta linija, traka iza zadnje linije padine → sljedeća linija ako dodiruje padinu
  (≤ ½ razmaka), inače zadnja partija. `lin.partija` [[padina, traka]] crta obris na klik. `komp.geo` je u SVOM smjeru
  (dno→vrh) — u lancu `obrni`; brojanje bocno s obrnutom linijom bi pomiješalo trake.
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
  Ime odjela: `napravi(ring, naziv, pitaj=true)` pita dijalogom (`_dlgPrompt`, Odustani = ništa se ne pravi) s prijedlogom iz poligona
  (`imeOdjela`: „Odjel ” + ODJEL · ODSJEK iz atributa, inače naziv) — za izbor iz liste, 🪓 u kartici poligona i „Više odsjeka”; crtanje
  granice već pita ime. Polje „Odjel / odsjek” (`.sl-naziv`, `data-a="naziv"`) preimenuje projekat u kartici (to NIJE izmjena plana — ne zove
  `planIzmjena`); `p.tNaziv`, a `slSpojiProjekte` uzima novije ime.
- **„Samo za odabir poligona”** (KML sloj čije ime odgovara `_KML_POLIGONSKI` = „Granice taksacije…”; `k.samoOdabir`): sloj NIJE na karti
  (`_kmlPrimijeniPrikaz`/`_kmlNaKarti` — jedino mjesto koje dodaje/uklanja `k.grp` sa karte; nema dodira/kartice/natpisa) i služi samo kao izvor
  poligona odjela/odsjeka (nagib, sjekačke linije i Primka čitaju `kmlLs` bez obzira na kartu). Zadano UKLJUČENO pri svakom učitavanju i
  pokretanju; checkbox na kartici sloja (`_kmlSamoOdabir`) isključuje samo dok se radi — stanje se NE čuva. `_kmlPoligoniOdabir` ostaje
  izvor i kad je opcija isključena. Test `primka.test.js`.
- **Granice odjela — prekidač i KML pregled (v2.5.1)**: tab Karte počinje karticom `#kh-gran` (`_khGranice`): veliki prekidač = `_kmlSamoOdabir(id, !on)` nad slojem „Granice taksacije”
  (prikazano ⇄ samo za odabir; stanje se i dalje NE čuva, pri pokretanju opet skriveno). Pri prikazu `_kmlGranicaIstakni` zadebljava zadani stil (3,5 px, 100 %) samo ako ga korisnik nije mijenjao.
  `#kh-lista` (`_khSlojevi`) = brzi popis ostalih KML slojeva s prekidačima. KML preglednik (`_kmlRegRender`): pločice sa ikonama, filter čipovi (`_kmlFilt`: svi/na karti/skriveni),
  „Prikaži/Sakrij sve” (`_kmlSviVid`), redovi s bojom sloja (`--kc`) i pilulama brojeva; `_kmlToggle` na „samo za odabir” sloju ga prikazuje. `_kmlRegRender` osvježava i `_khStat`.
- **Mjerenja — dizajn i visinski profil (v2.6.0)**: panel `#msr-panel` ima pločice umjesto reda teksta (`_msrKpi`: glavna vrijednost veliko — dužina / ha / nagib % u boji klase), natpise segmenata i Σ na karti
  (`.msr-seg`, ≤ 30 tačaka), ha u težištu poligona. Profil (`static/js/mjerenja-profil.js`, `USFProfil`): za Udaljenost i Nagib (≥ 2 tačke) i iz kartice sačuvanog mjerenja („📈 Profil”, `_msrProfilSaved`)
  kartica `#pf-sheet` pri vrhu karte: uzorci svakih ≥ 10 m (≤ 160) → visine `npVisinaNa` (lokalni DEM/Terrarium, keš) → `popuni` (rupe), `zagladi`, `statistika` (uspon/silazak s pragom 2 m, nagib zaglađen ~80 m,
  udio dužine po klasama 0–10…>50 %); SVG grafikon (ispuna, linija obojena po klasi nagiba, mreža, ▲▼ min/maks), povlačenje prsta = kursor + tačka na karti i nagib; „🎨 Nagib” boji liniju na karti po klasi (`slojNagiba`).
  Preračun je odgođen 650 ms (`odgodi`) pri svakoj izmjeni tačaka. Bez visina (offline van USK) ⇒ poruka. Test `tests/js/mjerenja-profil.test.js`.
- **Snimanje traga i terenske tačke (v2.6.1)**: povlačenje karte tokom snimanja = slobodan pogled (`_recFreeView`, `map.on('dragstart')`; prije se karta vraćala na GPS pri svakom fiksu); dugme `#rb-go` postaje „🎯 Prati me”.
  Vrste tačke (`KATEGORIJE`): suho/prelomljeno/izvala, potkornjak, bespravna sječa (`sjeca`), imela, silazak sa vlake, loš šumski red, granica odjela, ostalo; stari ključevi (`stablo/steta/put/voda`) idu kroz `STARE_VRSTE`.
  Pri spremanju traga (`_tragRegAdd`) tačke s datumom u vremenu snimanja postaju `trag.tacke` (i `tačka.trag`). „📤 Pošalji” trag: KML / KMZ (linija + tačke + fotografije, `izvozKmz(ids, {naziv, kml})`) / samo fotografije.
  Fotografije s lokacijom: `jpegSaGps` upisuje EXIF GPS u JPEG (canvas ga nema); `podijeliFoto` → APK `AndroidShare.shareFiles` (ACTION_SEND_MULTIPLE; `dokument` ⇒ tip `*/*` pa WhatsApp/Viber ne rekompresuju i ne skidaju GPS), uz tekst s koordinatama i Google Maps linkom.
- **Koordinate i dugmad — dizajn (v2.6.9)**: BEZ zamućenja iza (`backdrop-filter: blur(var(--ui-blur, 0px))`; zadano 0 — providnost znači da se vidi oštra karta); postavka „Zamućenje pozadine” 0–16 px; tema podloge tamna/svijetla (`_UI_TEME` → `--ui-bg/fg/bd/sep/a1/a2`, obris teksta u suprotnoj boji). `#geo-badge` = segmenti `.bseg` (⛰ visina | MGI5 | razmjera) odvojeni linijom; preview u Postavkama koristi iste klase (`.ui-bdg`, `_geoBadgeHtml`).
- **Koordinate i dugmad na karti (v2.6.8)**: Postavke → „🎛 Koordinate i dugmad” (`_uiPrikaz`, `usf_ui_prikaz`, `_setUi`/`_uiPrimijeni`): providnost podloge `#geo-badge` (zadano 55 %, `--bdg-a`), veličina teksta, obris teksta
  (Bez/Tanak/Jak → `--bdg-ts`), koji dijelovi se prikazuju (visina / MGI5 / razmjera; `_geoBadgeRender` iz keša `_geoBadgeLast`), providnost i veličina dugmadi (`--btn-a`, `--btn-z` = CSS `zoom` na `#layer-btn/#zoom-grp/#map-fabs`).
  „Prikaz po razmjeri” ima i 📏 mjerenja (zadano 1:25 000; `_msrDrawAllSaved` ne crta, klik izvor ih preskače). Tab Karte: traka skokova, kartica „🔭 Razmjera” (`_khRazmjera`: trenutna razmjera + šta je sakriveno → Postavke).
- **Postavke — raspored (v2.6.7)**: grupe `h4.set-grp`: Aplikacija (ažuriranje) → Prikaz na karti (razmjera, izgled traga) → GPS → Podaci → Memorija i uređaj (keš karata, Prikaz auto/računar/mobilni, napredno, korisnik). `#geo-badge` se prelama (`max-width: 100vw − 84px`) da ne gura 🗂 dugme.
- **Postavke (v2.6.2)**: sticky traka brzih skokova `.set-nav` (`_setSkok`) na sekcije (`set-s-*`, `set-update-card`); sekcija „🥾 Snimanje traga i linije”: debljina/neprovidnost/vrsta crte → `_lineStyle` + `usf_trag_stil`,
  prag GPS tačnosti `_tragAcMax` (20/50/100 m, `usf_trag_acmax`, koristi `_addTragPoint`), „Vrati zadano” (`_setTragZadano`); promjena odmah preiscrta sačuvane tragove. `usf_` ključevi idu u rezervnu kopiju.
- **Meni i modal Moja lokacija (v2.6.3)**: modal `#ab-loc-popup` ima blok uživo `#loc-live` (`_locPopupLive`: MGI 5 + WGS84, tačnost u boji ≤10/≤30/>30 m, visina, brzina iz `lastP.sp`; osvježava se u `onP` dok je otvoren),
  „📋 Kopiraj” i „📤 Podijeli” (`navigator.share` ili kopija s Google Maps linkom). Meni: samo „Nedavno” (pilule stanja i pretraga su uklonjeni na zahtjev),
  zadnja 3 otvorena odjeljka (`usf_meni_nedavno`, `_meniNedavnoRender`).
- **Stil traga (v2.6.5)**: klik na trag (izvor u `_kartaKlikIzvor`) otvara karticu s „🎨 Stil” → `_tragStilUredi` = isti editor kao KML slojevi (`_kmlStilOtvori`, imaPol:false, živo na karti): boja `t.color`, debljina `t.weight`, providnost `t.op`
  (neprovidnost %), vrsta crte `t.dashStyle` (ključevi editora puna/isprek/tack/crtatack ili stari solid/dash/dot → `_tragDashArray`); bez vrijednosti važe zadane iz Postavki (`_lineStyle`). Tab Karte: „🧭 Slojevi na karti” sadrži i tragove (prekidač + 🎨), pregled ima pločice Tragovi i Mjerenja.
- **Razmjera i prikaz po razmjeri (v2.6.6)**: `#geo-badge` (koordinate gore lijevo) ima i razmjeru `1:25 000` (`_razmjeraTxt`, 2 značajne cifre, osvježava se na zoomend). Postavke → „🔭 Prikaz po razmjeri”: posebna granica za
  slike/tačke, tragove i KML/SHP slojeve (`_prRazmjera` {slike, tragovi, kml}, `usf_prikaz_razmjera`; 0 = uvijek, zadano tragovi 50000 = sakriveni sitnije od 1:50 000; presetovi + „Vlastita…”). `_razmjeraSkriva(vrsta)` je jedino mjesto odluke;
  `_prPrimijeni` na zoomend preiscrta samo grupu čije se stanje promijenilo (`_tragRegAddLayer`, `_kmlPrimijeniPrikaz`, `USFTacke.crtaj`; sakrivene tačke/tragovi nisu ni klikabilni). `let` stanje MORA biti prije `_tragRegAddLayer` poziva (TDZ).
- **Meni → Realizacija izvedbenih projekata** (odmah ispod Praćenja šume): Primka i Sjekačke linije (preseljene iz Planiranja).
- **Primka — klase, dock, vizuelni panel (v2.5.0)**: tri klase `STATUS` = primljeno / neprimljeno / `sumskired` („Popraviti šumski red”, narandžasta,
  isprekidan rub); nepoznat status ⇒ neprimljeno (`kljucStatusa`). Šumski red nosi `razlozi[]` (`RAZLOZI`), `rok`, `popravljeno`; „✓ Popravljeno”
  (`USFPrimka.popravljeno`) prebacuje u primljeno i pamti datum. „Novi projekat” ODMAH prebacuje na kartu (`izbPocetniPogled` + `izbNaKarti`),
  poslije pravljenja se ostaje na karti uz DOCK `#pr-dock` (fiksni, `dockRender`): 3 velika dugmeta klase → `crtajStatus` (crtanje obojeno klasom, status
  ide u `crt.status`, bez dijaloga), čipovi razloga (`dockSr`), „Cijeli odjel…” (`izbCijeli`). Bez docka (brzi dio bez aktivnog odjela) klasu bira `pitajStatus`.
  Panel: donut `donutHtml` (razmak 2 px, centar % označeno), legenda s ikonom+nazivom (boja nikad sama), KPI pločice, filter čipovi (`filter`, u memoriji),
  dijelovi su `<details class="pr-dio">` (ključ `pid:d:did`). Značke ikona+ha na karti tek pri zoom ≥ 16 (`.pr-badge`). KML stilovi pr/ne/sr. `zbir().radnici[ime]` = {p, n, s, m3}.
- **Primka** (`static/js/primka.js`, `USFPrimka`, panel `primka-panel`): po odjelu dijelovi s PRIMLJENOM / NEPRIMLJENOM robom
  (drvni sortimenti): `p.dijelovi` [{id, naziv, prst (prstenovi, par/nepar), ha, status, m3, brPrimke, sortimenti, radnik, napomena, datum, izvor, t}],
  localStorage `usf_primka`. Novi projekat = „＋ odaberi odjel / odsjeke”: poligoni ISKLJUČIVO iz sloja „Granice taksacije”
  (`_kmlPoligoniOdabir()`), grupisano po odjelu (cijeli odjel ili pojedini odsjeci, pretraga) → `p.poligoni` [{ring, odjel, odsjek}]
  (`prsteni(p)`: poligoni ILI nacrtani `p.ring`), ime „Odjel 12 · a, b”. Projekat postaje AKTIVAN (`usf_primka_aktivni`, banner `#pr-akt`):
  svaki označeni dio (`brziDio`, „Označi dio odjela”) pripada njemu i siječe se po njegovim poligonima (izvan = odbijen); bez aktivnog
  odjel se prepoznaje po KML-u ispod dijela. Stari izbori (mjerenja, bilo koji KML, 🪵 u kartici poligona / „Više odsjeka”) su UKLONJENI;
  „Nacrtaj granice odjela” je UKLONJENO. Pri pravljenju projekta poligoni se PRIKAZUJU NA KARTI (`izbCrtaj`: konture u pogledu pri zoom ≥ 11,
  označeni istaknuti, oznake odjel · odsjek pri zoom ≥ 14, ≤ 900 poligona) i biraju se i dodirom (`izbNaKarti`, traka `#pr-crt` .pr-izbd:
  ✓ Napravi / ☰ Lista / ✕); u listi 🔍 zumira na odjel. Liste u projektu su SKLOPIVE (`<details>`, zadano sklopljene, otvoreno se pamti u
  memoriji `otvoreno` jer se panel iznova crta): ▣ Poligoni odjela, ▥ Dijelovi; isto u Sjekačkim linijama: „Linije” (`sl-det`). Dio: crtanje dodirom/GPS-om (`#pr-crt`, isječeno po odjelu `turf.intersect` v6) ili partije iz
  `USFSjek.partije(pid)` (isti obris kao klik na liniju — `obrisPartije`; + zadnja partija; ključ `izvor` = sjekId:lid, ponovni uvoz
  zadržava status/m³). Ručni dio ima PREDNOST: preklop se oduzima (`primijeniPrednost`/`oduzmi`, turf.difference) od partija i starijih
  dijelova — hektari se ne broje dvaput. Pane `primkaPane` z 414, dodir kroz `_kartaKlikIzvor` (popup: status, uredi, obriši).
  KML izvoz nosi projekat (`ExtendedData usf_primka`); „Učitaj KML” → `USFPrimka.izKml` (otvori/spoji, po dijelu novije `t`). Test `primka.test.js`.
  Zbir po radniku (`zbir().radnici`) u kartici projekta. `USFPrimka.nacrtaj(opc)` = zajednički alat za crtanje (Promise prstena, null = odustao)
  i `USFPrimka.geo` {ha, unutar, isijeci, oduzmi}. „Posječeno po radnicima” u Sjekačkim linijama je UKLONJENO (na zahtjev).
  Rad BEZ poligona: „✏ Nacrtaj dio (odjel se prepoznaje sam)” (`brziDio`) → `odjelPod` (najmanji KML poligon iz `kmlLs`, i ugrađeni odjeli,
  koji sadrži tačku dijela — `turf.pointOnFeature`) → projekat istog naziva (`_odjelOznaka`: ODJEL · ODSJEK) čija granica sadrži tačku, ili novi
  (`napravi(..., tiho)`); bez poligona → projekat „Bez odjela” (`ring: null` — zbir bez površine odjela, KML bez granice). Dodir: prednost je
  površina u PIKSELIMA (`pxPov` = `_pxPovrsina`, kao KML/mjerenja) — s m² je KML odjel uvijek pobjeđivao pa dio nije bio klikabilan; granica
  odjela primke ima karticu (`popupOdjel`: zbir, ✏ Označi dio, Otvori, Sakrij, Obriši) i stoji ispred istog KML poligona (×0,98).
- **Otvorenost odjela ŠKP-om** (Projektovanje šumskog puta → sekcija, `static/js/otvorenost.js`): poligoni iz
  KML sloja (odjeli/odsjeci), putevi = KML/SHP linije izabranih slojeva + sačuvane trase (`_rdGetSavedRoutes`).
  `otvRaster`: raster udaljenosti od puteva za cijelo područje (ćelija 15–60 m, ≤ ~2,5 M ćelija, propagacija
  najbližeg izvora 2 prolaza) + dužina puta po ćeliji; `otvOdjel` scanline po poligonu (rupe par/nepar): udio
  površine ≤ zona privlačenja (zadano 400 m), Ø udaljenost (bez puta = 3 km), gustoća m/ha. Klasa po udjelu:
  otvoren ≥ 70 %, djelimično ≥ 30 % (pragovi bez novog rastera). Pane `otvPane` z 412 (iznad KML-a), bez dodira;
  ŠKP se ponovo crta iznad ispune. Red „Otvorenost ŠKP” u kartici poligona (`USFOtv.zaSloj`); postavke u
  localStorage `usf_otvorenost`, rezultat samo u memoriji. 2000 odsjeka ≈ 3,7 s na 4× sporijem CPU-u.
  Preporuke za otvaranje su uklonjene (to je posao projektovanja A→B). Drive lista
  KML-a (`_driveKmlRender`) se prikazuje i u ovoj sekciji (`#otv-drive`) — tamo je i „Kamionski putevi”.
- **Slika u razmjeri (A4, PNG)** (`static/js/slika-karte.js`, `USFSlika.podijeli`): sjekačke linije (dugme „🖼 Slika (A4)”
  u projektu), odjel (kartica poligona i izvještaj odjela → `_odjelSlika`, susjedi istog sloja tanko). Crta se
  vektorski na vlastiti canvas — NE snimak karte (podloge s interneta prljaju canvas, nema tačne razmjere). 200 dpi,
  orijentacija po obliku, razmjera = najmanja standardna (`slkRazmjera`, 1:500…1:200 000) u koju objekat stane;
  reljef + izohipse iz lokalnog DEM-a (`USFDem`, samo 5 općina; `slkIzohipse` marching squares, `slkInterval`),
  mjerilo, sjever (S), legenda, podaci. Dijeljenje kroz `_izvozFajl` (Blob) → `AndroidShare.shareFile` (`image/png`).
  PODLOGA = slojevi pločica koji su trenutno na karti (`map.eachLayer` GridLayer, po z-indexu pane-a): pločice daje
  sam sloj (`createTile`, isti put kao ekran: keš, nativni most, sql.js), zoom `slkZoom` (rezolucija slike, ≤
  maxNativeZoom, ≤ 160 pločica); `l._tileZoom = z` privremeno jer `TileLayer.getTileUrl` čita zoom odatle; obični
  `L.tileLayer` dobija `crossOrigin`. Zaseban canvas: zaprljan (server bez CORS-a) ⇒ odbacuje se, slika s reljefom
  (DEM) kao prije. Ime podloge (offline karta / attribution) u podnožju.
- **Ikone u Sjekačkim linijama** (`static/js/ikone.js`, `USFIk(ime, vel)`): vlastiti set linijskih SVG ikona (24×24,
  `currentColor`) umjesto emojija — Unicode nema motornu pilu, sjekira 🪓 je zamijenjena ikonom `pila`; Sakrij/Prikaži
  = `oko-off`/`oko` (maska prekida konturu oka). SAMO sekcija Sjekačke linije (panel, kartica linije `sl-pop`, vodič,
  crtanje granice, slika A4 preko `USFIkPath` + Path2D u naslovu); `_okoDugme`/`_okoIkona` i emoji u kartici poligona,
  Terenskim tačkama i obavijestima su namjerno netaknuti. Statični HTML: `<span data-ik="pila" data-ikv="22">`
  (hidrira se pri učitavanju). Toast poruke i natpisi na karti ostaju tekst. Test `tests/js/sjekacke-ikone.test.js`.
- **Desktop (PWA, GitHub Pages)**: `.github/workflows/pages.yml` na push u `codex-forest` pokreće `android/copy-assets.sh`
  (ISTI paket kao u APK-u, pada ako fali offline fajl) i objavljuje `android/app/src/main/assets` na Pages
  (`https://pogonboskrupa.github.io/FOREST-UNA-SANA/`; jednokratno Settings → Pages → Source = GitHub Actions). APK i njegov
  updater (`build-apk.yml`) su netaknuti. `manifest.json` `id: "./"` (na podputanji `/` bi bio korijen github.io). Instalacija:
  Chrome/Edge ikona „Instaliraj” u adresnoj traci (Safari: Dodaj u Dock); ažurira se samim otvaranjem (`APP_VERSION` u sw.js).
  Veliki ekran: tijelo panela je centrirano od ranije (`.usf-panel .up-body`, 680 px, @media 700px), zaglavlje panela i
  `#main-tabs` se poravnavaju s njim — blok MORA biti poslije osnovnih `.up-hdr`/`#main-tabs` pravila (ista specifičnost).
  Bez Android mosta Drive „⬇ Preuzmi” (`_dkPreuzmi`/`_dkmlPreuzmi`) otvara direktan link u novom tabu (`_dkRacunar`, navigacija, ne
  fetch — Drive nema CORS); fajl se dodaje uobičajenim uvozom. Offline karte od ~1,5 GB ne staju u sql.js (RAM) — na računaru online
  podloge. Podaci (localStorage/IndexedDB) NISU zajednički telefonu i računaru: Postavke → Rezervna kopija / Vrati iz kopije.
  Test `tests/js/desktop.test.js`.
  **Desktop prikaz** (`html.desk`): Postavke → 🖥 Prikaz (`usf_prikaz`: auto | desktop | mobilni; `_prikazPostavi/_prikazPrimijeni`). Auto = `(min-width: 1100px)
  and (pointer: fine)` — tablet s dodirom ostaje mobilni. Klasa se postavlja inline skriptom u `<head>` (bez treptaja; ISTO pravilo kao `_PRIKAZ_MQ`).
  Paneli = stupac DESNO širine `--desk-w` (460, ≥ 1600 px 520), `#main-tabs` ispod stupca, karta lijevo vidljiva; Meni u jednoj koloni; Esc zatvara panel.
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
  bez APK-a). **PIN karata se mijenja svaki mjesec** (isti za Drive karte, Drive KML i GitHub karte): svaki zapis nosi `encm`
  `{ 'm2026-10': šifrat, … }` (13 mjeseci = tekući + 12; poslije zadnjeg mjeseca ZADNJI PIN ostaje važeći — `kljucZa`), Drive ID šifrovan AES-GCM ključem iz PIN-a tog mjeseca
  (PBKDF2-SHA256, `static/js/drive-karte.js`, isti kod app/alat/test). App uzima šifrat TEKUĆEG mjeseca
  (`encZaMjesec`); sačuvani ključ `usf_karte_kljuc` važi samo uz `usf_karte_mjesec` = tekući mjesec (`_dkKljuc`). Već preuzete karte
  („✓ Na telefonu”, „✓ Učitan”) NE traže PIN — treba samo za novo preuzimanje. FORMAT PIN-a (pravilo) NIKAD u repo: alati ga uzimaju iz
  `USF_PIN_FORMAT` (tokeni YY/YYYY/MM), kao i sam PIN i link. Dodavanje: `USF_PIN_FORMAT=… node tools/karta_drive_dodaj.mjs "<link>" "Naziv" ["opis"] [MB]`;
  novi niz mjeseci (npr. kad se želi nastaviti rotacija): `USF_PIN_FORMAT=… [USF_PIN_MJESECI=13] node tools/karte_pin_produzi.mjs`. Stariji APK-ovi (< 2.1.6) čitaju `enc` i više ne mogu otključati.
  PIN karata je odvojen od PIN-a sekcija; `_dkOtkljucaj` ga provjerava dešifrovanjem prvog zapisa (greške `usf_karte_greske`). APK: `AndroidKarta.preuzmi`
  → `drive.usercontent.google.com/download?…&confirm=t`, `.part` + Range nastavak, provjera
  „SQLite format 3”, pa uvoz kao `importOfflineMap`. Drive fajl mora biti „Svako s linkom”.
  **KML poligoni s Drive-a** (KML preglednik → „☁ Poligoni za preuzimanje”): isti (mjesečni) PIN, ZASEBNA lista
  `static/data/kml_drive.json` (`karta_drive_dodaj.mjs --kml …`, zapis `vrsta:'kml'`) — stariji APK-ovi čitaju
  karte_drive.json i KML bi prikazali kao offline kartu. APK `AndroidKarta.preuzmiKml` (zajednički `skiniDrive`)
  → cache `kml_drive/<id>.dat` (provjera `<?xml`/`<kml`/PK), JS `_driveKmlKraj` uzme bajtove (`uzmiKml`, briše fajl)
  i učita kroz `_vectorFileChosen` (KMZ, IndexedDB) — stari sloj istog imena se zamjenjuje.
- **Birač fajlova u APK-u** (`onShowFileChooser`): offline karta se prepoznaje u
  `IzborFajla.jeOfflineKarta` po CIJELIM tokenima accept-a (`.dbf` iz KML/SHP birača sadrži
  `.db` — podstring je slao svaki KML u uvoz offline karte). Test: `android/test-java/IzborFajlaTest.java`.
- **Otvorena kartica (popup)**: dodir na kartu je SAMO zatvara (capture `click` listener na
  `map.getContainer()` prije Leaflet-a) — inače dodir unutar odjela odmah otvori novu karticu.
- **KML slojevi trajno**: sadržaj u IndexedDB `usf_kml` (`_kmlSpremi`/`_kmlIdb`), u localStorage
  `usf_kml_layers` samo meta {col, vis, stil, idb:1} — veliki KML nije stao u ~5 MB localStorage i nestajao je
  pri ponovnom pokretanju/ažuriranju. Stari zapisi s `content` se sele pri `_kmlRestore`. SHP se odmah čuva kao KML
  (`_kmlIzGrupe`). Rezervna kopija ubacuje KML tekst u metu (`content`), vraćanje ga piše nazad u IDB.
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
- JS `alert/confirm/prompt` u APK-u: MainActivity `onJs*` s naslovom `app_name`
  ("Grmeč Navigator") — bez override-a WebView piše appassets.androidplatform.net.
- **Sačuvaj sliku (A4)** (Sjekačke linije, dugme `slika-sac`): `USFSlika.sacuvaj` — APK `AndroidDownload.save` (Downloads, MediaStore),
  desktop `<a download>`; „Slika (A4)” i dalje otvara share sheet.
- **Kartica poligona i providni prikaz**: popup KML objekta je širi (≤ 440 px, max 72vh, `touch-action: pan-y`); poligon NEMA „Obriši”
  (brisanje samo linija/tačaka; projekat Sjekačkih linija ima svoj „Izbriši”). „🖼 Sačuvaj sliku” → `_odjelSlika` → `USFSlika.sacuvaj`;
  susjedi na slici = svi poligoni slojeva koji su na karti (`x.sloj._map`). Stil sloja/objekta „Providno (samo dodir)” = `stil.providno`
  (`_kmlLeafletStil`: opacity 0, fillOpacity 0.001 — geometrija ostaje za klik; objekt: ExtendedData `usf_providno`). Test `tests/js/kml-providno.test.js`.
- **Slika odjela bez teksta** (`opis.cista`, samo `_odjelSlika`): jednaki bijeli okvir 36 px sa svih strana, nema zaglavlja/mjerila/legende/podnožja ni natpisa
  susjeda; „S” ispod strelice izostavljen. Pita se `prompt` za natpis (`opis.natpisGore`, gore u sredini; prazno = bez ičega, Odustani = ne sprema).
  Glavna granica (`glavni`) ima bijeli rub ispod crte da se ne gubi na podlozi (važi i za sjekačke linije).
- **Slika odjela — linije poligona**: SVE crno isprekidano, ISTO (odjel i susjedi 9 px `[30,14]` s bijelim rubom, `rub`), bez crvene; natpisi odjela i susjeda ostaju na slici (`_odjelOznaka`: atribut ODJEL · ODSJEK, inače naziv) — kao štampana granica na podlozi.
- **Korisnik** (localStorage `usf_korisnik` {ime, datum prvog upisa}; `_korisnikUi`, `_korisnikSpremi/Uredi/Ukloni`): bez imena gore u Postavkama kartica s poljem za unos (`#set-profil`);
  s imenom gore SAMO ime i prezime centrirano preko cijele kartice, pismom Dancing Script 700 (`.kor-ime`; font lokalno u `static/fonts/` — SIL OFL, latin + latin-ext za č ć š đ ž, radi offline; u sw.js i copy-assets.sh), isto u Meniju `#meni-korisnik`, a uređivanje (✏ Uredi / Odustani / 🗑 Ukloni) je u kartici NA DNU Postavki (`#set-korisnik-dno`).
  Prazno ime ne briše (samo Ukloni). `usf_` ključ ide u rezervnu kopiju. Test `tests/js/korisnik.test.js`.
- **Sjekačke linije — sve projekte odjednom**: traka na vrhu liste (`sl-sve`): „Sakrij sve / Prikaži sve” (`p.vidljiv` svih, prekidač po stanju) i „Obriši sve (N)” (confirm, `pisi([])`, gasi vodič).
  Obrađuje se u `akcija` PRIJE `nadji(id)` (dugmad nemaju data-id). Test `tests/js/sjekacke-sve.test.js`.
- **Karte iz GitHub releasea** (`pogonboskrupa/KARTE`, Učitaj kartu → „☁ Karte za preuzimanje”): ZASEBNA lista `static/data/karte_github.json` (`id, naziv, opis, mb, url` — javni
  `…/releases/download/<tag>/<fajl>`, bez `enc`/`encm` (URL je javan, ali dugme je iza istog mjesečnog PIN-a — samo zaštita izbora); NE u karte_drive.json jer stariji APK-ovi zapis bez `enc` dešifruju i brišu ključ). Isti nativni tok `AndroidKarta.preuzmi`
  (`skiniDrive`: redirekti, Range, `.part`); Java dozvoljava samo drive.usercontent i taj GitHub prefiks (`jeDozvoljenaKarta`). DRAFT release se ne može skinuti — mora biti objavljen.
  Novu kartu: upload u release, pa dodati zapis u listu (nova lista na `codex-forest` radi bez APK-a). Test `tests/js/karte-github.test.js`.
- **Tab Karte — Pregled** (`#kh-pregled`, `_khStat`): 4 pločice (podloga / offline karte / KML slojeva·poligona / uključeni slojevi teren+praćenje šume) vode u sekcije; zeleno = aktivno.
  Značke `kh-bedz` (offline „✓ aktivna”, KML „x/y na karti”). „Isključi slojeve praćenja šume” samo kad `_tematskiUkljuceni()` nije prazno. Test `tests/js/karte-pregled.test.js`.
- **Izbornik 🗂 (gore desno, `#layer-switch`)**: mrežne podloge, pa ispod njih okvir `.ls-offline` (zadebljan border, naslov „🗂 Offline karte”, ≤ 34vh uz skrol) sa SVIM offline kartama
  (`_sqlmapSyncLayerSwitch`, jedan dodir = `_sqlmapSelect`; ime bez .sqlitedb/.mbtiles).
- **Editor slojeva** (tab Karte → kartica „🎨 Editor slojeva” s dugmetom — kartica NE nabraja slojeve; `_kedListaOtvori` = list sa svim fajlovima (mini pregled,
  pretraga > 6; dodir = stil, 👁 vidljivost, 🔍 Na karti, ✏ Objekti → KML preglednik s otvorenim objektima; poslije editora vraća se u listu); isto dugme boje u KML pregledniku
  i „🎨 Boja, linija i ispuna” za objekat): `_kmlStilOtvori` = list s kartama **Linija** (boja, debljina 0,5–10, providnost linije, puna/isprek/tačk/crta-tačka, „Samo dodir”),
  **Ispuna** (providnost ispune 0–100 % + brzi izbor, boja ispune odvojena od linije ili „Ista kao linija”), **Oznake** (samo za sloj: natpisi). Šabloni (Granica odjela, Odjel, Put…),
  SVG pregled `_kedSvg`, ŽIVA primjena na karti (`uzivo`); Odustani vraća stil (objekat iz snimka `o0` — Leaflet setStyle mijenja options) i natpise (`ozn0`).
  Model `stil`: { w, crta, op (neprovidnost linije %), ispuna (%), ispunaBoja, providno } → `_kmlLeafletStil`; objekat u KML: LineStyle alfa = op, PolyStyle boja = ispunaBoja.
  Natpisi: localStorage `usf_oznake` po imenu sloja {on, polje, vel, boja, pozadina} (`_oznOsvjezi`: ne-interaktivni divIcon, zoom ≥ 12, ≤ 250). Testovi `oznake.test.js`, `kml-providno.test.js`.
- **Zadani stil novog fajla** (`_KML_STIL_NOVI`: puna linija 2 px, 90 %, ispuna 12 %) — KML/KMZ (i preuzet sa servera) i SHP; čuva se u meti sloja. Natpisi zadano isključeni.
  „↻ Osvježi” sloja sa servera ZADRŽAVA boju i stil (`_kmlZadrziStil` u `_driveKmlKraj` → `_vectorFileChosen`). Stil ugrađenog sloja: localStorage `usf_stil_ugradjeno` (odjeli.js).
