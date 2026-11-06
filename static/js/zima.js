// Zimski Sentinel-2 snimak: sloj + preuzimanje paketa po području i nivou zooma.
// U aplikaciji je ugrađen samo pregled (z8–11). Detalj z12–14 dolazi iz paketa
// (static/data/zima_paketi.json → ZIP sa raw.githubusercontent.com, CORS *), koji
// se raspakuju u Cache Storage (usf-zima-<područje>) i rade bez interneta.
// Nepreuzeti dijelovi se uz internet učitavaju pločicu po pločicu i pamte.
(function (root) {
  'use strict';
  const MANIFEST = 'static/data/zima_paketi.json';
  const UGRADJENO = 'static/data/zima/';
  const PLOCICE_WEB = 'https://raw.githubusercontent.com/pogonboskrupa/FOREST-UNA-SANA/claude/practical-pasteur-p2npth/static/data/zima/';
  const KES = 'usf-zima-', KES_PREGLED = 'usf-zima-pregled', STANJE = 'usf_zima_paketi';
  const Z_MIN = 8, Z_MAX = 14;
  let manP = null;
  const manifest = () => manP || (manP = fetch(MANIFEST).then(r => { if (!r.ok) throw new Error('nema popisa paketa'); return r.json(); }));
  const kljuc = (z, x, y) => new URL('__zima/' + z + '/' + x + '/' + y + '.webp', location.href).href;
  const stanje = () => { try { return JSON.parse(localStorage.getItem(STANJE) || '{}'); } catch (e) { return {}; } };
  const pamti = s => { try { localStorage.setItem(STANJE, JSON.stringify(s)); } catch (e) {} };
  const mb = b => (b / 1e6).toLocaleString('bs-BA', { maximumFractionDigits: b < 1e6 ? 2 : 1 }) + ' MB';
  const imaKes = typeof caches !== 'undefined';
  const vezaLosa = () => navigator.onLine === false || (typeof _vezaLoša === 'function' && _vezaLoša());

  // ── Izvor jedne pločice ──────────────────────────────────────────────
  async function blobPlocice(z, x, y, ugrMax) {
    if (z <= ugrMax) {
      try { const r = await fetch(UGRADJENO + z + '/' + x + '/' + y + '.webp'); return r.ok ? await r.blob() : null; } catch (e) { return null; }
    }
    if (imaKes) { try { const m = await caches.match(kljuc(z, x, y)); if (m) return await m.blob(); } catch (e) {} }
    if (vezaLosa()) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(PLOCICE_WEB + z + '/' + x + '/' + y + '.webp', { signal: ctl.signal, cache: 'force-cache' });
      if (!r.ok) return null;
      const b = await r.blob();
      if (imaKes) caches.open(KES_PREGLED).then(c => c.put(kljuc(z, x, y), new Response(b, { headers: { 'Content-Type': 'image/webp' } }))).catch(() => {});
      return b;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }

  // Canvas pločice: ako nivo nije dostupan, uveća se najbliži grublji (bez sivih rupa).
  function napraviSloj(opts) {
    const ugrMax = opts.ugrMax || 11;
    const Sloj = L.GridLayer.extend({
      createTile(c, done) {
        const cv = document.createElement('canvas'); cv.width = cv.height = 256;
        (async () => {
          for (let z = c.z, k = 0; z >= Z_MIN; z--, k++) {
            const s = 1 << k, x = Math.floor(c.x / s), y = Math.floor(c.y / s);
            const b = await blobPlocice(z, x, y, ugrMax);
            if (!b) continue;
            const bmp = await createImageBitmap(b), sub = 256 / s;
            const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = true;
            ctx.drawImage(bmp, (c.x - x * s) * sub, (c.y - y * s) * sub, sub, sub, 0, 0, 256, 256);
            if (bmp.close) bmp.close();
            break;
          }
        })().catch(() => {}).finally(() => done(null, cv));
        return cv;
      }
    });
    return new Sloj({ pane: opts.pane, minZoom: 0, maxZoom: 22, minNativeZoom: Z_MIN, maxNativeZoom: Z_MAX, bounds: opts.bounds, opacity: opts.opacity, attribution: 'Copernicus Sentinel-2 (ESA)' });
  }

  // ── Preuzimanje ──────────────────────────────────────────────────────
  let posao = null; // { ctl, id }
  async function preuzmi(id, doZ, napredak) {
    if (!imaKes) throw new Error('ovaj uređaj ne podržava pohranu pločica');
    if (posao) throw new Error('preuzimanje je već u toku');
    const m = await manifest(), p = m.podrucja.find(x => x.id === id);
    if (!p) throw new Error('nepoznato područje');
    const s = stanje(), imam = s[id] || 11;
    const pojasevi = [];
    for (let z = imam + 1; z <= doZ; z++) pojasevi.push([z, p.pojasevi[String(z)]]);
    const ukupno = pojasevi.reduce((a, [, b]) => a + b.bajtova, 0);
    if (!ukupno) return { preuzeto: 0 };
    posao = { ctl: new AbortController(), id };
    let gotovo = 0;
    try {
      const kes = await caches.open(KES + id);
      for (const [z, b] of pojasevi) {
        const r = await fetch(m.baza + b.fajl, { signal: posao.ctl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error('server je vratio ' + r.status + ' za ' + b.fajl);
        const citac = r.body.getReader(), dijelovi = []; let n = 0;
        for (;;) {
          const { done, value } = await citac.read(); if (done) break;
          dijelovi.push(value); n += value.length;
          napredak && napredak((gotovo + n * 0.85) / ukupno, 'Preuzimam z' + z + ' · ' + mb(gotovo + n) + ' / ' + mb(ukupno));
        }
        const buf = await new Blob(dijelovi).arrayBuffer();
        const ulazi = _zipUlazi(buf).filter(u => /\.webp$/.test(u.ime));
        for (let i = 0; i < ulazi.length; i++) {
          if (posao.ctl.signal.aborted) throw new DOMException('prekinuto', 'AbortError');
          const [zz, x, y] = ulazi[i].ime.replace('.webp', '').split('/').map(Number);
          await kes.put(kljuc(zz, x, y), new Response(await _zipIzvuci(buf, ulazi[i]), { headers: { 'Content-Type': 'image/webp' } }));
          if (i % 25 === 0) napredak && napredak((gotovo + b.bajtova * (0.85 + 0.15 * i / ulazi.length)) / ukupno, 'Spremam z' + z + ' · ' + (i + 1) + ' / ' + ulazi.length + ' pločica');
        }
        gotovo += b.bajtova;
        const st = stanje(); st[id] = z; pamti(st); // svaki završen nivo se odmah pamti
      }
      napredak && napredak(1, 'Gotovo · ' + mb(ukupno));
      return { preuzeto: ukupno };
    } finally { posao = null; }
  }
  function prekini() { if (posao) posao.ctl.abort(); }
  async function obrisi(id) {
    if (imaKes) await caches.delete(KES + id);
    const s = stanje(); delete s[id]; pamti(s);
  }
  async function obrisiPregledano() { if (imaKes) await caches.delete(KES_PREGLED); }
  async function zauzece() {
    const m = await manifest(), s = stanje();
    let b = 0;
    for (const [id, doZ] of Object.entries(s)) {
      const p = m.podrucja.find(x => x.id === id); if (!p) continue;
      for (let z = 12; z <= doZ; z++) b += p.pojasevi[String(z)].bajtova;
    }
    return b;
  }
  function velicina(p, odZ, doZ) { let b = 0; for (let z = odZ + 1; z <= doZ; z++) b += p.pojasevi[String(z)].bajtova; return b; }

  root.USKZima = { manifest, napraviSloj, preuzmi, prekini, obrisi, obrisiPregledano, zauzece, stanje, velicina, mb, kljuc, u_toku: () => !!posao };
})(typeof window !== 'undefined' ? window : globalThis);
