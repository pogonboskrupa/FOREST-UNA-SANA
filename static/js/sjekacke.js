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
const slGeo = lin => (slIma(lin.stvarna) ? lin.stvarna : slIma(lin.geo) ? lin.geo : slIma(lin.teren) ? lin.teren : [lin.dno, lin.vrh]);
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

if (typeof module !== 'undefined' && module.exports) module.exports = { slPadineMreza, slGranicaLinija, slRazdijeli, slDoRuba, slUgaoRazlika, slUprosti, slPodijeli, slSpojiTrake, slTrakeULinije, slAzimut, slOdstupanje, slOcjenaPravca, slLepeza, slMinRazmak, slLinijaKroz, slPoljaTeren, slUnutra, slGeo, slDuzina, slLinije, slRaspored, slPresjek, slTraka, slDominantniPad, slVodic, slLokalno };

(function () {
  if (typeof window === 'undefined' || typeof L === 'undefined' || typeof map === 'undefined') return;
  const KLJUC = 'usf_sjekacke';
  const STATUS = { ne: { t: 'nije', c: '#f59e0b' }, rad: { t: 'u radu', c: '#38bdf8' }, gotovo: { t: 'ofarbano', c: '#22c55e' } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => Number(v).toLocaleString('bs-BA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const citaj = () => { try { const v = JSON.parse(localStorage.getItem(KLJUC) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const pisi = l => { try { localStorage.setItem(KLJUC, JSON.stringify(l)); return true; } catch (e) { showToast('⚠ Nema mjesta za čuvanje'); return false; } };

  map.createPane('sjekackePane'); map.getPane('sjekackePane').style.zIndex = '415'; map.getPane('sjekackePane').style.pointerEvents = 'none';
  const grp = L.layerGroup().addTo(map);
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
    const g = slGeo(lin), uz = [];
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i], az = slAzimut(a, b), n = Math.max(1, Math.round(slDuzina([a, b]) / 40));
      for (let j = 0; j < n; j++) {
        const t = (j + 0.5) / n, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], s = await padGlatko(q);
        if (s) uz.push({ dev: slOdstupanje(az, s.azimut), nagib: s.nagib });
      }
    }
    const o = slOcjenaPravca(uz);
    lin.izo = o && o.udio >= 0.25 ? { udio: o.udio, max: o.max } : null;
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
      az: pad ? Math.round(pad.azimut) : 0, azDem: pad ? Math.round(pad.azimut) : null, dosljednost: pad ? pad.dosljednost : null, nagibSt: pad ? pad.nagibSt : 0, linije: [] };
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
    // numeracija preko svih dijelova s lijeva nadesno; komadi iste linije dijele broj
    const red = [];
    dijelovi.forEach((d, di) => d.linije.slice().sort((a, b) => a.k - b.k || a.dio - b.dio).forEach(x => red.push({ x, di })));
    let br = 0, pk = null;
    red.forEach(({ x, di }) => { const kl = di + ':' + x.k; if (kl !== pk) { br++; pk = kl; } x.br = br; });
    if (p.brojanje === 'D') red.forEach(({ x }) => { x.br = br + 1 - x.br; });
    p.linije = red.map(o => o.x).sort((a, b) => a.br - b.br || a.dio - b.dio);
    // površina partije po liniji (stvarne linije se računaju kao da dosežu granicu)
    status('⏳ Površine partija…');
    const trake = d => slPoljaTeren(d.ring, d.linije.filter(x => !x.dio).sort((a, b) => a.k - b.k).map(slGeo));
    p.linije.forEach(x => { if (x.dio) x.ha = null; });
    if (dijelovi.some(d => d.linije.some(x => x.padina != null))) {
      // padine: greben/jarak je granica partije — partije se ne spajaju preko njega, svaka padina ima svoj ostatak
      p.ostatakHa = 0;
      for (const d of dijelovi) {
        const pov = slTrakeULinije(trake(d), p.brojanje === 'D'), lr = d.linije.filter(x => !x.dio).sort((a, b) => a.k - b.k);
        lr.forEach((x, j) => { x.ha = pov.poLiniji[j]; });
        p.ostatakHa += pov.ostatak;
      }
    } else {
      const S = slSpojiTrake(dijelovi.map(trake));
      const lr = red.map(o => o.x).filter(x => !x.dio), pov = slTrakeULinije(S, p.brojanje === 'D');
      lr.forEach((x, j) => { x.ha = pov.poLiniji[j]; });
      p.ostatakHa = pov.ostatak;
    }
    status('⏳ Provjera pravca prema padu…');
    for (const x of p.linije) if (!slIma(x.stvarna)) await provjeriPravac(x); else x.izo = null;
    status('⏳ Visine krajeva linija…');
    for (const x of p.linije) { x.hDno = await visina(x.dno); x.hVrh = await visina(x.vrh); }
    status('');
  }
  function nadji(id) { return citaj().find(x => x.id === id); }
  function sacuvaj(p) { const l = citaj(), i = l.findIndex(x => x.id === p.id); if (i >= 0) l[i] = p; else l.unshift(p); return pisi(l); }

  // ── Karta ────────────────────────────────────────────────────────────
  function oznaka(lin) { return 'L' + lin.br + (lin.dio ? String.fromCharCode(97 + lin.dio) : ''); }
  function crtaj() {
    grp.clearLayers();
    citaj().filter(p => p.vidljiv !== false).forEach(p => {
      const akt = p.id === aktivni;
      L.polygon(p.ring, { pane: 'sjekackePane', color: '#fde68a', weight: akt ? 2.5 : 1.5, dashArray: '6 4', fill: false, interactive: false }).addTo(grp);
      const vodiOvdje = vodic && vodic.pid === p.id;
      if (altAktivan(p)) {
        p.padine.granice.forEach(g => {
          if (!slIma(g.geo)) return;
          L.polyline(g.geo, { pane: 'sjekackePane', color: '#0b1220', weight: 6, opacity: 0.45, interactive: false }).addTo(grp);
          L.polyline(g.geo, { pane: 'sjekackePane', color: g.tip === 'jarak' ? '#7dd3fc' : '#f5f5f4', weight: 2.5, dashArray: '2 7', lineCap: 'round', interactive: false }).addTo(grp);
          if (akt && !vodiOvdje) L.marker(g.geo[Math.floor(g.geo.length * 0.4)], { pane: 'sjekackePane', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl sl-gran">${g.tip === 'greben' ? '⛰ greben' : g.tip === 'jarak' ? '〰 jarak' : 'prelom'}</span>` }) }).addTo(grp);
        });
        if (akt && !vodiOvdje) p.padine.dijelovi.forEach((d, i) => L.marker(d.c, { pane: 'sjekackePane', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl sl-pad">${imeP(d, i)} ↘ ${d.nagibPct} %</span>` }) }).addTo(grp));
      }
      p.linije.forEach(lin => {
        const s = STATUS[lin.status] || STATUS.ne, vodi = vodiOvdje && vodic.lid === lin.id;
        if (ured && ured.pid === p.id && ured.lid === lin.id) return; // crta ga uređivač
        const prig = vodiOvdje && !vodi ? 0.35 : 1, stv = slIma(lin.stvarna);
        L.polyline(slGeo(lin), { pane: 'sjekackePane', color: '#0b1220', weight: vodi ? 11 : 6, opacity: 0.55 * prig, interactive: false }).addTo(grp);
        // plan isprekidano, stvarna (GPS) linija puna
        L.polyline(slGeo(lin), { pane: 'sjekackePane', color: vodi ? '#fde047' : s.c, weight: vodi ? 6 : 3, opacity: prig, dashArray: stv || vodi ? null : '10 6', interactive: false }).addTo(grp);
        if (lin.izo && !vodiOvdje) L.polyline(slGeo(lin), { pane: 'sjekackePane', color: '#ef4444', weight: 3, dashArray: '2 8', opacity: 1, interactive: false }).addTo(grp);
        if (vodi) strelice(lin);
        if (akt || vodi || map.getZoom() >= 15) {
          // broj na oba kraja: radnik koji kreće odozdo i onaj koji provjerava s vrha vide istu oznaku
          L.circleMarker(lin.dno, { pane: 'sjekackePane', radius: 4, color: '#fff', weight: 1.5, fillColor: s.c, fillOpacity: 1, interactive: false }).addTo(grp);
          L.marker(lin.dno, { pane: 'sjekackePane', interactive: false, opacity: prig, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl" style="--c:${s.c}">${oznaka(lin)}</span>` }) }).addTo(grp);
          L.marker(lin.vrh, { pane: 'sjekackePane', interactive: false, opacity: prig, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="sl-lbl vrh" style="--c:${s.c}">${oznaka(lin)} ▲</span>` }) }).addTo(grp);
        }
      });
      if (vodiOvdje && slIma(vodic.trag)) L.polyline(vodic.trag, { pane: 'sjekackePane', color: '#22d3ee', weight: 4, opacity: 1, interactive: false }).addTo(grp);
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
  map.on('zoomend', () => { const z = map.getZoom(); if ((z >= 15) !== (zZadnji >= 15)) crtaj(); zZadnji = z; });
  if (typeof _kartaKlikIzvor === 'function') _kartaKlikIzvor((ll, kp) => {
    const out = [];
    citaj().filter(p => p.vidljiv !== false).forEach(p => p.linije.forEach(lin => {
      out.push({ vrsta: 'linija', d: _pxDoLinije(kp, slGeo(lin).map(q => L.latLng(q[0], q[1]))), otvori: at => popup(p, lin, at) });
    }));
    return out;
  });
  function popup(p, lin, at) {
    const s = STATUS[lin.status] || STATUS.ne;
    const redovi = [['Dužina', fmt(lin.duz) + ' m'], ['Dno → vrh', (lin.hDno != null ? lin.hDno + ' m' : '—') + ' → ' + (lin.hVrh != null ? lin.hVrh + ' m' : '—')], ['Status', s.t]];
    if (lin.ha != null) redovi.push(['Partija', fmt(lin.ha, 2) + ' ha']);
    if (lin.padina != null && p.padine && p.padine.dijelovi[lin.padina]) { const d = p.padine.dijelovi[lin.padina]; redovi.push(['Padina', imeP(d, lin.padina) + ' · ' + d.nagibPct + ' %']); }
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
        { t: '🗑 Obriši', on: `USFSjek.obrisiLiniju('${p.id}','${lin.id}')`, v: 'opasno' }]
    })).openOn(map);
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
    if (lin.status === 'ne') { lin.status = 'rad'; sacuvaj(p); }
    document.body.classList.add('sl-vodi');
    crtaj(); render(); vodicOsvjezi();
    map.fitBounds(L.latLngBounds(slGeo(lin)).pad(0.25), { maxZoom: 18 });
  }
  map.on('dragstart', () => { if (vodic && vodic.prati) { vodic.prati = false; vodicOsvjezi(); } });
  function sacuvajTrag() {
    if (!vodic) return;
    const p = nadji(vodic.pid), lin = p && p.linije.find(x => x.id === vodic.lid); if (!lin) return;
    lin.trag = vodic.trag.slice(); vodic.nesacuvano = 0; sacuvaj(p);
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
    lin.status = 'gotovo';
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
          <label>Širina partije <span><input type="number" min="10" max="200" step="5" value="${p.razmak}" data-a="razmak" data-id="${p.id}"> m</span><small>pojas jedne sjekačke partije ≈ 2 visine stabla</small></label>
          <div class="sl-cipovi">${[40, 50, 60, 70, 80].map(v => `<button data-a="raz" data-v="${v}" data-id="${p.id}" class="${v === p.razmak ? 'on' : ''}">${v} m</button>`).join('')}</div>
          <label>Plan linija <select data-a="plan" data-id="${p.id}"><option value="paralelno"${p.plan !== 'teren' ? ' selected' : ''}>paralelne (jedan smjer pada)</option><option value="teren"${p.plan === 'teren' ? ' selected' : ''}>lepeza po terenu (svaka svoj pad)</option></select></label>
          <label>Brojanje <select data-a="brojanje" data-id="${p.id}"><option value="L"${p.brojanje !== 'D' ? ' selected' : ''}>s lijeva nadesno (gledano uzbrdo)</option><option value="D"${p.brojanje === 'D' ? ' selected' : ''}>s desna nalijevo (gledano uzbrdo)</option></select></label>
          <label class="sl-chk"><input type="checkbox" data-a="opt" data-id="${p.id}"${p.opt !== false ? ' checked' : ''}> Bez malih linija <small>rubne partije i zadnja partija prilagođene obliku poligona</small></label>
          ${altAktivan(p) ? '' : `<label>Smjer pada <span><button data-a="az-" data-id="${p.id}">−5°</button><input type="number" min="0" max="359" value="${p.az}" data-a="az" data-id="${p.id}">°<button data-a="az+" data-id="${p.id}">+5°</button></span><small>${p.azDem != null ? 'DEM: ' + p.azDem + '° (' + strana(p.azDem) + '), nagib ~' + Math.round(p.nagibSt) + '°' : 'bez DEM-a'}</small></label>`}
        </div>${altAktivan(p) ? '' : dos}${padineHtml(p)}${izoHtml(p)}${optHtml(p.optInfo)}
        ${altAktivan(p) ? '' : zonaHtml(p)}
        <div class="sl-sazetak">Površina partije uz svaku liniju: od ${p.brojanje === 'D' ? 'desne' : 'lijeve'} granice do L1, od L1 do L2 … ${p.ostatakHa != null ? '· ostatak do granice <b>' + fmt(p.ostatakHa, 2) + ' ha</b>' : ''}</div>
        <div class="sl-lin">${p.linije.map(lin => { const s = STATUS[lin.status] || STATUS.ne; return `<div class="sl-lin-red">
          <b style="--c:${s.c}">${oznaka(lin)}${lin.izo ? ' <i title="ide po izohipsi">⚠</i>' : ''}</b><span>${lin.ha != null ? '<b class="sl-ha">' + fmt(lin.ha, 2) + ' ha</b> · ' : ''}${fmt(lin.duz)} m${slIma(lin.stvarna) ? ' <i class="sl-gps">GPS</i>' : ''}</span>
          <input placeholder="radnik" value="${esc(lin.radnik)}" data-a="radnik" data-id="${p.id}" data-l="${lin.id}" maxlength="24">
          <button data-a="st" data-id="${p.id}" data-l="${lin.id}" style="--c:${s.c}">${s.t}</button>
          <button data-a="vodi" data-id="${p.id}" data-l="${lin.id}">🧭</button></div>`; }).join('')}</div>
        <div class="sl-dug">${brojIzbrisanih(p) ? `<button data-a="vrati" data-id="${p.id}">↺ Vrati obrisane (${brojIzbrisanih(p)})</button>` : ''}<button data-a="kml" data-id="${p.id}">⤓ KML sve linije</button>${p.linije.some(x => slIma(x.stvarna)) ? `<button data-a="kml-gotove" data-id="${p.id}">⤓ KML ofarbane</button>` : ''}<button data-a="vid" data-id="${p.id}">${p.vidljiv === false ? '👁 Prikaži' : '🙈 Sakrij'}</button><button data-a="brisi" data-id="${p.id}" class="opasno">🗑</button></div>`;
      return `<div class="sl-proj${otv ? ' otv' : ''}"><div class="sl-proj-zag" data-a="otvori" data-id="${p.id}"><b>🪓 ${esc(p.naziv)}</b><small>${fmt(p.ha || 0, 2)} ha · ${p.linije.length} linija · ${p.razmak} m · ofarbano ${gotovo}/${p.linije.length}</small></div>${tijelo}</div>`;
    }).join('');
  }
  function zonaHtml(p) {
    if (!p.zona) return '';
    const raz = p.linije.find(x => x.id === p.zona.lid), n = p.linije.filter(x => x.zona).length;
    return `<div class="sl-zona"><b>✂ Drugi pad iza ${raz ? oznaka(raz) : 'linije'}</b> — dio ${p.zona.strana === 'L' ? 'lijevo' : 'desno'} od nje (gledano uzbrdo), ${fmt(p.zona.ha || 0, 2)} ha, ${n} linija; linije završavaju na ${raz ? oznaka(raz) : 'liniji'}.
      <div class="sl-zona-red"><span>Pad ${p.zona.az}°${p.zona.azDem != null ? ' (DEM ' + p.zona.azDem + '°, ' + strana(p.zona.azDem) + ')' : ''}</span><button data-a="zona-az-" data-id="${p.id}">−5°</button><button data-a="zona-az+" data-id="${p.id}">+5°</button></div>
      <div class="sl-dug"><button data-a="zona-strana" data-id="${p.id}">↔ Druga strana</button><button data-a="zona-ukloni" data-id="${p.id}" class="opasno">✕ Ukloni podjelu</button></div></div>`;
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
  function padineHtml(p) {
    if (!p.padine) return `<div class="sl-padine"><button data-a="padine-citaj" data-id="${p.id}">⛰ Alternativni prikaz — pročitaj padine iz terena</button><small>Za odjel s dva brda ili padinama na više strana: svaka padina dobija svoj pad i svoje linije.</small></div>`;
    const D = p.padine.dijelovi;
    if (D.length < 2) return `<div class="sl-padine"><b>⛰ Teren: jedna padina</b> — ${strana(D[0].azDem)} (${D[0].azDem}°), nagib ~${D[0].nagibPct} %, ${D[0].hMin}–${D[0].hMax} m. Osnovni prikaz je dovoljan. <button data-a="padine-citaj" data-id="${p.id}">↻</button></div>`;
    const alt = altAktivan(p), gr = p.padine.granice.reduce((a, g) => { a[g.tip] = (a[g.tip] || 0) + 1; return a; }, {});
    const grT = Object.entries(gr).map(([t, n]) => (n > 1 ? n + '× ' : '') + t).join(', ');
    return `<div class="sl-padine"><div class="sl-prikaz"><button data-a="prikaz" data-v="osnovni" data-id="${p.id}" class="${alt ? '' : 'on'}">Osnovni</button><button data-a="prikaz" data-v="padine" data-id="${p.id}" class="${alt ? 'on' : ''}">⛰ Alternativni · ${D.length} padine</button></div>
      <small>Granice padina iz DEM-a: ${grT || '—'}. Linije svake padine idu uz njen pad i završavaju na granici padine.</small>
      ${alt ? D.map((d, i) => `<div class="sl-zona-red"><span><b>${imeP(d, i)}</b> ${d.az}°${d.az !== d.azDem ? ' (DEM ' + d.azDem + '°)' : ''} · ${d.nagibPct} % · ${d.hMin}–${d.hMax} m · ${fmt(d.ha, 2)} ha · ${p.linije.filter(x => x.padina === i).length} lin.${d.lepeza && p.plan !== 'teren' ? ' · lepeza (krive izohipse)' : ''}</span><button data-a="pad-az-" data-d="${i}" data-id="${p.id}">−5°</button><button data-a="pad-az+" data-d="${i}" data-id="${p.id}">+5°</button></div>`).join('') + `<div class="sl-dug"><button data-a="padine-citaj" data-id="${p.id}">↻ Pročitaj teren ponovo</button></div>` : ''}</div>`;
  }
  function zoom(id) { const p = nadji(id); if (p) try { map.fitBounds(L.latLngBounds(p.ring), { padding: [30, 30], maxZoom: 17 }); } catch (e) {} }

  async function akcija(el) {
    const a = el.dataset.a, p = nadji(el.dataset.id); if (!p) return;
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
    else if (a === 'pad-az-' || a === 'pad-az+') { const d = p.padine.dijelovi[Number(el.dataset.d)]; d.az = (d.az + (a === 'pad-az+' ? 5 : -5) + 360) % 360; d.izbrisane = []; await generisi(p); }
    else if (a === 'st') { const lin = p.linije.find(x => x.id === el.dataset.l), red = ['ne', 'rad', 'gotovo']; lin.status = red[(red.indexOf(lin.status) + 1) % 3]; }
    else if (a === 'vodi') { switchMainTab('karta'); vodi(p.id, el.dataset.l); return; }
    else if (a === 'kml') { izvozKml(p, false); return; }
    else if (a === 'kml-gotove') { izvozKml(p, true); return; }
    else if (a === 'zona-strana') { p.zona.strana = p.zona.strana === 'L' ? 'D' : 'L'; p.zona.az = null; p.zona.izbrisane = []; await generisi(p); }
    else if (a === 'zona-az-' || a === 'zona-az+') { p.zona.az = (p.zona.az + (a === 'zona-az+' ? 5 : -5) + 360) % 360; p.zona.izbrisane = []; await generisi(p); }
    else if (a === 'zona-ukloni') { p.zona = null; await generisi(p); }
    else if (a === 'vid') p.vidljiv = p.vidljiv === false;
    else if (a === 'brisi') { if (!confirm('Obrisati projekat "' + p.naziv + '"?')) return; pisi(citaj().filter(x => x.id !== p.id)); if (vodic && vodic.pid === p.id) vodicKraj(); crtaj(); render(); return; }
    sacuvaj(p); crtaj(); render();
  }
  async function promjena(el) {
    const a = el.dataset.a, p = nadji(el.dataset.id); if (!p) return;
    if (a === 'radnik') { const lin = p.linije.find(x => x.id === el.dataset.l); lin.radnik = el.value.trim().slice(0, 24); sacuvaj(p); return; }
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
  function izvozKml(p, samoGotove) {
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
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x('Sjekačke linije · ' + p.naziv + (samoGotove ? ' · ofarbane' : ''))}</name>
<description>${x('Širina partije ' + p.razmak + ' m · ' + p.linije.length + ' linija (' + gotove.length + ' ofarbano) · ' + fmt(p.ha || 0, 2) + ' ha · partije uz linije ' + fmt(ukupno, 2) + ' ha, ostatak do granice ' + fmt(p.ostatakHa || 0, 2) + ' ha')}</description>
${stilovi}
<Style id="pol"><LineStyle><color>ff8ae6fd</color><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
<Placemark><name>${x(p.naziv)}</name><styleUrl>#pol</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${p.ring.concat([p.ring[0]]).map(k).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
${folderi}
</Document></kml>`;
    _izvozFajl('sjekacke_' + p.naziv.normalize('NFKD').replace(/[^\w-]+/g, '_') + (samoGotove ? '_ofarbane' : '') + '.kml', kml, 'application/vnd.google-earth.kml+xml', 'Sjekačke linije');
  }

  window.USFSjek = {
    otvori() { _openStubPanel('sjekacke-panel', 'meni'); aktivni = aktivni || (citaj()[0] || {}).id || null; crtaj(); render(); },
    izIzvora() { const k = document.getElementById('sl-izvor')?.value, s = izvori().find(x => x.k === k); if (!s) { showToast('Izaberi poligon s liste'); return; } napravi(s.ring(), s.t.replace(/^\S+\s/, '')); },
    izKljuca(k) { map.closePopup(); const s = izvori().find(x => x.k === k); if (!s) { showToast('⚠ Poligon nije pronađen'); return; } _openStubPanel('sjekacke-panel', 'meni'); napravi(s.ring(), s.t.replace(/^\S+\s/, '')); },
    vodi, vodicKraj, zavrsiLiniju, crtPocni,
    snimanje() { if (vodic) { vodic.snima = !vodic.snima; vodicOsvjezi(); } },
    prati() { if (vodic) { vodic.prati = !vodic.prati; vodicOsvjezi(); } },
    async ponistiStvarnu(pid, lid) {
      const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
      map.closePopup();
      if (!confirm('Poništiti GPS liniju za ' + oznaka(lin) + '? Ostaje planirana linija.')) return;
      delete lin.stvarna; delete lin.trag; if (lin.status === 'gotovo') lin.status = 'rad';
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
      const st = npPovrsina(pod.desno) <= npPovrsina(pod.lijevo) ? 'D' : 'L';
      p.zona = { lid, strana: st, az: null, izbrisane: [] };
      _openStubPanel('sjekacke-panel', 'meni'); aktivni = p.id;
      await generisi(p); sacuvaj(p); crtaj(); render();
      showToast('✂ Drugi dio ima svoj pad ' + p.zona.az + '° (' + strana(p.zona.az) + ')');
    }, crtGps, crtZavrsi, uredi, urediKraj,
    urediSacuvaj: () => urediSacuvaj(false), urediRavno: () => urediSacuvaj(true),
    async obrisiLiniju(pid, lid) {
      const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin) return;
      map.closePopup();
      const br = lin.br, n = p.linije.reduce((m, x) => Math.max(m, x.br), 0);
      if (!confirm('Obrisati liniju ' + oznaka(lin) + '?\n\nPartije s obje strane se spajaju' + (br < n ? ', a linije L' + (br + 1) + '–L' + n + ' dobijaju nove brojeve (L' + br + '–L' + (n - 1) + ').' : '.'))) return;
      if (lin.padina != null && p.padine) { const d = p.padine.dijelovi[lin.padina]; d.izbrisane = (d.izbrisane || []).concat([lin.k]); }
      else if (lin.zona) p.zona.izbrisane = (p.zona.izbrisane || []).concat([lin.k]);
      else p.izbrisane = (p.izbrisane || []).concat([lin.k]);
      if (vodic && vodic.pid === pid && vodic.lid === lid) vodicKraj();
      await generisi(p); sacuvaj(p); crtaj(); render();
      showToast('🗑 ' + oznaka(lin) + ' obrisana — linije prenumerisane');
    },
    crtVrati() { if (crt) { crt.pts.pop(); crtOsvjezi(); } },
    crtOdustani() { crtKraj(); },
    status(pid, lid, s) { const p = nadji(pid), lin = p && p.linije.find(x => x.id === lid); if (!lin || !STATUS[s]) return; lin.status = s; sacuvaj(p); map.closePopup(); if (s === 'gotovo' && vodic && vodic.lid === lid) { vodicKraj(); showToast('✓ ' + oznaka(lin) + ' ofarbana'); } crtaj(); render(); }
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
