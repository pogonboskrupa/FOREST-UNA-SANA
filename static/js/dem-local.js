// Lokalni DEM (Copernicus GLO-30, 5 općina, static/data/dem_opcine.tif) —
// iz njega se prave Terrarium pločice kad nema interneta, pa nagib,
// ekspozicija, sjenčenje, profil i projektovanje puta rade i offline.
(function (root) {
  'use strict';

  const FAJL = 'static/data/dem_opcine.tif';
  const NODATA = -32768;

  let _dem = null;
  function ucitaj() {
    if (_dem) return _dem;
    _dem = (async () => {
      const G = await root.USFDeadtrees.ucitajLib();
      const r = await fetch(FAJL);
      if (!r.ok) throw new Error('nema lokalnog DEM-a (' + r.status + ')');
      const img = await (await G.fromArrayBuffer(await r.arrayBuffer())).getImage(0);
      const [ox, oy] = img.getOrigin();
      const [rx, ry] = img.getResolution();
      const data = (await img.readRasters({ samples: [0], interleave: false }))[0];
      return { data, W: img.getWidth(), H: img.getHeight(), ox, oy, rx, ry };
    })();
    _dem.catch(() => { _dem = null; });
    return _dem;
  }

  // Bilinearna visina (m) u WGS84 tački; null van obuhvata ili na nodata.
  function visina(d, lat, lon) {
    const fx = (lon - d.ox) / d.rx - 0.5, fy = (lat - d.oy) / d.ry - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= d.W || y0 + 1 >= d.H) return null;
    const i = y0 * d.W + x0;
    const a = d.data[i], b = d.data[i + 1], c = d.data[i + d.W], e = d.data[i + d.W + 1];
    if (a === NODATA || b === NODATA || c === NODATA || e === NODATA) return null;
    const tx = fx - x0, ty = fy - y0;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
  }

  function uObuhvatu(d, lat, lon) {
    return lon >= d.ox && lon <= d.ox + d.W * d.rx && lat <= d.oy && lat >= d.oy + d.H * d.ry;
  }

  // Terrarium RGBA za web-merkator pločicu z/x/y; null ako pločica nema
  // nijednu važeću visinu. Rupe (van općina) se pune najbližom visinom u redu,
  // da rub područja ne izgleda kao litica na karti nagiba.
  function terrariumRGBA(d, z, x, y) {
    const n = 2 ** z, out = new Uint8ClampedArray(256 * 256 * 4), v = new Float32Array(256 * 256);
    let ima = false;
    for (let py = 0; py < 256; py++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / 256) / n))) * 180 / Math.PI;
      for (let px = 0; px < 256; px++) {
        const lon = (x + (px + 0.5) / 256) / n * 360 - 180;
        const h = visina(d, lat, lon);
        v[py * 256 + px] = h === null ? NaN : h;
        if (h !== null) ima = true;
      }
    }
    if (!ima) return null;
    let zadnja = NaN;
    for (let i = 0; i < v.length; i++) { if (!isNaN(v[i])) zadnja = v[i]; else if (!isNaN(zadnja)) v[i] = zadnja; }
    zadnja = NaN;
    for (let i = v.length - 1; i >= 0; i--) { if (!isNaN(v[i])) zadnja = v[i]; else v[i] = zadnja; }
    for (let i = 0; i < v.length; i++) {
      const e = (isNaN(v[i]) ? 0 : v[i]) + 32768;
      out[i * 4] = Math.floor(e / 256); out[i * 4 + 1] = Math.floor(e) % 256;
      out[i * 4 + 2] = Math.round((e - Math.floor(e)) * 256) % 256; out[i * 4 + 3] = 255;
    }
    return out;
  }

  async function terrariumPlocica(z, x, y) {
    const d = await ucitaj();
    const rgba = terrariumRGBA(d, z, x, y);
    if (!rgba) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d').putImageData(new ImageData(rgba, 256, 256), 0, 0);
    return c;
  }

  // Nagib (°) i ekspozicija (° od sjevera) u pikselu DEM-a — za statistiku odjela.
  function nagibEkspozicija(d, ix, iy, lat) {
    if (ix < 1 || iy < 1 || ix >= d.W - 1 || iy >= d.H - 1) return null;
    const g = (x, y) => d.data[y * d.W + x];
    const l = g(ix - 1, iy), r = g(ix + 1, iy), u = g(ix, iy - 1), dn = g(ix, iy + 1);
    if ([l, r, u, dn].includes(NODATA)) return null;
    const mx = Math.abs(d.rx) * 111320 * Math.cos(lat * Math.PI / 180), my = Math.abs(d.ry) * 110540;
    const dzx = (r - l) / (2 * mx), dzy = (u - dn) / (2 * my);
    const nagib = Math.atan(Math.hypot(dzx, dzy)) * 180 / Math.PI;
    const eksp = (Math.atan2(-dzx, -dzy) * 180 / Math.PI + 360) % 360;
    return { nagib, eksp };
  }

  root.USFDem = { FAJL, NODATA, ucitaj, visina, uObuhvatu, terrariumRGBA, terrariumPlocica, nagibEkspozicija };
})(typeof window !== 'undefined' ? window : globalThis);
