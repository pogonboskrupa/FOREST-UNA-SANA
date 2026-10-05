// Vegetacijski indeksi (NDVI / EVI / NDMI) iz najnovijih Sentinel-2 L2A snimaka
// preko Copernicus Data Space (Sentinel Hub WMS). Korisnik unosi ID svoje
// konfiguracije (instance) — čuva se SAMO na uređaju, nikad u repozitoriju.
// Boje računa naš EVALSCRIPT (diskretna paleta → dodir na kartu vraća raspon
// vrijednosti), oblaci/sjene/snijeg (SCL) su prozirni. Pločice 512 px se
// pamte u Cache Storage i rade bez interneta.
(function (root) {
  'use strict';
  const KLJUC = 'usf_veg', BROJAC = 'usf_veg_brojac', KES = 'usf-veg';
  const WMS = 'https://sh.dataspace.copernicus.eu/ogc/wms/';
  const USK = [[44.20, 15.65], [45.30, 16.98]];
  const PL = 512, Z_MIN = 8, Z_MAX = 14, SVJEZE_DANA = 5, E = 20037508.342789244;
  const MASKA = [0, 1, 3, 8, 9, 10, 11]; // bez podatka, zasićeno, sjena oblaka, oblaci, cirus, snijeg
  const ZEMLJA = ['#4b5563', '#a0522d', '#d2a24c', '#e6d36a', '#c7e07a', '#9ccc65', '#66bb3a', '#2e9e2e', '#137a2a', '#0a4d1c'];
  const INDEKSI = {
    ndvi: { naziv: 'NDVI', ulazi: ['B04', 'B08'], v: '(s.B08-s.B04)/(s.B08+s.B04)', pragovi: [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], boje: ZEMLJA,
      opis: 'Zelena biomasa i vitalnost krošnje. Zdrava zatvorena šuma ljeti 0,8–0,9; pad ukazuje na sušenje, sječu ili oštećenje.',
      klase: ['voda, stijena, sjena', 'golo tlo, kamenjar, putevi', 'sječina, suha ili teško oštećena šuma', 'rijetka vegetacija, jako oslabljena krošnja',
        'travnjak, prorijeđena ili oslabljena šuma', 'livada, mlada šuma, krošnja pod stresom', 'šuma umjerene vitalnosti', 'vitalna šuma', 'gusta vitalna šuma (zdrava ljeti)', 'vrlo gusta, najveća vitalnost'] },
    evi: { naziv: 'EVI', ulazi: ['B02', 'B04', 'B08'], v: '2.5*(s.B08-s.B04)/(s.B08+6*s.B04-7.5*s.B02+1)', pragovi: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], boje: ZEMLJA,
      opis: 'Kao NDVI, ali ne "zasićuje" u gustim sastojinama i manje ga remeti atmosfera — bolje razlikuje gustu šumu.',
      klase: ['voda, sjena', 'golo tlo, putevi', 'sječina, vrlo rijetka vegetacija', 'rijetka ili oslabljena vegetacija', 'travnjak, oslabljena šuma',
        'šuma umjerene vitalnosti', 'vitalna šuma', 'gusta vitalna šuma', 'vrlo gusta šuma', 'najveća gustina (rijetko)'] },
    ndmi: { naziv: 'NDMI', ulazi: ['B08', 'B11'], v: '(s.B08-s.B11)/(s.B08+s.B11)', pragovi: [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5],
      boje: ['#7f3b08', '#b35806', '#e08214', '#fdb863', '#d9f0d3', '#a6dba0', '#5aae61', '#2b83ba', '#1a5490'],
      opis: 'Voda u krošnji. Smreka napadnuta potkornjakom gubi vodu (NDMI pada) prije nego što iglice vidno požute.',
      klase: ['golo/suho tlo, suha vegetacija', 'jak vodni stres — sušenje', 'vodni stres', 'umjeren stres (rana faza, provjeriti na terenu)', 'blag stres',
        'normalna vlažnost krošnje', 'dobra vlažnost', 'visoka vlažnost', 'vrlo visoka (gusti četinari, voda)'] }
  };
  const PERIODI = { '15': '15 dana', '30': '30 dana', '60': '60 dana', 'pg': 'isti mjesec prošle godine' };

  const st = (() => { const p = { on: false, id: '', sloj: '', ind: 'ndvi', per: '30', op: 80 }; try { Object.assign(p, JSON.parse(localStorage.getItem(KLJUC) || '{}')); } catch (e) {} return p; })();
  const pamti = () => { try { localStorage.setItem(KLJUC, JSON.stringify(st)); } catch (e) {} };
  const imaKes = typeof caches !== 'undefined';
  const vezaLosa = () => navigator.onLine === false || (typeof _vezaLoša === 'function' && _vezaLoša());
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idIspravan = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  // ── Evalscript i URL ─────────────────────────────────────────────────
  function evalscript(k) {
    const I = INDEKSI[k];
    return `//VERSION=3
function setup(){return{input:[{bands:${JSON.stringify(I.ulazi.concat(['SCL', 'dataMask']))}}],output:{bands:4}}}
const T=${JSON.stringify(I.pragovi)},C=${JSON.stringify(I.boje.map(hexRgb))},M=${JSON.stringify(MASKA)};
function evaluatePixel(s){if(!s.dataMask||M.indexOf(s.SCL)>=0)return[0,0,0,0];const v=${I.v};if(!isFinite(v))return[0,0,0,0];let i=0;while(i<T.length&&v>=T[i])i++;const c=C[i];return[c[0]/255,c[1]/255,c[2]/255,1]}`;
  }
  function period(p, danas) {
    const d = danas || new Date();
    const f = t => t.toISOString().slice(0, 10);
    if (p === 'pg') { const a = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)), b = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth() + 1, 0)); return f(a) + '/' + f(b); }
    return f(new Date(d.getTime() - Number(p) * 864e5)) + '/' + f(d);
  }
  function okvir(z, x, y) {
    const n = E * 2 * PL / (256 * Math.pow(2, z));
    return [-E + x * n, E - (y + 1) * n, -E + (x + 1) * n, E - y * n];
  }
  function urlPlocice(z, x, y, o) {
    const b = okvir(z, x, y);
    return WMS + encodeURIComponent(o.id) + '?' + [
      'SERVICE=WMS', 'REQUEST=GetMap', 'VERSION=1.3.0', 'CRS=EPSG:3857', 'BBOX=' + b.map(v => v.toFixed(2)).join(','),
      'WIDTH=' + PL, 'HEIGHT=' + PL, 'FORMAT=image/png', 'TRANSPARENT=TRUE', 'LAYERS=' + encodeURIComponent(o.sloj),
      'TIME=' + encodeURIComponent(period(o.per)), 'MAXCC=60', 'PRIORITY=leastCC', 'WARNINGS=NO',
      'EVALSCRIPT=' + encodeURIComponent(btoa(evalscript(o.ind)))
    ].join('&');
  }
  const kljuc = (o, z, x, y) => new URL('__veg/' + o.ind + '/' + o.per + '/' + z + '/' + x + '/' + y + '.png', location.href).href;
  function broji() {
    const mj = new Date().toISOString().slice(0, 7);
    let b = { mj, n: 0 }; try { const s = JSON.parse(localStorage.getItem(BROJAC) || 'null'); if (s && s.mj === mj) b = s; } catch (e) {}
    b.n++; try { localStorage.setItem(BROJAC, JSON.stringify(b)); } catch (e) {}
    return b.n;
  }
  function brojOvajMjesec() { try { const s = JSON.parse(localStorage.getItem(BROJAC) || 'null'); return s && s.mj === new Date().toISOString().slice(0, 7) ? s.n : 0; } catch (e) { return 0; } }

  // ── Izvor pločice: keš (svjež ili offline) → CDSE → stari keš ─────────
  let zadnjaGreska = '';
  async function plocica(z, x, y, prisili) {
    const o = { ...st }, k = kljuc(o, z, x, y);
    let stara = null;
    if (imaKes) try {
      const m = await caches.match(k);
      if (m) {
        const dob = (Date.now() - Number(m.headers.get('x-vrijeme') || 0)) / 864e5;
        if ((o.per === 'pg' || dob < SVJEZE_DANA || vezaLosa() || !o.id) && !prisili) return await m.blob();
        stara = m;
      }
    } catch (e) {}
    if (!o.id || !o.sloj || navigator.onLine === false) return stara ? stara.blob() : null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(urlPlocice(z, x, y, o), { signal: ctl.signal, cache: 'no-store' });
      broji();
      const tip = r.headers.get('content-type') || '';
      if (!r.ok || !tip.startsWith('image/')) {
        const txt = (await r.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        zadnjaGreska = r.status === 429 ? 'Kvota CDSE računa je potrošena (10 000 zahtjeva/mj) ili previše zahtjeva u minuti.' : (r.status === 401 || r.status === 403) ? 'CDSE odbija ID konfiguracije — provjeri ga.' : 'CDSE: ' + (txt || 'HTTP ' + r.status);
        javiStatus();
        return stara ? stara.blob() : null;
      }
      const b = await r.blob();
      zadnjaGreska = '';
      if (imaKes) caches.open(KES).then(c => c.put(k, new Response(b, { headers: { 'Content-Type': 'image/png', 'x-vrijeme': String(Date.now()) } }))).catch(() => {});
      return b;
    } catch (e) { return stara ? stara.blob() : null; } finally { clearTimeout(t); }
  }

  // ── Sloj ─────────────────────────────────────────────────────────────
  let sloj = null;
  function pane() {
    if (map.getPane('ukVegPane')) return;
    map.createPane('ukVegPane'); map.getPane('ukVegPane').style.zIndex = '214'; map.getPane('ukVegPane').style.pointerEvents = 'none';
  }
  function napraviSloj() {
    const S = L.GridLayer.extend({
      createTile(c, done) {
        const cv = document.createElement('canvas'); cv.width = cv.height = PL;
        (async () => {
          const b = await plocica(c.z, c.x, c.y); if (!b) return;
          const bmp = await createImageBitmap(b); const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
          cx.drawImage(bmp, 0, 0, PL, PL); if (bmp.close) bmp.close();
        })().catch(() => {}).finally(() => done(null, cv));
        return cv;
      }
    });
    return new S({ pane: 'ukVegPane', tileSize: PL, minZoom: Z_MIN, maxZoom: 22, minNativeZoom: Z_MIN, maxNativeZoom: Z_MAX, bounds: L.latLngBounds(USK), opacity: st.op / 100, attribution: 'Copernicus Sentinel-2 (ESA) · CDSE' });
  }
  function crtaj() {
    if (sloj) { map.removeLayer(sloj); sloj = null; }
    if (st.on) { pane(); sloj = napraviSloj().addTo(map); }
    legenda(); legendaNaKarti(); javiStatus();
  }

  // ── Dodir: vrijednost iz pločice u kešu ──────────────────────────────
  async function vrijednostNa(ll) {
    const z = Math.max(Z_MIN, Math.min(Z_MAX, Math.round(map.getZoom())));
    const p = map.project(ll, z), x = Math.floor(p.x / PL), y = Math.floor(p.y / PL);
    const b = await plocica(z, x, y); if (!b) return { nema: true };
    const bmp = await createImageBitmap(b), cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.floor(p.x - x * PL), Math.floor(p.y - y * PL), 1, 1, 0, 0, 1, 1);
    const [r, g, bb, a] = cx.getImageData(0, 0, 1, 1).data;
    if (a < 128) return { maska: true };
    const I = INDEKSI[st.ind]; let naj = 0, nd = Infinity;
    I.boje.forEach((h, i) => { const [R, G, B] = hexRgb(h), d = (R - r) ** 2 + (G - g) ** 2 + (B - bb) ** 2; if (d < nd) { nd = d; naj = i; } });
    return { klasa: naj, od: naj ? I.pragovi[naj - 1] : null, do: naj < I.pragovi.length ? I.pragovi[naj] : null, boja: I.boje[naj] };
  }
  const br = v => String(v).replace('.', ',');
  function raspon(o) { return o.od == null ? '< ' + br(o.do) : o.do == null ? '≥ ' + br(o.od) : br(o.od) + ' – ' + br(o.do); }

  // ── UI ───────────────────────────────────────────────────────────────
  function javiStatus(t) {
    const el = document.getElementById('veg-status'); if (!el) return;
    el.textContent = t || zadnjaGreska || (!st.id ? 'Unesi ID CDSE konfiguracije ispod.' : vezaLosa() ? '📴 Bez veze — prikazane zapamćene pločice.' : 'Ovaj uređaj ovaj mjesec: ' + brojOvajMjesec() + ' zahtjeva (račun: 10 000/mj).');
  }
  function legenda() {
    const el = document.getElementById('veg-leg'); if (!el) return;
    const I = INDEKSI[st.ind];
    el.innerHTML = `<div class="veg-skala">${I.boje.map(b => `<i style="background:${b}"></i>`).join('')}</div>
      <div class="veg-skala-br"><span>${br(I.pragovi[0])}</span><span>${br(I.pragovi[Math.floor(I.pragovi.length / 2)])}</span><span>${br(I.pragovi[I.pragovi.length - 1])}</span></div>
      <p class="uk-izvor"><b>${I.naziv}</b> — ${I.opis} Period: ${esc(PERIODI[st.per])}, najmanje oblačan snimak po pločici; oblaci i snijeg prozirni.</p>`;
  }
  // Pokretna legenda na karti (kao legenda požara): ručka za prevlačenje, ▾ skupi/raširi,
  // ✕ sakrij; položaj i stanje u localStorage `usf_veg_leg`. Vidljiva samo dok je sloj uključen.
  const KLJUC_LEG = 'usf_veg_leg';
  const leg = (() => { const p = { skrivena: false, sazeta: false, x: null, y: null }; try { Object.assign(p, JSON.parse(localStorage.getItem(KLJUC_LEG) || '{}')); } catch (e) {} return p; })();
  const pamtiLeg = () => { try { localStorage.setItem(KLJUC_LEG, JSON.stringify(leg)); } catch (e) {} };
  function legKutija() {
    let box = document.getElementById('veg-map-leg');
    if (box || typeof document === 'undefined' || !document.body) return box;
    box = document.createElement('div'); box.id = 'veg-map-leg'; box.hidden = true;
    box.innerHTML = '<div class="vml-ruc"><span class="vml-nasl"></span><button class="vml-saz" aria-label="Skupi legendu">▾</button><button class="vml-x" aria-label="Sakrij legendu">✕</button></div><div class="vml-tijelo"></div>';
    document.body.appendChild(box);
    const ruc = box.querySelector('.vml-ruc');
    box.querySelector('.vml-x').onclick = () => { leg.skrivena = true; pamtiLeg(); legendaNaKarti(); uiSync(); };
    box.querySelector('.vml-saz').onclick = () => { leg.sazeta = !leg.sazeta; pamtiLeg(); legendaNaKarti(); };
    let drag = null;
    const smjesti = (x, y) => {
      const minY = Math.max(58, (document.getElementById('top-bar')?.getBoundingClientRect().bottom || 50) + 8);
      box.style.left = Math.max(0, Math.min(x, innerWidth - box.offsetWidth - 4)) + 'px';
      box.style.top = Math.max(minY, Math.min(y, innerHeight - box.offsetHeight - 90)) + 'px';
    };
    ruc.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = box.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top }; ruc.setPointerCapture(e.pointerId); e.preventDefault(); });
    ruc.addEventListener('pointermove', e => { if (drag) smjesti(e.clientX - drag.x, e.clientY - drag.y); });
    const stani = () => { if (!drag) return; drag = null; const r = box.getBoundingClientRect(); leg.x = r.left; leg.y = r.top; pamtiLeg(); };
    ruc.addEventListener('pointerup', stani); ruc.addEventListener('pointercancel', stani);
    window.addEventListener('resize', () => { if (!box.hidden) { const r = box.getBoundingClientRect(); smjesti(r.left, r.top); } });
    box._smjesti = smjesti;
    return box;
  }
  function legendaNaKarti() {
    const box = legKutija(); if (!box) return;
    box.hidden = !st.on || leg.skrivena;
    if (box.hidden) return;
    const I = INDEKSI[st.ind], n = I.boje.length;
    box.querySelector('.vml-nasl').textContent = '⠿ ' + I.naziv + ' · ' + PERIODI[st.per];
    box.querySelector('.vml-saz').textContent = leg.sazeta ? '▸' : '▾';
    const red = i => { const o = { od: i ? I.pragovi[i - 1] : null, do: i < I.pragovi.length ? I.pragovi[i] : null }; return `<div class="vml-red"><i style="background:${I.boje[i]}"></i><b>${raspon(o)}</b><span>${esc((I.klase || [])[i] || '')}</span></div>`; };
    box.querySelector('.vml-tijelo').innerHTML = leg.sazeta
      ? `<div class="veg-skala">${I.boje.map(b => `<i style="background:${b}"></i>`).join('')}</div><div class="veg-skala-br"><span>${br(I.pragovi[0])}</span><span>${br(I.pragovi[I.pragovi.length - 1])}</span></div>`
      : Array.from({ length: n }, (_, k) => red(n - 1 - k)).join('') + `<p class="vml-opis">${esc(I.opis)} Oblaci i snijeg su prozirni; dodir na kartu daje vrijednost. Vrijednosti zavise od doba godine — porediti s „isti mjesec lani“.</p>`;
    if (leg.x != null && box._smjesti) box._smjesti(leg.x, leg.y);
  }
  function legendaPokazi() { leg.skrivena = false; pamtiLeg(); legendaNaKarti(); uiSync(); }
  function uiSync() {
    document.getElementById('uk-veg-switch')?.classList.toggle('on', !!st.on);
    const o = document.getElementById('uk-veg-opts'); if (o) o.style.display = st.on ? '' : 'none';
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    s('veg-ind', st.ind); s('veg-per', st.per); s('veg-op', st.op); s('veg-id', st.id);
    const lb = document.getElementById('veg-leg-karta'); if (lb) lb.hidden = !st.on || !leg.skrivena;
    const p = document.getElementById('veg-povezano'); if (p) p.textContent = st.id ? (st.sloj ? '✓ Povezano · sloj ' + st.sloj : '⚠ Nije provjereno') : '';
  }
  function prekidac(on) { st.on = on === undefined ? !st.on : !!on; pamti(); uiSync(); crtaj(); }
  function postavi(k, v) {
    if (k === 'op') { st.op = Number(v); pamti(); if (sloj) sloj.setOpacity(st.op / 100); return; }
    if (k === 'ind' && INDEKSI[v]) st.ind = v;
    if (k === 'per' && PERIODI[v]) st.per = v;
    pamti(); crtaj();
  }
  async function povezi() {
    const id = (document.getElementById('veg-id')?.value || '').trim();
    if (!id) { st.id = st.sloj = ''; pamti(); uiSync(); crtaj(); return; }
    if (!idIspravan(id)) { javiStatus('⚠ ID konfiguracije ima oblik xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.'); return; }
    javiStatus('⏳ Provjeravam konfiguraciju…');
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(WMS + encodeURIComponent(id) + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0', { signal: ctl.signal, cache: 'no-store' }).finally(() => clearTimeout(t));
      const xml = await r.text();
      if (!r.ok) throw new Error(r.status === 400 || r.status === 404 ? 'CDSE ne poznaje ovaj ID' : 'HTTP ' + r.status);
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const imena = [...doc.querySelectorAll('Layer > Layer > Name')].map(n => n.textContent.trim()).filter(Boolean);
      if (!imena.length) throw new Error('konfiguracija nema nijedan sloj — dodaj bilo koji Sentinel-2 L2A sloj');
      st.id = id; st.sloj = imena.find(n => /NDVI/i.test(n)) || imena.find(n => /TRUE/i.test(n)) || imena[0]; zadnjaGreska = '';
      pamti(); uiSync(); crtaj(); javiStatus('✓ Povezano. ' + imena.length + ' slojeva u konfiguraciji.');
    } catch (e) { javiStatus('⚠ ' + (e.name === 'AbortError' ? 'isteklo vrijeme' : e.message)); }
  }

  // Preuzimanje vidljivog dijela za rad bez interneta (do z13 karte).
  let posao = null;
  function plociceVidljivo(doZ) {
    const b = map.getBounds(), out = [], od = Math.max(Z_MIN, Math.floor(map.getZoom()));
    for (let zk = od; zk <= doZ; zk++) {
      const a = map.project(b.getNorthWest(), zk), c = map.project(b.getSouthEast(), zk);
      for (let x = Math.floor(a.x / PL); x <= Math.floor(c.x / PL); x++) for (let y = Math.floor(a.y / PL); y <= Math.floor(c.y / PL); y++) out.push([zk, x, y]);
    }
    return out;
  }
  async function preuzmi() {
    if (posao) { posao.stop = true; return; }
    if (!st.id || !st.sloj) { javiStatus('⚠ Prvo poveži CDSE konfiguraciju.'); return; }
    const lista = plociceVidljivo(13);
    if (lista.length > 400) { javiStatus('⚠ ' + lista.length + ' pločica je previše za jedno preuzimanje — približi kartu.'); return; }
    if (!confirm('Preuzeti ' + lista.length + ' pločica (' + INDEKSI[st.ind].naziv + ', ' + PERIODI[st.per] + ')? Troši ' + lista.length + ' od 10 000 mjesečnih zahtjeva računa.')) return;
    posao = { stop: false }; const dug = document.getElementById('veg-preuzmi'); if (dug) dug.textContent = '■ Prekini';
    let ok = 0;
    try {
      for (let i = 0; i < lista.length && !posao.stop; i += 3) {
        const r = await Promise.all(lista.slice(i, i + 3).map(([z, x, y]) => plocica(z, x, y)));
        ok += r.filter(Boolean).length;
        javiStatus('⬇ ' + Math.min(i + 3, lista.length) + ' / ' + lista.length + ' pločica…');
      }
      javiStatus((posao.stop ? 'Prekinuto: ' : '✓ Spremljeno za offline: ') + ok + ' pločica.');
    } finally { posao = null; if (dug) dug.textContent = '⬇ Preuzmi vidljivi dio'; }
  }
  async function obrisiKes() { if (imaKes) await caches.delete(KES); javiStatus('Zapamćene pločice obrisane.'); if (sloj) sloj.redraw(); }

  function registruj() {
    if (typeof _kartaKlikIzvor !== 'function') return;
    _kartaKlikIzvor(ll => {
      if (!st.on || !sloj || !L.latLngBounds(USK).contains(ll)) return [];
      return [{ vrsta: 'poligon', pov: 5e11, otvori: async at => {
        let o; try { o = await vrijednostNa(at); } catch (e) { o = { nema: true }; }
        const I = INDEKSI[st.ind];
        const redovi = o.nema ? [['', 'Pločica nije učitana za ovaj zoom.']] : o.maska ? [['', 'Oblak, sjena ili snijeg — nema čistog piksela u periodu.']] : [[I.naziv, raspon(o)]];
        L.popup({ maxWidth: 290, minWidth: 210, className: 'pk-pop' }).setLatLng(at).setContent(_popKartica({
          ikona: '🛰', boja: o.boja || '#64748b', naslov: I.naziv, tip: 'Sentinel-2', meta: PERIODI[st.per], redovi, opis: I.opis })).openOn(map);
      } }];
    });
  }

  root.USFVeg = { legendaPokazi, prekidac, postavi, povezi, preuzmi, obrisiKes, evalscript, period, okvir, urlPlocice, idIspravan, INDEKSI, stanje: () => ({ ...st }) };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.USFVeg;
  if (typeof L !== 'undefined' && typeof map !== 'undefined' && map && map.getContainer) {
    registruj(); uiSync(); legenda(); if (st.on) crtaj();
    window.addEventListener('online', () => javiStatus()); window.addEventListener('offline', () => javiStatus());
  }
})(typeof window !== 'undefined' ? window : globalThis);
