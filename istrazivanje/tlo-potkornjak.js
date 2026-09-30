// Tlo i potkornjak (Ips typographus) — Open-Meteo (bez ključa, CORS *).
//  • Vlažnost tla 0–7 / 7–28 / 28–100 cm (ERA5-Land) poređena s istim dobom
//    godine 1991–2020 → percentil sušnosti (kao Evropska opservatorija suše).
//  • Temperatura tla i 15-dnevna prognoza vlažnosti (ECMWF IFS, isti slojevi).
//  • PHENIPS (Baier i sar. 2007) na temperaturi zraka: početak rojenja
//    (140 °D iznad 8,3 °C od 1. aprila i Tmax ≥ 16,5 °C), razvoj legla 557 °D,
//    nova generacija samo dok je dan ≥ 14,5 h (dijapauza).
// Zadnji rezultat se čuva lokalno i prikazuje bez interneta.
(function (root) {
  'use strict';
  const API = 'https://api.open-meteo.com/v1/forecast', ARH = 'https://archive-api.open-meteo.com/v1/archive';
  const SLOJEVI = [['0_to_7cm', '0–7 cm'], ['7_to_28cm', '7–28 cm'], ['28_to_100cm', '28–100 cm']];
  const PRAG = 8.3, PRAG_GORNJI = 38.9, SUMA_ROJENJE = 140, TMAX_LET = 16.5, SUMA_GEN = 557, DAN_DIJAPAUZA = 14.5;
  const KLJUC_ZADNJE = 'usf_tlo_zadnje', KLJUC_KLIMA = 'usf_tlo_klima_';
  const Q = 21; // kvantili 0, 5, …, 100 %

  // ── Čiste funkcije (testovi) ─────────────────────────────────────────
  const dan = d => { const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); return Math.floor((t - Date.UTC(+d.slice(0, 4), 0, 1)) / 864e5) + 1; };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const plusDana = (d, n) => iso(Date.parse(d + 'T00:00:00Z') + n * 864e5);

  // Dužina dana [h] od izlaska do zalaska (Sunce na −0,833° zbog refrakcije i diska).
  function duzinaDana(lat, doy) {
    const dek = 23.44 * Math.sin(2 * Math.PI * (284 + doy) / 365) * Math.PI / 180, f = lat * Math.PI / 180;
    const x = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(f) * Math.sin(dek)) / (Math.cos(f) * Math.cos(dek));
    return x <= -1 ? 24 : x >= 1 ? 0 : 2 * Math.acos(x) * 180 / Math.PI / 15;
  }

  // Satne vrijednosti → dnevni prosjeci { 'YYYY-MM-DD': v }.
  function dnevno(vrijeme, vr) {
    const s = {}, n = {};
    for (let i = 0; i < vrijeme.length; i++) {
      const v = vr[i]; if (v == null) continue;
      const d = vrijeme[i].slice(0, 10); s[d] = (s[d] || 0) + v; n[d] = (n[d] || 0) + 1;
    }
    const o = {}; for (const d in s) o[d] = s[d] / n[d]; return o;
  }

  const efektivno = t => Math.max(0, Math.min(t, PRAG_GORNJI) - PRAG);
  // Jedan tok razvoja. brzina(x) = efektivni °D tog dana (hlad: Tsr, osunčano: (Tsr+Tmax)/2).
  function tokGeneracija(dani, lat, brzina) {
    const gen = []; let akt = null, ceka = true;
    for (const x of dani) {
      if (x.tmax == null || x.tsr == null) continue;
      if (ceka) {
        if (x.tmax < TMAX_LET) continue;
        if (gen.length && duzinaDana(lat, dan(x.d)) < DAN_DIJAPAUZA) break; // nova generacija se više ne zasniva
        akt = { od: x.d, suma: 0, do: null }; gen.push(akt); ceka = false;
      }
      akt.suma += brzina(x);
      if (akt.suma >= SUMA_GEN) { akt.do = x.d; akt.suma = SUMA_GEN; ceka = true; }
    }
    return gen.map(g => ({ od: g.od, do: g.do, udio: g.suma / SUMA_GEN }));
  }
  // dani: [{d, tmax, tsr, prognoza}] rastuće po datumu, od 1. aprila tekuće godine.
  function phenips(dani, lat) {
    let suma = 0, pocetak = null, iPoc = -1;
    for (let i = 0; i < dani.length; i++) {
      const x = dani[i]; if (x.tmax == null) continue;
      suma += efektivno(x.tmax);
      if (suma >= SUMA_ROJENJE && x.tmax >= TMAX_LET) { pocetak = x.d; iPoc = i; break; }
    }
    const r = { sumaRojenje: Math.min(suma, SUMA_ROJENJE), pocetak, pocetakPrognoza: iPoc >= 0 && !!dani[iPoc].prognoza, hlad: [], sunce: [] };
    if (iPoc < 0) return r;
    const ostatak = dani.slice(iPoc);
    r.hlad = tokGeneracija(ostatak, lat, x => efektivno(x.tsr));
    r.sunce = tokGeneracija(ostatak, lat, x => efektivno((x.tsr + x.tmax) / 2));
    return r;
  }

  // Kvantili po petodnevnim binovima (±15 dana) iz dnevnog niza 1991–2020.
  function klimaKvantili(vrijeme, vr) {
    const po = Array.from({ length: 73 }, () => []);
    for (let i = 0; i < vrijeme.length; i++) {
      const v = vr[i]; if (v == null) continue;
      po[Math.min(72, Math.floor((dan(vrijeme[i]) - 1) / 5))].push(v);
    }
    return po.map((_, b) => {
      const s = [];
      for (let k = -3; k <= 3; k++) s.push(...po[(b + k + 73) % 73]);
      s.sort((a, c) => a - c);
      if (!s.length) return null;
      return Array.from({ length: Q }, (_, j) => Math.round(s[Math.min(s.length - 1, Math.round(j / (Q - 1) * (s.length - 1)))] * 1000) / 1000);
    });
  }
  function percentil(kv, v) {
    if (!kv || v == null) return null;
    if (v <= kv[0]) return 0; if (v >= kv[Q - 1]) return 100;
    for (let j = 0; j < Q - 1; j++) if (v <= kv[j + 1]) {
      const r = kv[j + 1] - kv[j];
      return (j + (r > 0 ? (v - kv[j]) / r : 0.5)) * 100 / (Q - 1);
    }
    return 100;
  }
  const kvZaDan = (klima, sloj, d) => klima && klima[sloj] ? klima[sloj][Math.min(72, Math.floor((dan(d) - 1) / 5))] : null;
  function klasaSusnosti(p) {
    if (p == null) return { t: 'bez poređenja', c: '#94a3b8' };
    if (p < 10) return { t: 'ekstremno suho', c: '#b91c1c' };
    if (p < 20) return { t: 'vrlo suho', c: '#ea580c' };
    if (p < 33) return { t: 'suho', c: '#f59e0b' };
    if (p <= 67) return { t: 'normalno', c: '#22c55e' };
    if (p <= 85) return { t: 'vlažno', c: '#38bdf8' };
    return { t: 'vrlo vlažno', c: '#2563eb' };
  }
  // Orijentaciona procjena: let (rojenje) × stres domaćina (suša korijenske zone).
  function rizik(r) {
    const letSad = r.letDana7 > 0 && r.ph.pocetak && !r.dijapauza;
    const p = r.percentilKorijen;
    if (!letSad) return { t: 'Nizak', c: '#22c55e', z: r.ph.pocetak ? (r.dijapauza ? 'Kraj sezone: nova legla se ne zasnivaju (dan < 14,5 h).' : 'Nema dana za let u ±7 dana.') : 'Rojenje još nije počelo.' };
    if (p != null && p < 20) return { t: 'Visok', c: '#dc2626', z: 'Let potkornjaka uz sušni stres smreke (korijenska zona ' + Math.round(p) + '. percentil) — smanjena odbrana smolom.' };
    if (p != null && p < 33) return { t: 'Povišen', c: '#ea580c', z: 'Let potkornjaka, tlo suše od uobičajenog.' };
    return { t: 'Umjeren', c: '#f59e0b', z: 'Let potkornjaka, vlažnost tla uobičajena.' };
  }

  // ── Mreža ────────────────────────────────────────────────────────────
  async function dohvati(url, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.error) throw new Error((j && j.reason) || 'Open-Meteo: HTTP ' + r.status);
      return j;
    } catch (e) { throw e.name === 'AbortError' ? new Error('isteklo vrijeme — slab signal') : e; }
    finally { clearTimeout(t); }
  }
  const qs = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

  async function klimatologija(lat, lon) {
    const cel = Math.round(lat * 10) / 10 + '_' + Math.round(lon * 10) / 10; // ERA5-Land ćelija 0,1°
    try { const c = JSON.parse(localStorage.getItem(KLJUC_KLIMA + cel) || 'null'); if (c && c.v === 1) return c; } catch (e) {}
    const j = await dohvati(ARH + '?' + qs({ latitude: lat.toFixed(3), longitude: lon.toFixed(3), start_date: '1991-01-01', end_date: '2020-12-31', daily: SLOJEVI.map(s => 'soil_moisture_' + s[0] + '_mean').join(','), models: 'era5_land' }), 45000);
    const k = { v: 1 };
    for (const [s] of SLOJEVI) k[s] = klimaKvantili(j.daily.time, j.daily['soil_moisture_' + s + '_mean']);
    try { localStorage.setItem(KLJUC_KLIMA + cel, JSON.stringify(k)); } catch (e) {}
    return k;
  }

  async function izracunaj(lat, lon) {
    const danas = iso(Date.now()), god = danas.slice(0, 4);
    const odApr = god + '-04-01', od = danas < odApr ? plusDana(danas, -60) : [odApr, plusDana(danas, -60)].sort()[0];
    const ll = { latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'Europe/Sarajevo' };
    const [temp, tlo, arh] = await Promise.all([
      dohvati(API + '?' + qs({ ...ll, daily: 'temperature_2m_max,temperature_2m_mean,precipitation_sum', past_days: 92, forecast_days: 16 }), 15000),
      dohvati(API + '?' + qs({ ...ll, hourly: SLOJEVI.map(s => 'soil_moisture_' + s[0]).concat(SLOJEVI.map(s => 'soil_temperature_' + s[0])).join(','), models: 'ecmwf_ifs025', past_days: 31, forecast_days: 15 }), 15000),
      dohvati(ARH + '?' + qs({ ...ll, start_date: od, end_date: plusDana(danas, -2), daily: 'temperature_2m_max,temperature_2m_mean,' + SLOJEVI.map(s => 'soil_moisture_' + s[0] + '_mean').join(','), models: 'era5_land' }), 20000)
    ]);
    let klima = null; try { klima = await klimatologija(lat, lon); } catch (e) {}

    // Temperatura: noviji model (prošlih 92 dana + prognoza) ima prednost nad ERA5-Land.
    const T = {};
    arh.daily.time.forEach((d, i) => { if (arh.daily.temperature_2m_max[i] != null) T[d] = { d, tmax: arh.daily.temperature_2m_max[i], tsr: arh.daily.temperature_2m_mean[i], prognoza: false }; });
    temp.daily.time.forEach((d, i) => { if (temp.daily.temperature_2m_max[i] != null) T[d] = { d, tmax: temp.daily.temperature_2m_max[i], tsr: temp.daily.temperature_2m_mean[i], prognoza: d > danas }; });
    const dani = Object.values(T).filter(x => x.d >= odApr).sort((a, b) => a.d < b.d ? -1 : 1);
    const ph = phenips(dani, lat);
    const blizu = dani.filter(x => Math.abs(Date.parse(x.d) - Date.parse(danas)) <= 7 * 864e5);
    const letDana7 = blizu.filter(x => x.tmax >= TMAX_LET).length;
    const prognozaLet = dani.filter(x => x.prognoza && x.tmax >= TMAX_LET).map(x => x.d);

    // Tlo: ERA5-Land (sa zakašnjenjem ~3 dana) za percentil, IFS za trend i temperaturu.
    const slojevi = SLOJEVI.map(([s, naziv]) => {
      const niz = arh.daily['soil_moisture_' + s + '_mean'];
      let zadnji = null; for (let i = niz.length - 1; i >= 0; i--) if (niz[i] != null) { zadnji = { d: arh.daily.time[i], v: niz[i] }; break; }
      const ifs = dnevno(tlo.hourly.time, tlo.hourly['soil_moisture_' + s]);
      const tt = dnevno(tlo.hourly.time, tlo.hourly['soil_temperature_' + s]);
      const p = zadnji ? percentil(kvZaDan(klima, s, zadnji.d), zadnji.v) : null;
      return { s, naziv, zadnji, percentil: p, klasa: klasaSusnosti(p), sad: ifs[danas] ?? null, temp: tt[danas] ?? null,
        prognoza7: ifs[plusDana(danas, 7)] ?? null };
    });
    // Graf korijenske zone: 60 dana ERA5-Land + 14 dana IFS, s rasponom p20–p80.
    const k = '28_to_100cm', ifsK = dnevno(tlo.hourly.time, tlo.hourly['soil_moisture_' + k]);
    const graf = [];
    arh.daily.time.forEach((d, i) => { if (d >= plusDana(danas, -60) && arh.daily['soil_moisture_' + k + '_mean'][i] != null) graf.push({ d, v: arh.daily['soil_moisture_' + k + '_mean'][i] }); });
    const zadnjiArh = graf.length ? graf[graf.length - 1].d : danas;
    Object.keys(ifsK).sort().forEach(d => { if (d > zadnjiArh) graf.push({ d, v: ifsK[d], p: true }); });
    graf.forEach(g => { const kv = kvZaDan(klima, k, g.d); if (kv) { g.lo = kv[4]; g.hi = kv[16]; } });

    const r = { ts: Date.now(), lat, lon, visina: temp.elevation, danas, ph, letDana7, prognozaLet,
      dijapauza: !!ph.pocetak && duzinaDana(lat, dan(danas)) < DAN_DIJAPAUZA && danas.slice(5) > '06-21',
      slojevi, percentilKorijen: slojevi[2].percentil, graf, klima: !!klima };
    r.rizik = rizik(r);
    return r;
  }

  // ── Prikaz ───────────────────────────────────────────────────────────
  const fmt = (v, d = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dm = d => d ? +d.slice(8, 10) + '. ' + +d.slice(5, 7) + '.' : '—';
  function grafSvg(g) {
    if (g.length < 3) return '';
    const W = 300, H = 86, P = 4, vs = g.flatMap(x => [x.v, x.lo, x.hi].filter(v => v != null));
    const mn = Math.min(...vs) - 0.01, mx = Math.max(...vs) + 0.01;
    const X = i => P + i * (W - 2 * P) / (g.length - 1), Y = v => H - P - (v - mn) / (mx - mn) * (H - 2 * P);
    const pas = g.every(x => x.lo != null) ? `<path d="M${g.map((x, i) => X(i).toFixed(1) + ',' + Y(x.hi).toFixed(1)).join('L')}L${g.map((x, i) => X(i).toFixed(1) + ',' + Y(x.lo).toFixed(1)).reverse().join('L')}Z" fill="rgba(34,197,94,.14)"/>` : '';
    const lin = (f, dash) => { const t = g.map((x, i) => [x, i]).filter(([x]) => f(x)); return t.length > 1 ? `<path d="M${t.map(([x, i]) => X(i).toFixed(1) + ',' + Y(x.v).toFixed(1)).join('L')}" fill="none" stroke="#38bdf8" stroke-width="2"${dash ? ' stroke-dasharray="4 3"' : ''}/>` : ''; };
    const iPr = g.findIndex(x => x.p);
    return `<svg class="tp-graf" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Vlažnost korijenske zone">${pas}${lin(x => !x.p)}${lin((x) => x.p || x === g[iPr - 1], true)}${iPr > 0 ? `<line x1="${X(iPr - 1)}" x2="${X(iPr - 1)}" y1="0" y2="${H}" stroke="#64748b" stroke-dasharray="2 3"/>` : ''}</svg>
      <div class="tp-graf-leg"><span>${dm(g[0].d)}</span><span>— ERA5-Land · - - prognoza IFS${pas ? ' · <i></i> uobičajeno (p20–p80)' : ''}</span><span>${dm(g[g.length - 1].d)}</span></div>`;
  }
  function genHtml(ph) {
    if (!ph.pocetak) return `<div class="tp-red"><span>Rojenje</span><b>${fmt(ph.sumaRojenje)} / ${SUMA_ROJENJE} °D</b></div><div class="tp-nap">Počinje kad zbir dostigne 140 °D i Tmax ≥ 16,5 °C.</div>`;
    const red = (g, i, h) => {
      const s = g.do ? 'završena ' + dm(g.do) : Math.round(g.udio * 100) + ' %';
      return `<div class="tp-gen"><span>${i + 1}. generacija ${h}</span><div class="tp-bar"><u style="width:${(g.udio * 100).toFixed(0)}%"></u></div><b>${s}</b></div>`;
    };
    return `<div class="tp-red"><span>Početak rojenja</span><b>${dm(ph.pocetak)}${ph.pocetakPrognoza ? ' (prognoza)' : ''}</b></div>
      ${ph.sunce.map((g, i) => red(g, i, '☀')).join('')}${ph.hlad.map((g, i) => red(g, i, '🌲')).join('')}
      <div class="tp-nap">☀ osunčane ivice sastojina · 🌲 unutrašnjost (hlad). Legla starija od ~50 % već napuštaju roditelji (sestrinska legla).</div>`;
  }
  function html(r, izKesa) {
    const star = Math.round((Date.now() - r.ts) / 36e5);
    const sl = r.slojevi.map(s => `<div class="tp-sloj"><span>${s.naziv}</span><b>${fmt((s.zadnji ? s.zadnji.v : s.sad) * 100, 0)} %</b><i style="background:${s.klasa.c}">${s.klasa.t}${s.percentil != null ? ' · p' + Math.round(s.percentil) : ''}</i><small>${s.temp != null ? fmt(s.temp, 1) + ' °C' : ''}</small></div>`).join('');
    return `<div class="tp-rizik" style="--c:${r.rizik.c}"><b>Rizik potkornjaka: ${r.rizik.t}</b><small>${r.rizik.z}</small></div>
      <div class="tp-meta">${fmt(r.lat, 4)}, ${fmt(r.lon, 4)} · ${fmt(r.visina)} m${izKesa ? ' · 📴 podaci od prije ' + (star < 1 ? '<1' : star) + ' h' : ''}</div>
      <div class="tp-pod">Vlažnost tla <small>vol. %, ERA5-Land ${dm(r.slojevi[0].zadnji && r.slojevi[0].zadnji.d)} · percentil prema 1991–2020 · temp. tla danas</small></div>
      ${sl}${grafSvg(r.graf)}
      <div class="tp-pod">Potkornjak — PHENIPS <small>zbir temperatura od 1. aprila</small></div>
      ${genHtml(r.ph)}
      <div class="tp-red"><span>Dani za let (Tmax ≥ 16,5 °C)</span><b>${r.prognozaLet.length ? r.prognozaLet.slice(0, 6).map(dm).join(', ') + (r.prognozaLet.length > 6 ? ' …' : '') : 'nema u prognozi'}</b></div>
      <p class="uk-izvor">Procjena sa temperature zraka (bez insolacije i temperature kore) — orijentacija za planiranje obilaska i feromonskih klopki, ne zamjena za pregled terena. Podaci: Open-Meteo (ERA5-Land, ECMWF IFS, ICON), CC BY 4.0.</p>`;
  }

  // ── UI ───────────────────────────────────────────────────────────────
  let radi = false;
  function lokacija() {
    const gps = typeof gpsOn !== 'undefined' && gpsOn && typeof lastP !== 'undefined' && lastP;
    if (gps) return { lat: lastP.la, lon: lastP.lo, izvor: 'GPS' };
    const c = map.getCenter(); return { lat: c.lat, lon: c.lng, izvor: 'centar karte' };
  }
  function prikaziZadnje(poruka) {
    const el = document.getElementById('tp-rez'); if (!el) return;
    let z = null; try { z = JSON.parse(localStorage.getItem(KLJUC_ZADNJE) || 'null'); } catch (e) {}
    el.innerHTML = (poruka ? `<div class="uk-status">${poruka}</div>` : '') + (z ? html(z, true) : '');
  }
  async function osvjezi() {
    if (radi) return;
    const el = document.getElementById('tp-rez'), dug = document.getElementById('tp-osvjezi');
    const l = lokacija();
    if (navigator.onLine === false) { prikaziZadnje('📴 Bez interneta — prikazano zadnje očitanje.'); return; }
    radi = true; if (dug) dug.disabled = true;
    if (el) el.insertAdjacentHTML('afterbegin', `<div class="uk-status" id="tp-cek">⏳ Očitavam za ${l.izvor}… (prvi put i klimatologija 1991–2020)</div>`);
    try {
      const r = await izracunaj(l.lat, l.lon);
      try { localStorage.setItem(KLJUC_ZADNJE, JSON.stringify(r)); } catch (e) {}
      if (el) el.innerHTML = html(r, false);
    } catch (e) {
      prikaziZadnje('⚠ ' + e.message + ' — prikazano zadnje očitanje.');
    } finally { radi = false; if (dug) dug.disabled = false; }
  }

  root.USFTlo = { osvjezi, prikaziZadnje, izracunaj, phenips, duzinaDana, klimaKvantili, percentil, klasaSusnosti, dnevno, rizik };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.USFTlo;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => prikaziZadnje(''));
})(typeof window !== 'undefined' ? window : globalThis);
