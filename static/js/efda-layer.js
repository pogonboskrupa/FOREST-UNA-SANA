// Poremećaji šume — European Forest Disturbance Atlas v3.0 (Viana-Soto & Senf),
// Landsat 30 m, 1985–2024, izrezano na 5 općina (tools/efda_priprema.py).
// Fajl je u APK-u (static/data), pa sloj radi i bez interneta. Jedan Byte
// raster: v = uzrok*50 + (godina-1984), 0 = nema poremećaja.
(function (root) {
  'use strict';

  const FAJL = 'static/data/efda_opcine.tif';
  const GOD_OD = 1985, GOD_DO = 2024;
  const GRID = 16;

  // Kodovi uzroka prema EFDA metapodacima (0 = model nije dodijelio uzrok).
  const UZROCI = {
    1: { naziv: 'Vjetar / potkornjak', boja: [168, 85, 247] },
    2: { naziv: 'Požar', boja: [239, 68, 68] },
    3: { naziv: 'Sječa', boja: [245, 158, 11] },
    0: { naziv: 'Nepoznat uzrok', boja: [148, 163, 184] }
  };

  function dekodiraj(v) {
    if (!(v > 0) || v > 3 * 50 + (GOD_DO - GOD_OD + 1)) return null;
    const uzrok = Math.floor(v / 50), g = v % 50;
    if (g < 1 || g > GOD_DO - GOD_OD + 1) return null;
    return { uzrok, godina: GOD_OD - 1 + g };
  }

  // Noviji poremećaji jači, stariji blijeđi (najstariji ~35 % neprozirnosti).
  function boja(v, filter) {
    const d = dekodiraj(v);
    if (!d) return null;
    const f = filter || {};
    if (f.uzroci && !f.uzroci.has(d.uzrok)) return null;
    if (f.odGodine && d.godina < f.odGodine) return null;
    const u = UZROCI[d.uzrok] || UZROCI[0];
    const t = (d.godina - GOD_OD) / (GOD_DO - GOD_OD);
    return [u.boja[0], u.boja[1], u.boja[2], Math.round(255 * (0.35 + 0.6 * t))];
  }

  let _podaci = null;
  function ucitaj() {
    if (_podaci) return _podaci;
    const D = root.USFDeadtrees;
    _podaci = (async () => {
      const G = await D.ucitajLib();
      const r = await fetch(FAJL);
      if (!r.ok) throw new Error('nema fajla poremećaja (' + r.status + ')');
      const tiff = await G.fromArrayBuffer(await r.arrayBuffer());
      const img = await tiff.getImage(0);
      const [ox, oy] = img.getOrigin();
      const [rx, ry] = img.getResolution();
      const data = (await img.readRasters({ samples: [0], interleave: false }))[0];
      const p = root.proj4('EPSG:4326', D.projDef(3035));
      return { data, W: img.getWidth(), H: img.getHeight(), ox, oy, rx, ry, fwd: p.forward };
    })();
    _podaci.catch(() => { _podaci = null; });
    return _podaci;
  }

  function vrijednostNa(c, lat, lng) {
    const [X, Y] = c.fwd([lng, lat]);
    const x = Math.floor((X - c.ox) / c.rx), y = Math.floor((Y - c.oy) / c.ry);
    if (x < 0 || y < 0 || x >= c.W || y >= c.H) return 0;
    return c.data[y * c.W + x];
  }

  function napraviSloj(L) {
    return L.GridLayer.extend({
      options: { tileSize: 256, maxZoom: 22, minZoom: 8, filter: null, onGreska: null },
      setFilter(f) { this.options.filter = f; this.redraw(); },
      createTile(coords, done) {
        const tile = document.createElement('canvas');
        tile.width = tile.height = this.options.tileSize;
        ucitaj().then(c => { this._crtaj(tile, coords, c); done(null, tile); }, e => {
          if (this.options.onGreska) this.options.onGreska(e);
          done(null, tile);
        });
        return tile;
      },
      _crtaj(tile, coords, c) {
        const T = this.options.tileSize, n = T / GRID + 1;
        const nw = coords.scaleBy(this.getTileSize());
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
        const ctx = tile.getContext('2d'), out = ctx.createImageData(T, T), px = out.data;
        const f = this.options.filter;
        let ima = false;
        for (let y = 0; y < T; y++) {
          const gj = Math.min(n - 2, (y / GRID) | 0), fy = y / GRID - gj;
          for (let x = 0; x < T; x++) {
            const gi = Math.min(n - 2, (x / GRID) | 0), fx = x / GRID - gi, k = gj * n + gi;
            const sx = (gx[k] * (1 - fx) + gx[k + 1] * fx) * (1 - fy) + (gx[k + n] * (1 - fx) + gx[k + n + 1] * fx) * fy;
            const sy = (gy[k] * (1 - fx) + gy[k + 1] * fx) * (1 - fy) + (gy[k + n] * (1 - fx) + gy[k + n + 1] * fx) * fy;
            const cx = Math.floor(sx), cy = Math.floor(sy);
            if (cx < 0 || cy < 0 || cx >= c.W || cy >= c.H) continue;
            const b = boja(c.data[cy * c.W + cx], f);
            if (!b) continue;
            const o = (y * T + x) * 4;
            px[o] = b[0]; px[o + 1] = b[1]; px[o + 2] = b[2]; px[o + 3] = b[3];
            ima = true;
          }
        }
        if (ima) ctx.putImageData(out, 0, 0);
      }
    });
  }

  root.USFEfda = { FAJL, GOD_OD, GOD_DO, UZROCI, dekodiraj, boja, ucitaj, vrijednostNa, napraviSloj };
})(typeof window !== 'undefined' ? window : globalThis);
