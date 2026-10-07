'use strict';
// Sjekačke linije: granice sjekačkih partija (istog izvođača) unutar poligona
// sječe, ~2 visine stabla široke. Uvijek idu UZ PADINU (smjer najvećeg pada iz
// DEM-a) zbog obaranja: svaka partija radi uzbrdo u svom pojasu, susjedna je
// bočno — nikad iznad/ispod. Linije su prave (dominantan pad poligona); azimut
// se može ručno okrenuti. Širina partije se mjeri po izohipsi, horizontalno.
// Na terenu: GPS vodi radnika duž linije ("← 3 m do linije") dok farba stabla.

const SL_E = 6371008.8;
function slLokalno(lat0, lon0) {
  const ky = Math.PI / 180 * SL_E, kx = ky * Math.cos(lat0 * Math.PI / 180);
  return { u: (la, lo) => [(lo - lon0) * kx, (la - lat0) * ky], n: (x, y) => [lat0 + y / ky, lon0 + x / kx] };
}
// Smjer (jedinični, istok/sjever) za azimut od sjevera u stepenima.
const slSmjer = az => { const r = az * Math.PI / 180; return [Math.sin(r), Math.cos(r)]; };
function slPovrsinaXY(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return Math.abs(a) / 2; }

// Presjek prave {o + t·d} s poligonom (lokalni metri): parovi [t0, t1] unutra.
function slPresjek(poly, o, d) {
  const ts = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-12) continue;
    const ax = a[0] - o[0], ay = a[1] - o[1];
    const t = (ax * ey - ay * ex) / den, s = (ax * d[1] - ay * d[0]) / den;
    if (s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out = []; for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k + 1] - ts[k] > 0.5) out.push([ts[k], ts[k + 1]]);
  return out;
}
// Sutherland–Hodgman: dio poligona gdje je (p·n) između a i b.
function slTraka(poly, n, a, b) {
  const rez = (pts, f) => {
    const o = [];
    for (let i = 0; i < pts.length; i++) {
      const P = pts[i], Q = pts[(i + 1) % pts.length], fp = f(P), fq = f(Q);
      if (fp >= 0) o.push(P);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); o.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return o;
  };
  const dot = p => p[0] * n[0] + p[1] * n[1];
  return rez(rez(poly, p => dot(p) - a), p => b - dot(p));
}

// Širine polja preko poprečne širine poligona W. Prva linija je tačno `razmak`
// od ruba. Ako bi zadnje polje bilo preusko (< 75 % razmaka), zadnjih k polja
// (2–4) se malo suzi da sva budu ≥ 80 % razmaka; ako ni to ne ide, ostatak se
// raspodijeli na zadnja 3 polja (malo šira, bez dodatne linije).
function slRaspored(W, razmak, optimizuj) {
  const m = Math.floor(W / razmak + 1e-9), r = W - m * razmak;
  let sir = Array(m).fill(razmak); if (r > 0.5) sir.push(r);
  let info = null;
  if (optimizuj !== false && m >= 1 && r > 0.5 && r < 0.75 * razmak) {
    let ok = null;
    for (let k = 2; k <= Math.min(4, m + 1) && !ok; k++) { const w = (W - (m + 1 - k) * razmak) / k; if (w >= 0.8 * razmak) ok = { k, w }; }
    if (ok) { sir = Array(m + 1 - ok.k).fill(razmak).concat(Array(ok.k).fill(ok.w)); info = { nacin: 'suzeno', k: ok.k, w: ok.w, ostatak: r }; }
    else { const k = Math.min(3, m), w = razmak + r / k; sir = Array(m - k).fill(razmak).concat(Array(k).fill(w)); info = { nacin: 'prošireno', k, w, ostatak: r }; }
  }
  return { sir, info };
}

// ring [[lat,lon]…], azPada (° od sjevera, nizbrdo), razmak = širina sjekačke
// partije (m, horizontalno po izohipsi). Linije uvijek idu uz padinu (obaranje).
// Optimizacija (podrazumijevano):
//  • rubne linije: prva je `razmak` od granice; ako je tu poligon uzak (najduži
//    komad linije < pola tipične dužine), pomjera se dublje — najviše do 1,6 ×
//    razmak — da prva/zadnja partija ne bude mala krpa uz krivudav rub (isto s desne);
//  • između njih puni razmak, a preuska zadnja partija ide kroz slRaspored;
//  • nema linija ni komada kraćih od 100 m (lukovi, zalivi, šiljci) — taj komad
//    pripada susjednoj partiji; u malom poligonu prag je 90 % najduže tetive.
// izbrisane: ključevi linija koje je korisnik obrisao (udaljenost od lijevog
// ruba, 0,1 m) — ostale se prenumerišu, a dvije partije se spajaju.
const SL_MIN_DUZ = 100;
function slLinije(ring, azPada, razmak, optimizuj, izbrisane, sDesna) {
  const opt = optimizuj !== false;
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length, lon0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const L = slLokalno(lat0, lon0), poly = ring.map(p => L.u(p[0], p[1]));
  // d = smjer linije (nizbrdo), n = smjer razmicanja (lijevo→desno gledano uzbrdo)
  const d = slSmjer(azPada), n = [-d[1], d[0]];
  const proj = poly.map(p => p[0] * n[0] + p[1] * n[1]), min = Math.min(...proj), max = Math.max(...proj), W = max - min;
  const komadi = off => slPresjek(poly, [n[0] * off, n[1] * off], d);
  const glavni = off => komadi(off).reduce((m, [a, b]) => Math.max(m, b - a), 0);
  const uz = []; for (let i = 1; i < 40; i++) uz.push(glavni(min + W * i / 40));
  uz.sort((a, b) => a - b);
  const MALI = Math.min(SL_MIN_DUZ, 0.9 * uz[uz.length - 1]);
  const Lmin = Math.max(MALI, 0.5 * uz[Math.floor(uz.length * 0.75)]), MAXP = 1.6 * razmak;
  const bez = new Set((izbrisane || []).map(Number));
  const kljuc = off => Math.round((off - min) * 10) / 10;
  function rubni(od, sm) {
    for (let t = razmak; t <= MAXP + 1e-9; t += 1) if (glavni(od + sm * t) >= Lmin) return t;
    let naj = razmak, nl = -1;
    for (let t = razmak; t <= MAXP + 1e-9; t += 1) { const l = glavni(od + sm * t); if (l > nl + 0.5) { nl = l; naj = t; } }
    return naj;
  }
  let granice, info = null;
  if (!opt) {
    granice = [min]; for (let o = min + razmak; o < max - 0.5; o += razmak) granice.push(o); granice.push(max);
  } else if (W <= MAXP) {
    granice = [min, max];
  } else {
    const tL = rubni(min, 1), tD = rubni(max, -1), a = min + tL;
    // desni rub pun → ostatak ide u zadnje partije (slRaspored); uzak → i zadnja linija dublje
    const b = tD > razmak + 0.5 ? max - tD : max;
    info = { rubL: tL > razmak + 0.5 ? tL : null, rubD: b < max ? tD : null };
    if (b - a < 0.8 * razmak) granice = [min, (min + max) / 2, max];
    else {
      const rs = slRaspored(b - a, razmak, true);
      granice = [min, a]; rs.sir.forEach(w => granice.push(granice[granice.length - 1] + w));
      granice[granice.length - 1] = b; if (b < max) granice.push(max);
      Object.assign(info, rs.info || {});
    }
  }
  // komadi po liniji; male komade izbaci, liniju bez ijednog komada spoji s partijom
  let izbaceno = 0, obrisano = 0;
  const unut = [];
  for (let k = 1; k + 1 < granice.length; k++) {
    const sv = komadi(granice[k]), ok = opt ? sv.filter(([t0, t1]) => t1 - t0 >= MALI) : sv;
    izbaceno += sv.length - ok.length;
    if (ok.length && bez.has(kljuc(granice[k]))) obrisano++;
    else if (ok.length) unut.push({ off: granice[k], ok });
  }
  const g2 = [min, ...unut.map(u => u.off), max];
  const linije = [];
  unut.forEach((u, i) => {
    const o = [n[0] * u.off, n[1] * u.off];
    u.ok.forEach(([t0, t1], dio) => {
      // d gleda nizbrdo: veći t = niže → dno je kraj s većim t
      const A = [o[0] + d[0] * t1, o[1] + d[1] * t1], B = [o[0] + d[0] * t0, o[1] + d[1] * t0];
      linije.push({ br: i + 1, dio, k: kljuc(u.off), dno: L.n(A[0], A[1]), vrh: L.n(B[0], B[1]), duz: t1 - t0, off: u.off });
    });
  });
  if (sDesna) { linije.forEach(l => { l.br = unut.length + 1 - l.br; }); linije.sort((x, y) => x.br - y.br || x.dio - y.dio); }
  const polja = [];
  for (let i = 0; i + 1 < g2.length; i++) {
    const tr = slTraka(poly, n, g2[i], g2[i + 1]);
    polja.push({ br: sDesna ? g2.length - 1 - i : i + 1, ha: tr.length > 2 ? slPovrsinaXY(tr) / 1e4 : 0, sirina: g2[i + 1] - g2[i] });
  }
  if (sDesna) polja.reverse();
  if (info && izbaceno) info.izbaceno = izbaceno;
  if (info && !info.rubL && !info.rubD && !info.nacin && !info.izbaceno) info = null;
  if (obrisano) (info = info || {}).obrisano = obrisano;
  return { linije, polja, korak: razmak, ha: slPovrsinaXY(poly) / 1e4, opt: info };
}

// Dominantan pad iz vektora gradijenta (dzx, dzy u m/m, istok/sjever) po tačkama.
// dosljednost = |zbir| / zbir |v| (1 = jednolična padina, ~0 = greben/vrtača).
function slDominantniPad(grad) {
  let sx = 0, sy = 0, sm = 0, sn = 0, n = 0;
  for (const [gx, gy] of grad) {
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
    sx += -gx; sy += -gy; const m = Math.hypot(gx, gy); sm += m; sn += Math.atan(m) * 180 / Math.PI; n++;
  }
  if (!n || !sm) return null;
  return { azimut: (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360, dosljednost: Math.hypot(sx, sy) / sm, nagibSt: sn / n };
}

// Tačke linije od dna do vrha: stvarna (GPS trag radnika) > ručni lom > lepeza > ravna.
const slIma = a => Array.isArray(a) && a.length >= 2;
const slGeo = lin => (slIma(lin.stvarna) ? lin.stvarna : slIma(lin.geo) ? lin.geo : slIma(lin.spoj) ? lin.spoj : slIma(lin.teren) ? lin.teren : [lin.dno, lin.vrh]);
function slDuzina(geo) {
  const L = slLokalno(geo[0][0], geo[0][1]); let s = 0;
  for (let i = 1; i < geo.length; i++) { const a = L.u(geo[i - 1][0], geo[i - 1][1]), b = L.u(geo[i][0], geo[i][1]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
}
// Bočni otklon i položaj duž (izlomljene) linije, gledano uzbrdo od dna:
// najbliži segment daje stranu, put do njega se sabira po segmentima.
function slVodic(lin, la, lo) {
  const g = slGeo(lin), L = slLokalno(g[0][0], g[0][1]), P = g.map(q => L.u(q[0], q[1])), v = L.u(la, lo);
  let put = 0, naj = null;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], ex = b[0] - a[0], ey = b[1] - a[1], sl = Math.hypot(ex, ey) || 1, ux = ex / sl, uy = ey / sl;
    const wx = v[0] - a[0], wy = v[1] - a[1], t = wx * ux + wy * uy;
    const tk = Math.max(i === 1 ? -Infinity : 0, Math.min(i === P.length - 1 ? Infinity : sl, t));
    const d = Math.hypot(wx - ux * tk, wy - uy * tk);
    if (!naj || d < naj.d - 1e-9) naj = { d, duz: put + tk, bocno: wx * uy - wy * ux };
    put += sl;
  }
  return { duz: naj.duz, len: put || 1, bocno: naj.bocno }; // bocno > 0: radnik je desno → linija mu je lijevo
}

// ── Plan po terenu i provjera izohipse ────────────────────────────────
const slAzimut = (a, b) => { const L = slLokalno(a[0], a[1]), q = L.u(b[0], b[1]); return (Math.atan2(q[0], q[1]) * 180 / Math.PI + 360) % 360; };
// Ugao između pravca linije i pada (0° = niz pad, 90° = po izohipsi); smjer linije nebitan.
const slOdstupanje = (azLinije, azPada) => { const d = Math.abs(((azLinije - azPada) % 180 + 180) % 180); return Math.min(d, 180 - d); };
// uzorci [{dev, nagib}] duž linije (jednak razmak) → udio dužine > 45° od pada.
// Nagib < 8 % se ne broji: tu je smjer obaranja slobodan (i pad iz DEM-a je šum).
const SL_NAGIB_MIN = Math.atan(0.08) * 180 / Math.PI;
function slOcjenaPravca(uzorci) {
  const v = uzorci.filter(u => Number.isFinite(u.dev) && u.nagib >= SL_NAGIB_MIN);
  if (!v.length) return null;
  const los = v.filter(u => u.dev > 45);
  return { udio: los.length / v.length, max: Math.max(...v.map(u => u.dev)) };
}
// Dijelovi linije koji ne idu uz padinu: uzorci [{p0, p1, dev, nagib}] redom duž linije (p0–p1 = raspon
// uzorka) → spojeni rasponi uzastopnih loših uzoraka (> 45° od pada, nagib ≥ 8 %) kao polilinije.
function slIzoDijelovi(uzorci) {
  const out = []; let cur = null;
  for (const u of uzorci) {
    const los = Number.isFinite(u.dev) && u.nagib >= SL_NAGIB_MIN && u.dev > 45;
    if (!los) { cur = null; continue; }
    if (cur && slDuzina([cur[cur.length - 1], u.p0]) < 0.5) cur.push(u.p1);
    else { cur = [u.p0, u.p1]; out.push(cur); }
  }
  return out;
}
// Lepeza: svaka linija prava kroz svoje sjeme (sredinu), ali sa svojim smjerom pada.
// zeljeni[i] = pad u pojasu linije (°); pola[i] = najveća udaljenost sjemena od kraja (m).
// Susjedi smiju odstupati najviše Δ = asin(0,4·razmak / h): na kraju linije razmak
// ne pada ispod 60 % (ni ne raste iznad 140 %) — nema sabijanja ni ukrštanja.
// Prave linije se na terenu lako prate kompasom; glađenje (3 susjeda), pa ograničenje.
function slLepeza(zeljeni, pola, razmak, azOsnova, faktor) {
  const n = zeljeni.length; if (!n) return [];
  const rel = zeljeni.map(a => ((a - azOsnova + 540) % 360) - 180);
  const gl = rel.map((_, i) => { const v = rel.slice(Math.max(0, i - 1), i + 2); return v.reduce((a, b) => a + b, 0) / v.length; });
  const dmax = i => Math.asin(Math.min(1, 0.4 * razmak / Math.max(1, Math.max(pola[i], pola[i + 1])))) * 180 / Math.PI * (faktor ? faktor[i] : 1);
  const f = gl.slice(), b = gl.slice();
  for (let i = 1; i < n; i++) f[i] = Math.max(f[i - 1] - dmax(i - 1), Math.min(f[i - 1] + dmax(i - 1), f[i]));
  for (let i = n - 2; i >= 0; i--) b[i] = Math.max(b[i + 1] - dmax(i), Math.min(b[i + 1] + dmax(i), b[i]));
  const r = f.map((v, i) => (v + b[i]) / 2);
  for (let i = n - 2; i >= 0; i--) r[i] = Math.max(r[i + 1] - dmax(i), Math.min(r[i + 1] + dmax(i), r[i]));
  return r.map(v => (azOsnova + v + 360) % 360);
}
// Najmanji razmak dvije linije (uzorak svakih 5 m po a, udaljenost do segmenata b).
function slMinRazmak(a, b) {
  const L = slLokalno(a[0][0], a[0][1]), A = a.map(q => L.u(q[0], q[1])), Bp = b.map(q => L.u(q[0], q[1]));
  const doSeg = (p, s, e) => { const ex = e[0] - s[0], ey = e[1] - s[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((p[0] - s[0]) * ex + (p[1] - s[1]) * ey) / l2)); return Math.hypot(p[0] - s[0] - t * ex, p[1] - s[1] - t * ey); };
  let m = Infinity;
  for (let i = 1; i < A.length; i++) {
    const s = A[i - 1], e = A[i], n = Math.max(1, Math.ceil(Math.hypot(e[0] - s[0], e[1] - s[1]) / 5));
    for (let k = 0; k <= n; k++) { const q = [s[0] + (e[0] - s[0]) * k / n, s[1] + (e[1] - s[1]) * k / n]; for (let j = 1; j < Bp.length; j++) m = Math.min(m, doSeg(q, Bp[j - 1], Bp[j])); }
  }
  return m;
}
// Prava kroz sjeme pod azimutom, odsječena granicom: komad koji sadrži sjeme [dno, vrh].
function slLinijaKroz(ring, sjeme, azPada) {
  const L = slLokalno(sjeme[0], sjeme[1]), poly = ring.map(q => L.u(q[0], q[1])), d = slSmjer(azPada);
  const k = slPresjek(poly, [0, 0], d).find(([t0, t1]) => t0 <= 0.5 && t1 >= -0.5);
  return k ? [L.n(d[0] * k[1], d[1] * k[1]), L.n(d[0] * k[0], d[1] * k[0])] : null;
}
function slUnutra(q, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ya, xa] = ring[i], [yb, xb] = ring[j];
    if ((ya > q[0]) !== (yb > q[0]) && q[1] < (xb - xa) * (q[0] - ya) / (yb - ya) + xa) ins = !ins;
  }
  return ins;
}
// Površine partija između (krivih) linija: mreža tačaka, partija = broj linija
// desno od kojih je tačka (gledano uzbrdo). geos poredani s lijeva nadesno.
function slPoljaTeren(ring, geos) {
  const lat0 = ring.reduce((a, q) => a + q[0], 0) / ring.length, lon0 = ring.reduce((a, q) => a + q[1], 0) / ring.length;
  const L = slLokalno(lat0, lon0), poly = ring.map(q => L.u(q[0], q[1])), ha = slPovrsinaXY(poly) / 1e4;
  const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), korak = Math.max(4, Math.sqrt(ha * 1e4 / 2500));
  const n = new Array(geos.length + 1).fill(0); let uk = 0;
  for (let x = Math.min(...xs) + korak / 2; x < Math.max(...xs); x += korak)
    for (let y = Math.min(...ys) + korak / 2; y < Math.max(...ys); y += korak) {
      const ll = L.n(x, y); if (!slUnutra(ll, ring)) continue;
      let c = 0; for (const g of geos) if (slVodic({ geo: g }, ll[0], ll[1]).bocno > 0) c++;
      n[c]++; uk++;
    }
  return n.map(c => (uk ? c / uk * ha : 0));
}

