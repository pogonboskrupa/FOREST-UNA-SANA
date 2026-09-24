// Sušenje šume — deadtrees.earth Sentinel-2 karte (udio stojećeg suhog drveta,
// godišnje 2017–2025, 10 m). Izvor su javni Cloud-Optimized GeoTIFF-ovi koje
// koristi i sam deadtrees.earth frontend (MIT); nema tile/WMS servisa, pa se
// COG čita direktno HTTP range zahtjevima (geotiff.js 2.1.3 — ista verzija kao deadtrees.earth; lijeno učitan tek kad se
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

  // Neprozirnost: šum ispod ~4% prozirno. Vrijednosti u COG-u realno idu do
  // ~140/255, pa rampa deadtrees.earth (alfa = vrijednost) daje najviše ~0.5 i
  // sušenje se slabo vidi. Ovdje je dno 0.5, a puna jačina već na ~55%.
  // Slabo sušenje (donja polovina rampe) blijedi kvadratno do 0.12, da ne
  // prekrije kartu; jako sušenje (t ≥ 0.5) ostaje kao u v1.4.10.
  const JAKO_T = 0.5, JAKO_ALFA = 0.5 + 0.47 * JAKO_T;
  function alfa(v) {
    const n = v / 255;
    if (!(n > 0.04)) return 0;
    const t = (n - 0.04) / 0.5;
    if (t >= JAKO_T) return Math.min(1, 0.5 + 0.47 * t);
    return 0.12 + (JAKO_ALFA - 0.12) * (t / JAKO_T) ** 2;
  }

  // Palete: [boja za malo sušenja, boja za puno]. Podrazumijevana žuta se ne
  // miješa sa Hansen gubitkom (ružičasto-crveno), rastom (plavo) ni pokrivačem.
  const PALETE = {
    zuta:       { naziv: 'Žuta',       od: [255, 241, 118], do: [255, 160, 0] },
    ljubicasta: { naziv: 'Ljubičasta', od: [240, 171, 252], do: [134, 25, 143] },
    cijan:      { naziv: 'Cijan',      od: [165, 243, 252], do: [14, 116, 144] },
    crvena:     { naziv: 'Crvena',     od: [252, 165, 165], do: [185, 28, 28] }
  };

  // [r, g, b, a 0..255] ili null (prozirno).
  function boja(v, paleta) {
    const a = alfa(v);
    if (!a) return null;
    const p = PALETE[paleta] || PALETE.zuta;
    const t = Math.min(1, Math.max(0, (v / 255 - 0.04) / 0.5));
    return [0, 1, 2].map(i => Math.round(p.od[i] + (p.do[i] - p.od[i]) * t)).concat(Math.round(a * 255));
  }

  // Tamna kontura od 1 px samo oko JAKOG sušenja, i to samo na praznim
  // pikselima — slabo sušenje ostaje blijedo, bez obruba.
  const OBRUB_MIN_A = Math.floor(JAKO_ALFA * 255);
  function obrubi(px, T) {
    const puno = new Uint8Array(T * T);
    for (let i = 0; i < T * T; i++) puno[i] = px[i * 4 + 3] >= OBRUB_MIN_A ? 1 : 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const i = y * T + x;
      if (puno[i] || px[i * 4 + 3] > 0) continue;
      if ((x > 0 && puno[i - 1]) || (x < T - 1 && puno[i + 1]) || (y > 0 && puno[i - T]) || (y < T - 1 && puno[i + T])) {
        const o = i * 4; px[o] = 20; px[o + 1] = 20; px[o + 2] = 20; px[o + 3] = 200;
      }
    }
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

  // ── Range klijent sa provjerom. geotiff.js vjeruje da 206 odgovor sadrži
  // baš traženi opseg; ako posrednik vrati drugi dio fajla, parser čita
  // pogrešne bajtove (npr. double kao 64-bit offset → "exceeds
  // MAX_SAFE_INTEGER"). Zato se Content-Range i dužina provjeravaju ovdje. ──
  function parsirajOpseg(h) {
    const m = /bytes[ =](\d+)-(\d+)(?:\/(\d+|\*))?/.exec(String(h || ''));
    if (!m) return null;
    return { start: +m[1], end: +m[2], total: m[3] && m[3] !== '*' ? +m[3] : null };
  }

  function provjeriOdgovor(trazeno, status, contentRange, duzina) {
    if (status !== 206) throw new Error(status === 200 ? 'server ne podržava range zahtjeve (200)' : 'HTTP ' + status);
    const cr = parsirajOpseg(contentRange);
    if (cr && cr.start !== trazeno.start) {
      throw new Error('server vratio bajtove ' + cr.start + '-' + cr.end + ' umjesto ' + trazeno.start + '-' + trazeno.end);
    }
    const trazenaDuz = trazeno.end - trazeno.start + 1;
    // Bez Content-Range (CORS ga ne izloži) kraj fajla može vratiti manje bajtova.
    const ocek = cr ? Math.min(trazeno.end, cr.total ? cr.total - 1 : trazeno.end) - trazeno.start + 1 : trazenaDuz;
    if (cr ? duzina !== ocek : (duzina < 1 || duzina > trazenaDuz)) {
      throw new Error('dužina odgovora ' + duzina + ' umjesto ' + ocek + ' bajtova');
    }
  }

  // APK: range se čita nativno (AndroidRange), mimo WebView mrežnog sloja.
  const _cbs = new Map();
  let _cbSeq = 0;
  root._usfRangeCb = function (id, status, contentRange, b64, greska) {
    const cb = _cbs.get(id);
    if (!cb) return;
    _cbs.delete(id);
    if (greska) { cb.rej(new Error(greska)); return; }
    const bin = atob(b64 || ''), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    cb.res({ status, contentRange, buf: buf.buffer });
  };
  function nativniRange(url, t) {
    return new Promise((res, rej) => {
      const id = 'r' + (++_cbSeq);
      _cbs.set(id, { res, rej });
      try { root.AndroidRange.get(url, String(t.start), String(t.end), id); }
      catch (e) { _cbs.delete(id); rej(e); }
    });
  }

  async function webRange(url, t, signal) {
    const r = await fetch(url, { headers: { Range: 'bytes=' + t.start + '-' + t.end }, signal, cache: 'no-store' });
    return { status: r.status, contentRange: r.headers.get('content-range'), buf: await r.arrayBuffer() };
  }

  let _zadnjaGreska = null;
  function rangeKlijent(url) {
    return {
      url,
      async request(opts) {
        const h = (opts && opts.headers) || {};
        const t = parsirajOpseg(h.Range || h.range);
        if (!t) throw new Error('geotiff zahtjev bez Range zaglavlja');
        let r;
        try {
          r = root.AndroidRange && root.AndroidRange.get
            ? await nativniRange(url, t)
            : await webRange(url, t, opts && opts.signal);
          provjeriOdgovor(t, r.status, r.contentRange, r.buf.byteLength);
        } catch (e) { _zadnjaGreska = e; throw e; }
        const cr = /^bytes \d+-\d+\/\d+$/.test(String(r.contentRange || '').trim()) ? String(r.contentRange).trim() : null;
        const hdr = { 'content-range': cr, 'content-type': 'image/tiff' };
        return { ok: true, status: 206, getHeader: n => hdr[String(n).toLowerCase()], getData: async () => r.buf };
      }
    };
  }

  const _cog = {};
  function otvoriCog(url) {
    if (!_cog[url]) {
      _cog[url] = (async () => {
        const G = await ucitajLib();
        const tiff = await G.fromCustomClient(rangeKlijent(url), { cacheSize: 200 });
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
      options: { godina: '2025', paleta: 'zuta', tileSize: 256, maxNativeZoom: 14, maxZoom: 22, minZoom: 7, opacity: 1, onGreska: null },

      setPaleta(p) {
        if (!PALETE[p] || p === this.options.paleta) return;
        this.options.paleta = p;
        this.redraw();
      },

      setGodina(g) {
        if (String(g) === this.options.godina) return;
        this.options.godina = String(g);
        this.redraw();
      },

      createTile(coords, done) {
        const tile = document.createElement('canvas');
        tile.width = tile.height = this.options.tileSize;
        this._crtaj(tile, coords).then(() => done(null, tile), e => {
          // geotiff.js grešku klijenta zamijeni sa AggregateError("Request failed")
          // bez uzroka — prikaži stvarni razlog iz range klijenta.
          if (e && e.errors && _zadnjaGreska) e = _zadnjaGreska;
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
            const b = boja(v, this.options.paleta);
            if (!b) continue;
            const o = (y * T + x) * 4;
            px[o] = b[0]; px[o + 1] = b[1]; px[o + 2] = b[2]; px[o + 3] = b[3];
            ima = true;
          }
        }
        if (ima) { obrubi(px, T); ctx.putImageData(out, 0, 0); }
      }
    });
  }

  root.USFDeadtrees = { GODINE, PALETE, cogUrl, alfa, boja, obrubi, projDef, izaberiNivo, parsirajOpseg, provjeriOdgovor, rangeKlijent, napraviSloj, ucitajLib };
})(typeof window !== 'undefined' ? window : globalThis);
