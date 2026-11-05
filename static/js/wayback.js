// Satelitski snimci po godinama (Esri World Imagery Wayback): arhiva izdanja podloge od 2014. Za izabranu godinu koristi se ZADNJE izdanje
// te godine (Wayback prikaže najnovije snimke koje su do tada postojale — ako područje te godine nije snimano, vidi se starija scena).
// Lista izdanja: živo s Esri konfiguracije (CORS), rezerva static/data/wayback_izdanja.json i zadnja zapamćena. Pločice treba internet
// (pregledane se trajno keširaju u service workeru — vidi sw.js).
(function (root) {
  'use strict';
  const CFG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
  const URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{id}/{z}/{y}/{x}';
  const LS_KEY = 'usf_wb', LS_LISTA = 'usf_wb_lista';

  // [[datum, id], …] → { godina: {datum, id, svi:[[datum,id]…]} } za zadnjih `n` godina (najnovija prva)
  function poGodinama(lista, n, tekuca) {
    const po = {};
    (lista || []).forEach(([dat, id]) => { const g = +String(dat).slice(0, 4); if (g) (po[g] = po[g] || []).push([dat, id]); });
    const out = [];
    for (let g = tekuca; g > tekuca - n; g--) {
      const sv = (po[g] || []).slice().sort((a, b) => a[0].localeCompare(b[0]));
      if (sv.length) out.push({ godina: g, datum: sv[sv.length - 1][0], id: sv[sv.length - 1][1], svi: sv });
    }
    return out;
  }
  function parsirajKonfig(obj) {
    return Object.entries(obj || {}).map(([id, v]) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(v && v.itemTitle || ''); return m ? [m[1], +id] : null; }).filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
  }
  function parsirajMeta(obj) {
    const m = {}; Object.entries(obj || {}).forEach(([id, v]) => { if (v && /^https:\/\/[^/]*arcgis\.com\//.test(v.metadataLayerUrl || '')) m[id] = v.metadataLayerUrl; });
    return m;
  }
  // Atributi metadata sloja → { datum 'GGGG-MM-DD', rez (m), opis }
  function citajMeta(attr) {
    if (!attr) return null;
    const a = {}; Object.keys(attr).forEach(k => { a[k.toUpperCase()] = attr[k]; });
    let d = a.SRC_DATE2 != null ? a.SRC_DATE2 : a.SRC_DATE;
    if (typeof d === 'number' && d > 1e11) d = new Date(d).toISOString().slice(0, 10);
    else if (typeof d === 'number' && d > 19000000) { const t = String(d); d = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8); }
    else d = null;
    const rez = +a.SRC_RES || +a.SAMP_RES || null;
    return d ? { datum: d, rez, opis: a.NICE_DESC || a.SRC_DESC || '' } : null;
  }
  const urlZa = id => URL.replace('{id}', id);
  // Udio „oblaka” u RGBA podacima pločice: svijetli (> 195) slabo zasićeni (raspon kanala < 28) pikseli; transparentni se ne broje.
  // Snijeg se broji isto — i on zaklanja šumu, pa je za pregled stanja šume jednako loš snimak.
  function udioOblaka(d) {
    let n = 0, o = 0;
    for (let i = 0; i + 3 < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      n++;
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mn > 195 && mx - mn < 28) o++;
    }
    return n ? o / n : null;
  }
  const PRAG_OBLAKA = 0.15;
  if (typeof module !== 'undefined') module.exports = { poGodinama, parsirajKonfig, parsirajMeta, citajMeta, urlZa, udioOblaka };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let lista = null, sloj = null, sloj2 = null, razd = null, razdX = 0.5, anim = null, meta = {}, uspor = { on: false, godina: null, id: null }, st = { godina: null, id: null, datum: null, op: 100 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(LS_KEY) || '{}'), { godina: null, id: null }); } catch (e) {}
  try { meta = JSON.parse(localStorage.getItem('usf_wb_meta') || '{}') || {}; } catch (e) {}
  const pamti = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({ op: st.op })); } catch (e) {} };
  const toast = t => { try { showToast(t); } catch (e) {} };

  async function ucitajListu() {
    if (lista) return lista;
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(CFG, { signal: ctl.signal }).finally(() => clearTimeout(tm));
      if (r.ok) { const j = await r.json(), l = parsirajKonfig(j); if (l.length > 20) { lista = l; const m = parsirajMeta(j); if (Object.keys(m).length) { meta = m; try { localStorage.setItem('usf_wb_meta', JSON.stringify(m)); } catch (e) {} } try { localStorage.setItem(LS_LISTA, JSON.stringify(l)); } catch (e) {} return lista; } }
    } catch (e) {}
    try { const z = JSON.parse(localStorage.getItem(LS_LISTA) || 'null'); if (z && z.length > 20) return (lista = z); } catch (e) {}
    try { const r = await fetch('static/data/wayback_izdanja.json'); if (r.ok) return (lista = await r.json()); } catch (e) {}
    return (lista = []);
  }
  // Oblačnost izdanja za CIJELI Unsko-sanski kanton (bbox granice): pločice z9 koje ga pokrivaju, mjere se samo pikseli unutar bbox-a.
  // Wayback nema podatak o oblacima, pa se procjena radi iz slike; null = nije moguće izmjeriti (mreža/CORS) → ne krije se.
  const USK = { w: 15.7287, e: 16.9010, s: 44.2501, n: 45.2311 }, ZO = 9;
  const oblaci = new Map();
  const svijetX = lo => (lo + 180) / 360 * Math.pow(2, ZO) * 256;
  const svijetY = la => { const r = la * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, ZO) * 256; };
  function plociceUSK() {
    const x0 = svijetX(USK.w), x1 = svijetX(USK.e), y0 = svijetY(USK.n), y1 = svijetY(USK.s), out = [];
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) {
      const rx = Math.max(x0, tx * 256) - tx * 256, ry = Math.max(y0, ty * 256) - ty * 256;
      const rw = Math.min(x1, (tx + 1) * 256) - tx * 256 - rx, rh = Math.min(y1, (ty + 1) * 256) - ty * 256 - ry;
      if (rw >= 1 && rh >= 1) out.push({ z: ZO, x: tx, y: ty, rx: Math.floor(rx), ry: Math.floor(ry), rw: Math.floor(rw), rh: Math.floor(rh) });
    }
    return out;
  }
  function izmjeriPlocicu(id, t) {
    return new Promise(res => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      const tm = setTimeout(() => res(null), 10000);
      im.onload = () => { clearTimeout(tm); try { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.drawImage(im, 0, 0); res({ u: udioOblaka(x.getImageData(t.rx, t.ry, t.rw, t.rh).data), w: t.rw * t.rh }); } catch (e) { res(null); } };
      im.onerror = () => { clearTimeout(tm); res(null); };
      im.src = urlZa(id).replace('{z}', t.z).replace('{y}', t.y).replace('{x}', t.x);
    });
  }
  function izmjeriOblake(id) {
    if (oblaci.has(id)) return oblaci.get(id);
    const p = Promise.all(plociceUSK().map(t => izmjeriPlocicu(id, t))).then(r => {
      const ok = r.filter(q => q && q.u != null); if (ok.length < Math.ceil(r.length / 2)) return null;
      const w = ok.reduce((a, q) => a + q.w, 0); return ok.reduce((a, q) => a + q.u * q.w, 0) / w;
    });
    oblaci.set(id, p); return p;
  }
  let ocjena = { god: null, rez: null, tece: false };
  async function ocijeniGodinu(g) {
    const e = godine().find(x => x.godina === g); if (!e || typeof map === 'undefined') return;
    ocjena = { god: g, rez: null, tece: true }; render();
    const izm = [];
    for (let i = 0; i < e.svi.length; i += 4) izm.push(...await Promise.all(e.svi.slice(i, i + 4).map(async x => [x[1], await izmjeriOblake(x[1])])));
    if (ocjena.god !== g) return;
    ocjena = { god: g, rez: new Map(izm), tece: false };
    // izabrano izdanje je preoblačno → najnovije čisto
    const dobra = e.svi.filter(x => { const u = ocjena.rez.get(x[1]); return u == null || u <= PRAG_OBLAKA; });
    if (dobra.length && !dobra.some(x => x[1] === st.id)) { postavi(g, dobra[dobra.length - 1][1]); return; }
    render();
  }
  const godine = () => poGodinama(lista || [], 10, new Date().getFullYear());

  function paneSloj() {
    if (!map.getPane('waybackPane')) { map.createPane('waybackPane'); map.getPane('waybackPane').style.zIndex = '212'; map.getPane('waybackPane').style.pointerEvents = 'none'; }
  }
  function uklonisloj() { if (sloj) { try { map.removeLayer(sloj); } catch (e) {} sloj = null; } }
  function postavi(g, id) {
    const e = godine().find(x => x.godina === g);
    if (!e) return;
    const izdanje = (id && e.svi.find(x => x[1] === +id)) || [e.datum, e.id];
    paneSloj(); uklonisloj();
    st.godina = g; st.id = izdanje[1]; st.datum = izdanje[0];
    sloj = L.tileLayer(urlZa(st.id), { pane: 'waybackPane', maxNativeZoom: 19, maxZoom: 22, opacity: st.op / 100, keepBuffer: 2, updateWhenIdle: !uspor.on, updateWhenZooming: false, attribution: 'Esri World Imagery Wayback' });
    prati(sloj, 'd'); sloj.addTo(map);
    osvjezi();
    if (!id && !anim && ocjena.god !== g) ocijeniGodinu(g);
    if (uspor.on) usporediOsvjezi();
    snimljenoOsvjezi();
  }
  // Izdanje (datum) unutar izabrane godine
  function izdanje(id) { if (st.godina) postavi(st.godina, id); }
  function iskljuci() { stani(); usporediGasi(); uklonisloj(); st.godina = null; st.id = null; st.datum = null; osvjezi(); }
  function korak(d) {
    const l = godine().map(x => x.godina).sort((a, b) => a - b); if (!l.length) return;
    const i = l.indexOf(st.godina); const n = i < 0 ? l[l.length - 1] : l[Math.max(0, Math.min(l.length - 1, i + d))];
    postavi(n);
  }
  function opacity(v) { st.op = Math.max(20, Math.min(100, +v || 100)); pamti(); if (sloj) sloj.setOpacity(st.op / 100); }

  // ── Animacija godina ────────────────────────────────────────────────
  function stani() { if (anim) { clearInterval(anim); anim = null; } const d = document.querySelector('#wb-traka [data-a="p"]'); if (d) d.textContent = '⏵'; }
  function igraj() {
    if (anim) { stani(); return; }
    const l = godine().map(x => x.godina).sort((a, b) => a - b); if (l.length < 2) return;
    let i = Math.max(0, l.indexOf(st.godina));
    postavi(l[i]);
    anim = setInterval(() => { i = (i + 1) % l.length; postavi(l[i]); }, 1800);
    const d = document.querySelector('#wb-traka [data-a="p"]'); if (d) d.textContent = '⏸';
  }

  // ── Uporedba prije/poslije (klizač) ─────────────────────────────────
  function paneDrugi() {
    if (!map.getPane('waybackPane2')) { map.createPane('waybackPane2'); const p = map.getPane('waybackPane2'); p.style.zIndex = '213'; p.style.pointerEvents = 'none'; }
  }
  function klipaj() {
    if (!uspor.on || !razd) return;
    const nw = map.containerPointToLayerPoint([0, 0]), sz = map.getSize(), x = Math.round(razdX * sz.x);
    const a = map.getPane('waybackPane'), b = map.getPane('waybackPane2');
    if (a) a.style.clip = `rect(${nw.y}px, ${nw.x + x}px, ${nw.y + sz.y}px, ${nw.x}px)`;
    if (b) b.style.clip = `rect(${nw.y}px, ${nw.x + sz.x}px, ${nw.y + sz.y}px, ${nw.x + x}px)`;
    razd.style.left = x + 'px';
  }
  // Oznake strana + stanje učitavanja (⏳ dok se pločice te strane još učitavaju)
  const ucit = { l: false, d: false };
  function prati(sl, strana) {
    ucit[strana] = true; natpisiStrana();
    sl.on('loading', () => { ucit[strana] = true; natpisiStrana(); });
    sl.on('load', () => { ucit[strana] = false; natpisiStrana(); });
  }
  function natpisiStrana() {
    if (!razd) return;
    const l = razd.querySelector('.wb-l'), d = razd.querySelector('.wb-d');
    l.textContent = (ucit.l ? '⏳ ' : '') + (uspor.godina || ''); d.textContent = (ucit.d ? '⏳ ' : '') + (st.godina || '');
    l.classList.toggle('uc', ucit.l); d.classList.toggle('uc', ucit.d);
  }
  function usporediOsvjezi() {
    if (!uspor.on) return;
    const e = godine().find(x => x.godina === uspor.godina); if (!e) return;
    paneDrugi();
    if (sloj2) { try { map.removeLayer(sloj2); } catch (er) {} }
    sloj2 = L.tileLayer(urlZa(uspor.id || e.id), { pane: 'waybackPane2', maxNativeZoom: 19, maxZoom: 22, opacity: st.op / 100, keepBuffer: 4, updateWhenIdle: false, updateWhenZooming: false });
    prati(sloj2, 'l'); sloj2.addTo(map);
    if (sloj) { sloj.options.updateWhenIdle = false; sloj.options.keepBuffer = 4; }
    klipaj(); osvjezi();
  }
  function usporediUkljuci() {
    if (!st.godina) { toast('Prvo izaberi godinu'); return; }
    stani();
    const l = godine().map(x => x.godina).sort((a, b) => a - b), ranija = l.filter(g => g < st.godina);
    uspor = { on: true, godina: ranija.length ? ranija[0] : l[l.length - 1], id: null };
    if (!razd) {
      razd = document.createElement('div'); razd.id = 'wb-razd'; razd.innerHTML = '<span>⇆</span><em class="wb-l"></em><em class="wb-d"></em>';
      let vuce = false;
      razd.addEventListener('pointerdown', e => { vuce = true; razd.setPointerCapture(e.pointerId); map.dragging.disable(); e.preventDefault(); });
      razd.addEventListener('pointermove', e => { if (!vuce) return; const r = map.getContainer().getBoundingClientRect(); razdX = Math.max(0.04, Math.min(0.96, (e.clientX - r.left) / r.width)); klipaj(); });
      const kraj = () => { vuce = false; try { map.dragging.enable(); } catch (e) {} };
      razd.addEventListener('pointerup', kraj); razd.addEventListener('pointercancel', kraj);
      map.on('move zoom viewreset resize', klipaj);
    }
    map.getContainer().appendChild(razd); razd.hidden = false; razdX = 0.5;
    if (sloj) { sloj.options.updateWhenIdle = false; sloj.options.keepBuffer = 4; }
    usporediOsvjezi();
  }
  function usporediGasi() {
    if (!uspor.on && !sloj2) return;
    uspor.on = false;
    if (sloj2) { try { map.removeLayer(sloj2); } catch (e) {} sloj2 = null; }
    if (razd) razd.hidden = true;
    const a = map.getPane('waybackPane'); if (a) a.style.clip = '';
    osvjezi();
  }
  function usporediGodina(g, id) { uspor.godina = +g; uspor.id = id ? +id : null; usporediOsvjezi(); }
  const usporediPrebaci = () => (uspor.on ? usporediGasi() : usporediUkljuci());

  // ── Stvarni datum snimanja (Esri metadata sloj) na centru karte ─────
  const snKes = new Map(); let snTm = null, snTekst = '';
  async function snimljeno(id) {
    const base = meta[id]; if (!base || typeof map === 'undefined') return null;
    const c = map.getCenter(), z = Math.max(10, Math.min(17, Math.round(map.getZoom())));
    const kljuc = id + ':' + z + ':' + c.lat.toFixed(3) + ':' + c.lng.toFixed(3);
    if (snKes.has(kljuc)) return snKes.get(kljuc);
    const get = async u => { const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000); try { const r = await fetch(u, { signal: ctl.signal }); return r.ok ? await r.json() : null; } finally { clearTimeout(tm); } };
    let rez = null;
    try {
      let lay = 23 - z;
      const info = await get(base + '?f=json');
      const ls = info && info.layers; if (ls && ls.length) { const nad = ls.find(q => (String(q.name).match(/\d+/) || [])[0] == z); lay = nad ? nad.id : Math.min(ls.length - 1, Math.max(0, lay)); }
      const q = base + '/' + lay + '/query?f=json&returnGeometry=false&outFields=*&inSR=4326&spatialRel=esriSpatialRelIntersects&geometryType=esriGeometryPoint&geometry=' + c.lng + ',' + c.lat;
      const j = await get(q);
      rez = j && j.features && j.features[0] ? citajMeta(j.features[0].attributes) : null;
    } catch (e) {}
    snKes.set(kljuc, rez); return rez;
  }
  function snimljenoOsvjezi() {
    clearTimeout(snTm);
    snTm = setTimeout(async () => {
      if (!st.id) { snTekst = ''; } else {
        const r = await snimljeno(st.id);
        snTekst = r ? `📷 snimljeno ${r.datum.split('-').reverse().join('. ')}.${r.rez ? ' · ' + String(r.rez).replace('.', ',') + ' m' : ''}` : '';
      }
      document.querySelectorAll('.wb-sn').forEach(el => { el.textContent = snTekst; el.hidden = !snTekst; });
      const t = document.querySelector('#wb-traka small.wb-sn2'); if (t) t.textContent = snTekst.replace('📷 snimljeno ', '📷 ');
    }, 700);
  }

  function traka() {
    let b = document.getElementById('wb-traka');
    if (!b) {
      b = document.createElement('div'); b.id = 'wb-traka'; b.hidden = true;
      b.innerHTML = '<button type="button" data-a="-">◀</button><div class="wb-god"><b></b><small></small><small class="wb-sn2"></small></div><button type="button" data-a="+">▶</button><button type="button" data-a="p" aria-label="Animacija">⏵</button><button type="button" data-a="u" aria-label="Uporedi">⇆</button><button type="button" data-a="x" aria-label="Isključi">✕</button>';
      b.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'x') iskljuci(); else if (a.dataset.a === 'p') igraj(); else if (a.dataset.a === 'u') usporediPrebaci(); else { stani(); korak(a.dataset.a === '-' ? -1 : 1); } });
      document.body.appendChild(b);
    }
    return b;
  }
  function osvjezi() {
    const b = traka(), e = godine().find(x => x.godina === st.godina);
    b.hidden = !e;
    if (e) { b.querySelector('b').textContent = '🕰 ' + (uspor.on ? uspor.godina + ' ⇆ ' + e.godina : e.godina); b.querySelector('small').textContent = 'izdanje ' + (st.datum || e.datum); }
    render();
  }
  function izborDatuma() {
    const e = godine().find(x => x.godina === st.godina); if (!e) return '';
    const o = ocjena.god === e.godina ? ocjena : null, rez = o && o.rez;
    if (o && o.tece) return '<p class="set-nap">☁ Provjeravam oblačnost snimaka na ovom mjestu…</p>';
    const dobra = rez ? e.svi.filter(x => { const u = rez.get(x[1]); return u == null || u <= PRAG_OBLAKA; }) : e.svi;
    const lista = (dobra.length ? dobra : e.svi).slice().reverse();
    const nap = !rez ? `${e.svi.length} izdanja u ${e.godina}.`
      : dobra.length ? `Prikazani samo čisti snimci (oblaci/snijeg ≤ ${Math.round(PRAG_OBLAKA * 100)} %): ${dobra.length} od ${e.svi.length}.`
      : `⚠ Svi snimci iz ${e.godina} imaju puno oblaka/snijega na području USK — prikazani su svi. Pokušaj drugu godinu.`;
    const oz = x => { const u = rez && rez.get(x[1]); return u == null ? '' : ' · ☁ ' + Math.round(u * 100) + ' %'; };
    return `<label class="wb-dat">Datum snimka (izdanje)<select onchange="USFWayback.izdanje(this.value)">${lista.map(x => `<option value="${x[1]}"${x[1] === st.id ? ' selected' : ''}>${x[0].split('-').reverse().join('. ')}.${oz(x)}</option>`).join('')}</select><small>${nap}</small></label>
      <p class="set-nap wb-sn" hidden></p>
      <button type="button" class="wb-iskljuci" onclick="USFWayback.ocijeni()">☁ Ponovi provjeru oblačnosti (USK)</button>`;
  }
  const jeWb = r => r.url.includes('wayback.maptiles.arcgis.com');
  async function kesStat() {
    try { const c = await caches.open('usf-tiles-v1'); return (await c.keys()).filter(jeWb).length; } catch (e) { return null; }
  }
  async function kesObrisi() {
    if (typeof confirm === 'function' && !confirm('Obrisati sačuvane pločice satelitskih snimaka (Wayback)?')) return;
    try { const c = await caches.open('usf-tiles-v1'); const k = (await c.keys()).filter(jeWb); await Promise.all(k.map(r => c.delete(r))); toast('🗑 Obrisano ' + k.length + ' pločica'); } catch (e) { toast('⚠ Brisanje nije uspjelo'); }
    kesOsvjezi();
  }
  async function kesOsvjezi() {
    const n = await kesStat();
    document.querySelectorAll('.wb-kes-n').forEach(el => { el.textContent = n == null ? 'nije dostupno' : n + ' pločica'; });
  }
  function usporediHtml(g) {
    const tipka = `<button type="button" class="wb-iskljuci" onclick="USFWayback.uporedi()">${uspor.on ? '✕ Ugasi uporedbu' : '⇆ Uporedi s drugom godinom (klizač)'}</button>`;
    if (!uspor.on) return tipka;
    return `<label class="wb-dat">Lijeva strana (godina)<select onchange="USFWayback.usporediGodina(this.value)">${g.filter(x => x.godina !== st.godina).map(x => `<option value="${x.godina}"${x.godina === uspor.godina ? ' selected' : ''}>${x.godina}</option>`).join('')}</select><small>Desno je ${st.godina}. Povuci ⇆ na karti.</small></label>` + tipka;
  }
  function render() {
    const g = godine();
    document.querySelectorAll('.wb-host').forEach(el => {
      const naslov = st.godina ? 'Prikazano: ' + st.godina : 'Esri Wayback · zadnjih 10 godina';
      const glava = el.dataset.kompakt
        ? `<h3>Satelitski snimci po godinama <small>${naslov}</small></h3>`
        : `<div class="kg-top"><i>🕰</i><div><h3>Satelitski snimci po godinama</h3><p class="kh-stat">${naslov}</p></div></div>`;
      el.innerHTML = glava + (g.length ? `<div class="wb-cipovi">${g.map(x => `<button type="button" class="${x.godina === st.godina ? 'on' : ''}" onclick="USFWayback.postavi(${x.godina})">${x.godina}</button>`).join('')}</div>
      ${st.godina ? izborDatuma() : ''}
      ${st.godina ? usporediHtml(g) : ''}
      <label class="wb-op">Providnost <input type="range" min="20" max="100" step="5" value="${st.op}" oninput="USFWayback.opacity(this.value)"><span>${st.op} %</span></label>
      <div class="wb-kes"><span>Keš snimaka: <b class="wb-kes-n">…</b></span><button type="button" class="wb-iskljuci" onclick="USFWayback.kesObrisi()">🗑 Obriši keš</button></div>
      ${st.godina ? '<button type="button" class="wb-iskljuci" onclick="USFWayback.iskljuci()">✕ Isključi snimak</button>' : ''}
      <p class="set-nap">Najnovije izdanje u izabranoj godini. Ako to područje te godine nije snimano, vidi se starija scena. Treba internet; pregledane pločice ostaju sačuvane.</p>` : '<p class="set-nap">Lista izdanja se učitava…</p>');
    });
    kesOsvjezi();
  }
  async function pokreni() { render(); await ucitajListu(); render(); if (!pokreni.k) { pokreni.k = 1; try { map.on('moveend', () => { if (st.id) snimljenoOsvjezi(); }); } catch (e) {} } }
  root.USFWayback = { kesObrisi, igraj, uporedi: usporediPrebaci, usporediGodina, ocijeni: () => { ocjena = { god: null, rez: null, tece: false }; oblaci.clear(); return st.godina && ocijeniGodinu(st.godina); }, postavi, izdanje, iskljuci, korak, opacity, render: pokreni, godine: () => godine() };
})(typeof window !== 'undefined' ? window : globalThis);
