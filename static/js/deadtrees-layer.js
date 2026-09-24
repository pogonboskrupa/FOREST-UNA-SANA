// Sušenje šume — deadtrees.earth Sentinel-2 karte (udio stojećeg suhog drveta,
// godišnje 2017–2025, 10 m). Izvor su javni Cloud-Optimized GeoTIFF-ovi koje
// koristi i sam deadtrees.earth frontend (MIT); nema tile/WMS servisa, pa se
// COG čita direktno HTTP range zahtjevima (geotiff.js, lijeno učitan tek kad se
// sloj uključi) i boji na klijentu istom rampom kao na deadtrees.earth.
(function (root) {
  'use strict';

  const BASE = 'https://data2.deadtrees.earth/assets/v1/dte_maps/';
  const RUN = 'run_v1004_v1000_crop_half_fold_None_checkpoint_199_';
  const GODINE = ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
  const LIB = 'static/libs/geotiff.js';
  const GRID = 16; // mreža kontrolnih tačaka za reprojekciju (px); između se interpolira linearno

  function cogUrl(vrsta, godina) {
    if (!GODINE.includes(String(godina))) return null;
    if (vrsta !== 'deadwood' && vrsta !== 'forest') return null;
    return BASE + RUN + vrsta + '_' + godina + '.cog.tif';
  }

  // Ista rampa kao deadtrees.earth (createDeadwoodGeotiffLayer.ts): šum ispod
  // ~4% prozirno, pa crvena sa neprozirnošću = normalizovana vrijednost.
  function alfa(v) {
    const n = v / 255;
    if (!(n > 0.04)) return 0;
    if (n < 0.15) return (n - 0.04) / 0.11 * 0.15;
    return Math.min(1, n);
  }

  // proj4 definicije za CRS-ove u kojima COG realno može biti.
  function projDef(epsg) {
    if (epsg === 4326) return '+proj=longlat +datum=WGS84 +no_defs';
    if (epsg === 3857) return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
    if (epsg === 3035) return '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs';
    if (epsg > 32600 && epsg <= 32660) return '+proj=utm +zone=' + (epsg - 32600) + ' +datum=WGS84 +units=m +no_defs';
    if (epsg > 32700 && epsg <= 32760) return '+proj=utm +zone=' + (epsg - 32700) + ' +south +datum=WGS84 +units=m +no_defs';
    return null;
  }

  // Najgrublji overview koji je i dalje bar ~oštar kao traženo (faktor ≤ želja);
  // faktori su umanjenje u odnosu na punu rezoluciju (1, 2, 4, ...).
  function izaberiNivo(faktori, zeljeniFaktor) {
    let best = 0;
    for (let i = 0; i < faktori.length; i++) {
      if (faktori[i] <= zeljeniFaktor * 1.001 && faktori[i] > faktori[best]) best = i;
    }
    return best;
  }

  let _libPromise = null;
  function ucitajLib() {
    if (root.GeoTIFF) return Promise.resolve(root.GeoTIFF);
    if (_libPromise) return _libPromise;
    _libPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => root.GeoTIFF ? res(root.GeoTIFF) : rej(new Error('geotiff.js nije učitan'));
      s.onerror = () => { _libPromise = null; rej(new Error('geotiff.js nije dostupan')); };
      document.head.appendChild(s);
    });
    return _libPromise;
  }

  const _cog = {};
  function otvoriCog(url) {
    if (!_cog[url]) {
      _cog[url] = (async () => {
        const G = await ucitajLib();
        const tiff = await G.fromUrl(url, { cacheSize: 200 });
        const n = await tiff.getImageCount();
        const slike = [];
        for (let i = 0; i < n; i++) slike.push(await tiff.getImage(i));
        const glavna = slike[0];
        const gk = glavna.getGeoKeys() || {};
        const epsg = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey || 4326;
        const def = projDef(epsg);
        if (!def) throw new Error('Nepodržan CRS EPSG:' + epsg);
        const [ox, oy] = glavna.getOrigin();
        const [rx, ry] = glavna.getResolution();
        const W = glavna.getWidth();
        const nodata = glavna.getGDALNoData();
        return {
          slike, epsg, ox, oy, rx, ry, W, H: glavna.getHeight(), nodata,
          faktori: slike.map(s => W / s.getWidth()),
          fwd: root.proj4('EPSG:4326', def).forward
        };
      })();
      _cog[url].catch(() => { delete _cog[url]; });
    }
    return _cog[url];
  }

  function napraviSloj(L) {
    return L.GridLayer.extend({
      options: { godina: '2025', tileSize: 256, maxNativeZoom: 14, maxZoom: 22, minZoom: 7, opacity: 0.9, onGreska: null },

      setGodina(g) {
        if (String(g) === this.options.godina) return;
        this.options.godina = String(g);
        this.redraw();
      },

      createTile(coords, done) {
        const tile = document.createElement('canvas');
        tile.width = tile.height = this.options.tileSize;
        this._crtaj(tile, coords).then(() => done(null, tile), e => {
          if (this.options.onGreska) this.options.onGreska(e);
          done(null, tile); // prazna pločica, ne ponavljaj u petlji
        });
        return tile;
      },

      async _crtaj(tile, coords) {
        const url = cogUrl('deadwood', this.options.godina);
        const c = await otvoriCog(url);
        const T = this.options.tileSize, n = T / GRID + 1;
        const nw = coords.scaleBy(this.getTileSize());
        // Kontrolne tačke: piksel pločice → lat/lng → CRS COG-a → piksel pune rezolucije
        const gx = new Float64Array(n * n), gy = new Float64Array(n * n);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const ll = this._map.unproject(nw.add([i * GRID, j * GRID]), coords.z);
          const [X, Y] = c.fwd([ll.lng, ll.lat]);
          const px = (X - c.ox) / c.rx, py = (Y - c.oy) / c.ry;
          gx[j * n + i] = px; gy[j * n + i] = py;
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        if (maxX < 0 || maxY < 0 || minX >= c.W || minY >= c.H) return;
        const lvl = izaberiNivo(c.faktori, Math.max(maxX - minX, maxY - minY) / T);
        const f = c.faktori[lvl], img = c.slike[lvl];
        const iw = img.getWidth(), ih = img.getHeight();
        const x0 = Math.max(0, Math.floor(minX / f)), y0 = Math.max(0, Math.floor(minY / f));
        const x1 = Math.min(iw, Math.ceil(maxX / f) + 1), y1 = Math.min(ih, Math.ceil(maxY / f) + 1);
        if (x1 <= x0 || y1 <= y0) return;
        const r = await img.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: false });
        const data = r[0], ww = x1 - x0, wh = y1 - y0;
        const ctx = tile.getContext('2d');
        const out = ctx.createImageData(T, T), px = out.data;
        let ima = false;
        for (let y = 0; y < T; y++) {
          const gj = Math.min(n - 2, (y / GRID) | 0), fy = y / GRID - gj;
          for (let x = 0; x < T; x++) {
            const gi = Math.min(n - 2, (x / GRID) | 0), fx = x / GRID - gi;
            const k = gj * n + gi;
            const sx = (gx[k] * (1 - fx) + gx[k + 1] * fx) * (1 - fy) + (gx[k + n] * (1 - fx) + gx[k + n + 1] * fx) * fy;
            const sy = (gy[k] * (1 - fx) + gy[k + 1] * fx) * (1 - fy) + (gy[k + n] * (1 - fx) + gy[k + n + 1] * fx) * fy;
            const cx = Math.floor(sx / f) - x0, cy = Math.floor(sy / f) - y0;
            if (cx < 0 || cy < 0 || cx >= ww || cy >= wh) continue;
            const v = data[cy * ww + cx];
            if (c.nodata != null && v === c.nodata) continue;
            const a = alfa(v);
            if (!a) continue;
            const o = (y * T + x) * 4;
            px[o] = 220; px[o + 1] = 20; px[o + 2] = 20; px[o + 3] = Math.round(a * 255);
            ima = true;
          }
        }
        if (ima) ctx.putImageData(out, 0, 0);
      }
    });
  }

  root.USFDeadtrees = { GODINE, cogUrl, alfa, projDef, izaberiNivo, napraviSloj, ucitajLib };
})(typeof window !== 'undefined' ? window : globalThis);
