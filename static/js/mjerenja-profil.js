'use strict';
// Visinski profil mjerenja (📏 Mjerenja → Udaljenost / Nagib): uzorkovanje duž linije, visine iz DEM-a (`npVisinaNa`),
// statistika (uspon/silazak s pragom, nagib po klasama), interaktivan SVG grafikon, boja linije na karti po nagibu.
// Čiste funkcije (uzorkuj, popuni, statistika, svg) rade i u Node-u (tests/js/mjerenja-profil.test.js).
(function (root) {
  const R = 6371000, RAD = Math.PI / 180;
  const hav = (a, b) => {
    const dl = (b.lat - a.lat) * RAD, dg = (b.lng - a.lng) * RAD;
    const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dg / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  // Šumarske klase nagiba u % (iste granice kao karta nagiba); boje su u profilu uvijek pune (i 0–10).
  const KLASE = [
    { max: 10, c: '#22c55e', t: '0–10' }, { max: 20, c: '#84cc16', t: '10–20' }, { max: 30, c: '#facc15', t: '20–30' },
    { max: 40, c: '#f97316', t: '30–40' }, { max: 50, c: '#dc2626', t: '40–50' }, { max: Infinity, c: '#7e22ce', t: '>50' }];
  const klasaIdx = p => KLASE.findIndex(k => Math.abs(p) < k.max);
  const fmtD = m => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Tačke jednako razmaknute duž linije (korak ≥ minKorak, ≤ maxN uzoraka); vrati [{lat, lng, d}] s kumulativnom dužinom.
  function uzorkuj(pts, maxN = 160, minKorak = 10) {
    const seg = [];
    let uk = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = hav(pts[i], pts[i + 1]); seg.push(l); uk += l; }
    if (!(uk > 0)) return [];
    const korak = Math.max(minKorak, uk / maxN), out = [{ lat: pts[0].lat, lng: pts[0].lng, d: 0 }];
    let pocetak = 0, sljedeci = korak;
    for (let i = 0; i < seg.length; i++) {
      const kraj = pocetak + seg[i];
      while (sljedeci < kraj - 1e-6) {
        const t = (sljedeci - pocetak) / seg[i];
        out.push({ lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t, d: sljedeci });
        sljedeci += korak;
      }
      pocetak = kraj;
    }
    const z = pts[pts.length - 1];
    if (uk - out[out.length - 1].d > 1) out.push({ lat: z.lat, lng: z.lng, d: uk }); else out[out.length - 1] = { lat: z.lat, lng: z.lng, d: uk };
    return out;
  }
  // Rupe (NaN/null) se linearno popune; vrati {h, nedostaje (udio), ok (ima bar 2 vrijednosti)}.
  function popuni(vis) {
    const h = vis.map(v => (Number.isFinite(v) ? v : null)), znane = h.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
    if (znane.length < 2) return { h: h.map(v => (v === null ? NaN : v)), nedostaje: 1, ok: false };
    for (let i = 0; i < h.length; i++) {
      if (h[i] !== null) continue;
      const a = znane.filter(k => k < i).pop(), b = znane.find(k => k > i);
      h[i] = a === undefined ? h[b] : b === undefined ? h[a] : h[a] + (h[b] - h[a]) * (i - a) / (b - a);
    }
    return { h, nedostaje: 1 - znane.length / vis.length, ok: true };
  }
  const zagladi = (h, w = 1) => h.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - w); k <= Math.min(h.length - 1, i + w); k++) { s += h[k]; n++; } return s / n; });

  // Nagib po segmentu zaglađen na ~80 m (DEM 30 m + korak 10 m daje šum) — ponderisano dužinom.
  function nagibi(d, h, prozor = 40) {
    const n = d.length, len = [], dh = [], mid = [];
    for (let i = 0; i < n - 1; i++) { len.push(d[i + 1] - d[i]); dh.push(h[i + 1] - h[i]); mid.push((d[i] + d[i + 1]) / 2); }
    return len.map((_, i) => { let L = 0, H = 0; for (let j = 0; j < len.length; j++) if (Math.abs(mid[j] - mid[i]) <= prozor) { L += len[j]; H += dh[j]; } return L > 0 ? H / L * 100 : 0; });
  }
  function statistika(d, h, prag = 2) {
    const n = d.length, uk = d[n - 1] || 0, g = nagibi(d, h);
    let uspon = 0, silazak = 0, ref = h[0], iMin = 0, iMax = 0;
    for (let i = 1; i < n; i++) {
      if (h[i] < h[iMin]) iMin = i; if (h[i] > h[iMax]) iMax = i;
      if (h[i] - ref >= prag) { uspon += h[i] - ref; ref = h[i]; } else if (ref - h[i] >= prag) { silazak += ref - h[i]; ref = h[i]; }
    }
    const poKlasi = KLASE.map(() => 0);
    g.forEach((p, i) => { poKlasi[klasaIdx(p)] += d[i + 1] - d[i]; });
    return { duzina: uk, uspon, silazak, min: h[iMin], max: h[iMax], iMin, iMax, delta: h[n - 1] - h[0], prosjek: uk > 0 ? (h[n - 1] - h[0]) / uk * 100 : 0,
      maxNagib: g.reduce((m, p) => (Math.abs(p) > Math.abs(m) ? p : m), 0), nagibi: g, poKlasi: poKlasi.map(v => (uk > 0 ? v / uk : 0)) };
  }
  // Nagib u tački i (za prikaz uz kursor): prosjek susjednih segmenata
  const nagibTacke = (st, i) => { const g = st.nagibi, a = g[Math.max(0, i - 1)], b = g[Math.min(g.length - 1, i)]; return ((a || 0) + (b || 0)) / 2; };

  async function racunaj(pts, visinaFn, opc) {
    const uz = uzorkuj(pts, (opc && opc.maxN) || 160);
    if (uz.length < 2) return null;
    const vis = new Array(uz.length);
    for (let c = 0; c < uz.length; c += 24) {
      await Promise.all(uz.slice(c, c + 24).map(async (q, k) => { try { const v = await visinaFn(q.lat, q.lng); vis[c + k] = Number.isFinite(v) ? v : NaN; } catch (e) { vis[c + k] = NaN; } }));
    }
    const p = popuni(vis);
    if (!p.ok) return { uz, ok: false, nedostaje: 1 };
    const h = zagladi(p.h, 1), d = uz.map(q => q.d);
    return { uz, d, h, ok: true, nedostaje: p.nedostaje, st: statistika(d, h) };
  }

  const lijepiKorak = (raspon, ciljano) => {
    const sirovo = raspon / ciljano, e = Math.pow(10, Math.floor(Math.log10(sirovo || 1))), f = sirovo / e;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e;
  };
  // SVG grafikon: ispuna, linija obojena po klasi nagiba, mreža, min/maks oznake. Dimenzije u px (viewBox = veličina).
  function svg(p, W, H, opc) {
    const o = Object.assign({ bojaNagib: true, boja: '#38bdf8' }, opc || {});
    const pad = { l: 40, r: 10, t: 14, b: 22 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b, st = p.st;
    const rasp = Math.max(1, st.max - st.min), marg = Math.max(4, rasp * 0.14), y0 = st.min - marg, y1 = st.max + marg;
    const X = d => pad.l + d / (st.duzina || 1) * w, Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * h;
    const ky = lijepiKorak(y1 - y0, 4), kx = lijepiKorak(st.duzina, Math.max(2, Math.floor(w / 70)));
    let m = '';
    for (let v = Math.ceil(y0 / ky) * ky; v <= y1; v += ky) m += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="pf-g"/><text x="${pad.l - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="pf-t">${Math.round(v)}</text>`;
    for (let d = 0; d <= st.duzina + 1e-6; d += kx) m += `<line x1="${X(d).toFixed(1)}" x2="${X(d).toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}" class="pf-g v"/><text x="${X(d).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="pf-t">${d >= 1000 ? (d / 1000).toFixed(d % 1000 ? 1 : 0) + ' km' : Math.round(d) + ' m'}</text>`;
    const tac = p.d.map((d, i) => [X(d), Y(p.h[i])]);
    const area = 'M' + tac.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + `L${(pad.l + w).toFixed(1)},${H - pad.b}L${pad.l},${H - pad.b}Z`;
    let lin = '';
    if (o.bojaNagib) for (let i = 0; i < tac.length - 1; i++) lin += `<line x1="${tac[i][0].toFixed(1)}" y1="${tac[i][1].toFixed(1)}" x2="${tac[i + 1][0].toFixed(1)}" y2="${tac[i + 1][1].toFixed(1)}" stroke="${KLASE[klasaIdx(st.nagibi[i])].c}" class="pf-l"/>`;
    else lin = `<polyline points="${tac.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" stroke="${o.boja}" class="pf-l" fill="none"/>`;
    const oznaka = (i, gore) => `<circle cx="${tac[i][0].toFixed(1)}" cy="${tac[i][1].toFixed(1)}" r="3.5" class="pf-m"/><text x="${Math.min(W - pad.r - 2, Math.max(pad.l + 2, tac[i][0])).toFixed(1)}" y="${(tac[i][1] + (gore ? -8 : 15)).toFixed(1)}" text-anchor="middle" class="pf-mt">${gore ? '▲' : '▼'} ${Math.round(p.h[i])} m</text>`;
    return `<svg class="pf-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Visinski profil, ${fmtD(st.duzina)}, od ${Math.round(st.min)} do ${Math.round(st.max)} m">
      <defs><linearGradient id="pf-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.boja}" stop-opacity=".34"/><stop offset="1" stop-color="${o.boja}" stop-opacity=".03"/></linearGradient></defs>
      ${m}<path d="${area}" fill="url(#pf-gr)"/>${lin}${st.max - st.min >= 3 ? oznaka(st.iMax, true) + oznaka(st.iMin, false) : ''}
      <g class="pf-kur" style="display:none"><line y1="${pad.t}" y2="${H - pad.b}" class="pf-kl"/><circle r="5.5" class="pf-kd"/></g></svg>`;
  }
  const API = { uzorkuj, popuni, zagladi, nagibi, statistika, racunaj, svg, KLASE, klasaIdx, nagibTacke, hav };
  if (typeof module !== 'undefined') module.exports = API;
  if (typeof window === 'undefined') return;

  // ── Sučelje: kartica na vrhu karte ──
  let tok = 0, stanje = null, bojaNagib = true, skupljeno = false, kursor = null, slojNagiba = null, vrijeme = null;
  const el = () => document.getElementById('pf-sheet');
  const kes = new Map();
  const visina = async (la, lo) => {
    const k = la.toFixed(5) + ',' + lo.toFixed(5);
    if (kes.has(k)) return kes.get(k);
    const v = typeof window.npVisinaNa === 'function' ? await window.npVisinaNa(la, lo) : NaN;
    if (kes.size > 4000) kes.clear();
    kes.set(k, v); return v;
  };
  function ukloniSloj() { if (slojNagiba) { try { map.removeLayer(slojNagiba); } catch (e) {} slojNagiba = null; } if (kursor) { try { map.removeLayer(kursor); } catch (e) {} kursor = null; } }
  // Linija na karti obojena po nagibu (iznad obične linije mjerenja)
  function crtajSloj() {
    if (slojNagiba) { try { map.removeLayer(slojNagiba); } catch (e) {} slojNagiba = null; }
    const p = stanje && stanje.p; if (!p || !p.ok || !bojaNagib || typeof map === 'undefined') return;
    const g = L.layerGroup();
    const ll = p.uz.map(q => [q.lat, q.lng]);
    g.addLayer(L.polyline(ll, { color: '#fff', weight: 9, opacity: .9, lineCap: 'round', interactive: false, pane: 'tragMsrLines' }));
    for (let i = 0; i < ll.length - 1; i++) g.addLayer(L.polyline([ll[i], ll[i + 1]], { color: KLASE[klasaIdx(p.st.nagibi[i])].c, weight: 5.5, opacity: 1, lineCap: 'butt', interactive: false, pane: 'tragMsrLines' }));
    slojNagiba = g.addTo(map);
  }
  function naVrh() { if (slojNagiba) slojNagiba.eachLayer(l => { try { l.bringToFront(); } catch (e) {} }); }
  function kpi(l, v, k) { return `<div class="${k || ''}"><b>${v}</b><span>${l}</span></div>`; }
  function crtaj() {
    let s = el(); if (!s) { s = document.createElement('div'); s.id = 'pf-sheet'; document.body.appendChild(s); wire(s); }
    if (!stanje) { s.style.display = 'none'; return; }
    s.style.display = 'block'; s.classList.toggle('skup', skupljeno);
    const p = stanje.p, n = stanje.pts.length;
    const zag = `<div class="pf-zag"><div><b>📈 Visinski profil</b><small>${esc(stanje.naslov || '')}${p && p.ok ? ' · ' + fmtD(p.st.duzina) : ''} · ${n} tač.</small></div>
      <button data-a="boja" class="${bojaNagib ? 'on' : ''}" title="Boja linije na karti po nagibu">🎨 Nagib</button><button data-a="skup" aria-label="Skupi">${skupljeno ? '▸' : '▾'}</button><button data-a="x" aria-label="Zatvori">✕</button></div>`;
    if (!p) { s.innerHTML = zag + '<div class="pf-por">⏳ Računam profil…</div>'; return; }
    if (!p.ok) { s.innerHTML = zag + '<div class="pf-por">Nema visinskih podataka za ovo područje (bez veze rade samo općine USK i ranije pregledana područja).</div>'; return; }
    const st = p.st, nag = st.maxNagib;
    s.innerHTML = zag + `<div class="pf-tijelo"><div class="pf-por" id="pf-por">Povuci prstom preko grafikona — tačka se prati na karti</div>
      <div class="pf-graf" id="pf-graf">${svg(p, Math.max(240, (s.clientWidth || 340) - 20), 118, { bojaNagib, boja: stanje.boja || '#38bdf8' })}</div>
      <div class="pf-kpi">${kpi('Dužina', fmtD(st.duzina))}${kpi('↗ Uspon', '+' + Math.round(st.uspon) + ' m', 'up')}${kpi('↘ Silazak', '−' + Math.round(st.silazak) + ' m', 'dn')}${kpi('Δ visina', (st.delta > 0 ? '+' : '') + Math.round(st.delta) + ' m')}
        ${kpi('Najniža', Math.round(st.min) + ' m')}${kpi('Najviša', Math.round(st.max) + ' m')}${kpi('Prosj. nagib', (st.prosjek > 0 ? '+' : '') + st.prosjek.toFixed(1) + ' %')}${kpi('Maks. nagib', (nag > 0 ? '+' : '') + nag.toFixed(0) + ' %', 'mx')}</div>
      <div class="pf-dist" role="img" aria-label="Udio dužine po klasi nagiba">${KLASE.map((k, i) => (st.poKlasi[i] > 0.004 ? `<i style="flex:${st.poKlasi[i]};background:${k.c}" title="${k.t} %"></i>` : '')).join('')}</div>
      <div class="pf-leg">${KLASE.map((k, i) => (st.poKlasi[i] > 0.004 ? `<span><i style="background:${k.c}"></i>${k.t} % <b>${Math.round(st.poKlasi[i] * 100)}%</b></span>` : '')).join('')}</div>
      ${p.nedostaje > 0.02 ? `<div class="pf-nap">⚠ ${Math.round(p.nedostaje * 100)} % visina nedostaje (interpolirano)</div>` : ''}</div>`;
    const g = document.getElementById('pf-graf'); if (g) wireGraf(g, p);
  }
  function wireGraf(g, p) {
    const sv = g.querySelector('svg'), kur = sv.querySelector('.pf-kur'), pad = { l: 40, r: 10, t: 14, b: 22 }, W = +sv.getAttribute('width'), H = +sv.getAttribute('height');
    const rasp = Math.max(1, p.st.max - p.st.min), marg = Math.max(4, rasp * 0.14), y0 = p.st.min - marg, y1 = p.st.max + marg, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const por = document.getElementById('pf-por');
    const naTacku = e => {
      const r = sv.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), d = Math.max(0, Math.min(p.st.duzina, (x - pad.l) / w * p.st.duzina));
      let i = 0; while (i < p.d.length - 1 && p.d[i + 1] < d) i++; if (i < p.d.length - 1 && d - p.d[i] > p.d[i + 1] - d) i++;
      const px = pad.l + p.d[i] / p.st.duzina * w, py = pad.t + (1 - (p.h[i] - y0) / (y1 - y0)) * h;
      kur.style.display = ''; kur.querySelector('line').setAttribute('x1', px); kur.querySelector('line').setAttribute('x2', px);
      const c = kur.querySelector('circle'); c.setAttribute('cx', px); c.setAttribute('cy', py);
      const ng = nagibTacke(p.st, i), kl = KLASE[klasaIdx(ng)];
      if (por) por.innerHTML = `<b>${fmtD(p.d[i])}</b> · ${Math.round(p.h[i])} m · <span style="color:${kl.c}">${ng > 0 ? '↗ +' : ng < 0 ? '↘ ' : ''}${ng.toFixed(0)} %</span>`;
      if (typeof map !== 'undefined') { const ll = [p.uz[i].lat, p.uz[i].lng]; if (!kursor) kursor = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: kl.c, fillOpacity: 1, interactive: false, pane: 'tragMsrLines' }).addTo(map); else { kursor.setLatLng(ll); kursor.setStyle({ fillColor: kl.c }); } }
    };
    sv.style.touchAction = 'none';
    sv.addEventListener('pointerdown', e => { sv.setPointerCapture && sv.setPointerCapture(e.pointerId); naTacku(e); });
    sv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch' || e.pointerType === 'pen') naTacku(e); else naTacku(e); });
  }
  function wire(s) {
    s.addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      if (b.dataset.a === 'x') zatvori();
      else if (b.dataset.a === 'skup') { skupljeno = !skupljeno; crtaj(); }
      else if (b.dataset.a === 'boja') { bojaNagib = !bojaNagib; crtajSloj(); crtaj(); }
    });
  }
  async function otvori(opc) {
    const pts = (opc.pts || []).filter(q => Number.isFinite(q.lat) && Number.isFinite(q.lng));
    if (pts.length < 2) { zatvori(); return; }
    const moj = ++tok;
    stanje = { pts, naslov: opc.naslov, boja: opc.boja, p: null }; if (opc.otvori !== false) skupljeno = !!opc.skupljeno && skupljeno;
    crtaj();
    let p = null; try { p = await racunaj(pts, visina); } catch (e) { p = { ok: false }; }
    if (moj !== tok || !stanje) return;
    stanje.p = p; crtaj(); crtajSloj(); naVrh();
  }
  // Pri svakoj izmjeni tačaka (povlačenje, dodavanje) — preračun tek kad korisnik stane
  function odgodi(opc) { clearTimeout(vrijeme); vrijeme = setTimeout(() => otvori(opc), 650); }
  function zatvori() { tok++; clearTimeout(vrijeme); stanje = null; ukloniSloj(); const s = el(); if (s) s.style.display = 'none'; }
  Object.assign(API, { otvori, odgodi, zatvori, naVrh, otvoren: () => !!stanje });
  root.USFProfil = API;
})(typeof window !== 'undefined' ? window : globalThis);
