// Projektovanje puta — poređenje varijanti, procjena troška i izvještaj (A4 slika + PDF).
// Čiste funkcije (bez DOM-a osim `crtaj`, koji prima canvas); koristi ih index.html.
(function (root) {
  'use strict';
  const CIJENE_ZADANO = { zemljani: 6, nova: 20, zid: 120 }; // KM/m³ iskopa+nasipa, KM/m nove trase (kolovoz), KM/m potpornog zida — orijentaciono

  // Sve brojke jedne trase na jednom mjestu: dužina, nagibi, uspon/silazak, dio po postojećem putu, zemljani radovi i trošak.
  function metrike(path, val, zr, cijene) {
    const c = Object.assign({}, CIJENE_ZADANO, cijene || {});
    let up = 0, dn = 0, ex = 0;
    for (let i = 1; i < path.length; i++) {
      const dh = path[i].elev - path[i - 1].elev; if (dh > 0) up += dh; else dn -= dh;
    }
    (val.segments || []).forEach(s => { if (s.level === 'ex') ex += s.distM; });
    const dist = val.totalDist, nova = Math.max(0, dist - ex);
    const iskop = zr ? zr.iskop : 0, nasip = zr ? zr.nasip : 0, zid = zr ? zr.zidM : 0;
    const trosak = (iskop + nasip) * c.zemljani + nova * c.nova + zid * c.zid;
    return { dist, up, dn, maxN: val.maxSlopePct, avgN: val.avgSlopePct, ex, nova, iskop, nasip, zid, trosak, cijene: c };
  }
  const najbolji = (lista, kljuc) => lista.reduce((b, x, i) => (b < 0 || x.m[kljuc] < lista[b].m[kljuc] ? i : b), -1);

  // Minimalni PDF s jednom A4 stranicom koja je JPEG slika (DCTDecode) — dovoljno za štampu/dijeljenje bez biblioteke.
  function pdfIzJpeg(jpeg, w, h) {
    const enc = new TextEncoder(), dijelovi = [], off = [];
    let duz = 0;
    const dodaj = d => { const b = typeof d === 'string' ? enc.encode(d) : d; dijelovi.push(b); duz += b.length; };
    const obj = (n, tijelo) => { off[n] = duz; dodaj(`${n} 0 obj\n${tijelo}\nendobj\n`); };
    dodaj('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    off[4] = duz; dodaj(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); dodaj(jpeg); dodaj('\nendstream\nendobj\n');
    const sad = 'q 595 0 0 842 0 0 cm /Im0 Do Q';
    obj(5, `<< /Length ${sad.length} >>\nstream\n${sad}\nendstream`);
    const xref = duz;
    let t = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) t += String(off[i]).padStart(10, '0') + ' 00000 n \n';
    dodaj(t + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out = new Uint8Array(duz); let p = 0; dijelovi.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  const fm = v => v >= 1000 ? (v / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(v) + ' m';
  const fn = v => Math.round(v).toLocaleString('bs-BA');
  // Crta izvještaj na canvas 1240×1754 (A4 @150 dpi).
  // ulaz: { naslov, datum, params, path, val, stac(fn m→tekst), putevi (linije [[lat,lon]…]), varijante [{naziv, m}], kljucni [{ozn,i}], boje }
  function crtaj(cv, u) {
    const W = cv.width = 1240, H = cv.height = 1754, x = cv.getContext('2d');
    const m = metrike(u.path, u.val, u.zr, u.cijene), P = u.params, B = u.boje;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#14532d'; x.fillRect(0, 0, W, 130);
    x.fillStyle = '#fff'; x.font = '700 44px system-ui,sans-serif'; x.fillText('Izvještaj o trasi šumskog puta', 50, 62);
    x.font = '400 26px system-ui,sans-serif'; x.fillText((u.naslov || '') + ' · ' + u.datum + ' · Grmeč Navigator', 50, 104);
    // plan trase
    const MX = 50, MY = 160, MW = 1140, MH = 560;
    x.fillStyle = '#f1f5f0'; x.fillRect(MX, MY, MW, MH); x.strokeStyle = '#94a3b8'; x.lineWidth = 2; x.strokeRect(MX, MY, MW, MH);
    const la = u.path.map(p => p.lat), lo = u.path.map(p => p.lon);
    let la0 = Math.min(...la), la1 = Math.max(...la), lo0 = Math.min(...lo), lo1 = Math.max(...lo);
    const cos = Math.cos((la0 + la1) / 2 * Math.PI / 180), padM = 0.12;
    let sw = (lo1 - lo0) * cos || 1e-5, sh = (la1 - la0) || 1e-5;
    la0 -= sh * padM; la1 += sh * padM; lo0 -= sh * padM / cos; lo1 += sh * padM / cos; sw = (lo1 - lo0) * cos; sh = la1 - la0;
    const k = Math.min((MW - 40) / sw, (MH - 40) / sh), ox = MX + (MW - sw * k) / 2, oy = MY + (MH - sh * k) / 2;
    const X = lon => ox + (lon - lo0) * cos * k, Y = lat => oy + (la1 - lat) * k;
    x.save(); x.beginPath(); x.rect(MX + 1, MY + 1, MW - 2, MH - 2); x.clip();
    (u.putevi || []).forEach(L => { x.beginPath(); L.forEach((q, i) => i ? x.lineTo(X(q[1]), Y(q[0])) : x.moveTo(X(q[1]), Y(q[0]))); x.strokeStyle = '#93c5fd'; x.lineWidth = 5; x.stroke(); });
    x.lineCap = 'round';
    u.val.segments.forEach(s => { const a = u.path[s.i - 1], b2 = u.path[s.i]; x.beginPath(); x.moveTo(X(a.lon), Y(a.lat)); x.lineTo(X(b2.lon), Y(b2.lat)); x.strokeStyle = '#fff'; x.lineWidth = 11; x.stroke(); });
    u.val.segments.forEach(s => { const a = u.path[s.i - 1], b2 = u.path[s.i]; x.beginPath(); x.moveTo(X(a.lon), Y(a.lat)); x.lineTo(X(b2.lon), Y(b2.lat)); x.strokeStyle = B[s.level] || B.ok; x.lineWidth = 7; x.stroke(); });
    (u.kljucni || []).forEach(kq => { const q = u.path[kq.i]; x.beginPath(); x.arc(X(q.lon), Y(q.lat), 17, 0, 6.3); x.fillStyle = '#0f172a'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 3; x.stroke(); x.fillStyle = '#fff'; x.font = '700 20px system-ui'; x.textAlign = 'center'; x.fillText(kq.ozn, X(q.lon), Y(q.lat) + 7); x.textAlign = 'left'; });
    x.restore();
    // sjever i mjerilo
    x.fillStyle = '#0f172a'; x.font = '700 28px system-ui'; x.fillText('S', MX + MW - 48, MY + 70); x.beginPath(); x.moveTo(MX + MW - 40, MY + 78); x.lineTo(MX + MW - 52, MY + 108); x.lineTo(MX + MW - 28, MY + 108); x.closePath(); x.fill();
    const mPx = 111320 * cos * (1 / 1) / 1; // m po stepenu lon * cos
    const mjerilo = [100, 200, 250, 500, 1000, 2000].find(v => v / (111320 * cos) * cos * k >= 120) || 2000, sp = mjerilo / 111320 * k;
    x.fillRect(MX + 24, MY + MH - 40, sp, 8); x.font = '600 22px system-ui'; x.fillText(fm(mjerilo), MX + 24, MY + MH - 50);
    // KPI
    const kpi = [[fm(m.dist), 'dužina'], ['+' + fn(m.up) + ' / −' + fn(m.dn) + ' m', 'uspon / silazak'], [m.maxN.toFixed(1) + ' %', 'maks. nagib'], [m.avgN.toFixed(1) + ' %', 'prosj. nagib']];
    kpi.forEach((q, i) => { const bx = 50 + i * 290; x.fillStyle = '#f1f5f0'; x.fillRect(bx, 750, 270, 100); x.fillStyle = '#0f172a'; x.font = '700 34px system-ui'; x.fillText(q[0], bx + 16, 800); x.font = '400 22px system-ui'; x.fillStyle = '#475569'; x.fillText(q[1], bx + 16, 832); });
    // profil
    const PX = 50, PY = 890, PW = 1140, PH = 330;
    x.fillStyle = '#0f172a'; x.font = '700 28px system-ui'; x.fillText('Uzdužni profil', PX, PY - 8);
    const d = [0]; for (let i = 1; i < u.path.length; i++) d.push(d[i - 1] + u.rdH(u.path[i - 1], u.path[i]));
    const uk = d[d.length - 1] || 1, hs = u.path.map(p => p.elev), hmn = Math.floor(Math.min(...hs) / 10) * 10, hmx = Math.max(Math.ceil(Math.max(...hs) / 10) * 10, hmn + 10);
    const gx = mm => PX + 70 + mm / uk * (PW - 90), gy = h => PY + 20 + (1 - (h - hmn) / (hmx - hmn)) * (PH - 80);
    x.strokeStyle = '#e2e8f0'; x.lineWidth = 1; x.font = '20px system-ui'; x.fillStyle = '#64748b';
    const kh = Math.max(10, Math.ceil((hmx - hmn) / 5 / 10) * 10);
    for (let h = hmn; h <= hmx; h += kh) { x.beginPath(); x.moveTo(PX + 70, gy(h)); x.lineTo(PX + PW - 20, gy(h)); x.stroke(); x.fillText(String(h), PX + 4, gy(h) + 6); }
    const kxm = [100, 200, 250, 500, 1000, 2000, 5000].find(v => uk / v <= 8) || 5000;
    for (let mm = 0; mm <= uk; mm += kxm) { x.fillText(u.stac(mm), gx(mm) - 22, PY + PH - 22); x.beginPath(); x.moveTo(gx(mm), PY + 20); x.lineTo(gx(mm), PY + PH - 60); x.stroke(); }
    x.lineWidth = 5; x.lineCap = 'round';
    for (let i = 1; i < u.path.length; i++) { x.beginPath(); x.moveTo(gx(d[i - 1]), gy(hs[i - 1])); x.lineTo(gx(d[i]), gy(hs[i])); const s = u.val.segments.find(q => q.i === i); x.strokeStyle = B[s ? s.level : 'ok'] || B.ok; x.stroke(); }
    // legenda boja
    x.font = '22px system-ui'; let lx = 50; [['ok', '≤ ' + P.nagibPreporuceni + ' %'], ['warn', 'do ' + P.nagibMax + ' %'], ['bad', '> ' + P.nagibMax + ' %'], ['ex', 'postojeći put']].forEach(([k2, t]) => { x.fillStyle = B[k2]; x.fillRect(lx, 1238, 36, 10); x.fillStyle = '#334155'; x.fillText(t, lx + 46, 1250); lx += 46 + x.measureText(t).width + 30; });
    // zemljani radovi i trošak
    let y = 1300; x.fillStyle = '#0f172a'; x.font = '700 28px system-ui'; x.fillText('Zemljani radovi i procjena troška (orijentaciono)', 50, y);
    const red = [['Iskop', fn(m.iskop) + ' m³', fn(m.iskop * m.cijene.zemljani) + ' KM'], ['Nasip', fn(m.nasip) + ' m³', fn(m.nasip * m.cijene.zemljani) + ' KM'], ['Nova trasa (kolovoz)', fm(m.nova), fn(m.nova * m.cijene.nova) + ' KM'], ['Potporni zid', fm(m.zid), fn(m.zid * m.cijene.zid) + ' KM'], ['Postojeći put (bez troška)', fm(m.ex), '—'], ['UKUPNO', '', fn(m.trosak) + ' KM']];
    x.font = '24px system-ui'; red.forEach((r, i) => { const ry = y + 44 + i * 40; if (i === red.length - 1) { x.fillStyle = '#dcfce7'; x.fillRect(50, ry - 28, 1140, 38); x.font = '700 24px system-ui'; } x.fillStyle = '#0f172a'; x.fillText(r[0], 64, ry); x.fillText(r[1], 600, ry); x.textAlign = 'right'; x.fillText(r[2], 1176, ry); x.textAlign = 'left'; });
    // poređenje varijanti
    y = 1610;
    if (u.varijante && u.varijante.length > 1) {
      x.fillStyle = '#0f172a'; x.font = '700 24px system-ui'; x.fillText('Poređenje varijanti', 50, y - 26);
      x.font = '20px system-ui';
      u.varijante.slice(0, 4).forEach((v, i) => { const t = `${v.naziv}: ${fm(v.m.dist)} · maks ${v.m.maxN.toFixed(1)} % · iskop ${fn(v.m.iskop)} m³ · ${fn(v.m.trosak)} KM`; x.fillStyle = v.najjeftinija ? '#15803d' : '#334155'; x.fillText((v.najjeftinija ? '★ ' : '') + t, 64, y + i * 28); });
    } else { x.fillStyle = '#64748b'; x.font = '20px system-ui'; x.fillText('Parametri: max nagib ' + P.nagibMax + ' %, preporučeni ' + P.nagibPreporuceni + ' %, širina puta ' + P.sirinaPuta + ' m.', 50, y); }
    x.fillStyle = '#94a3b8'; x.font = '18px system-ui'; x.fillText('Orijentacioni proračun iz DEM-a (Copernicus 30 m); cijene su unesene vrijednosti.', 50, 1712); x.fillText('Prije izgradnje obavezan terenski pregled i izvedbeni projekat.', 50, 1736);
    return m;
  }
  root.USFPutIzv = { metrike, najbolji, pdfIzJpeg, crtaj, CIJENE_ZADANO };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.USFPutIzv;
})(typeof window !== 'undefined' ? window : globalThis);