// Douglas–Peucker u lokalnim metrima (tol m) — za GPS trag radnika.
function slUprosti(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const L = slLokalno(pts[0][0], pts[0][1]), P = pts.map(q => L.u(q[0], q[1])), keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop(), a = P[i], b = P[j], ex = b[0] - a[0], ey = b[1] - a[1], ln = Math.hypot(ex, ey) || 1;
    let mx = -1, mi = -1;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((P[k][0] - a[0]) * ey - (P[k][1] - a[1]) * ex) / ln; if (d > mx) { mx = d; mi = k; } }
    if (mx > tol) { keep[mi] = 1; st.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// Podjela poligona sjekačkom linijom (dno → vrh): krajevi se prislone na najbližu
// tačku granice, pa svaki dio = luk granice + linija. Vraća {lijevo, desno} gledano uzbrdo.
function slPodijeli(ring, geo) {
  if (!slIma(geo) || ring.length < 3) return null;
  const L = slLokalno(ring[0][0], ring[0][1]), P = ring.map(q => L.u(q[0], q[1])), G = geo.map(q => L.u(q[0], q[1]));
  const naRub = q => {
    let naj = null;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2)), x = [a[0] + t * ex, a[1] + t * ey], d = Math.hypot(q[0] - x[0], q[1] - x[1]);
      if (!naj || d < naj.d) naj = { i, t, x, d };
    }
    return naj;
  };
  const A = naRub(G[0]), B = naRub(G[G.length - 1]);
  if (A.i === B.i && Math.abs(A.t - B.t) < 1e-9) return null;
  const luk = (od, doo) => { // od tačke od, naprijed po granici, do tačke doo
    const out = [od.x]; let i = od.i;
    const isti = od.i === doo.i && doo.t > od.t;
    if (!isti) { for (let k = 0; k < P.length; k++) { i = (i + 1) % P.length; out.push(P[i]); if (i === doo.i) break; } }
    out.push(doo.x); return out;
  };
  const unutra = G.slice(1, -1);
  const r1 = luk(A, B).concat(unutra.slice().reverse()), r2 = luk(B, A).concat(unutra);
  const nazad = r => r.map(q => L.n(q[0], q[1]));
  // desno od linije (gledano uzbrdo): tačka malo desno od sredine najdužeg segmenta
  let si = 1, sl = -1; for (let i = 1; i < G.length; i++) { const d = Math.hypot(G[i][0] - G[i - 1][0], G[i][1] - G[i - 1][1]); if (d > sl) { sl = d; si = i; } }
  const a = G[si - 1], b = G[si], ux = (b[0] - a[0]) / (sl || 1), uy = (b[1] - a[1]) / (sl || 1);
  const t = L.n((a[0] + b[0]) / 2 + uy * 2, (a[1] + b[1]) / 2 - ux * 2);
  const R1 = nazad(r1), R2 = nazad(r2);
  return slUnutra(t, R1) ? { desno: R1, lijevo: R2 } : { desno: R2, lijevo: R1 };
}
// Drugi pad: koja strana podjele (slPodijeli) je „prema liniji prije” (manji broj) — ona koja
// sadrži sredinu prethodne linije; bez nje suprotna od strane sljedeće; bez obje null.
function slZonaStrane(pod, prije, poslije) {
  if (!pod) return null;
  const sred = g => g.length === 2 ? [(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2] : g[Math.floor((g.length - 1) / 2)];
  const strana = g => { const q = sred(g); return slUnutra(q, pod.lijevo) ? 'L' : slUnutra(q, pod.desno) ? 'D' : null; };
  let s = slIma(prije) ? strana(prije) : null;
  if (!s && slIma(poslije)) { const t = strana(poslije); if (t) s = t === 'L' ? 'D' : 'L'; }
  return s ? { prije: s, poslije: s === 'L' ? 'D' : 'L' } : null;
}
// Trake susjednih dijelova (s lijeva nadesno): zadnja traka dijela i prva sljedećeg
// su ista partija (između zadnje linije jednog i prve linije drugog dijela).
function slSpojiTrake(nizovi) {
  const S = [];
  nizovi.forEach((n, j) => { if (!n.length) return; if (j && S.length) { S[S.length - 1] += n[0]; S.push(...n.slice(1)); } else S.push(...n); });
  return S;
}
// Površina partije pridružena liniji: L — od prethodne linije (ili granice) do nje,
// gledano s lijeva; D — s desna. Trake S (n+1) za n linija s lijeva nadesno.
function slTrakeULinije(S, sDesna) {
  const n = S.length - 1;
  return sDesna ? { poLiniji: S.slice(1), ostatak: S[0] } : { poLiniji: S.slice(0, n), ostatak: S[n] };
}

// ── Alternativni prikaz: čitanje padina iz DEM-a ─────────────────────────
// Odjel s dva brda ili s padinama na više strana dijeli se na padine (jedna
// ekspozicija svaka) po grebenima i jarcima; svaka dobija svoj pad i svoje linije.
// Mreža visina z (nx × ny, korak s m; i raste prema istoku, j prema sjeveru).
const SL_RAVNO = 0.05; // nagib < 5 % nema pouzdanu ekspoziciju
const slUgaoRazlika = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function slPadineStat(r) { // r: { sx, sy, sm, n, sn } — zbirovi vektora pada
  return { azimut: (Math.atan2(r.sx, r.sy) * 180 / Math.PI + 360) % 360, dosljednost: r.sm ? Math.hypot(r.sx, r.sy) / r.sm : 0, nagibPct: r.n ? r.sn / r.n * 100 : 0 };
}
function slPadineMreza(z, nx, ny, s, unutra, minCelija) {
  const N = nx * ny, id = (i, j) => j * nx + i;
  // zaglađivanje 3×3, dva prolaza: Copernicus DEM je model površine s krošnjama
  let h = Float64Array.from(z, v => (Number.isFinite(v) ? v : NaN));
  for (let it = 0; it < 2; it++) {
    const o = new Float64Array(N).fill(NaN);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let a = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const v = h[id(ii, jj)]; if (Number.isFinite(v)) { a += v; n++; }
      }
      if (n) o[id(i, j)] = a / n;
    }
    h = o;
  }
  const H = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? NaN : h[id(i, j)]);
  const der = (i, j, di, dj) => { for (const k of [2, 1]) { const a = H(i + di * k, j + dj * k), b = H(i - di * k, j - dj * k); if (Number.isFinite(a) && Number.isFinite(b)) return (a - b) / (2 * k * s); } return 0; };
  const vx = new Float64Array(N), vy = new Float64Array(N), nag = new Float64Array(N); // vektor pada (nizbrdo), m/m
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const c = id(i, j); vx[c] = -der(i, j, 1, 0); vy[c] = -der(i, j, 0, 1); nag[c] = Math.hypot(vx[c], vy[c]); }
  const unut = []; for (let c = 0; c < N; c++) if (unutra[c]) unut.push(c);
  // 1) ekspozicije: vrhovi histograma (10°, težina = nagib), razmak ≥ 60°, svaki ≥ 12 % težine
  const B = 36, hist = new Float64Array(B); let uk = 0;
  for (const c of unut) if (nag[c] >= SL_RAVNO) { const az = (Math.atan2(vx[c], vy[c]) * 180 / Math.PI + 360) % 360; hist[Math.floor(az / 10) % B] += nag[c]; uk += nag[c]; }
  const hb = b => hist[((b % B) + B) % B], sm = Array.from({ length: B }, (_, b) => (hb(b - 2) + 2 * hb(b - 1) + 3 * hb(b) + 2 * hb(b + 1) + hb(b + 2)) / 9);
  const smb = b => sm[((b % B) + B) % B], vrhovi = [];
  Array.from({ length: B }, (_, b) => b).filter(b => sm[b] > 0 && sm[b] >= smb(b - 1) && sm[b] > smb(b + 1)).sort((a, b) => sm[b] - sm[a]).forEach(b => {
    let udio = 0; for (let k = -3; k <= 3; k++) udio += hb(b + k);
    if (udio < 0.12 * uk || vrhovi.length >= 4 || vrhovi.some(v => slUgaoRazlika(v * 10, b * 10) < 60)) return;
    vrhovi.push(b);
  });
  let cen = (vrhovi.length ? vrhovi : [0]).map(b => slSmjer(b * 10 + 5));
  // 2) dodjela najbližoj ekspoziciji + k-means na smjerovima pada
  const lab = new Int32Array(N).fill(-1);
  for (let it = 0; it < 5; it++) {
    const zb = cen.map(() => [0, 0]);
    for (const c of unut) {
      if (nag[c] < SL_RAVNO) { lab[c] = -2; continue; }
      let bk = 0, bd = -Infinity; cen.forEach((q, k) => { const d = (vx[c] * q[0] + vy[c] * q[1]) / nag[c]; if (d > bd) { bd = d; bk = k; } });
      lab[c] = bk; zb[bk][0] += vx[c]; zb[bk][1] += vy[c];
    }
    cen = cen.map((q, k) => { const m = Math.hypot(zb[k][0], zb[k][1]); return m ? [zb[k][0] / m, zb[k][1] / m] : q; });
  }
  // 3) modus 3×3 (dva prolaza) i popuna ravnih ćelija od susjeda
  const susjedi = (c, f) => { const i = c % nx, j = (c - i) / nx; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if ((di || dj) && ii >= 0 && jj >= 0 && ii < nx && jj < ny) f(id(ii, jj)); } };
  const modus = (c, l) => { const cnt = new Map(); if (l[c] >= 0) cnt.set(l[c], 1.5); susjedi(c, d => { if (l[d] >= 0) cnt.set(l[d], (cnt.get(l[d]) || 0) + 1); }); let b = l[c], bn = 0; cnt.forEach((n, k) => { if (n > bn) { bn = n; b = k; } }); return b; };
  for (let it = 0; it < 2; it++) { const o = Int32Array.from(lab); for (const c of unut) o[c] = modus(c, lab); lab.set(o); }
  for (let it = 0; it < 60 && unut.some(c => lab[c] < 0); it++) { const o = Int32Array.from(lab); for (const c of unut) if (lab[c] < 0) o[c] = modus(c, lab); lab.set(o); }
  for (const c of unut) if (lab[c] < 0) lab[c] = 0;
  // 4) povezane komponente (4-susjedstvo) = kandidati padina
  const komp = new Int32Array(N).fill(-1); let nk = 0;
  const s4 = c => { const i = c % nx, o = []; if (i > 0) o.push(c - 1); if (i < nx - 1) o.push(c + 1); if (c >= nx) o.push(c - nx); if (c < N - nx) o.push(c + nx); return o; };
  for (const c of unut) {
    if (komp[c] >= 0) continue;
    const st = [c]; komp[c] = nk;
    while (st.length) { const x = st.pop(); for (const d of s4(x)) if (unutra[d] && komp[d] < 0 && lab[d] === lab[c]) { komp[d] = nk; st.push(d); } }
    nk++;
  }
  const korijen = Array.from({ length: nk }, (_, k) => k), nadji = k => { while (korijen[k] !== k) k = korijen[k] = korijen[korijen[k]]; return k; };
  const zbir = () => {
    const R = new Map();
    for (const c of unut) {
      const k = nadji(komp[c]); let r = R.get(k);
      if (!r) R.set(k, r = { id: k, n: 0, sx: 0, sy: 0, sm: 0, sn: 0, hMin: Infinity, hMax: -Infinity, ci: 0, cj: 0 });
      r.n++; r.sx += vx[c]; r.sy += vy[c]; r.sm += nag[c]; r.sn += nag[c]; r.ci += c % nx; r.cj += Math.floor(c / nx);
      if (Number.isFinite(z[c])) { r.hMin = Math.min(r.hMin, z[c]); r.hMax = Math.max(r.hMax, z[c]); }
    }
    return R;
  };
  const dodiri = () => { // zajednička granica (broj stranica ćelija) između komponenti
    const D = new Map();
    for (const c of unut) for (const d of s4(c)) { if (d < c || !unutra[d]) continue; const a = nadji(komp[c]), b = nadji(komp[d]); if (a === b) continue; const k = Math.min(a, b) + ':' + Math.max(a, b); D.set(k, (D.get(k) || 0) + 1); }
    return D;
  };
  // 5) spajanje: male komponente u susjeda s najdužom granicom; susjedne slične ekspozicije (< 35°)
  for (let it = 0; it < 500; it++) {
    const R = zbir(), D = dodiri();
    const mala = [...R.values()].filter(r => r.n < minCelija).sort((a, b) => a.n - b.n)[0];
    let spoj = null;
    if (mala) {
      let bn = 0; D.forEach((n, k) => { const [a, b] = k.split(':').map(Number); if ((a === mala.id || b === mala.id) && n > bn) { bn = n; spoj = [mala.id, a === mala.id ? b : a]; } });
      if (!spoj) break;
    } else {
      let bd = 35; D.forEach((n, k) => { const [a, b] = k.split(':').map(Number), d = slUgaoRazlika(slPadineStat(R.get(a)).azimut, slPadineStat(R.get(b)).azimut); if (d < bd) { bd = d; spoj = [a, b]; } });
      if (!spoj && R.size > 5) { const m = [...R.values()].sort((a, b) => a.n - b.n)[0]; let bn = 0; D.forEach((n, k) => { const [a, b] = k.split(':').map(Number); if ((a === m.id || b === m.id) && n > bn) { bn = n; spoj = [m.id, a === m.id ? b : a]; } }); }
      if (!spoj) break;
    }
    korijen[nadji(spoj[0])] = nadji(spoj[1]);
  }
  const R = zbir(), ids = [...R.keys()].sort((a, b) => a - b), novi = new Map(ids.map((k, i) => [k, i]));
  const labela = new Int32Array(N).fill(-1); for (const c of unut) labela[c] = novi.get(nadji(komp[c]));
  const regije = ids.map(k => { const r = R.get(k); return { ...r, id: novi.get(k), ci: r.ci / r.n, cj: r.cj / r.n, ...slPadineStat(r) }; });
  // 6) granice između padina: tačke na sredini stranica ćelija; tip po smjeru pada s obje strane
  const G = new Map();
  for (const c of unut) for (const d of s4(c)) {
    if (d < c || !unutra[d] || labela[c] === labela[d]) continue;
    const a = labela[c], b = labela[d], k = Math.min(a, b) + ':' + Math.max(a, b);
    let g = G.get(k); if (!g) G.set(k, g = { a: Math.min(a, b), b: Math.max(a, b), tacke: [], greben: 0, jarak: 0 });
    const ic = c % nx, jc = Math.floor(c / nx), id2 = d % nx, jd = Math.floor(d / nx), ex = id2 - ic, ey = jd - jc;
    g.tacke.push([(ic + id2) / 2, (jc + jd) / 2]);
    const pc = vx[c] * ex + vy[c] * ey, pd = vx[d] * ex + vy[d] * ey; // pad ćelije c prema d i obrnuto
    if (pc < 0 && pd > 0) g.greben++; else if (pc > 0 && pd < 0) g.jarak++;
  }
  return { labela, regije, granice: [...G.values()] };
}
// Tačke granice (metri) → uređena, zaglađena linija: lanac najbližih susjeda od kraja glavne ose.
function slGranicaLinija(tacke, s) {
  if (tacke.length < 2) return null;
  const n = tacke.length, mx = tacke.reduce((a, q) => a + q[0], 0) / n, my = tacke.reduce((a, q) => a + q[1], 0) / n;
  let xx = 0, xy = 0, yy = 0; for (const [x, y] of tacke) { xx += (x - mx) ** 2; xy += (x - mx) * (y - my); yy += (y - my) ** 2; }
  const ug = 0.5 * Math.atan2(2 * xy, xx - yy), os = [Math.cos(ug), Math.sin(ug)], pr = q => (q[0] - mx) * os[0] + (q[1] - my) * os[1];
  const ost = tacke.slice().sort((a, b) => pr(a) - pr(b)), lanac = [ost.shift()];
  while (ost.length) {
    const z = lanac[lanac.length - 1]; let bi = -1, bd = Infinity;
    ost.forEach((q, i) => { const d = Math.hypot(q[0] - z[0], q[1] - z[1]); if (d < bd) { bd = d; bi = i; } });
    if (bd > 4 * s) break; // odvojen komad (drugi dodir istih padina) se ne spaja
    lanac.push(ost.splice(bi, 1)[0]);
  }
  if (lanac.length < 2) return null;
  const w = 2; // klizni prosjek ±2 tačke, krajevi ostaju
  return lanac.map((q, i) => { if (i === 0 || i === lanac.length - 1) return q; let a = 0, b = 0, k = 0; for (let j = Math.max(0, i - w); j <= Math.min(lanac.length - 1, i + w); j++) { a += lanac[j][0]; b += lanac[j][1]; k++; } return [a / k, b / k]; });
}
function slNaRub(q, ring) { // najbliža tačka granice i udaljenost (m)
  const L = slLokalno(q[0], q[1]), P = ring.map(x => L.u(x[0], x[1]));
  let m = Infinity, x = null;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, -(a[0] * ex + a[1] * ey) / l2)), d = Math.hypot(a[0] + t * ex, a[1] + t * ey);
    if (d < m) { m = d; x = [a[0] + t * ex, a[1] + t * ey]; }
  }
  return { d: m, q: x ? L.n(x[0], x[1]) : q };
}
const slDoRuba = (q, ring) => slNaRub(q, ring).d;
const slRingHa = ring => { const L = slLokalno(ring[0][0], ring[0][1]); return slPovrsinaXY(ring.map(q => L.u(q[0], q[1]))) / 1e4; };
// Podjela poligona po granicama padina (geo [lat, lon]): granica se koristi kad su
// joj oba kraja na rubu dijela (≤ tol m) — ona koja završava na drugoj granici čeka
// da ta prva podijeli poligon. regije: [{ id, tacke }] (uzorak ćelija za pripadnost dijelu).
// Padine koje nijedna granica ne razdvoji ostaju zajedno (spoje se).
function slRazdijeli(ring, regije, granice, tol, minHa) {
  let dijelovi = [{ ring, ids: regije.map(r => r.id) }];
  const ost = granice.filter(g => slIma(g.geo)).slice().sort((a, b) => slDuzina(b.geo) - slDuzina(a.geo)), koristene = [];
  const strana = (ids, R) => ids.filter(id => { const r = regije.find(x => x.id === id), u = r.tacke.filter(q => slUnutra(q, R)).length; return u * 2 > r.tacke.length; });
  for (let napredak = true; napredak && ost.length;) {
    napredak = false;
    for (let gi = 0; gi < ost.length; gi++) {
      const g = ost[gi], d = dijelovi.find(x => x.ids.includes(g.a) && x.ids.includes(g.b));
      if (!d) { ost.splice(gi--, 1); continue; } // već razdvojene drugom granicom
      if (slDoRuba(g.geo[0], d.ring) > tol || slDoRuba(g.geo[g.geo.length - 1], d.ring) > tol) continue;
      const pod = slPodijeli(d.ring, g.geo); if (!pod) continue;
      const lj = strana(d.ids, pod.lijevo), de = d.ids.filter(id => !lj.includes(id));
      if (!lj.length || !de.length || lj.includes(g.a) === lj.includes(g.b)) continue;
      if (slRingHa(pod.lijevo) < minHa || slRingHa(pod.desno) < minHa) continue;
      dijelovi.splice(dijelovi.indexOf(d), 1, { ring: pod.lijevo, ids: lj }, { ring: pod.desno, ids: de });
      koristene.push({ ...g, geo: [slNaRub(g.geo[0], d.ring).q, ...g.geo, slNaRub(g.geo[g.geo.length - 1], d.ring).q] }); // do ruba, kao podjela ost.splice(gi, 1); napredak = true; break;
    }
  }
  return { dijelovi, granice: koristene };
}
// Poligon partije uz liniju j dijela di — ISTA podjela kao lin.ha (slPoljaTeren: tačka je u
// traci = broj linija desno od kojih je), pa obris ćelija trake. L — od prethodne linije (ili
// granice) do linije j, D — od linije j do sljedeće. dijelovi: [{ ring, geos }] s lijeva nadesno
// (gledano uzbrdo); spajaj: rubne trake susjednih dijelova su jedna partija (drugi pad iza
// sjekačke linije), za padine ne (greben dijeli partije). Vraća prstenove [lat, lon].
// Mreža dijela: za svaku ćeliju broj linija desno od kojih je (255 = van poligona). Skupo
// (ćelije × linije) — gradi se jednom, pa se iz nje čitaju obrisi više partija.
function slTrakeMreza(ring, geos) {
  const lat0 = ring.reduce((a, q) => a + q[0], 0) / ring.length, lon0 = ring.reduce((a, q) => a + q[1], 0) / ring.length;
  const L = slLokalno(lat0, lon0), poly = ring.map(q => L.u(q[0], q[1])), ha = slPovrsinaXY(poly) / 1e4;
  const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), k = Math.max(2.5, Math.sqrt(ha * 1e4 / 12000));
  const x0 = Math.min(...xs), y0 = Math.min(...ys), nx = Math.ceil((Math.max(...xs) - x0) / k), ny = Math.ceil((Math.max(...ys) - y0) / k);
  const c = new Uint8Array(nx * ny).fill(255);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ll = L.n(x0 + (i + 0.5) * k, y0 + (j + 0.5) * k); if (!slUnutra(ll, ring)) continue;
    let n = 0; for (const g of geos) if (slVodic({ geo: g }, ll[0], ll[1]).bocno > 0) n++;
    c[j * nx + i] = Math.min(254, n);
  }
  return { c, nx, ny, k, x0, y0, L };
}
function slTrakaObris(ring, geos, traka, mreza) {
  const { c, nx, ny, k, x0, y0, L } = mreza || slTrakeMreza(ring, geos);
  const U = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && c[j * nx + i] === traka;
  // rubne stranice ćelija, usmjerene tako da je traka lijevo → zatvorene petlje
  const iz = new Map(), kljuc = (i, j) => i + ',' + j, dodaj = (a, b) => { const kk = kljuc(...a); (iz.get(kk) || iz.set(kk, []).get(kk)).push(b); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!U(i, j)) continue;
    if (!U(i, j - 1)) dodaj([i, j], [i + 1, j]);
    if (!U(i + 1, j)) dodaj([i + 1, j], [i + 1, j + 1]);
    if (!U(i, j + 1)) dodaj([i + 1, j + 1], [i, j + 1]);
    if (!U(i - 1, j)) dodaj([i, j + 1], [i, j]);
  }
  const petlje = [];
  for (const [start, lista] of iz) {
    while (lista.length) {
      const p0 = start.split(',').map(Number), pet = [p0]; let v = lista.pop();
      for (let n = 0; n < 1e6 && kljuc(...v) !== start; n++) { pet.push(v); const l = iz.get(kljuc(...v)); if (!l || !l.length) break; v = l.pop(); }
      if (pet.length < 4) continue;
      const geo = pet.map(([i, j]) => L.n(x0 + i * k, y0 + j * k));
      // stepenice ćelija → glatka ivica; zatvorena petlja se dijeli na najdaljoj tački (DP treba dva kraja)
      let m = 0, md = -1; geo.forEach((q, i) => { const d = (q[0] - geo[0][0]) ** 2 + (q[1] - geo[0][1]) ** 2; if (d > md) { md = d; m = i; } });
      const g = slUprosti(geo.slice(0, m + 1), k * 0.75).concat(slUprosti(geo.slice(m).concat([geo[0]]), k * 0.75).slice(1, -1));
      if (g.length >= 3) petlje.push(g);
    }
  }
  return petlje;
}
// mreze (neobavezno): keš slTrakeMreza po dijelu — za obrise svih partija odjednom.
function slPartija(dijelovi, di, j, sDesna, spajaj, mreze) {
  const d = dijelovi[di]; if (!d || j < 0 || j >= d.geos.length) return [];
  const m = x => mreze ? (mreze[x] = mreze[x] || slTrakeMreza(dijelovi[x].ring, dijelovi[x].geos)) : undefined;
  const out = slTrakaObris(d.ring, d.geos, sDesna ? j + 1 : j, m(di));
  if (spajaj && !sDesna && j === 0) for (let k = di - 1; k >= 0; k--) { const p = dijelovi[k]; out.push(...slTrakaObris(p.ring, p.geos, p.geos.length, m(k))); if (p.geos.length) break; }
  if (spajaj && sDesna && j === d.geos.length - 1) for (let k = di + 1; k < dijelovi.length; k++) { const p = dijelovi[k]; out.push(...slTrakaObris(p.ring, p.geos, 0, m(k))); if (p.geos.length) break; }
  return out;
}
// Alternativni prikaz: linije susjednih padina čiji su krajevi blizu (≤ prag m) i uz granicu
// padina spajaju se u jednu krivudavu liniju (manje linija za obilježavanje). Parovi krajeva
// redom po udaljenosti, svaki kraj najviše jednom, bez petlji (union-find).
// linije [{padina, geo}] → lanci [[{i, obrni}]] (svaka linija u tačno jednom lancu).
function slSpojiLinije(linije, granice, prag) {
  const n = linije.length, sami = () => linije.map((_, i) => [{ i, obrni: false }]);
  if (!(prag > 0) || n < 2) return sami();
  const sve = linije.flatMap(x => x.geo), Lc = slLokalno(sve.reduce((a, q) => a + q[0], 0) / sve.length, sve.reduce((a, q) => a + q[1], 0) / sve.length);
  const xy = q => Lc.u(q[0], q[1]), G = (granice || []).filter(slIma).map(g => g.map(xy));
  const doSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const doGranice = p => { let m = Infinity; for (const g of G) for (let i = 1; i < g.length; i++) m = Math.min(m, doSeg(p, g[i - 1], g[i])); return m; };
  const blizu = Math.max(15, prag / 2), kraj = linije.map(x => [xy(x.geo[0]), xy(x.geo[x.geo.length - 1])]);
  const uzGr = kraj.map(k => k.map(q => !G.length || doGranice(q) <= blizu)), parovi = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (linije[i].padina === linije[j].padina) continue;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const d = Math.hypot(kraj[i][a][0] - kraj[j][b][0], kraj[i][a][1] - kraj[j][b][1]);
      if (d <= prag && uzGr[i][a] && uzGr[j][b]) parovi.push({ i, a, j, b, d });
    }
  }
  parovi.sort((x, y) => x.d - y.d);
  const rod = linije.map((_, i) => i), korijen = i => { while (rod[i] !== i) i = rod[i] = rod[rod[i]]; return i; }, veza = new Map();
  for (const { i, a, j, b } of parovi) {
    if (veza.has(i + ':' + a) || veza.has(j + ':' + b) || korijen(i) === korijen(j)) continue;
    rod[korijen(i)] = korijen(j); veza.set(i + ':' + a, [j, b]); veza.set(j + ':' + b, [i, a]);
  }
  if (!veza.size) return sami();
  const bio = new Uint8Array(n), out = [];
  for (let s = 0; s < n; s++) {
    if (bio[s] || (veza.has(s + ':0') && veza.has(s + ':1'))) continue; // lanac počinje slobodnim krajem
    const lanac = []; let i = s, obrni = veza.has(s + ':0');
    for (;;) {
      lanac.push({ i, obrni }); bio[i] = 1;
      const v = veza.get(i + ':' + (obrni ? 0 : 1)); if (!v || bio[v[0]]) break;
      i = v[0]; obrni = v[1] === 1;
    }
    out.push(lanac);
  }
  return out;
}
// Geometrije redom u lancu → jedna linija (spoj između krajeva ostaje kao kratak komad uz granicu).
function slSpojiGeo(geos) {
  const out = [];
  for (const g of geos) for (const q of g) { const z = out[out.length - 1]; if (!z || slDuzina([z, q]) > 1) out.push(q); }
  return out;
}
// Glatki (esoidni) spoj lanca: kraj svakog dijela se skrati za r m (≤ 40 % dijela), a praznina se
// premosti kubnom Bezierovom krivom tangentnom na oba dijela — bez oštrog loma na granici padina.
function slSpojiGlatko(geos, r) {
  if (geos.length < 2 || !(r > 0)) return slSpojiGeo(geos);
  const q0 = geos[0][0], Lc = slLokalno(q0[0], q0[1]), G = geos.map(g => slSpojiGeo([g]).map(q => Lc.u(q[0], q[1])));
  const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]), duz = P => P.reduce((a, q, i) => (i ? a + hyp(P[i - 1], q) : 0), 0);
  const rez = (P, t) => { // [prije, poslije] na dužini t od početka
    let put = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], d = hyp(a, b);
      if (put + d >= t) { const f = d ? (t - put) / d : 0, x = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; return [P.slice(0, i).concat([x]), [x].concat(P.slice(i))]; }
      put += d;
    }
    return [P.slice(), [P[P.length - 1]]];
  };
  const smjer = (a, b) => { const l = hyp(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const len = G.map(duz), rj = G.slice(1).map((_, i) => Math.min(r, 0.4 * len[i], 0.4 * len[i + 1]));
  const dijelovi = G.map((P, i) => { let Q = P; if (i) Q = rez(Q, rj[i - 1])[1]; if (i < G.length - 1) Q = rez(Q, duz(Q) - rj[i])[0]; return Q; });
  let out = dijelovi[0].slice();
  for (let i = 1; i < dijelovi.length; i++) {
    const A = G[i - 1], B = G[i], P0 = out[out.length - 1], P3 = dijelovi[i][0];
    const tA = smjer(A[A.length - 2], A[A.length - 1]), tB = smjer(B[0], B[1]), k = 0.5 * hyp(P0, P3);
    const C1 = [P0[0] + tA[0] * k, P0[1] + tA[1] * k], C2 = [P3[0] - tB[0] * k, P3[1] - tB[1] * k];
    for (let s = 1; s < 10; s++) {
      const t = s / 10, u = 1 - t, b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      out.push([b[0] * P0[0] + b[1] * C1[0] + b[2] * C2[0] + b[3] * P3[0], b[0] * P0[1] + b[1] * C1[1] + b[2] * C2[1] + b[3] * P3[1]]);
    }
    out = out.concat(dijelovi[i]);
  }
  return slSpojiGeo([out.map(q => Lc.n(q[0], q[1]))]);
}
// Produženje kraja linije (kraj 0 = prvi, 1 = zadnji) pravo do granice poligona: samo ako kraj nije
// već na granici, granica je ≤ maxDuz i produžetak ostaje ≥ minRaz od ostalih linija (prepreke).
function slProduzi(geo, kraj, ring, prepreke, maxDuz, minRaz) {
  if (!slIma(geo) || geo.length < 2) return null;
  const Lc = slLokalno(geo[0][0], geo[0][1]), P = geo.map(q => Lc.u(q[0], q[1])), R = ring.map(q => Lc.u(q[0], q[1]));
  const E = kraj ? P[P.length - 1] : P[0], Pp = kraj ? P[P.length - 2] : P[1], l = Math.hypot(E[0] - Pp[0], E[1] - Pp[1]);
  if (!l) return null;
  const u = [(E[0] - Pp[0]) / l, (E[1] - Pp[1]) / l];
  let t = Infinity;
  for (let i = 0; i < R.length; i++) {
    const a = R[i], b = R[(i + 1) % R.length], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
    const f = Math.max(0, Math.min(1, ((E[0] - a[0]) * ex + (E[1] - a[1]) * ey) / l2));
    if (Math.hypot(E[0] - a[0] - f * ex, E[1] - a[1] - f * ey) < 2) return null; // već na granici
    const den = u[0] * ey - u[1] * ex; if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - E[0], wy = a[1] - E[1], tt = (wx * ey - wy * ex) / den, ss = (wx * u[1] - wy * u[0]) / den;
    if (tt > 0.5 && ss >= 0 && ss <= 1) t = Math.min(t, tt);
  }
  if (!(t <= maxDuz)) return null;
  const H = Lc.n(E[0] + u[0] * t, E[1] + u[1] * t), Ell = kraj ? geo[geo.length - 1] : geo[0];
  if (!slUnutra(Lc.n(E[0] + u[0] * t / 2, E[1] + u[1] * t / 2), ring)) return null;
  const seg = [Ell, H];
  if ((prepreke || []).some(g => slIma(g) && g.length > 1 && slMinRazmak(seg, g) < minRaz)) return null;
  return kraj ? geo.concat([H]) : [H].concat(geo);
}
// Površine po padinama kad linije jedne padine (produžeci `ext`) ulaze u susjednu: ćelija pripada
// izvornoj padini kad joj je produžetak bliži od vlastitih linija (i ≤ razmak); traka se onda broji
// linijama izvorne padine. D [{ring, geos (s lijeva nadesno), ext: [geo]}] → trake (ha) po padini.
function slPoljaPadine(D, razmak) {
  const out = D.map(d => new Array(d.geos.length + 1).fill(0));
  if (!D.length) return out;
  const q0 = D[0].ring[0], Lc = slLokalno(q0[0], q0[1]), XY = g => g.map(q => Lc.u(q[0], q[1]));
  const own = D.map(d => d.geos.map(XY)), ext = D.map(d => (d.ext || []).map(XY));
  const doLin = (p, P) => { let m = Infinity; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, f = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)); m = Math.min(m, Math.hypot(p[0] - a[0] - f * ex, p[1] - a[1] - f * ey)); } return m; };
  D.forEach((d, i) => {
    const poly = XY(d.ring), ha = slPovrsinaXY(poly) / 1e4, korak = Math.max(4, Math.sqrt(ha * 1e4 / 2500));
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), cel = [];
    for (let x = Math.min(...xs) + korak / 2; x < Math.max(...xs); x += korak)
      for (let y = Math.min(...ys) + korak / 2; y < Math.max(...ys); y += korak) { const ll = Lc.n(x, y); if (slUnutra(ll, d.ring)) cel.push([x, y, ll]); }
    for (const [x, y, ll] of cel) {
      let vl = i, naj = Math.min(Infinity, ...own[i].map(P => doLin([x, y], P)));
      ext.forEach((E, j) => { if (j === i) return; for (const P of E) { const dd = doLin([x, y], P); if (dd < naj && dd <= razmak) { naj = dd; vl = j; } } });
      let c = 0; for (const g of D[vl].geos) if (slVodic({ geo: g }, ll[0], ll[1]).bocno > 0) c++;
      out[vl][c] += ha / cel.length;
    }
  });
  return out;
}
// Jedinstven smjer „s lijeva nadesno” preko padina: spojena linija u jednoj padini ide uzbrdo, a u
// drugoj (preko grebena) nizbrdo — ta padina se gleda obrnuto (flip). lanci [[{padina, obrni}]] → flip[].
function slOrijentacija(nPadina, lanci) {
  const sus = Array.from({ length: nPadina }, () => []);
  for (const l of lanci) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i], r = (a.obrni ? 1 : 0) ^ (b.obrni ? 1 : 0);
    if (a.padina !== b.padina) { sus[a.padina].push([b.padina, r]); sus[b.padina].push([a.padina, r]); }
  }
  const flip = new Array(nPadina).fill(null);
  for (let s = 0; s < nPadina; s++) {
    if (flip[s] !== null) continue;
    flip[s] = 0; const st = [s];
    while (st.length) { const a = st.pop(); for (const [b, r] of sus[a]) if (flip[b] === null) { flip[b] = flip[a] ^ r; st.push(b); } }
  }
  return flip.map(Boolean);
}
// Redoslijed linija preko svih padina iz redoslijeda po padini (spojena linija je u više nizova):
// topološki, pri izboru prednost ranija padina/položaj; petlja (rijetko) → ostatak po prednosti.
function slRedoslijed(nizovi) {
  const cvor = new Map(), c = k => cvor.get(k) || cvor.set(k, { k, ul: 0, iz: new Set(), pr: null }).get(k);
  nizovi.forEach((n, ni) => n.forEach((k, j) => {
    const x = c(k); if (!x.pr) x.pr = [ni, j];
    if (j && n[j - 1] !== k) { const a = c(n[j - 1]); if (!a.iz.has(k)) { a.iz.add(k); x.ul++; } }
  }));
  const pr = (a, b) => a.pr[0] - b.pr[0] || a.pr[1] - b.pr[1], out = [], gotov = new Set();
  while (out.length < cvor.size) {
    const sl = [...cvor.values()].filter(x => !gotov.has(x.k));
    const x = sl.filter(v => v.ul === 0).sort(pr)[0] || sl.sort(pr)[0];
    out.push(x.k); gotov.add(x.k);
    for (const k of x.iz) cvor.get(k).ul--;
  }
  return out;
}
// Spajanje projekta s drugog telefona (dijeljenje KML-om): plan (granica, razmak, pad,
// podjele) uzima se iz projekta s novijom izmjenom plana `tPlan`, a stanje svake linije
// (status, radnik, lom, GPS linija) iz verzije s novijim `lin.t` — tako planer dobije
// ofarbane linije radnika, a radnik novi raspored ako ga je planer promijenio.
const SL_STANJE = ['status', 'radnik', 'geo', 'stvarna', 'trag', 't'];
function slSpojiProjekte(lok, dol) {
  const planDolazni = (dol.tPlan || 0) > (lok.tPlan || 0);
  const baza = JSON.parse(JSON.stringify(planDolazni ? dol : lok)), drugi = planDolazni ? lok : dol;
  const mapa = new Map((drugi.linije || []).map(l => [l.id, l]));
  let azurirano = 0;
  for (const l of baza.linije) {
    const o = mapa.get(l.id);
    if (!o || (o.t || 0) <= (l.t || 0)) continue;
    for (const k of SL_STANJE) { if (o[k] !== undefined) l[k] = JSON.parse(JSON.stringify(o[k])); else delete l[k]; }
    azurirano++;
  }
  if (lok.vidljiv !== undefined) baza.vidljiv = lok.vidljiv; // prikaz je lična postavka
  return { p: baza, azurirano, planDolazni };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { slIzoDijelovi, slOrijentacija, slRedoslijed, slSpojiLinije, slSpojiGeo, slSpojiGlatko, slProduzi, slPoljaPadine, slTrakeMreza, slZonaStrane, slSpojiProjekte, slPartija, slTrakaObris, slPadineMreza, slGranicaLinija, slRazdijeli, slDoRuba, slUgaoRazlika, slUprosti, slPodijeli, slSpojiTrake, slTrakeULinije, slAzimut, slOdstupanje, slOcjenaPravca, slLepeza, slMinRazmak, slLinijaKroz, slPoljaTeren, slUnutra, slGeo, slDuzina, slLinije, slRaspored, slPresjek, slTraka, slDominantniPad, slVodic, slLokalno };

(function () {
  if (typeof window === 'undefined' || typeof L === 'undefined' || typeof map === 'undefined') return;
  const KLJUC = 'usf_sjekacke';
  const STATUS = { ne: { t: 'nije', c: '#f59e0b' }, rad: { t: 'u radu', c: '#38bdf8' }, gotovo: { t: 'ofarbano', c: '#22c55e' } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const citaj = () => { try { const v = JSON.parse(localStorage.getItem(KLJUC) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const pisi = l => { try { localStorage.setItem(KLJUC, JSON.stringify(l)); return true; } catch (e) { showToast('⚠ Nema mjesta za čuvanje'); return false; } };

  map.createPane('sjekackePane'); map.getPane('sjekackePane').style.zIndex = '415'; map.getPane('sjekackePane').style.pointerEvents = 'none';
  const grp = L.layerGroup().addTo(map), lblGrp = L.layerGroup().addTo(map);
  let natpisi = [];
  let aktivni = null, vodic = null; // vodic: { pid, lid, t }

  // ── Izvori poligona ───────────────────────────────────────────────────
  function izvori() {
    const out = [];
    (typeof _msrRegistry !== 'undefined' ? _msrRegistry : []).filter(m => m.mode === 'area' && m.pts && m.pts.length >= 3)
      .forEach(m => out.push({ k: 'm:' + m.id, t: '📏 ' + (m.name || 'Površina'), ring: () => m.pts.map(p => [p.lat, p.lng]) }));
    (typeof kmlLs !== 'undefined' ? kmlLs : []).forEach(k => k && k.grp && k.grp.eachLayer(function walk(l) {
      if (l.eachLayer && !l.getLatLngs) { l.eachLayer(walk); return; }
      if (!l._kmlIsPolygon) return;
      out.push({ k: 'k:' + L.stamp(l), t: '🗺 ' + (l._kmlName || 'KML poligon'), ring: () => { let ll = l.getLatLngs(); while (Array.isArray(ll[0])) ll = ll[0]; return ll.map(p => [p.lat, p.lng]); } });
    }));
    return out;
  }


  // ── DEM: dominantan pad poligona ─────────────────────────────────────
  async function padPoligona(ring) {
    if (typeof window.npVisinaNa !== 'function' || typeof npMreza !== 'function') return null;
    const pov = npPovrsina(ring), { tacke } = npMreza(ring, Math.max(20, Math.sqrt(pov / 60)));
    const D = 45, grad = [];
    for (let i = 0; i < tacke.length; i += 8) {
      const dio = tacke.slice(i, i + 8);
      const r = await Promise.all(dio.map(async p => {
        try {
          const [e, w, n, s] = await Promise.all([npPomak(p, 90, D), npPomak(p, 270, D), npPomak(p, 0, D), npPomak(p, 180, D)].map(q => npVisinaNa(q[0], q[1])));
          return [(e - w) / (2 * D), (n - s) / (2 * D)];
        } catch (err) { return [NaN, NaN]; }
      }));
      grad.push(...r);
    }
    return slDominantniPad(grad);
  }
  // Lokalni pad (±45 m, kao Nagib poligona); keš po ~5 m da trasa i provjera ne ponavljaju DEM.
  const padKes = new Map();
  async function padNa(q) {
    const k = q[0].toFixed(5) + ',' + q[1].toFixed(5);
    if (padKes.has(k)) return padKes.get(k);
    let r = null;
    try {
      const D = 45, [e, w, n, s] = await Promise.all([npPomak(q, 90, D), npPomak(q, 270, D), npPomak(q, 0, D), npPomak(q, 180, D)].map(x => npVisinaNa(x[0], x[1])));
      if ([e, w, n, s].every(Number.isFinite)) r = npAzimutPada(e, w, n, s, D);
    } catch (err) {}
    if (padKes.size > 20000) padKes.clear();
    padKes.set(k, r); return r;
  }
  // Pad zaglađen na ~150 m (centar + 4 tačke na 60 m): DEM je model površine s
  // krošnjama, pa je smjer iz ±45 m na blagom nagibu šum.
  async function padGlatko(q) {
    const t = [q, npPomak(q, 0, 60), npPomak(q, 90, 60), npPomak(q, 180, 60), npPomak(q, 270, 60)];
    let gx = 0, gy = 0, n = 0;
    for (const x of t) { const s = await padNa(x); if (!s) continue; const tg = Math.tan(s.nagib * Math.PI / 180), r = s.azimut * Math.PI / 180; gx += Math.sin(r) * tg; gy += Math.cos(r) * tg; n++; }
    if (!n) return null;
    gx /= n; gy /= n;
    return { azimut: (Math.atan2(gx, gy) * 180 / Math.PI + 360) % 360, nagib: Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI };
  }
  // Provjera: uzorak svakih ~40 m duž linije, odstupanje pravca od zaglađenog pada.
  async function provjeriPravac(lin) {
    const g = slGeo(lin), uz = [], tl = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i], az = slAzimut(a, b), n = Math.max(1, Math.round(slDuzina([a, b]) / 40));
      for (let j = 0; j < n; j++) {
        const s = await padGlatko(tl(a, b, (j + 0.5) / n));
        if (s) uz.push({ dev: slOdstupanje(az, s.azimut), nagib: s.nagib, p0: tl(a, b, j / n), p1: tl(a, b, (j + 1) / n) });
      }
    }
    const o = slOcjenaPravca(uz);
    lin.izo = o && o.udio >= 0.25 ? { udio: o.udio, max: o.max } : null;
    // crveno se crta samo dio koji ne ide uz padinu (kratki komad < 80 m samo kad je linija označena)
    const d = slIzoDijelovi(uz).filter(x => lin.izo || slDuzina(x) >= 80);
    if (d.length) lin.izoGeo = d; else delete lin.izoGeo;
  }
  // Plohe gdje linije ne idu uz padinu: mreža ~20–40 m, pravac najbliže linije prema zaglađenom padu
  // (> 45°, nagib ≥ 8 %) → obris ćelija (slTrakaObris). p.izoPlohe [prsten], p.izoPloheHa.
  async function racunajPlohe(p) {
    const ring = p.ring, c0 = ring.reduce((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0]), Lc = slLokalno(c0[0], c0[1]);
    const poly = ring.map(q => Lc.u(q[0], q[1])), ha = slPovrsinaXY(poly) / 1e4, k = Math.max(20, Math.min(40, Math.sqrt(ha * 1e4 / 500)));
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), nx = Math.ceil((Math.max(...xs) - x0) / k), ny = Math.ceil((Math.max(...ys) - y0) / k);
    const seg = []; p.linije.forEach(l => { const g = slGeo(l).map(q => Lc.u(q[0], q[1])); for (let i = 1; i < g.length; i++) seg.push([g[i - 1], g[i], slAzimut(slGeo(l)[i - 1], slGeo(l)[i])]); });
    const c = new Uint8Array(nx * ny).fill(255); let los = 0, n = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * k, y = y0 + (j + 0.5) * k, ll = Lc.n(x, y);
      if (!slUnutra(ll, ring)) continue;
      c[j * nx + i] = 0;
      if (!seg.length) continue;
      if (++n % 25 === 0) status('⏳ Plohe gdje linije ne idu uz stranu… ' + Math.round((j * nx + i) / (nx * ny) * 100) + ' %');
      let naj = Infinity, az = 0;
      for (const [a, b, z] of seg) { const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2)), d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey); if (d < naj) { naj = d; az = z; } }
      const s = await padGlatko(ll);
      if (s && s.nagib >= SL_NAGIB_MIN && slOdstupanje(az, s.azimut) > 45) { c[j * nx + i] = 1; los++; }
    }
    p.izoPlohe = los ? slTrakaObris(ring, [], 1, { c, nx, ny, k, x0, y0, L: Lc }) : [];
    p.izoPloheHa = los * k * k / 1e4;
  }

  async function visina(p) { try { const h = await npVisinaNa(p[0], p[1]); return Number.isFinite(h) ? Math.round(h) : null; } catch (e) { return null; } }

  // Alternativni prikaz: mreža visina (korak 12–25 m, ±3 ćelije oko poligona za gradijent na rubu)
  // → padine (slPadineMreza) → podjela poligona po grebenima/jarcima. null = nema DEM-a.
  async function citajPadine(p) {
    if (typeof window.npVisinaNa !== 'function') return null;
    const ring = p.ring, lat0 = ring.reduce((a, q) => a + q[0], 0) / ring.length, lon0 = ring.reduce((a, q) => a + q[1], 0) / ring.length;
    const Lc = slLokalno(lat0, lon0), poly = ring.map(q => Lc.u(q[0], q[1])), ha = slPovrsinaXY(poly) / 1e4;
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]), sir = Math.max(...xs) - Math.min(...xs), vis = Math.max(...ys) - Math.min(...ys);
    let s = Math.max(12, Math.min(25, Math.sqrt(ha * 1e4 / 700)));
    while ((sir / s + 7) * (vis / s + 7) > 9000) s *= 1.2;
    const x0 = Math.min(...xs) - 3 * s, y0 = Math.min(...ys) - 3 * s, nx = Math.ceil(sir / s) + 7, ny = Math.ceil(vis / s) + 7, N = nx * ny;
    const z = new Float64Array(N).fill(NaN), unutra = new Uint8Array(N), ll = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = Lc.n(x0 + i * s, y0 + j * s); ll.push(q); unutra[j * nx + i] = slUnutra(q, ring) ? 1 : 0; }
    let dem = 0;
    for (let c = 0; c < N; c += 96) {
      status('⏳ Čitam teren (visine, padine)… ' + Math.round(c / N * 100) + ' %');
      const r = await Promise.all(ll.slice(c, c + 96).map(q => npVisinaNa(q[0], q[1]).catch(() => NaN)));
      r.forEach((h, k) => { if (Number.isFinite(h)) { z[c + k] = h; dem++; } });
    }
    if (dem < N * 0.5) return null;
    const minHa = Math.max(0.8, 0.1 * ha, 2.5 * p.razmak * p.razmak / 1e4);
    const r = slPadineMreza(z, nx, ny, s, unutra, Math.round(minHa * 1e4 / (s * s)));
    const geo = (i, j) => Lc.n(x0 + i * s, y0 + j * s);
    const regije = r.regije.map(q => {
      const t = []; for (let c = 0; c < N; c++) if (r.labela[c] === q.id) t.push(ll[c]);
      const korak = Math.max(1, Math.floor(t.length / 150));
      return { ...q, tacke: t.filter((_, k) => k % korak === 0) };
    });
    const granice = r.granice.map(g => {
      const lin = slGranicaLinija(g.tacke.map(([i, j]) => [i * s, j * s]), s);
      return { a: g.a, b: g.b, tip: g.greben > 1.5 * g.jarak ? 'greben' : g.jarak > 1.5 * g.greben ? 'jarak' : 'prelom', geo: lin ? slUprosti(lin.map(([x, y]) => geo(x / s, y / s)), s / 2) : null };
    });
    const raz = regije.length > 1 ? slRazdijeli(ring, regije, granice, 2.5 * s, minHa * 0.6) : { dijelovi: [{ ring, ids: regije.map(q => q.id) }], granice: [] };
    const dijelovi = raz.dijelovi.map(d => {
      const rs = regije.filter(q => d.ids.includes(q.id)), zb = rs.reduce((a, q) => ({ sx: a.sx + q.sx, sy: a.sy + q.sy, sm: a.sm + q.sm, sn: a.sn + q.sn, n: a.n + q.n }), { sx: 0, sy: 0, sm: 0, sn: 0, n: 0 }), st = slPadineStat(zb);
      const c = d.ring.reduce((a, q) => [a[0] + q[0] / d.ring.length, a[1] + q[1] / d.ring.length], [0, 0]);
      return { ring: d.ring, az: Math.round(st.azimut) % 360, azDem: Math.round(st.azimut) % 360, nagibPct: Math.round(st.nagibPct), dosljednost: st.dosljednost,
        hMin: Math.round(Math.min(...rs.map(q => q.hMin))), hMax: Math.round(Math.max(...rs.map(q => q.hMax))), ha: slRingHa(d.ring), c, izbrisane: [] };
    }).sort((a, b) => a.c[1] - b.c[1]); // zapad → istok
    return { dijelovi, granice: raz.granice.map(g => ({ geo: g.geo, tip: g.tip })), korak: s };
  }

  // ── Projekat ─────────────────────────────────────────────────────────
  async function napravi(ring, naziv) {
    if (!ring || ring.length < 3) { showToast('⚠ Poligon nije ispravan'); return; }
    status('⏳ Računam smjer pada iz DEM-a…');
    const pad = await padPoligona(ring);
    const p = { id: 'sl_' + Date.now().toString(36), naziv: naziv || 'Sječa', datum: new Date().toISOString(), ring, razmak: 60,
      tPlan: Date.now(), az: pad ? Math.round(pad.azimut) : 0, azDem: pad ? Math.round(pad.azimut) : null, dosljednost: pad ? pad.dosljednost : null, nagibSt: pad ? pad.nagibSt : 0, linije: [] };
    if (!pad) showToast('⚠ Nema DEM-a za ovo područje — postavi azimut pada ručno');
    else p.padine = await citajPadine(p);
    await generisi(p);
    if (p.padine && p.padine.dijelovi.length > 1) showToast('⛰ Teren ima ' + p.padine.dijelovi.length + ' padine — vidi Alternativni prikaz');
    const l = citaj(); l.unshift(p); pisi(l);
    aktivni = p.id; crtaj(); render(); zoom(p.id);
  }
  // Linije jednog dijela (poligon ili drugi dio iza sjekačke linije): ključevi + prenos
  // statusa, radnika, ručnog loma i stvarne (GPS) linije sa starih linija istog id-a.
  function linijeDijela(r, prefiks, stari) {
    return r.linije.map(x => {
      const id = prefiks + x.k + '.' + x.dio, s = stari.get(id) || {}, o = { ...x, id, status: s.status || 'ne', radnik: s.radnik || '' };
      if (s.t) o.t = s.t;
      if (prefiks === 'z:') o.zona = 1;
      for (const k of ['geo', 'stvarna', 'trag']) if (slIma(s[k])) o[k] = s[k];
      const g = slIma(o.stvarna) ? o.stvarna : slIma(o.geo) ? o.geo : null;
      if (g) { o.dno = g[0]; o.vrh = g[g.length - 1]; o.duz = slDuzina(g); }
      return o;
    });
  }
  const sredina = x => { const g = slGeo(x), m = g[Math.floor(g.length / 2)], n = g[Math.max(0, Math.floor(g.length / 2) - 1)]; return g.length > 2 ? m : [(n[0] + m[0]) / 2, (n[1] + m[1]) / 2]; };
  async function lepeza(p, linije, ring) {
    // smjer pada u pojasu svake linije (±⅓ širine, svakih 40 m), ograničeno skretanje susjeda
    const red = linije.slice().sort((a, b) => a.k - b.k || a.dio - b.dio), zeljeni = [], pola = [];
    let i = 0;
    for (const x of red) {
      status('⏳ Smjer pada po linijama… ' + (++i) + '/' + red.length);
      const sj = [(x.dno[0] + x.vrh[0]) / 2, (x.dno[1] + x.vrh[1]) / 2], Lx = slLokalno(sj[0], sj[1]);
      const d = slSmjer(slAzimut(x.vrh, x.dno)), nrm = [-d[1], d[0]], m = Math.max(2, Math.round(x.duz / 40)), grad = [];
      for (let j = 0; j <= m; j++) for (const o of [-p.razmak / 3, 0, p.razmak / 3]) {
        const t = (j / m - 0.5) * x.duz, q = Lx.n(d[0] * t + nrm[0] * o, d[1] * t + nrm[1] * o);
        if (!slUnutra(q, ring)) continue;
        const s = await padNa(q); if (!s) continue;
        const tg = Math.tan(s.nagib * Math.PI / 180), r = s.azimut * Math.PI / 180;
        grad.push([-Math.sin(r) * tg, -Math.cos(r) * tg]);
      }
      const dp = slDominantniPad(grad);
      zeljeni.push(dp ? dp.azimut : p.az); pola.push(x.duz / 2 + p.razmak);
    }
    // zarotirana linija se drugačije odsiječe (može biti duža) → provjeri stvarni razmak
    // susjeda cijelom dužinom i parovima koji se sabiju ispod 60 % smanji skretanje
    const sjeme = red.map(x => [(x.dno[0] + x.vrh[0]) / 2, (x.dno[1] + x.vrh[1]) / 2]), fak = red.map(() => 1);
    let az = [], segs = [];
    for (let it = 0; it < 12; it++) {
      az = slLepeza(zeljeni, pola, p.razmak, p.az, fak);
      segs = red.map((x, j) => slLinijaKroz(ring, sjeme[j], az[j]));
      let ok = true;
      for (let j = 0; j + 1 < red.length; j++) {
        if (!segs[j] || !segs[j + 1] || red[j].k === red[j + 1].k) continue;
        if (slMinRazmak(segs[j], segs[j + 1]) < 0.6 * p.razmak) { fak[j] *= 0.6; ok = false; }
      }
      if (ok) break;
      if (it === 11) { az = red.map(() => p.az); segs = red.map((x, j) => slLinijaKroz(ring, sjeme[j], p.az)); }
    }
    red.forEach((x, j) => {
      const seg = segs[j];
      if (seg && slDuzina(seg) >= Math.min(SL_MIN_DUZ, x.duz)) { x.teren = seg; x.azTeren = Math.round(az[j]); if (!slIma(x.geo) && !slIma(x.stvarna)) { x.dno = seg[0]; x.vrh = seg[1]; x.duz = slDuzina(seg); } }
    });
  }
  // Spajanje bliskih linija susjednih padina u jednu (p.spoj × razmak, zadano ½; 0 = isključeno), glatko
  // (slSpojiGlatko). Spajaju se samo linije bez stanja (status, radnik, lom, GPS) — stanje ima spojena
  // linija (id m:…). Slobodni krajevi na granici padina produžuju se do ruba poligona (slProduzi).
  // Komponente (`komp`) ostaju za obris partije i brisanje; dno = niži kraj.
  // Površine: po padini (partije se ne spajaju preko grebena), produžeci uzimaju dio susjedne (slPoljaPadine).
  const SL_SPOJ = 0.5, spojFak = p => (p.spoj != null ? p.spoj : SL_SPOJ);
  async function spojiPadine(p, dijelovi, stari) {
    const R = p.razmak, D = p.brojanje === 'D', sve = dijelovi.flatMap(d => d.linije), cist = x => !['geo', 'stvarna', 'trag'].some(k => slIma(x[k]));
    const kand = sve.filter(x => !x.dio && x.status === 'ne' && !x.radnik && cist(x));
    const lanci = slSpojiLinije(kand.map(x => ({ padina: x.padina, geo: slGeo(x) })), p.padine.granice.map(g => g.geo), spojFak(p) * R).filter(l => l.length > 1);
    // jedinica = spojeni lanac ili samostalna linija; komponenta: geo u SVOM smjeru (dno→vrh), obrni = smjer u lancu
    const ukloni = new Set(), jed = [];
    for (const l of lanci) jed.push({ spoj: true, prod: true, komp: l.map(({ i, obrni }) => { ukloni.add(kand[i]); return { x: kand[i], obrni, geo: slGeo(kand[i]) }; }) });
    for (const x of sve) if (!ukloni.has(x) && !x.dio) jed.push({ prod: cist(x), komp: [{ x, obrni: false, geo: slGeo(x) }] });
    const lancGeo = j => slSpojiGeo(j.komp.map(c => (c.obrni ? c.geo.slice().reverse() : c.geo)));
    // produženje slobodnih krajeva do ruba poligona
    status('⏳ Produžujem linije do ruba…');
    const fiksne = sve.filter(x => x.dio).map(slGeo), ext = dijelovi.map(() => []);
    for (const j of jed) if (j.prod) for (const kraj of [0, 1]) {
      const c = kraj ? j.komp[j.komp.length - 1] : j.komp[0], vk = kraj ^ (c.obrni ? 1 : 0);
      const g2 = slProduzi(c.geo, vk, p.ring, fiksne.concat(jed.filter(o => o !== j).map(lancGeo)), 2 * R, 0.4 * R);
      if (!g2) continue;
      ext[c.x.padina].push(vk ? g2.slice(-2) : g2.slice(0, 2)); c.geo = g2;
    }
    jed.filter(j => !j.spoj).forEach(({ komp: [c] }) => { if (c.geo.length !== slGeo(c.x).length) { const x = c.x; x.spoj = c.geo; x.dno = c.geo[0]; x.vrh = c.geo[c.geo.length - 1]; x.duz = slDuzina(c.geo); } });
    // jedinstven smjer i redoslijed preko padina (s lijeva nadesno gledano kao prva padina; D = zdesna)
    const flip = slOrijentacija(dijelovi.length, jed.filter(j => j.spoj).map(j => j.komp.map(c => ({ padina: c.x.padina, obrni: c.obrni }))));
    const poPadini = dijelovi.map((d, i) => jed.flatMap(j => j.komp.filter(c => c.x.padina === i).map(c => ({ j, c }))).sort((a, b) => a.c.x.k - b.c.x.k));
    const obr = i => flip[i] !== D; // niz padine u redoslijedu numeracije je obrnut lokalnom (lijevo→desno uzbrdo)
    const red = slRedoslijed(poPadini.map((n, i) => (obr(i) ? n.slice().reverse() : n).map(o => jed.indexOf(o.j))));
    jed.forEach(j => { j.br = red.indexOf(jed.indexOf(j)) + 1; j.ha = 0; j.partija = []; });
    // površine: trake po padini (komponente u svom smjeru), traka m (u redu numeracije) → m-ta linija;
    // traka iza zadnje linije padine → sljedeća linija ako dodiruje padinu, inače ostatak do granice
    status('⏳ Površine partija…');
    const S = slPoljaPadine(dijelovi.map((d, i) => ({ ring: d.ring, geos: poPadini[i].map(o => o.c.geo), ext: ext[i] })), R);
    const poBr = new Map(jed.map(j => [j.br, j])), zatvoren = d => d.ring.concat([d.ring[0]]);
    p.ostatakHa = 0;
    dijelovi.forEach((d, i) => {
      const n = poPadini[i].length, o = obr(i), niz = o ? poPadini[i].slice().reverse() : poPadini[i], lok = m => (o ? n - m : m);
      niz.forEach(({ j }, m) => { j.ha += S[i][lok(m)]; j.partija.push([i, lok(m)]); });
      const rep = S[i][lok(n)], sl = n ? poBr.get(niz[n - 1].j.br + 1) : null;
      if (sl && slMinRazmak(lancGeo(sl), zatvoren(d)) <= 0.5 * R) { sl.ha += rep; sl.partija.push([i, lok(n)]); } else p.ostatakHa += rep;
    });
    for (const j of jed) if (!j.spoj) { const x = j.komp[0].x; x.br = j.br; x.ha = j.ha; x.partija = j.partija; }
    for (const j of jed.filter(o => o.spoj)) {
      const komp = j.komp.map(c => ({ id: c.x.id, padina: c.x.padina, k: c.x.k, geo: c.geo }));
      const geo = slSpojiGlatko(j.komp.map(c => (c.obrni ? c.geo.slice().reverse() : c.geo)), Math.min(0.5 * R, 30)), h0 = await visina(geo[0]), h1 = await visina(geo[geo.length - 1]);
      if (h0 != null && h1 != null && h0 > h1) geo.reverse();
      const prvi = komp.reduce((a, c) => (c.padina < a.padina ? c : a)), id = 'm:' + komp.map(c => c.id).sort().join('+'), s = stari.get(id) || {};
      const o = { id, k: prvi.k, dio: 0, br: j.br, padina: prvi.padina, komp, spoj: geo, dno: geo[0], vrh: geo[geo.length - 1], duz: slDuzina(geo),
        status: s.status || 'ne', radnik: s.radnik || '', ha: j.ha, partija: j.partija };
      if (s.t) o.t = s.t;
      for (const k of ['geo', 'stvarna', 'trag']) if (slIma(s[k])) o[k] = s[k];
      const g = slIma(o.stvarna) ? o.stvarna : slIma(o.geo) ? o.geo : null;
      if (g) { o.dno = g[0]; o.vrh = g[g.length - 1]; o.duz = slDuzina(g); }
      dijelovi[prvi.padina].linije.push(o);
    }
    dijelovi.forEach(d => { d.linije = d.linije.filter(x => !ukloni.has(x)); });
    // komadi (dio > 0) dijele broj s linijom iste padine i položaja
    const brK = new Map(); jed.forEach(j => j.komp.forEach(c => brK.set(c.x.padina + ':' + c.x.k, j.br)));
    sve.filter(x => x.dio).forEach(x => { x.br = brK.get(x.padina + ':' + x.k) || jed.length + 1; x.ha = null; x.partija = null; });
  }
  // površina partije: stvarne linije se računaju kao da dosežu granicu
  const trake = d => { status('⏳ Površine partija…'); return slPoljaTeren(d.ring, d.linije.filter(x => !x.dio).sort((a, b) => a.k - b.k).map(slGeo)); };
  async function generisi(p) {
    const r = slLinije(p.ring, p.az, p.razmak, p.opt !== false, p.izbrisane, false);
    // id = položaj linije (ne redni broj) → status i radnik ostaju uz liniju i kad se prenumeriše
    const stari = new Map((p.linije || []).map(x => [x.id, x]));
    const osnovne = linijeDijela(r, '', stari), alt = p.prikaz === 'padine' && p.padine && p.padine.dijelovi.length > 1;
    p.ha = r.ha; p.korak = r.korak; p.optInfo = r.opt; delete p.polja;
    if (p.plan === 'teren' && !alt) await lepeza(p, osnovne, p.ring);
    // Drugi dio odjela (druga ekspozicija) iza izabrane sjekačke linije: svoj pad iz DEM-a,
    // linije završavaju na toj sjekačkoj liniji (ona je granica dijela), ne na granici poligona.
    let dijelovi = [{ ring: p.ring, linije: osnovne }];
    if (p.prikaz === 'padine' && p.padine && p.padine.dijelovi.length > 1) {
      // Alternativni prikaz: svaka padina svoj pad; linije završavaju na grebenu/jarku
      dijelovi = [];
      for (const [di, d] of p.padine.dijelovi.entries()) {
        const r2 = slLinije(d.ring, d.az, p.razmak, p.opt !== false, d.izbrisane, false), lin = linijeDijela(r2, 'p' + di + ':', stari);
        lin.forEach(x => { x.padina = di; });
        // padina s krivim izohipsama: kad paralelne linije ne prate pad, ta padina dobija lepezu
        d.lepeza = p.plan === 'teren';
        if (!d.lepeza) { status('⏳ Provjera pada padine P' + (di + 1) + '…'); for (const x of lin) await provjeriPravac(x); d.lepeza = lin.some(x => x.izo); }
        if (d.lepeza) await lepeza({ razmak: p.razmak, az: d.az }, lin, d.ring);
        d.optInfo = r2.opt; dijelovi.push({ ring: d.ring, linije: lin });
      }
      p.optInfo = null;
      // spajanje, produženje do ruba i površine (partije se ne spajaju preko grebena)
      await spojiPadine(p, dijelovi, stari);
    } else if (p.zona) {
      const raz = osnovne.find(x => x.id === p.zona.lid), pod = raz && slPodijeli(p.ring, slGeo(raz));
      if (!pod) { p.zona = null; showToast('⚠ Podjela uklonjena — sjekačka linija za podjelu više ne postoji'); }
      else {
        const zRing = p.zona.strana === 'L' ? pod.lijevo : pod.desno, aRing = p.zona.strana === 'L' ? pod.desno : pod.lijevo;
        if (p.zona.az == null) { status('⏳ Pad drugog dijela iz DEM-a…'); const pd = await padPoligona(zRing); p.zona.az = p.zona.azDem = pd ? Math.round(pd.azimut) : p.az; }
        const zr = slLinije(zRing, p.zona.az, p.razmak, p.opt !== false, p.zona.izbrisane, false);
        const zLin = linijeDijela(zr, 'z:', stari);
        const aLin = osnovne.filter(x => x === raz || slUnutra(sredina(x), aRing));
        p.zona.ha = zr.ha; p.zona.optInfo = zr.opt;
        const A = { ring: aRing, linije: aLin }, Z = { ring: zRing, linije: zLin };
        dijelovi = p.zona.strana === 'L' ? [Z, A] : [A, Z];
      }
    }
    // numeracija preko svih dijelova s lijeva nadesno; komadi iste linije dijele broj (padine: spojiPadine)
    const red = [];
    dijelovi.forEach((d, di) => d.linije.slice().sort((a, b) => a.k - b.k || a.dio - b.dio).forEach(x => red.push({ x, di })));
    if (!alt) {
      let br = 0, pk = null;
      red.forEach(({ x, di }) => { const kl = di + ':' + x.k; if (kl !== pk) { br++; pk = kl; } x.br = br; delete x.partija; });
      if (p.brojanje === 'D') red.forEach(({ x }) => { x.br = br + 1 - x.br; });
    }
    p.linije = red.map(o => o.x).sort((a, b) => a.br - b.br || a.dio - b.dio);
    // površina partije po liniji (stvarne linije se računaju kao da dosežu granicu)
    p.linije.forEach(x => { if (x.dio) x.ha = null; });
    if (!alt) {
      const S = slSpojiTrake(dijelovi.map(trake));
      const lr = red.map(o => o.x).filter(x => !x.dio), pov = slTrakeULinije(S, p.brojanje === 'D');
      lr.forEach((x, j) => { x.ha = pov.poLiniji[j]; });
      p.ostatakHa = pov.ostatak;
    }
    status('⏳ Provjera pravca prema padu…');
    for (const x of p.linije) {
      if (slIma(x.stvarna)) { x.izo = null; continue; }
      await provjeriPravac(x); // crveni dijelovi na prikazanoj (spojenoj) geometriji
      if (!x.komp || slIma(x.geo)) continue;
      // spojena: oznaka po najgorem dijelu (duža linija bi razvodnila dio po izohipsi)
      x.izo = null;
      for (const c of x.komp) { const t = { geo: c.geo }; await provjeriPravac(t); if (t.izo && (!x.izo || t.izo.udio > x.izo.udio)) x.izo = t.izo; }
    }
    status('⏳ Visine krajeva linija…');
    for (const x of p.linije) { x.hDno = await visina(x.dno); x.hVrh = await visina(x.vrh); }
    if (p.plohe) await racunajPlohe(p); else delete p.izoPlohe;
    status('');
  }
  function nadji(id) { return citaj().find(x => x.id === id); }
  const dodirni = lin => { lin.t = Date.now(); };          // stanje linije (spajanje po liniji)
  const planIzmjena = p => { p.tPlan = Date.now(); };      // raspored linija (spajanje po projektu)
  function sacuvaj(p) { const l = citaj(), i = l.findIndex(x => x.id === p.id); if (i >= 0) l[i] = p; else l.unshift(p); return pisi(l); }

  // ── Karta ────────────────────────────────────────────────────────────
  const zadnjiBr = p => p.linije.reduce((m, x) => Math.max(m, x.br || 0), 0);
  function oznaka(lin) { return 'L' + lin.br + (lin.dio ? String.fromCharCode(97 + lin.dio) : ''); }
  function crtaj() {
    grp.clearLayers(); natpisi = [];
    citaj().filter(p => p.vidljiv !== false).forEach(p => {
      const akt = p.id === aktivni;
      L.polygon(p.ring, { pane: 'sjekackePane', color: '#fde68a', weight: akt ? 2.5 : 1.5, dashArray: '6 4', fill: false, interactive: false }).addTo(grp);
      const vodiOvdje = vodic && vodic.pid === p.id;
      if (altAktivan(p)) {
        p.padine.granice.forEach(g => {
          if (!slIma(g.geo)) return;
          L.polyline(g.geo, { pane: 'sjekackePane', color: '#0b1220', weight: 6, opacity: 0.45, interactive: false }).addTo(grp);
          L.polyline(g.geo, { pane: 'sjekackePane', color: g.tip === 'jarak' ? '#7dd3fc' : '#f5f5f4', weight: 2.5, dashArray: '2 7', lineCap: 'round', interactive: false }).addTo(grp);
          if (akt && !vodiOvdje) natpisi.push({ ll: g.geo[Math.floor(g.geo.length * 0.4)], t: g.tip === 'greben' ? '⛰ greben' : g.tip === 'jarak' ? '〰 jarak' : 'prelom', cls: 'sl-gran', prio: 20 });
        });
        if (akt && !vodiOvdje) p.padine.dijelovi.forEach((d, i) => natpisi.push({ ll: d.c, t: imeP(d, i) + ' ↘ ' + d.nagibPct + ' %', cls: 'sl-pad', prio: 60 }));
      }
      if (p.plohe && (p.izoPlohe || []).length) L.polygon(p.izoPlohe, { pane: 'sjekackePane', color: '#ef4444', weight: 1.5, opacity: 0.9, fillColor: '#ef4444', fillOpacity: p.plohaOp != null ? p.plohaOp : 0.35, fillRule: 'evenodd', interactive: false }).addTo(grp);
      p.linije.forEach(lin => {
        const s = STATUS[lin.status] || STATUS.ne, vodi = vodiOvdje && vodic.lid === lin.id;
        if (ured && ured.pid === p.id && ured.lid === lin.id) return; // crta ga uređivač
        const prig = vodiOvdje && !vodi ? 0.35 : 1, stv = slIma(lin.stvarna);
        L.polyline(slGeo(lin), { pane: 'sjekackePane', color: '#0b1220', weight: vodi ? 11 : 6, opacity: 0.55 * prig, interactive: false }).addTo(grp);
        // plan isprekidano, stvarna (GPS) linija puna
        L.polyline(slGeo(lin), { pane: 'sjekackePane', color: vodi ? '#fde047' : s.c, weight: vodi ? 6 : 3, opacity: prig, dashArray: stv || vodi ? null : '10 6', interactive: false }).addTo(grp);
        if (!vodiOvdje && !stv) (lin.izoGeo || []).forEach(d => L.polyline(d, { pane: 'sjekackePane', color: '#ef4444', weight: 4, opacity: 1, interactive: false }).addTo(grp));
        if (vodi) strelice(lin);
        if (akt || vodi || map.getZoom() >= 15) {
          // broj na oba kraja: radnik koji kreće odozdo i onaj koji provjerava s vrha vide istu oznaku
          L.circleMarker(lin.dno, { pane: 'sjekackePane', radius: 4, color: '#fff', weight: 1.5, fillColor: s.c, fillOpacity: 1, interactive: false }).addTo(grp);
          const g = slGeo(lin);
          natpisi.push({ ll: lin.dno, od: g[1], t: oznaka(lin), c: s.c, op: prig, prio: vodi ? 100 : 50 - lin.br / 1000, tacka: 1 });
          natpisi.push({ ll: lin.vrh, od: g[g.length - 2], t: oznaka(lin) + ' ▲', c: s.c, op: prig * 0.9, prio: vodi ? 90 : 30 - lin.br / 1000, tacka: 1 });
        }
      });
      if (vodiOvdje && slIma(vodic.trag)) L.polyline(vodic.trag, { pane: 'sjekackePane', color: '#22d3ee', weight: 4, opacity: 1, interactive: false }).addTo(grp);
    });
    postaviNatpise();
  }
  // Natpisi bez preklapanja: po prioritetu (vođena linija, padine, dno, granice, vrh) svaki
  // dobija prvi slobodan položaj — produžetak linije van kraja (bliže pa dalje), pa bočno;
  // ako nijedan nije slobodan, ne crta se (vidi se na većem zumu). Tačke krajeva su prepreke.
  let mjera = null;
  const sirina = t => { try { mjera = mjera || document.createElement('canvas').getContext('2d'); mjera.font = '800 11px system-ui, sans-serif'; return mjera.measureText(t).width + 14; } catch (e) { return t.length * 7 + 14; } };
  function postaviNatpise() {
    lblGrp.clearLayers();
    const zauzeto = [], H = 18, sijece = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    for (const n of natpisi) if (n.tacka) { const q = map.latLngToLayerPoint(n.ll); zauzeto.push([q.x - 5, q.y - 5, q.x + 5, q.y + 5]); }
    natpisi.slice().sort((a, b) => b.prio - a.prio).forEach(n => {
      const q = map.latLngToLayerPoint(n.ll), w = sirina(n.t);
      let ux = 0, uy = 1; // smjer van kraja linije (od susjedne tačke prema kraju)
      if (n.od) { const o = map.latLngToLayerPoint(n.od), d = Math.hypot(q.x - o.x, q.y - o.y); if (d > 0.5) { ux = (q.x - o.x) / d; uy = (q.y - o.y) / d; } }
      const centri = n.od ? [9, 9 + H, 9 + 2 * H].map(r => [ux * (r + Math.abs(ux) * w / 2), uy * (r + Math.abs(uy) * H / 2)])
        .concat([[-uy * (w / 2 + 8), ux * (H / 2 + 8)], [uy * (w / 2 + 8), -ux * (H / 2 + 8)]]) : [[0, 0], [0, H + 2], [0, -H - 2]];
      for (const [cx, cy] of centri) {
        const box = [q.x + cx - w / 2, q.y + cy - H / 2, q.x + cx + w / 2, q.y + cy + H / 2];
        if (zauzeto.some(z => z !== null && sijece(z, box) && !(n.tacka && Math.abs(z[0] + 5 - q.x) < 0.5 && Math.abs(z[1] + 5 - q.y) < 0.5))) continue;
        zauzeto.push(box);
        L.marker(n.ll, { pane: 'sjekackePane', interactive: false, opacity: n.op == null ? 1 : n.op, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl${n.cls ? ' ' + n.cls : ''}" style="${n.c ? '--c:' + n.c + ';' : ''}transform:translate(${(cx - w / 2).toFixed(1)}px,${(cy - H / 2).toFixed(1)}px)">${esc(n.t)}</span>` }) }).addTo(lblGrp);
        break;
      }
    });
  }
  // strelice uzbrdo svakih ~60 m duž linije koju radnik prati
  function strelice(lin) {
    const g = slGeo(lin), uk = slDuzina(g); let put = 0;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i], dl = slDuzina([a, b]), az = slAzimut(a, b);
      for (let t = Math.ceil(put / 60) * 60 - put; t < dl; t += 60) {
        if (put + t < 20 || uk - put - t < 20) continue;
        const f = t / dl, q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        L.marker(q, { pane: 'sjekackePane', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-strel" style="transform:translate(-50%,-50%) rotate(${az.toFixed(0)}deg)">▲</span>` }) }).addTo(grp);
      }
      put += dl;
    }
  }
  let zZadnji = map.getZoom();
  map.on('zoomend', () => { const z = map.getZoom(); if ((z >= 15) !== (zZadnji >= 15)) crtaj(); else postaviNatpise(); zZadnji = z; });
  if (typeof _kartaKlikIzvor === 'function') _kartaKlikIzvor((ll, kp) => {
    const out = [];
    citaj().filter(p => p.vidljiv !== false).forEach(p => p.linije.forEach(lin => {
      out.push({ vrsta: 'linija', d: _pxDoLinije(kp, slGeo(lin).map(q => L.latLng(q[0], q[1]))), otvori: at => popup(p, lin, at) });
    }));
    return out;
  });
  // Dijelovi projekta kao u generisi (iz sačuvanih linija): poligon partije na klik linije.
  function dijeloviProjekta(p) {
    const sortiraj = l => l.filter(x => !x.dio).sort((a, b) => a.k - b.k);
    // spojena linija se razlaže na komponente po padinama (vlasnik = id spojene)
    if (altAktivan(p)) return { alt: true, d: p.padine.dijelovi.map((d, i) => ({ ring: d.ring, linije: sortiraj(p.linije.flatMap(x => x.komp ? x.komp.filter(c => c.padina === i).map(c => ({ ...c, dio: 0, vlasnik: x.id })) : x.padina === i ? [x] : [])) })) };
    if (p.zona) {
      const raz = p.linije.find(x => x.id === p.zona.lid), pod = raz && slPodijeli(p.ring, slGeo(raz));
      if (pod) {
        const zR = p.zona.strana === 'L' ? pod.lijevo : pod.desno, aR = p.zona.strana === 'L' ? pod.desno : pod.lijevo;
        const A = { ring: aR, linije: sortiraj(p.linije.filter(x => !x.zona)) }, Z = { ring: zR, linije: sortiraj(p.linije.filter(x => x.zona)) };
        return { spajaj: true, d: p.zona.strana === 'L' ? [Z, A] : [A, Z] };
      }
    }
    return { spajaj: true, d: [{ ring: p.ring, linije: sortiraj(p.linije) }] };
  }
  const partijaGrp = L.layerGroup().addTo(map);
  function prikaziPartiju(p, lin) {
    partijaGrp.clearLayers(); partijaT = Date.now();
    if (lin.dio) return;
    try {
      const D = dijeloviProjekta(p), c = (STATUS[lin.status] || STATUS.ne).c, dd = D.d.map(d => ({ ring: d.ring, geos: d.linije.map(slGeo) })), prst = [];
      // padine: trake partije izračunate u spojiPadine ([padina, traka]), i preko granice padina
      if (D.alt) (lin.partija || []).forEach(([i, t]) => { if (dd[i]) prst.push(...slTrakaObris(dd[i].ring, dd[i].geos, t)); });
      else D.d.forEach((d, di) => d.linije.forEach((x, j) => { if (x.id === lin.id) prst.push(...slPartija(dd, di, j, p.brojanje === 'D', D.spajaj)); }));
      if (prst.length) L.polygon(prst, { pane: 'sjekackePane', color: c, weight: 2, fillColor: c, fillOpacity: 0.28, fillRule: 'evenodd', interactive: false }).addTo(partijaGrp);
    } catch (e) {}
  }
  // partija ostaje vidljiva i kad se popup zatvori (popup je prekriva); briše je dodir drugdje
  let partijaT = 0;
  map.on('click', () => setTimeout(() => { if (Date.now() - partijaT > 400) partijaGrp.clearLayers(); }, 60));
  function popup(p, lin, at) {
    const s = STATUS[lin.status] || STATUS.ne;
    const redovi = [['Dužina', fmt(lin.duz) + ' m'], ['Dno → vrh', (lin.hDno != null ? lin.hDno + ' m' : '—') + ' → ' + (lin.hVrh != null ? lin.hVrh + ' m' : '—')], ['Status', s.t]];
    if (lin.ha != null) redovi.push(['Partija', fmt(lin.ha, 2) + ' ha' + (lin.br > 1 ? ' (L' + (lin.br - 1) + ' → ' + oznaka(lin) + ')' : ' (granica → ' + oznaka(lin) + ')')]);
    if (lin.br === zadnjiBr(p) && p.ostatakHa != null) redovi.push(['Zadnja partija', fmt(p.ostatakHa, 2) + ' ha (' + oznaka(lin) + ' → granica)']);
    if (lin.komp && p.padine) redovi.push(['Spojena preko padina', [...new Set(lin.komp.map(c => c.padina))].map(i => p.padine.dijelovi[i] ? imeP(p.padine.dijelovi[i], i) : '?').join(' + ')]);
    else if (lin.padina != null && p.padine && p.padine.dijelovi[lin.padina]) { const d = p.padine.dijelovi[lin.padina]; redovi.push(['Padina', imeP(d, lin.padina) + ' · ' + d.nagibPct + ' %']); }
    if (slIma(lin.stvarna)) redovi.push(['Stvarna (GPS)', fmt(slDuzina(lin.stvarna)) + ' m']);
    else if (slIma(lin.trag)) redovi.push(['Snimljeno', fmt(slDuzina(lin.trag)) + ' m (nastavlja se)']);
    if (lin.radnik) redovi.push(['Radnik', lin.radnik]);
    if (lin.geo) redovi.push(['Lomova', String(lin.geo.length - 2)]);
    if (lin.izo) redovi.push(['⚠ Po izohipsi', fmt(lin.izo.udio * 100) + ' % dužine (do ' + fmt(lin.izo.max) + '°)']);
    L.popup({ maxWidth: 290, minWidth: 220, className: 'pk-pop' }).setLatLng(at).setContent(_popKartica({
      ikona: '🪓', boja: s.c, naslov: oznaka(lin) + ' · ' + p.naziv, tip: 'Sjekačka linija', meta: 'razmak ' + p.razmak + ' m', redovi,
      dugmad: [{ t: '🧭 Vodi me', on: `USFSjek.vodi('${p.id}','${lin.id}')`, v: 'glavno' }, { t: '✓ Ofarbano', on: `USFSjek.status('${p.id}','${lin.id}','gotovo')` }, { t: '✏ Lomi liniju', on: `USFSjek.uredi('${p.id}','${lin.id}')` },
        ...(slIma(lin.stvarna) || slIma(lin.trag) ? [{ t: '↺ Poništi GPS liniju', on: `USFSjek.ponistiStvarnu('${p.id}','${lin.id}')` }] : []),
        ...(!lin.zona && lin.padina == null ? [{ t: '✂ Drugi pad iza ove linije', on: `USFSjek.zona('${p.id}','${lin.id}')` }] : []),
        { t: '📤 Pošalji liniju', on: `USFSjek.posaljiLiniju('${p.id}','${lin.id}')` },
        { t: '🗑 Obriši', on: `USFSjek.obrisiLiniju('${p.id}','${lin.id}')`, v: 'opasno' }]
    })).openOn(map);
    prikaziPartiju(p, lin);
  }

  // ── GPS vodič ────────────────────────────────────────────────────────
  // Izabrana linija se ističe (ostale prigušene, strelice uzbrdo), karta prati radnika,
  // a njegov put se snima (tačnost ≤ 20 m, korak ≥ 3 m) — to je stvarna linija.
  // "✓ Završi liniju" pretvara snimak u stvarnu liniju (od dna prema vrhu) i ofarbano.
  // U APK-u tačke dolaze iz native foreground servisa (GpsService) kao i kod "Snimi trag":
  // snima i pod zaključanim ekranom; vodič se nastavlja i ako Android ubije app.
  const KLJUC_VODIC = 'usf_sjek_vodic', BG_ID = 'sjekacke';
  const pozadina = () => (typeof window !== 'undefined' && window.usfPozadina) || null;
  function vodicDodaj(la, lo, ac, t) {
    if (!vodic || !vodic.snima || !(ac <= 20) || !(t > vodic.zadT)) return false;
    const zad = vodic.trag[vodic.trag.length - 1];
    if (zad && slDuzina([zad, [la, lo]]) < 3) return false;
    vodic.trag.push([la, lo]); vodic.zadT = t;
    if (++vodic.nesacuvano >= 5) sacuvajTrag();
    return true;
  }
  function vodicNativno(pts) {
    let n = 0;
    for (const q of pts) if (vodicDodaj(q.la, q.lo, Number.isFinite(q.ac) ? q.ac : 99, q.t)) n++;
    if (n) crtaj();
  }
  function vodicPozadinaKraj() {
    const bg = pozadina(); if (bg) bg.zavrsi(BG_ID);
    try { localStorage.removeItem(KLJUC_VODIC); } catch (e) {}
  }
  function vodi(pid, lid, odT) {
    map.closePopup();
    const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
    if (typeof gpsOn !== 'undefined' && !gpsOn && typeof startGPS === 'function') startGPS();
    if (vodic) { clearInterval(vodic.t); sacuvajTrag(); }
    const bg = pozadina();
    vodic = { pid, lid, t: setInterval(vodicOsvjezi, 1000), trag: slIma(lin.trag) ? lin.trag.slice() : [], snima: true, prati: true, nesacuvano: 0, zadT: odT || Date.now(), nat: !!(bg && bg.nativno()) };
    if (bg) bg.pocni(BG_ID, 'Sjekačka linija ' + oznaka(lin), vodicNativno);
    try { localStorage.setItem(KLJUC_VODIC, JSON.stringify({ pid, lid, t: vodic.zadT })); } catch (e) {}
    if (lin.status === 'ne') { lin.status = 'rad'; dodirni(lin); sacuvaj(p); }
    document.body.classList.add('sl-vodi');
    crtaj(); render(); vodicOsvjezi();
    map.fitBounds(L.latLngBounds(slGeo(lin)).pad(0.25), { maxZoom: 18 });
  }
  map.on('dragstart', () => { if (vodic && vodic.prati) { vodic.prati = false; vodicOsvjezi(); } });
  function sacuvajTrag() {
    if (!vodic) return;
    const p = nadji(vodic.pid), lin = p && p.linije.find(x => x.id === vodic.lid); if (!lin) return;
    lin.trag = vodic.trag.slice(); dodirni(lin); vodic.nesacuvano = 0; sacuvaj(p);
    try { localStorage.setItem(KLJUC_VODIC, JSON.stringify({ pid: vodic.pid, lid: vodic.lid, t: vodic.zadT })); } catch (e) {}
  }
  function vodicKraj() { if (vodic) { clearInterval(vodic.t); sacuvajTrag(); vodicPozadinaKraj(); } vodic = null; document.body.classList.remove('sl-vodi'); crtaj(); render(); }
  async function zavrsiLiniju() {
    if (!vodic) return;
    const p = nadji(vodic.pid), lin = p && p.linije.find(x => x.id === vodic.lid); if (!lin) { vodicKraj(); return; }
    const bg = pozadina();
    if (bg) { try { await bg.dopuni(); } catch (e) {} } // zadnji fiksovi iz native bafera
    if (!vodic) return;
    let tr = vodic.trag.slice();
    clearInterval(vodic.t); vodic = null; document.body.classList.remove('sl-vodi');
    vodicPozadinaKraj();
    if (tr.length >= 2 && slDuzina(tr) >= 20) {
      // orijentacija dno → vrh kao planirana linija
      const dPrvi = slDuzina([tr[0], lin.dno]), dZadnji = slDuzina([tr[tr.length - 1], lin.dno]);
      if (dZadnji < dPrvi) tr.reverse();
      lin.stvarna = slUprosti(tr, 2); delete lin.trag;
    }
    lin.status = 'gotovo'; dodirni(lin);
    status('⏳ Površine partija…');
    await generisi(p); sacuvaj(p); crtaj(); render();
    const nova = p.linije.find(x => x.id === lin.id) || lin;
    showToast('✓ ' + oznaka(nova) + ' ofarbana' + (slIma(nova.stvarna) ? ' · stvarna linija ' + fmt(slDuzina(nova.stvarna)) + ' m' + (nova.ha != null ? ' · partija ' + fmt(nova.ha, 2) + ' ha' : '') : ''));
  }
  function vodicOsvjezi() {
    const el = document.getElementById('sl-vodic'); if (!el || !vodic) return;
    const p = nadji(vodic.pid), lin = p && p.linije.find(x => x.id === vodic.lid); if (!lin) { vodicKraj(); return; }
    const gps = typeof lastP !== 'undefined' && lastP && Number.isFinite(lastP.la) ? lastP : null;
    let glavno = '📍 Čekam GPS…', sporedno = '', boja = '#64748b';
    if (gps) {
      // snimanje stvarne linije; u APK-u isključivo iz native bafera (inače dupli fiksovi)
      if (!vodic.nat && vodicDodaj(gps.la, gps.lo, gps.ac || 99, Date.now())) crtaj();
      if (vodic.prati) map.panTo([gps.la, gps.lo], { animate: true });
      const v = slVodic(lin, gps.la, gps.lo), b = Math.abs(v.bocno), tol = Math.max(3, Math.min(8, (gps.ac || 5) * 0.8));
      boja = b <= tol ? '#22c55e' : b <= 15 ? '#f59e0b' : '#ef4444';
      glavno = b <= tol ? '✓ Na liniji' : (v.bocno > 0 ? '← ' : '') + fmt(b, b < 10 ? 1 : 0) + ' m do linije' + (v.bocno < 0 ? ' →' : '');
      sporedno = v.duz < -5 ? fmt(-v.duz) + ' m ispod dna linije' : v.duz > v.len + 5 ? fmt(v.duz - v.len) + ' m iznad vrha — linija završena' : fmt(Math.max(0, v.duz)) + ' / ' + fmt(v.len) + ' m uzbrdo';
      sporedno += ' · GPS ±' + fmt(gps.ac || 0) + ' m';
    }
    const snimljeno = vodic.trag.length >= 2 ? fmt(slDuzina(vodic.trag)) + ' m' : '—';
    el.style.setProperty('--c', boja);
    el.innerHTML = `<div class="sl-v-nasl">🪓 ${esc(oznaka(lin))} · ${esc(p.naziv)} <small>gledano uzbrdo</small></div><div class="sl-v-glavno">${glavno}</div><div class="sl-v-sporedno">${sporedno}</div>
      <div class="sl-v-snim">${vodic.snima ? '🔴' : '⏸'} Stvarna linija: <b>${snimljeno}</b></div>
      <div class="sl-v-dug"><button onclick="USFSjek.zavrsiLiniju()">✓ Završi liniju</button><button onclick="USFSjek.snimanje()">${vodic.snima ? '⏸' : '▶'}</button><button onclick="USFSjek.prati()" class="${vodic.prati ? 'on' : ''}">🎯</button><button onclick="USFSjek.vodicKraj()">✕</button></div>`;
  }

  // ── Crtanje poligona: dodirom na kartu ili obilaskom granice s GPS-om ──
  let crt = null; // { pts:[[la,lo]], sloj }
  function crtPocni() {
    if (crt) return;
    crt = { pts: [], sloj: L.layerGroup().addTo(map) };
    window._npHvataKlik = true; map.on('click', crtKlik);
    document.body.classList.add('sl-crta'); switchMainTab('karta'); crtOsvjezi();
  }
  function crtKlik(e) { crt.pts.push([e.latlng.lat, e.latlng.lng]); crtOsvjezi(); }
  function crtGps() {
    const g = typeof lastP !== 'undefined' && lastP && Number.isFinite(lastP.la) ? lastP : null;
    if (!g) { if (typeof gpsOn !== 'undefined' && !gpsOn && typeof startGPS === 'function') startGPS(); showToast('📍 Čekam GPS — pokušaj za koju sekundu'); return; }
    crt.pts.push([g.la, g.lo]); crtOsvjezi(); showToast('📍 Tačka ' + crt.pts.length + ' (±' + fmt(g.ac || 0) + ' m)');
  }
  function crtKraj() { if (!crt) return; map.removeLayer(crt.sloj); map.off('click', crtKlik); window._npHvataKlik = false; crt = null; document.body.classList.remove('sl-crta'); }
  function crtOsvjezi() {
    if (!crt) return;
    crt.sloj.clearLayers();
    if (crt.pts.length > 1) L.polygon(crt.pts, { pane: 'sjekackePane', color: '#fde68a', weight: 2.5, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(crt.sloj);
    crt.pts.forEach((q, i) => L.circleMarker(q, { pane: 'sjekackePane', radius: i ? 5 : 7, color: '#0b1220', weight: 2, fillColor: '#fde68a', fillOpacity: 1, interactive: false }).addTo(crt.sloj));
    const el = document.getElementById('sl-crt'); if (!el) return;
    const ha = crt.pts.length > 2 && typeof npPovrsina === 'function' ? npPovrsina(crt.pts) / 1e4 : 0;
    el.innerHTML = `<div class="sl-v-nasl">🪓 Granica sječe <small>dodirni kartu ili idi granicom i dodaj 📍</small></div>
      <div class="sl-v-sporedno">${crt.pts.length} tačaka${ha ? ' · ' + fmt(ha, 2) + ' ha' : ''}</div>
      <div class="sl-v-dug"><button onclick="USFSjek.crtGps()">📍 Moja pozicija</button><button onclick="USFSjek.crtVrati()">↶</button><button onclick="USFSjek.crtZavrsi()">✓ Gotovo</button><button onclick="USFSjek.crtOdustani()">✕</button></div>`;
  }
  function crtZavrsi() {
    if (!crt || crt.pts.length < 3) { showToast('Treba bar 3 tačke granice'); return; }
    const ring = crt.pts.slice(), br = citaj().length + 1;
    crtKraj();
    const naziv = (prompt('Naziv sječe (odjel/odsjek):', 'Sječa ' + br) || '').trim() || 'Sječa ' + br;
    _openStubPanel('sjekacke-panel', 'meni'); napravi(ring, naziv.slice(0, 60));
  }

  // ── Lomljenje linije: povuci tačku, ＋ na sredini segmenta dodaje lom,
  // dodir na lom ga briše. Krajevi ostaju na granici (mogu se povući).
  let ured = null; // { pid, lid, pts, sloj }
  const ikona = (cls, t) => L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-ur ${cls}">${t}</span>` });
  function uredi(pid, lid) {
    map.closePopup();
    const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
    if (crt) crtKraj();
    if (ured) urediKraj();
    ured = { pid, lid, pts: slGeo(lin).map(q => q.slice()), sloj: L.layerGroup().addTo(map) };
    window._npHvataKlik = true; document.body.classList.add('sl-uredi');
    if (typeof switchMainTab === 'function') switchMainTab('karta');
    crtaj(); urediCrtaj();
    map.fitBounds(L.latLngBounds(ured.pts).pad(0.2), { maxZoom: 18 });
  }
  function urediCrtaj() {
    if (!ured) return;
    const u = ured; u.sloj.clearLayers();
    L.polyline(u.pts, { pane: 'sjekackePane', color: '#0b1220', weight: 8, opacity: 0.6, interactive: false }).addTo(u.sloj);
    L.polyline(u.pts, { pane: 'sjekackePane', color: '#38bdf8', weight: 4, interactive: false }).addTo(u.sloj);
    u.pts.forEach((q, i) => {
      const kraj = i === 0 || i === u.pts.length - 1;
      const m = L.marker(q, { draggable: true, icon: ikona(kraj ? 'kraj' : 'lom', kraj ? (i ? '▲' : '●') : '') }).addTo(u.sloj);
      m.on('drag', e => { const ll = e.target.getLatLng(); u.pts[i] = [ll.lat, ll.lng]; u.sloj.eachLayer(l => { if (l.setLatLngs) l.setLatLngs(u.pts); }); });
      m.on('dragend', urediCrtaj);
      if (!kraj) m.on('click', () => { u.pts.splice(i, 1); urediCrtaj(); });
    });
    for (let i = 1; i < u.pts.length; i++) {
      const a = u.pts[i - 1], b = u.pts[i];
      L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: ikona('plus', '+') }).addTo(u.sloj)
        .on('click', () => { u.pts.splice(i, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); urediCrtaj(); });
    }
    const el = document.getElementById('sl-ured'), p = nadji(u.pid), lin = p && p.linije.find(x => x.id === u.lid);
    if (el && lin) el.innerHTML = `<div class="sl-v-nasl">✏ ${esc(oznaka(lin))} · ${esc(p.naziv)} <small>povuci tačku · ＋ dodaje lom · dodir na lom briše</small></div>
      <div class="sl-v-sporedno">${u.pts.length - 2} lomova · ${fmt(slDuzina(u.pts))} m</div>
      <div class="sl-v-dug"><button onclick="USFSjek.urediSacuvaj()">✓ Sačuvaj</button><button onclick="USFSjek.urediRavno()">↺ Poništi lom</button><button onclick="USFSjek.urediKraj()">✕</button></div>`;
  }
  function urediKraj() {
    if (!ured) return;
    map.removeLayer(ured.sloj); ured = null; window._npHvataKlik = false; document.body.classList.remove('sl-uredi'); crtaj();
  }
  async function urediSacuvaj(ravno) {
    if (!ured) return;
    const p = nadji(ured.pid), lin = p && p.linije.find(x => x.id === ured.lid); if (!lin) { urediKraj(); return; }
    const pts = ured.pts;
    urediKraj();
    dodirni(lin);
    if (ravno) { delete lin.geo; await generisi(p); }
    else { lin.geo = pts; lin.dno = pts[0]; lin.vrh = pts[pts.length - 1]; lin.duz = slDuzina(pts); lin.hDno = await visina(lin.dno); lin.hVrh = await visina(lin.vrh); await provjeriPravac(lin); }
    sacuvaj(p); crtaj(); render();
    showToast(ravno ? '↺ ' + oznaka(lin) + ': lom poništen' : '✓ ' + oznaka(lin) + ' sačuvana (' + (pts.length - 2) + ' lomova)');
  }

  // ── UI panel ─────────────────────────────────────────────────────────
  function status(t) { const el = document.getElementById('sl-status'); if (el) el.textContent = t; }
  function izvoriUi() {
    const s = document.getElementById('sl-izvor'); if (!s) return;
    const lista = izvori();
    s.innerHTML = '<option value="">— izaberi poligon —</option>' + lista.map(x => `<option value="${esc(x.k)}">${esc(x.t)}</option>`).join('');
  }
  function render() {
    izvoriUi();
    const el = document.getElementById('sl-lista'); if (!el) return;
    const l = citaj();
    const st = document.getElementById('mc-stat-sjekacke'); if (st) st.textContent = l.length ? String(l.length) : '';
    if (!l.length) { el.innerHTML = '<div class="treg-empty">Nema projekata. Izaberi poligon iznad.</div>'; return; }
    el.innerHTML = l.map(p => {
      const otv = p.id === aktivni, gotovo = p.linije.filter(x => x.status === 'gotovo').length;
      const dos = p.dosljednost != null && p.dosljednost < 0.6 ? `<div class="sl-upoz">⚠ Pad u poligonu nije jednoličan (${Math.round(p.dosljednost * 100)} %) — greben ili vrtača; Alternativni prikaz ispod dijeli ga na padine.</div>` : '';
      const tijelo = !otv ? '' : `
        <div class="sl-param">
          <label>Širina sjekačke linije <span><input type="number" min="10" max="200" step="5" value="${p.razmak}" data-a="razmak" data-id="${p.id}"> m</span><small>pojas jedne sjekačke partije ≈ 2 visine stabla</small></label>
          <div class="sl-cipovi">${[40, 50, 60, 70, 80].map(v => `<button data-a="raz" data-v="${v}" data-id="${p.id}" class="${v === p.razmak ? 'on' : ''}">${v} m</button>`).join('')}</div>
          <label>Plan linija <select data-a="plan" data-id="${p.id}"><option value="paralelno"${p.plan !== 'teren' ? ' selected' : ''}>paralelne (jedan smjer pada)</option><option value="teren"${p.plan === 'teren' ? ' selected' : ''}>lepeza po terenu (svaka svoj pad)</option></select></label>
          <label>Brojanje <select data-a="brojanje" data-id="${p.id}"><option value="L"${p.brojanje !== 'D' ? ' selected' : ''}>s lijeva nadesno (gledano uzbrdo)</option><option value="D"${p.brojanje === 'D' ? ' selected' : ''}>s desna nalijevo (gledano uzbrdo)</option></select></label>
          <label class="sl-chk"><input type="checkbox" data-a="opt" data-id="${p.id}"${p.opt !== false ? ' checked' : ''}> Bez malih linija <small>rubne partije i zadnja partija prilagođene obliku poligona</small></label>
          ${altAktivan(p) ? '' : `<label>Smjer pada <span><button data-a="az-" data-id="${p.id}">−5°</button><input type="number" min="0" max="359" value="${p.az}" data-a="az" data-id="${p.id}">°<button data-a="az+" data-id="${p.id}">+5°</button></span><small>${p.azDem != null ? 'DEM: ' + p.azDem + '° (' + strana(p.azDem) + '), nagib ~' + Math.round(p.nagibSt) + '°' : 'bez DEM-a'}</small></label>`}
        </div>${altAktivan(p) ? '' : dos}${padineHtml(p)}${izoHtml(p)}${ploheHtml(p)}${optHtml(p.optInfo)}
        ${altAktivan(p) ? '' : zonaHtml(p)}
        <div class="sl-sazetak">Partija linije: od ${p.brojanje === 'D' ? 'desne' : 'lijeve'} granice do L1, od L1 do L2 …${p.ostatakHa != null && p.linije.length ? ` · <b>zadnja partija</b> od L${zadnjiBr(p)} do granice <b>${fmt(p.ostatakHa, 2)} ha</b>` : ''}</div>
        <div class="sl-lin">${p.linije.map(lin => { const s = STATUS[lin.status] || STATUS.ne; return `<div class="sl-lin-red">
          <b style="--c:${s.c}">${oznaka(lin)}${lin.izo ? ' <i title="ide po izohipsi">⚠</i>' : ''}</b><span>${lin.ha != null ? '<b class="sl-ha">' + fmt(lin.ha, 2) + ' ha</b> · ' : ''}${fmt(lin.duz)} m${slIma(lin.stvarna) ? ' <i class="sl-gps">GPS</i>' : ''}</span>
          <input placeholder="radnik" value="${esc(lin.radnik)}" data-a="radnik" data-id="${p.id}" data-l="${lin.id}" maxlength="24">
          <button data-a="st" data-id="${p.id}" data-l="${lin.id}" style="--c:${s.c}">${s.t}</button>
          <button data-a="vodi" data-id="${p.id}" data-l="${lin.id}">🧭</button></div>`; }).join('')}</div>
        <div class="sl-dug">${brojIzbrisanih(p) ? `<button data-a="vrati" data-id="${p.id}">↺ Vrati obrisane (${brojIzbrisanih(p)})</button>` : ''}<button data-a="kml" data-id="${p.id}">📤 Podijeli projekat</button>${p.linije.some(x => slIma(x.stvarna)) ? `<button data-a="kml-gotove" data-id="${p.id}">⤓ KML ofarbane</button>` : ''}<button data-a="vid" data-id="${p.id}">${typeof _okoDugme === 'function' ? _okoDugme(p.vidljiv !== false) : (p.vidljiv === false ? '👁 Prikaži' : '🙈 Sakrij')}</button><button data-a="brisi" data-id="${p.id}" class="opasno">🗑</button></div>`;
      return `<div class="sl-proj${otv ? ' otv' : ''}"><div class="sl-proj-zag" data-a="otvori" data-id="${p.id}"><b>🪓 ${esc(p.naziv)}</b><small>${fmt(p.ha || 0, 2)} ha · ${p.linije.length} linija · ${p.razmak} m · ofarbano ${gotovo}/${p.linije.length}</small></div>${tijelo}</div>`;
    }).join('');
  }
  function zonaHtml(p) {
    if (!p.zona) return '';
    const raz = p.linije.find(x => x.id === p.zona.lid), n = p.linije.filter(x => x.zona).length;
    const smjer = zonaSmjer(p), dio = smjer ? 'prema liniji ' + smjer : 'dio ' + (p.zona.strana === 'L' ? 'lijevo' : 'desno') + ' od nje (gledano uzbrdo)';
    const drugi = smjer === 'prije' ? '⇄ Prema liniji poslije' : smjer === 'poslije' ? '⇄ Prema liniji prije' : '↔ Druga strana';
    return `<div class="sl-zona"><b>✂ Drugi pad iza ${raz ? oznaka(raz) : 'linije'}</b> — ${dio}, ${fmt(p.zona.ha || 0, 2)} ha, ${n} linija; linije završavaju na ${raz ? oznaka(raz) : 'liniji'}.
      <div class="sl-zona-red"><span>Pad ${p.zona.az}°${p.zona.azDem != null ? ' (DEM ' + p.zona.azDem + '°, ' + strana(p.zona.azDem) + ')' : ''}</span><button data-a="zona-az-" data-id="${p.id}">−5°</button><button data-a="zona-az+" data-id="${p.id}">+5°</button></div>
      <div class="sl-dug"><button data-a="zona-strana" data-id="${p.id}">${drugi}</button><button data-a="zona-ukloni" data-id="${p.id}" class="opasno">✕ Ukloni podjelu</button></div></div>`;
  }
  // Susjedne osnovne linije (bez zone/padina) linije po kojoj se dijeli — po broju.
  function zonaSusjedi(p, lin) {
    const o = p.linije.filter(x => !x.zona && x.padina == null && x.id !== lin.id);
    let prije = null, poslije = null;
    for (const x of o) {
      if (x.br < lin.br && (!prije || x.br > prije.br)) prije = x;
      if (x.br > lin.br && (!poslije || x.br < poslije.br)) poslije = x;
    }
    return { prije, poslije };
  }
  // 'prije'|'poslije' za postojeću zonu (stari projekti nemaju zona.smjer — izračuna se)
  function zonaSmjer(p) {
    if (p.zona.smjer) return p.zona.smjer;
    const raz = p.linije.find(x => x.id === p.zona.lid); if (!raz) return null;
    const sus = zonaSusjedi(p, raz), str = slZonaStrane(slPodijeli(p.ring, slGeo(raz)), sus.prije && slGeo(sus.prije), sus.poslije && slGeo(sus.poslije));
    return str ? (p.zona.strana === str.prije ? 'prije' : 'poslije') : null;
  }
  function ploheHtml(p) {
    const op = Math.round((p.plohaOp != null ? p.plohaOp : 0.35) * 100);
    return `<div class="sl-plohe"><label class="sl-chk"><input type="checkbox" data-a="plohe" data-id="${p.id}"${p.plohe ? ' checked' : ''}> Plohe gdje linije ne idu uz stranu
      <small>${p.plohe && p.izoPlohe ? (p.izoPlohe.length ? `crveno na karti · ~${fmt(p.izoPloheHa || 0, 2)} ha` : 'nema takvih ploha ✓') : 'pravac linije > 45° od pada (DEM), nagib ≥ 8 %'}</small></label>
      ${p.plohe ? `<label class="sl-op">Providnost <input type="range" min="5" max="80" step="5" value="${op}" data-a="plohe-op" data-id="${p.id}"><b>${op} %</b></label>` : ''}</div>`;
  }
  function izoHtml(p) {
    const los = p.linije.filter(x => x.izo);
    if (!los.length) return '';
    const mx = Math.max(...los.map(x => x.izo.max));
    return `<div class="sl-upoz sl-izo">⚠ ${los.map(oznaka).join(', ')} ${los.length === 1 ? 'ide' : 'idu'} dijelom po izohipsi (do ${fmt(mx)}° od pada) — tu obaranje niz padinu nije sigurno.
      ${p.plan !== 'teren' ? `<button data-a="plan-teren" data-id="${p.id}">🔀 Napravi lepezu po terenu</button>` : `<small>Lepeza već prati pad poprijeko. Ostalo je promjena pada duž linije (greben, vrtača): izlomi liniju (✏) ili na liniji na prelazu uključi „✂ Drugi pad iza ove linije“.</small>`}</div>`;
  }
  function optHtml(o) {
    if (!o) return '';
    const t = [];
    if (o.rubL) t.push('prva linija pomjerena na ' + fmt(o.rubL) + ' m od granice (uz rub bi bila prekratka)');
    if (o.rubD) t.push('zadnja linija ' + fmt(o.rubD) + ' m od granice');
    if (o.nacin) t.push(o.nacin === 'suzeno' ? 'zadnje ' + o.k + ' partije sužene na ' + fmt(o.w) + ' m (ostatak bi bio ' + fmt(o.ostatak) + ' m)' : 'ostatak ' + fmt(o.ostatak) + ' m raspoređen na zadnje ' + o.k + ' partije (' + fmt(o.w) + ' m)');
    if (o.obrisano) t.push(o.obrisano + ' linij' + (o.obrisano === 1 ? 'a ručno obrisana' : 'e ručno obrisane'));
    if (o.izbaceno) t.push(o.izbaceno + ' kratk' + (o.izbaceno === 1 ? 'i komad linije izbačen' : 'a komada linija izbačena') + ' (krivudav rub)');
    return `<div class="sl-info">↔ ${t.join('; ')}.</div>`;
  }
  const STRANE = ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'];
  const strana = az => STRANE[Math.round(az / 45) % 8]; // ekspozicija = smjer u kojem padina gleda (= smjer pada)
  const altAktivan = p => p.prikaz === 'padine' && p.padine && p.padine.dijelovi.length > 1;
  const imeP = (d, i) => 'P' + (i + 1) + ' · ' + strana(d.azDem != null ? d.azDem : d.az);
  const brojIzbrisanih = p => (p.izbrisane || []).length + (p.padine ? p.padine.dijelovi.reduce((a, d) => a + (d.izbrisane || []).length, 0) : 0);
  function ocistiIzbrisane(p) { p.izbrisane = []; if (p.padine) p.padine.dijelovi.forEach(d => { d.izbrisane = []; }); }
  const SPOJ_IZBOR = [[0, 'Ne'], [0.3, 'Blizu'], [0.5, 'Srednje'], [0.75, 'Šire']];
  function spojHtml(p) {
    const f = spojFak(p), n = p.linije.filter(x => x.komp).length;
    return `<div class="sl-spoj"><small>🔗 Spoji bliske linije susjednih padina u jednu${n ? ` — <b>${n} spojeno</b>` : ''}:</small><div class="sl-prikaz">${SPOJ_IZBOR.map(([v, t]) => `<button data-a="spoj" data-v="${v}" data-id="${p.id}" class="${Math.abs(f - v) < 1e-6 ? 'on' : ''}">${t}${v ? '<small>≤ ' + Math.round(v * p.razmak) + ' m</small>' : ''}</button>`).join('')}</div></div>`;
  }
  function padineHtml(p) {
    if (!p.padine) return `<div class="sl-padine"><button data-a="padine-citaj" data-id="${p.id}">⛰ Alternativni prikaz — pročitaj padine iz terena</button><small>Za odjel s dva brda ili padinama na više strana: svaka padina dobija svoj pad i svoje linije.</small></div>`;
    const D = p.padine.dijelovi;
    if (D.length < 2) return `<div class="sl-padine"><b>⛰ Teren: jedna padina</b> — ${strana(D[0].azDem)} (${D[0].azDem}°), nagib ~${D[0].nagibPct} %, ${D[0].hMin}–${D[0].hMax} m. Osnovni prikaz je dovoljan. <button data-a="padine-citaj" data-id="${p.id}">↻</button></div>`;
    const alt = altAktivan(p), gr = p.padine.granice.reduce((a, g) => { a[g.tip] = (a[g.tip] || 0) + 1; return a; }, {});
    const grT = Object.entries(gr).map(([t, n]) => (n > 1 ? n + '× ' : '') + t).join(', ');
    return `<div class="sl-padine"><div class="sl-prikaz"><button data-a="prikaz" data-v="osnovni" data-id="${p.id}" class="${alt ? '' : 'on'}">Osnovni</button><button data-a="prikaz" data-v="padine" data-id="${p.id}" class="${alt ? 'on' : ''}">⛰ Alternativni · ${D.length} padine</button></div>
      <small>Granice padina iz DEM-a: ${grT || '—'}. Linije svake padine idu uz njen pad i završavaju na granici padine.</small>
      ${alt ? spojHtml(p) + D.map((d, i) => `<div class="sl-zona-red"><span><b>${imeP(d, i)}</b> ${d.az}°${d.az !== d.azDem ? ' (DEM ' + d.azDem + '°)' : ''} · ${d.nagibPct} % · ${d.hMin}–${d.hMax} m · ${fmt(d.ha, 2)} ha · ${p.linije.filter(x => x.padina === i || (x.komp && x.komp.some(c => c.padina === i))).length} lin.${d.lepeza && p.plan !== 'teren' ? ' · lepeza (krive izohipse)' : ''}</span><button data-a="pad-az-" data-d="${i}" data-id="${p.id}">−5°</button><button data-a="pad-az+" data-d="${i}" data-id="${p.id}">+5°</button></div>`).join('') + `<div class="sl-dug"><button data-a="padine-citaj" data-id="${p.id}">↻ Pročitaj teren ponovo</button></div>` : ''}</div>`;
  }
  function zoom(id) { const p = nadji(id); if (p) try { map.fitBounds(L.latLngBounds(p.ring), { padding: [30, 30], maxZoom: 17 }); } catch (e) {} }

  async function akcija(el) {
    const a = el.dataset.a, p = nadji(el.dataset.id); if (!p) return;
    if (!['otvori', 'st', 'vodi', 'kml', 'kml-gotove', 'vid', 'brisi'].includes(a)) planIzmjena(p);
    if (a === 'otvori') { aktivni = aktivni === p.id ? null : p.id; crtaj(); render(); if (aktivni) zoom(p.id); return; }
    if (a === 'az-' || a === 'az+') { p.az = (p.az + (a === 'az+' ? 5 : -5) + 360) % 360; p.izbrisane = []; await generisi(p); }
    else if (a === 'raz') { p.razmak = Number(el.dataset.v); ocistiIzbrisane(p); await generisi(p); }
    else if (a === 'plan-teren') { p.plan = 'teren'; await generisi(p); }
    else if (a === 'vrati') { ocistiIzbrisane(p); await generisi(p); }
    else if (a === 'prikaz') { p.prikaz = el.dataset.v === 'padine' ? 'padine' : 'osnovni'; await generisi(p); }
    else if (a === 'padine-citaj') {
      const pd = await citajPadine(p); status('');
      if (!pd) { showToast('⚠ Nema DEM-a za ovo područje'); return; }
      p.padine = pd; p.prikaz = pd.dijelovi.length > 1 ? 'padine' : 'osnovni';
      showToast(pd.dijelovi.length > 1 ? '⛰ ' + pd.dijelovi.length + ' padine: ' + pd.dijelovi.map(imeP).join(', ') : '⛰ Teren je jedna padina (' + strana(pd.dijelovi[0].azDem) + ')');
      await generisi(p);
    }
    else if (a === 'spoj') { p.spoj = Number(el.dataset.v); await generisi(p); }
    else if (a === 'pad-az-' || a === 'pad-az+') { const d = p.padine.dijelovi[Number(el.dataset.d)]; d.az = (d.az + (a === 'pad-az+' ? 5 : -5) + 360) % 360; d.izbrisane = []; await generisi(p); }
    else if (a === 'st') { const lin = p.linije.find(x => x.id === el.dataset.l), red = ['ne', 'rad', 'gotovo']; lin.status = red[(red.indexOf(lin.status) + 1) % 3]; dodirni(lin); }
    else if (a === 'vodi') { switchMainTab('karta'); vodi(p.id, el.dataset.l); return; }
    else if (a === 'kml') { izvozKml(p, false); return; }
    else if (a === 'kml-gotove') { izvozKml(p, true); return; }
    else if (a === 'zona-strana') { const sm = zonaSmjer(p); p.zona.strana = p.zona.strana === 'L' ? 'D' : 'L'; if (sm) p.zona.smjer = sm === 'prije' ? 'poslije' : 'prije'; p.zona.az = null; p.zona.izbrisane = []; await generisi(p); }
    else if (a === 'zona-az-' || a === 'zona-az+') { p.zona.az = (p.zona.az + (a === 'zona-az+' ? 5 : -5) + 360) % 360; p.zona.izbrisane = []; await generisi(p); }
    else if (a === 'zona-ukloni') { p.zona = null; await generisi(p); }
    else if (a === 'vid') p.vidljiv = p.vidljiv === false;
    else if (a === 'brisi') { if (!confirm('Obrisati projekat "' + p.naziv + '"?')) return; pisi(citaj().filter(x => x.id !== p.id)); if (vodic && vodic.pid === p.id) vodicKraj(); crtaj(); render(); return; }
    sacuvaj(p); crtaj(); render();
  }
  async function promjena(el) {
    const a = el.dataset.a, p = nadji(el.dataset.id); if (!p) return;
    if (!['radnik', 'plohe', 'plohe-op'].includes(a)) planIzmjena(p);
    if (a === 'plohe') { p.plohe = !!el.checked; if (p.plohe && !p.izoPlohe) { await racunajPlohe(p); status(''); } sacuvaj(p); crtaj(); render(); return; }
    if (a === 'plohe-op') { p.plohaOp = Math.max(0.05, Math.min(0.8, Number(el.value) / 100)); sacuvaj(p); crtaj(); render(); return; }
    if (a === 'radnik') { const lin = p.linije.find(x => x.id === el.dataset.l); lin.radnik = el.value.trim().slice(0, 24); dodirni(lin); sacuvaj(p); return; }
    if (a === 'razmak') p.razmak = Math.max(10, Math.min(200, Number(el.value) || 60));
    if (a === 'az') p.az = ((Math.round(Number(el.value)) || 0) % 360 + 360) % 360;
    if (a === 'plan') { p.plan = el.value === 'teren' ? 'teren' : 'paralelno'; await generisi(p); sacuvaj(p); crtaj(); render(); return; } // ključevi isti → brisanja i statusi ostaju
    if (a === 'brojanje') { p.brojanje = el.value === 'D' ? 'D' : 'L'; await generisi(p); sacuvaj(p); crtaj(); render(); return; } // brojanje ne mijenja linije
    if (a === 'opt') p.opt = !!el.checked;
    ocistiIzbrisane(p); // ključevi obrisanih važe samo za iste parametre
    await generisi(p); sacuvaj(p); crtaj(); render();
  }

  // KML za radnike: linije (boja po statusu; ofarbane = stvarna GPS linija) + natpis
  // na dnu ("L3 · 2,41 ha") i vrhu ("L3 ▲") kao tačka s nazivom — Google Earth, Locus,
  // QGIS i naš "Učitaj KML" ga prikazuju stalno. samoGotove: samo ofarbane linije.
  // Projekat ide u KML kao ExtendedData `usf_sjekacke` (base64 JSON): Google Earth/QGIS vide
  // obične linije, a Grmeč Navigator na drugom telefonu otvara živi projekat (vodič, statusi)
  // i spaja ga s postojećim. fokusLid: "Pošalji liniju" — primalac dobija ponudu "Vodi me".
  const uBase64 = t => btoa(unescape(encodeURIComponent(t)));
  const izBase64 = t => decodeURIComponent(escape(atob(t)));
  function izvozKml(p, samoGotove, fokusLid) {
    const x = s => typeof _xmlEsc === 'function' ? _xmlEsc(s) : esc(s);
    const k = q => q[1].toFixed(7) + ',' + q[0].toFixed(7);
    const KML_BOJA = { ne: 'ff0b9ef5', rad: 'fff8bd38', gotovo: 'ff5ec522' }; // aabbggrr
    const stilovi = Object.entries(KML_BOJA).map(([st, c]) => `<Style id="lin-${st}"><LineStyle><color>${c}</color><width>4</width></LineStyle></Style>
<Style id="oz-${st}"><IconStyle><scale>0.6</scale><color>${c}</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><color>${c}</color><scale>1.1</scale></LabelStyle></Style>`).join('\n');
    const oz = (q, ime, st) => `<Placemark><name>${x(ime)}</name><styleUrl>#oz-${st}</styleUrl><ExtendedData><Data name="usf_oznaka"><value>1</value></Data></ExtendedData><Point><coordinates>${k(q)}</coordinates></Point></Placemark>`;
    const placemark = l => {
      const st = STATUS[l.status] ? l.status : 'ne', ime = oznaka(l), ha = l.ha != null ? fmt(l.ha, 2) + ' ha' : '', g = slGeo(l);
      const opis = [ha && 'partija ' + ha, fmt(slDuzina(g)) + ' m', slIma(l.stvarna) ? 'stvarna linija (GPS)' : 'planirana', STATUS[st].t, l.radnik, l.hDno != null && l.hVrh != null ? l.hDno + '→' + l.hVrh + ' m' : ''].filter(Boolean).join(' · ');
      return `<Placemark><name>${x(ime + (ha ? ' · ' + ha : ''))}</name><description>${x(opis)}</description><styleUrl>#lin-${st}</styleUrl><ExtendedData><Data name="linija"><value>${x(ime)}</value></Data><Data name="povrsina_ha"><value>${l.ha != null ? l.ha.toFixed(3) : ''}</value></Data><Data name="duzina_m"><value>${Math.round(slDuzina(g))}</value></Data><Data name="izvor"><value>${slIma(l.stvarna) ? 'GPS' : 'plan'}</value></Data></ExtendedData><LineString><tessellate>1</tessellate><coordinates>${g.map(k).join(' ')}</coordinates></LineString></Placemark>
${oz(g[0], ime + (ha ? ' · ' + ha : ''), st)}
${oz(g[g.length - 1], ime + ' ▲', st)}`;
    };
    const gotove = p.linije.filter(l => slIma(l.stvarna)), plan = p.linije.filter(l => !slIma(l.stvarna));
    const granice = altAktivan(p) ? `\n<Folder><name>Granice padina</name>\n${p.padine.granice.filter(g => slIma(g.geo)).map(g => `<Placemark><name>${x(g.tip)}</name><Style><LineStyle><color>${g.tip === 'jarak' ? 'fffcd37d' : 'fff4f5f5'}</color><width>2</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${g.geo.map(k).join(' ')}</coordinates></LineString></Placemark>`).join('\n')}\n</Folder>` : '';
    const folderi = `<Folder><name>Ofarbane (stvarne GPS) linije</name>\n${gotove.map(placemark).join('\n')}\n</Folder>` + (samoGotove ? '' : `\n<Folder><name>Planirane linije</name>\n${plan.map(placemark).join('\n')}\n</Folder>`) + granice;
    const ukupno = p.linije.filter(l => l.ha != null).reduce((a, l) => a + l.ha, 0);
    const fokus = fokusLid && p.linije.find(l => l.id === fokusLid);
    const projekat = samoGotove ? '' : `<ExtendedData><Data name="usf_sjekacke"><value>${uBase64(JSON.stringify(p))}</value></Data>${fokus ? `<Data name="usf_fokus"><value>${x(fokus.id)}</value></Data>` : ''}</ExtendedData>`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x((fokus ? oznaka(fokus) + ' · ' : 'Sjekačke linije · ') + p.naziv + (samoGotove ? ' · ofarbane' : ''))}</name>${projekat}
<description>${x('Širina sjekačke linije ' + p.razmak + ' m · ' + p.linije.length + ' linija (' + gotove.length + ' ofarbano) · ' + fmt(p.ha || 0, 2) + ' ha · partije uz linije ' + fmt(ukupno, 2) + ' ha, ostatak do granice ' + fmt(p.ostatakHa || 0, 2) + ' ha')}</description>
${stilovi}
<Style id="pol"><LineStyle><color>ff8ae6fd</color><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
<Placemark><name>${x(p.naziv)}</name><styleUrl>#pol</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${p.ring.concat([p.ring[0]]).map(k).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
${folderi}
</Document></kml>`;
    const ime = p.naziv.normalize('NFKD').replace(/[^\w-]+/g, '_');
    _izvozFajl((fokus ? oznaka(fokus) + '_' : 'sjekacke_') + ime + (samoGotove ? '_ofarbane' : '') + '.kml', kml, 'application/vnd.google-earth.kml+xml',
      fokus ? oznaka(fokus) + ' · ' + p.naziv + ' — sjekačka linija (otvori u Grmeč Navigator: vodi me)' : samoGotove ? 'Ofarbane sjekačke linije · ' + p.naziv : 'Sjekačke linije · ' + p.naziv + ' — otvori u Grmeč Navigator (vodič, statusi)');
  }
  // KML s ugrađenim projektom (s drugog telefona): otvori kao projekat ili spoji s postojećim.
  // false = nije naš projekat ili korisnik hoće samo KML sloj → učitava se kao obični KML.
  async function izKml(doc) {
    const el = doc.querySelector('ExtendedData Data[name="usf_sjekacke"] value'); if (!el) return false;
    let dol; try { dol = JSON.parse(izBase64(el.textContent.trim())); } catch (e) { return false; }
    if (!dol || !Array.isArray(dol.ring) || !Array.isArray(dol.linije) || !dol.id) return false;
    const fEl = doc.querySelector('ExtendedData Data[name="usf_fokus"] value'), fokusId = fEl ? fEl.textContent.trim() : '';
    const lok = nadji(dol.id), gotovih = dol.linije.filter(l => l.status === 'gotovo').length;
    if (!confirm('„' + dol.naziv + '“ — sjekačke linije (' + dol.linije.length + ', ofarbano ' + gotovih + ').\n\n' +
      (lok ? 'Spojiti s tvojim projektom? Ofarbane i GPS linije se dodaju, novije promjene pobjeđuju.' : 'Otvoriti kao projekat s GPS vodičem i statusima?') +
      '\n\nOdustani = prikaži samo kao KML sloj.')) return false;
    let p = dol, poruka = '📥 Projekat „' + dol.naziv + '“ otvoren';
    if (lok) {
      const sp = slSpojiProjekte(lok, dol); p = sp.p;
      if (sp.azurirano) { status('⏳ Površine partija…'); await generisi(p); }
      poruka = '↻ Spojeno: ' + sp.azurirano + ' linij' + (sp.azurirano === 1 ? 'a ažurirana' : 'e ažurirano') + (sp.planDolazni ? ' · raspored iz primljenog projekta' : '');
    }
    if (!sacuvaj(p)) return true;
    aktivni = p.id; _openStubPanel('sjekacke-panel', 'meni'); crtaj(); render(); zoom(p.id);
    showToast(poruka);
    const f = fokusId && p.linije.find(l => l.id === fokusId);
    if (f && confirm('Vodi me na ' + oznaka(f) + '?')) { switchMainTab('karta'); vodi(p.id, f.id); }
    return true;
  }

  window.USFSjek = {
    otvori() { _openStubPanel('sjekacke-panel', 'meni'); aktivni = aktivni || (citaj()[0] || {}).id || null; crtaj(); render(); },
    izIzvora() { const k = document.getElementById('sl-izvor')?.value, s = izvori().find(x => x.k === k); if (!s) { showToast('Izaberi poligon s liste'); return; } napravi(s.ring(), s.t.replace(/^\S+\s/, '')); },
    izPrstena(ring, naziv) { map.closePopup(); if (!Array.isArray(ring) || ring.length < 3) return; _openStubPanel('sjekacke-panel', 'meni'); napravi(ring, naziv || 'Spojeni odsjeci'); },
    izKljuca(k) { map.closePopup(); const s = izvori().find(x => x.k === k); if (!s) { showToast('⚠ Poligon nije pronađen'); return; } _openStubPanel('sjekacke-panel', 'meni'); napravi(s.ring(), s.t.replace(/^\S+\s/, '')); },
    vodi, vodicKraj, zavrsiLiniju, crtPocni, izKml,
    posaljiLiniju(pid, lid) { const p = nadji(pid); if (!p) return; map.closePopup(); izvozKml(p, false, lid); },
    snimanje() { if (vodic) { vodic.snima = !vodic.snima; vodicOsvjezi(); } },
    prati() { if (vodic) { vodic.prati = !vodic.prati; vodicOsvjezi(); } },
    async ponistiStvarnu(pid, lid) {
      const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
      map.closePopup();
      if (!confirm('Poništiti GPS liniju za ' + oznaka(lin) + '? Ostaje planirana linija.')) return;
      delete lin.stvarna; delete lin.trag; if (lin.status === 'gotovo') lin.status = 'rad'; dodirni(lin);
      if (vodic && vodic.lid === lid) vodic.trag = [];
      await generisi(p); sacuvaj(p); crtaj(); render();
    },
    // Drugi pad: dio iza linije (manji dio, ili izabrana strana) dobija svoj smjer pada,
    // a njegove linije završavaju na toj sjekačkoj liniji.
    async zona(pid, lid) {
      const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
      map.closePopup();
      if (p.zona && !confirm('Postojeća podjela (po ' + (p.linije.find(x => x.id === p.zona.lid) ? oznaka(p.linije.find(x => x.id === p.zona.lid)) : 'liniji') + ') se zamjenjuje. Nastaviti?')) return;
      const pod = slPodijeli(p.ring, slGeo(lin)); if (!pod) { showToast('⚠ Linija ne dijeli poligon'); return; }
      // korisnik bira: drugi pad prema liniji prije (manji broj) ili poslije
      const sus = zonaSusjedi(p, lin), str = slZonaStrane(pod, sus.prije && slGeo(sus.prije), sus.poslije && slGeo(sus.poslije));
      let st = npPovrsina(pod.desno) <= npPovrsina(pod.lijevo) ? 'D' : 'L', smjer = null;
      if (str) {
        const ha = s => fmt(npPovrsina(s === 'L' ? pod.lijevo : pod.desno) / 10000, 2) + ' ha';
        const opis = x => x ? oznaka(x) + ' …' : 'do granice';
        const i = typeof _dlgActions === 'function' ? await _dlgActions('✂ Drugi pad iza ' + oznaka(lin), [
          { label: '⬅ Prema liniji prije — ' + opis(sus.prije) + ' (' + ha(str.prije) + ')' },
          { label: '➡ Prema liniji poslije — ' + opis(sus.poslije) + ' (' + ha(str.poslije) + ')' }]) : 0;
        if (i !== 0 && i !== 1) return;
        smjer = i === 0 ? 'prije' : 'poslije'; st = str[smjer];
      }
      p.zona = { lid, strana: st, smjer, az: null, izbrisane: [] }; planIzmjena(p);
      _openStubPanel('sjekacke-panel', 'meni'); aktivni = p.id;
      await generisi(p); sacuvaj(p); crtaj(); render();
      showToast('✂ Drugi pad' + (smjer ? ' prema liniji ' + smjer : '') + ': ' + p.zona.az + '° (' + strana(p.zona.az) + ')');
    }, crtGps, crtZavrsi, uredi, urediKraj,
    urediSacuvaj: () => urediSacuvaj(false), urediRavno: () => urediSacuvaj(true),
    async obrisiLiniju(pid, lid) {
      const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
      map.closePopup();
      const br = lin.br, n = p.linije.reduce((m, x) => Math.max(m, x.br), 0);
      if (!confirm('Obrisati liniju ' + oznaka(lin) + '?\n\nPartije s obje strane se spajaju' + (br < n ? ', a linije L' + (br + 1) + '–L' + n + ' dobijaju nove brojeve (L' + br + '–L' + (n - 1) + ').' : '.'))) return;
      planIzmjena(p);
      if (lin.komp && p.padine) lin.komp.forEach(c => { const d = p.padine.dijelovi[c.padina]; if (d) d.izbrisane = (d.izbrisane || []).concat([c.k]); });
      else if (lin.padina != null && p.padine) { const d = p.padine.dijelovi[lin.padina]; d.izbrisane = (d.izbrisane || []).concat([lin.k]); }
      else if (lin.zona) p.zona.izbrisane = (p.zona.izbrisane || []).concat([lin.k]);
      else p.izbrisane = (p.izbrisane || []).concat([lin.k]);
      if (vodic && vodic.pid === pid && vodic.lid === lid) vodicKraj();
      await generisi(p); sacuvaj(p); crtaj(); render();
      showToast('🗑 ' + oznaka(lin) + ' obrisana — linije prenumerisane');
    },
    crtVrati() { if (crt) { crt.pts.pop(); crtOsvjezi(); } },
    crtOdustani() { crtKraj(); },
    status(pid, lid, s) { const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin || !STATUS[s]) return; lin.status = s; dodirni(lin); sacuvaj(p); map.closePopup(); if (s === 'gotovo' && vodic && vodic.lid === lid) { vodicKraj(); showToast('✓ ' + oznaka(lin) + ' ofarbana'); } crtaj(); render(); }
  };
  const panel = document.getElementById('sjekacke-panel');
  if (panel) {
    panel.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (el && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') akcija(el); });
    panel.addEventListener('change', e => { const el = e.target.closest('[data-a]'); if (el) promjena(el); });
  }
  crtaj(); render();
  // Android je ubio app usred vodiča → nastavi; tačke iz native bafera nakon zadnjeg snimka idu u liniju
  try {
    const v = JSON.parse(localStorage.getItem(KLJUC_VODIC) || 'null'), p = v && nadji(v.pid), lin = p && p.linije.find(x => x.id === v.lid);
    if (lin && lin.status !== 'gotovo') { vodi(v.pid, v.lid, v.t); if (typeof showToast === 'function') showToast('🪓 Nastavljen vodič ' + oznaka(lin)); }
    else localStorage.removeItem(KLJUC_VODIC);
  } catch (e) {}
})();
