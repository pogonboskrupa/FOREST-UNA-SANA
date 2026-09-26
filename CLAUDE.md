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
