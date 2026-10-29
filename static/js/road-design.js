// =====================================================================
// PROJEKTOVANJE ŠUMSKOG PUTA (RD = Road Design) — izdvojeno iz monolita,
// po istom obrascu kao static/js/offline-layer.js (vidi docs/MODULARIZACIJA.md).
// Učitava se <script src>-om, top-level const/function su globalno vidljivi
// narednim inline <script> blokovima u index.html.
//
// FAZA 1 (osnovni end-to-end tok): korisnik postavi tačku A i B, algoritam
// preko DEM-a i principa šestarskog koraka (L = ΔH/i) predloži JEDNU trasu
// koja NIKAD ne prelazi maksimalni dozvoljeni uzdužni nagib. Rezultat se
// pretvara u običnu vlaku (isti obrazac kao ostale metode kreiranja vlake —
// _routeToVlaka u index.html), pa besplatno nasljeđuje postojeći editing
// (buildEditHandles) i profil (_renderElevProfile).
//
// NIJE u Fazi 1 (namjerno, vidi CLAUDE.md/plan): više varijanti trase,
// serpentine, formalna stacionaža+izvoz, poprečni nagib/vodotoci/klizišta
// kao cost-slojevi. Ovaj fajl je pisan tako da se to može dograditi kasnije
// bez prepravke jezgra (rdFindRoute uzima "sampleElev" kao ubrizganu
// funkciju — Faza 2 može ubrizgati sloj koji dodatno penalizuje vodotoke
// bez diranja pathfinding petlje).
//
// Zavisnosti: čisto samostalan modul — sve geo funkcije (azimut, tačka na
// zadanoj udaljenosti/azimutu, haversine) su OVDJE ponovo napisane (ne
// oslanja se na turf/proj4 iz ostatka app-a), da bi jezgro bilo testabilno
// u Node-u bez browsera (vidi tests/js/road-design.test.js). Kod poziva iz
// index.html (glue kod) SLOBODNO koristi postojeće dst()/wgsToMGI/turf —
// ovaj fajl samo ne zavisi od njih.
// =====================================================================

const RD_PARAMS_KEY = 'tvlake_rd_params';

// Sve vrijednosti su podesive (tačka 2 specifikacije) — ovo su samo default-i
// pri prvom otvaranju alata, korisnik ih mijenja u panelu "Parametri trase".
const RD_DEFAULT_PARAMS = {
  nagibMax: 8,              // maksimalni uzdužni nagib (%) — TVRDA granica, nikad se ne prelazi
  nagibPreporuceni: 6,       // preporučeni uzdužni nagib (%) — cilj šestarskog koraka
  nagibMin: 1.5,             // minimalni uzdužni nagib (%) — informativno u Fazi 1 (odvodnjavanje)
  poprecniNagibMax: 60,      // maks. poprečni nagib terena koji se prihvata (%) — rezervisano za Fazu 2
  radijusMin: 12,            // minimalni radijus horizontalne krivine (m) — rezervisano za Fazu 2 (serpentine)
  radijusMax: 60,            // maksimalni radijus po potrebi (m) — rezervisano
  sirinaKolovoza: 3.5,       // m
  sirinaBankine: 0.5,        // m
  sirinaPuta: 4.5,           // m (kolovoz + bankine)
  duzinaMax: 8000,           // maksimalna dozvoljena dužina trase (m) — sigurnosna kočnica pretrage
  toleranNagib: 1,           // dozvoljena tolerancija nagiba (%) — rezervisano za Fazu 2 (blaže upozorenje)
  minRazmakSerpentina: 40,   // m — rezervisano za Fazu 2 (pune geometrijske serpentine)
  bezSerpentina: true        // true = zabrani oštre zaokrete (skoro-obrtanje smjera) — vidi RD_MAX_TURN_NO_SERPENTINE
};

// Prag (°) preko kojeg se zaokret u pretrazi smatra "serpentinom" (skoro-
// obrtanje smjera radi savladavanja nagiba na malom prostoru), a ne običnim
// skretanjem oko prepreke/konture. Kad je params.bezSerpentina uključeno,
// ovakvi kandidati se TVRDO odbacuju (isti princip kao hard-cutoff nagiba) —
// ako terenu ipak treba serpentina da zadovolji max nagib, pretraga vraća
// ok:false umjesto da je ipak napravi.
const RD_MAX_TURN_NO_SERPENTINE = 100;

function rdLoadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(RD_PARAMS_KEY));
    return Object.assign({}, RD_DEFAULT_PARAMS, saved || {});
  } catch(e) { return Object.assign({}, RD_DEFAULT_PARAMS); }
}

function rdSaveParams(params) {
  try { localStorage.setItem(RD_PARAMS_KEY, JSON.stringify(params)); } catch(e) {}
}

// ─── Geodezija (samostalna, bez vanjskih zavisnosti) ──────────────────────

function rdHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const a = Math.sin((lat2-lat1)*Math.PI/360)**2 +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin((lon2-lon1)*Math.PI/360)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Azimut (smjer) od tačke 1 ka tački 2, 0-360°, 0=sjever.
function rdAzimuth(lat1, lon1, lat2, lon2) {
  const φ1 = lat1*Math.PI/180, φ2 = lat2*Math.PI/180, Δλ = (lon2-lon1)*Math.PI/180;
  const y = Math.sin(Δλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y, x)*180/Math.PI + 360) % 360;
}

// Tačka na zadanoj udaljenosti (m) i azimutu (°) od polazne tačke.
function rdDestPoint(lat, lon, azimuthDeg, distM) {
  const R = 6371000;
  const brng = azimuthDeg*Math.PI/180;
  const lat1 = lat*Math.PI/180, lon1 = lon*Math.PI/180;
  const dR = distM/R;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(dR) + Math.cos(lat1)*Math.sin(dR)*Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(dR)*Math.cos(lat1), Math.cos(dR)-Math.sin(lat1)*Math.sin(lat2));
  return { lat: lat2*180/Math.PI, lon: ((lon2*180/Math.PI + 540) % 360) - 180 };
}

// Šestarski korak: horizontalna udaljenost potrebna da se savlada visinska
// razlika ΔH uz zadani nagib i (%). L = ΔH / i.  (tačka 3 specifikacije)
function rdSestarKorak(deltaH, nagibPct) {
  const i = Math.max(0.1, nagibPct)/100;
  return Math.abs(deltaH)/i;
}

// ─── Pregled A→B prije generisanja (tačka 1: distanca/azimut/visinska razlika) ──

function rdPreview(startLat, startLon, startElev, endLat, endLon, endElev) {
  const dist = rdHaversine(startLat, startLon, endLat, endLon);
  const az = rdAzimuth(startLat, startLon, endLat, endLon);
  const dh = endElev - startElev;
  return {
    distM: dist,
    azimuthDeg: az,
    elevStart: startElev,
    elevEnd: endElev,
    deltaH: dh,
    directSlopePct: dist > 0 ? Math.abs(dh)/dist*100 : 0
  };
}

// Binarni min-heap za "open" listu A* pretrage. Prvobitna verzija je (kao i
// postojeći _astarRoute u index.html) koristila obično sortiranje niza pri
// svakom skidanju elementa (O(n log n) PO ITERACIJI) — dovoljno brzo za
// kratke trase, ali kod dužih/strmijih (gdje treba puno cik-cak koraka i
// open lista naraste na hiljade) to dominira vremenom izvršavanja i na
// realnom telefonu (sporiji CPU od dev mašine) može izgledati kao da se
// alat zaledio. Heap svodi skidanje/dodavanje na O(log n).
function _rdHeapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= heap[i].f) break;
    const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
    i = parent;
  }
}
function _rdHeapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    const n = heap.length;
    while (true) {
      const l = 2*i+1, r = 2*i+2;
      let smallest = i;
      if (l < n && heap[l].f < heap[smallest].f) smallest = l;
      if (r < n && heap[r].f < heap[smallest].f) smallest = r;
      if (smallest === i) break;
      const tmp = heap[smallest]; heap[smallest] = heap[i]; heap[i] = tmp;
      i = smallest;
    }
  }
  return top;
}

// ─── Jezgro: A* vođen šestarskim korakom preko kontinualnog DEM prostora ──
//
// Za razliku od rasterskog A* (fiksne susjedne ćelije grida), ovdje se
// kandidati generišu DINAMIČKI za svaki čvor: koristi se šestarski princip
// (L = preostala visinska razlika / preporučeni nagib) da se odredi POD
// KOJIM UGLOM u odnosu na direktan pravac ka cilju treba skrenuti da bi
// pravolinijski korak te dužine ostvario preporučeni nagib (kontura umjesto
// prave linije uzbrdo/nizbrdo) — tačka 3 specifikacije, ne interpolacija.
// Stvarna ostvarena kosina svakog koraka provjerava se PRAVOM DEM
// elevacijom (sampleElev), pa kandidat koji stvarno prelazi nagibMax biva
// ODBAČEN, bez obzira na idealizovanu pretpostavku ugla.
//
// opts: { startLat, startLon, endLat, endLon, sampleElev(lat,lon)->m|null,
//         params, maxIterations }
// Vraća: { ok, path:[{lat,lon,elev}], reason } — reason popunjen kad !ok.
function rdFindRoute(opts) {
  const {
    startLat, startLon, endLat, endLon, sampleElev, params,
    maxIterations = 4000
  } = opts;
  // opts.stat (opcionalno) = brojači za dijagnostiku (Postavke → Dijagnostika trase); bez njega se ništa ne mjeri.
  const st = opts.stat || null;
  if (st) Object.assign(st, { it: 0, otvoreno: 0, bezDem: 0, prestrmo: 0, serp: 0, zatvoreno: 0, najblize: Infinity, preDuga: 0, maxIt: maxIterations });

  const elevStart = sampleElev(startLat, startLon);
  const elevEnd = sampleElev(endLat, endLon);
  if (elevStart == null || elevEnd == null) {
    return { ok: false, reason: 'DEM_MISSING', path: null };
  }

  const iPreferred = Math.max(0.1, params.nagibPreporuceni)/100;
  const nagibMax = params.nagibMax;
  const reachTol = 15;       // m — smatraj cilj dostignutim unutar ovog radijusa
  const stepMin = 12, stepMax = 60, chunkTarget = 40; // m — granice dužine jednog koraka pretrage
  const dedupCellM = 8;      // m — rezolucija zatvorenog skupa (sprječava eksploziju čvorova)

  // Lokalna ravninska projekcija (equirect. aprox.) SAMO za ključeve zatvorenog
  // skupa — stvarno kretanje i dalje ide preko prave geodezije (rdDestPoint).
  const lat0 = startLat, cosLat0 = Math.max(0.15, Math.cos(lat0*Math.PI/180));
  const keyFor = (lat, lon) => {
    const x = (lon-startLon)*111320*cosLat0;
    const y = (lat-startLat)*111320;
    return Math.round(x/dedupCellM) + ':' + Math.round(y/dedupCellM);
  };

  const startKey = keyFor(startLat, startLon);
  const nodes = new Map();  // key -> {lat,lon,elev,parentKey,g,azIn}
  nodes.set(startKey, { lat: startLat, lon: startLon, elev: elevStart, parentKey: null, g: 0, len: 0, azIn: null });

  const closed = new Set();
  const open = [];
  _rdHeapPush(open, { f: rdHaversine(startLat, startLon, endLat, endLon), key: startKey });

  const offsets = [0, 20, -20, 45, -45, 70, -70, 100, -100, 135, -135];

  let reachedKey = null;
  let iterations = 0;

  while (open.length && iterations++ < maxIterations) {
    const cur = _rdHeapPop(open);
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);
    if (st) st.it++;

    const node = nodes.get(cur.key);
    const dRemaining = rdHaversine(node.lat, node.lon, endLat, endLon);
    if (st && dRemaining < st.najblize) st.najblize = dRemaining;
    if (dRemaining <= reachTol) { reachedKey = cur.key; break; }
    if (node.len > params.duzinaMax) { if (st) st.preDuga++; continue; } // sigurnosna kočnica — predugo, odustani od ove grane

    const azToGoal = rdAzimuth(node.lat, node.lon, endLat, endLon);
    const dhRemaining = elevEnd - node.elev;
    const lNeeded = rdSestarKorak(dhRemaining, params.nagibPreporuceni);

    // Idealan ugao skretanja od direktnog pravca — geometrija šestarskog
    // koraka: hod dužine lNeeded pod uglom phi od direktnog pravca napravi
    // neto napredak dRemaining ka cilju ako je cos(phi) = dRemaining/lNeeded.
    // Kad lNeeded <= dRemaining, teren (uz preporučeni nagib) dozvoljava
    // gotovo direktan pravac — phi ≈ 0.
    let phi = 0;
    if (lNeeded > dRemaining && dRemaining > 0.5) {
      phi = Math.acos(Math.max(-1, Math.min(1, dRemaining/lNeeded))) * 180/Math.PI;
    }
    const stepLen = Math.max(stepMin, Math.min(stepMax, dRemaining <= reachTol*3 ? dRemaining : chunkTarget));

    for (const off of offsets) {
      // Kandidati su centrirani oko ±phi (šestarski ugao) uz direktan (0)
      // pravac kao rezervu ako teren ipak dozvoljava pravolinijski nastavak.
      const angle = off === 0 ? 0 : (off > 0 ? phi + off - 20 : -phi + off + 20);
      const az = (azToGoal + angle + 360) % 360;
      const L = Math.min(stepLen, dRemaining < reachTol ? dRemaining : stepLen);
      if (L < 1) continue;

      const cand = rdDestPoint(node.lat, node.lon, az, L);
      const candElev = sampleElev(cand.lat, cand.lon);
      if (candElev == null) { if (st) st.bezDem++; continue; } // van DEM pokrivenosti — preskoči pravac

      const slopePct = Math.abs(candElev - node.elev)/L*100;
      if (slopePct > nagibMax) { if (st) st.prestrmo++; continue; } // TVRDO odbačen kandidat — nikad se ne prelazi max nagib

      // Ugao skretanja u odnosu na ULAZNI pravac u ovaj čvor (ne u odnosu na
      // pravac ka cilju) — koristi se ISKLJUČIVO za bezSerpentina TVRDI
      // cutoff ispod (isto mjesto gdje se odbacuje nagib), NE za kaznu u
      // cost funkciji (vidi napomenu ispod zašto je ta kazna uklonjena).
      let turnDiff = 0;
      if (node.azIn != null) {
        turnDiff = Math.abs(az - node.azIn);
        if (turnDiff > 180) turnDiff = 360 - turnDiff;
      }
      if (params.bezSerpentina && turnDiff > RD_MAX_TURN_NO_SERPENTINE) { if (st) st.serp++; continue; } // TVRDO odbačen — serpentina zabranjena

      let penalty = 1;
      if (slopePct > params.nagibPreporuceni*1.5) penalty = 3.5;
      else if (slopePct > params.nagibPreporuceni) penalty = 1.8;
      const angPenalty = 1 + Math.abs(off)/400; // blaga kazna za skretanje, da ne luta bez potrebe

      // NAPOMENA (regresija otkrivena i uklonjena poslije v3.95.1): ovdje je
      // ranije postojala i kvadratna "turnPenalty" kazna za promjenu smjera
      // u odnosu na prethodni korak, uvedena da spriječi cik-cak na malom
      // prostoru. Mjerenja su pokazala da je BILA ŠTETNA na stvarnom terenu
      // koji zahtijeva pravu serpentinu: na terenu gdje je serpentina jedini
      // način da se zadovolji max nagib, kazna je iskrivila prioritet
      // pretrage tako da (a) na kraćim trasama nađe znatno DUŽI put nego
      // bez nje (izmjereno: 4.03× umjesto 2.77× prave linije, isti teren),
      // ili (b) na dužim trasama (~1km+) pretraga uopšte NE USPIJE naći
      // rješenje unutar realnog budžeta iteracija. Anti-cik-cak cilj i dalje
      // je ostvaren — ali isključivo kroz _rdSmoothPath (string-pulling
      // zaglađivanje poslije pretrage, ispod), koje je dovoljno samo za sebe
      // (nikad ne može PRODUŽITI trasu, samo skratiti kad prava linija
      // između dvije tačke zadovoljava max nagib) i ne pati od ovog problema
      // jer ne utiče na TOK same pretrage, samo čisti rezultat naknadno.

      const candKey = keyFor(cand.lat, cand.lon);
      if (closed.has(candKey)) { if (st) st.zatvoreno++; continue; }
      const tentG = node.g + L*penalty*angPenalty;

      const existing = nodes.get(candKey);
      if (!existing || tentG < existing.g) {
        nodes.set(candKey, { lat: cand.lat, lon: cand.lon, elev: candElev, parentKey: cur.key, g: tentG, len: node.len + L, azIn: az });
        const f = tentG + rdHaversine(cand.lat, cand.lon, endLat, endLon);
        _rdHeapPush(open, { f, key: candKey });
      }
    }
  }

  if (st) { st.otvoreno = open.length; st.iscrpljen = !reachedKey && open.length > 0; }
  if (!reachedKey) return { ok: false, reason: 'NO_ROUTE', path: null };

  const path = [];
  let k = reachedKey;
  while (k !== null) {
    const n = nodes.get(k);
    path.unshift({ lat: n.lat, lon: n.lon, elev: n.elev });
    k = n.parentKey;
  }
  // Posljednja tačka pretrage je unutar reachTol od B, ne tačno B — dodaj pravu
  // krajnju tačku da trasa doslovno završi na B (kratak, blag posljednji segment).
  const last = path[path.length-1];
  if (rdHaversine(last.lat, last.lon, endLat, endLon) > 0.5) {
    path.push({ lat: endLat, lon: endLon, elev: elevEnd });
  }
  return { ok: true, reason: null, path: _rdSmoothPath(path, sampleElev, nagibMax) };
}

// ─── Pro-level zaglađivanje trase (string-pulling / line-of-sight shortcut) ──
// Pretraga bira ugao svakog koraka dinamički (šestarski princip), pa i uz
// kaznu za zaokret (turnPenalty gore) zna ostaviti sitno cik-cak na malom
// prostoru gdje bi prava linija između dvije NE-susjedne tačke trase bila
// potpuno prihvatljiva. Ovaj prolaz to uklanja: za svaku tačku traži
// NAJDALJU sljedeću tačku do koje prava linija — provjerena stvarnom DEM
// elevacijom na svakih ~10m, ne samo na krajevima — nigdje ne prelazi
// nagibMax, i preskače sve tačke između. Nikad ne može proizvesti segment
// preko max nagiba: svaka kandidat-linija se provjerava punom rezolucijom
// prije prihvatanja (isti hard-cutoff princip kao u samoj pretrazi).
function _rdLineWithinGrade(a, b, sampleElev, nagibMax) {
  const dist = rdHaversine(a.lat, a.lon, b.lat, b.lon);
  if (dist < 0.5) return true;
  const az = rdAzimuth(a.lat, a.lon, b.lat, b.lon);
  const checkStep = 10; // m — rezolucija provjere nagiba duž kandidat-linije
  const n = Math.max(1, Math.round(dist/checkStep));
  let prevElev = a.elev, prevD = 0;
  for (let s = 1; s <= n; s++) {
    const d = dist*s/n;
    const pt = rdDestPoint(a.lat, a.lon, az, d);
    const e = s === n ? b.elev : sampleElev(pt.lat, pt.lon);
    if (e == null) return false;
    const segD = d - prevD;
    if (segD > 0.01 && Math.abs(e - prevElev)/segD*100 > nagibMax) return false;
    prevElev = e; prevD = d;
  }
  return true;
}

function _rdSmoothPath(path, sampleElev, nagibMax) {
  if (path.length < 3) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !_rdLineWithinGrade(path[i], path[j], sampleElev, nagibMax)) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}


// ─── Zaobljavanje krivina (bez oštrih lomova) ──────────────────────────────
// Pretraga i string-pulling daju poligonalnu liniju s ravnim ćoškovima. Svaki unutrašnji vrh
// zamjenjujemo glatkim lukom (kvadratna Bezier tangentna na oba kraka): tangenta t = R·tan(θ/2)
// za radijus `radijusMin` (min. radijus iz parametara), ali najviše 45 % susjednih krakova da se
// lukovi dva susjedna vrha nikad ne preklope. Pri vrlo oštrom zaokretu na kratkim krakovima luk
// je širi od R koliko krakovi dozvoljavaju — i dalje bez ćoška. Visine novih tačaka se čitaju iz
// DEM-a; ako luk na bilo kojem djelu pređe nagibMax, taj vrh ostaje kakav je (hard cutoff kao u pretrazi).
function rdZaobli(path, sampleElev, params) {
  if (!path || path.length < 3) return path;
  const R = Math.max(8, params.radijusMin || 12);
  const lat0 = path[0].lat, cosL = Math.max(0.15, Math.cos(lat0 * Math.PI / 180));
  const X = q => (q.lon - path[0].lon) * 111320 * cosL, Y = q => (q.lat - lat0) * 111320;
  const ll = (x, y) => ({ lat: lat0 + y / 111320, lon: path[0].lon + x / (111320 * cosL) });
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], v = path[i], b = path[i + 1];
    const ax = X(a), ay = Y(a), vx = X(v), vy = Y(v), bx = X(b), by = Y(b);
    const l1 = Math.hypot(vx - ax, vy - ay), l2 = Math.hypot(bx - vx, by - vy);
    if (l1 < 1 || l2 < 1) { out.push(v); continue; }
    const u1x = (vx - ax) / l1, u1y = (vy - ay) / l1, u2x = (bx - vx) / l2, u2y = (by - vy) / l2;
    const theta = Math.acos(Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y))); // zaokret smjera
    if (theta < 0.05) { out.push(v); continue; }
    const t = Math.min(R * Math.tan(Math.min(theta, Math.PI * 0.93) / 2), 0.45 * l1, 0.45 * l2);
    const px = vx - u1x * t, py = vy - u1y * t, qx = vx + u2x * t, qy = vy + u2y * t;
    const n = Math.max(5, Math.ceil(theta * Math.min(R, t / Math.max(0.2, Math.tan(theta / 2))) / 6));
    const prev = out[out.length - 1], nova = [];
    for (let k = 0; k <= n; k++) {
      const f = k / n, g = 1 - f;
      const x = g * g * px + 2 * g * f * vx + f * f * qx, y = g * g * py + 2 * g * f * vy + f * f * qy;
      const pt = ll(x, y), e = sampleElev(pt.lat, pt.lon);
      nova.push({ lat: pt.lat, lon: pt.lon, elev: Number.isFinite(e) ? e : v.elev });
    }
    // Provjera nagiba od prethodne tačke preko luka do sljedećeg vrha.
    const niz = [prev, ...nova, b];
    let ok = true;
    for (let k = 1; k < niz.length; k++) {
      const d = rdHaversine(niz[k - 1].lat, niz[k - 1].lon, niz[k].lat, niz[k].lon);
      if (d > 0.5 && Math.abs(niz[k].elev - niz[k - 1].elev) / d * 100 > params.nagibMax) { ok = false; break; }
    }
    if (ok) nova.forEach(q => out.push(q)); else out.push(v);
  }
  out.push(path[path.length - 1]);
  return out;
}


// ─── Postojeći putevi (KML „Kamionski putevi”) i „idealna” trasa ────────────
// Indeks puteva: svaka linija se zgusne na tačke ≤ 15 m razmaka (čvorovi grafa) i smjesti u mrežu 30 m.
// `blizu(lat, lon, r)` = najbliži čvor puta unutar r metara (ili null); čvorovi su povezani duž linije,
// a čvorovi različitih linija na ≤ 6 m (raskrsnica) međusobno.
function rdIndeksPuteva(linije, sampleElev) {
  const cvorovi = [], G = 30, grid = new Map();
  const lat0 = linije.length && linije[0].length ? linije[0][0][0] : 44.5, cosL = Math.max(0.15, Math.cos(lat0 * Math.PI / 180));
  const X = lon => lon * 111320 * cosL, Y = lat => lat * 111320;
  const kljuc = (x, y) => Math.floor(x / G) + ':' + Math.floor(y / G);
  const dodaj = (lat, lon) => { const i = cvorovi.length; cvorovi.push({ lat, lon, x: X(lon), y: Y(lat), elev: sampleElev ? sampleElev(lat, lon) : null, adj: [] }); const k = kljuc(cvorovi[i].x, cvorovi[i].y); (grid.get(k) || grid.set(k, []).get(k)).push(i); return i; };
  linije.forEach(P => {
    let prev = -1;
    for (let j = 0; j < P.length; j++) {
      const a = P[j - 1], b = P[j];
      if (j > 0) {
        const d = rdHaversine(a[0], a[1], b[0], b[1]), n = Math.max(1, Math.ceil(d / 15));
        for (let m = 1; m <= n; m++) {
          const t = m / n, i = dodaj(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
          if (prev >= 0) { cvorovi[prev].adj.push(i); cvorovi[i].adj.push(prev); }
          prev = i;
        }
      } else prev = dodaj(b[0], b[1]);
    }
  });
  const okolo = (x, y, r, f) => { const c = Math.ceil(r / G); const gx = Math.floor(x / G), gy = Math.floor(y / G); for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) { const l = grid.get((gx + i) + ':' + (gy + j)); if (l) l.forEach(f); } };
  // raskrsnice: čvorovi različitih linija na ≤ 6 m
  cvorovi.forEach((c, i) => okolo(c.x, c.y, 6, j => { if (j > i && Math.hypot(cvorovi[j].x - c.x, cvorovi[j].y - c.y) <= 6 && !c.adj.includes(j)) { c.adj.push(j); cvorovi[j].adj.push(i); } }));
  const najblizi = (lat, lon, r) => { const x = X(lon), y = Y(lat); let best = null, bd = r; okolo(x, y, r, i => { const d = Math.hypot(cvorovi[i].x - x, cvorovi[i].y - y); if (d <= bd) { bd = d; best = i; } }); return best === null ? null : { i: best, d: bd }; };
  return { cvorovi, najblizi, blizu: (lat, lon, r) => !!najblizi(lat, lon, r), n: cvorovi.length };
}

// Idealna trasa: početak može biti bilo gdje u krugu `zonaR` oko A, kraj bilo gdje u krugu oko B; cijena =
// dužina × kazna nagiba × (1 + 4·poprečni nagib) — poprečni nagib je zamjena za zemljane radove (usjek/nasip),
// pa je najjeftinija trasa ona s najmanje radova. Postojeći putevi su skoro besplatni (0,12 × dužine, bez ograničenja nagiba).
// Pristup od A do početka i od kraja do B se plaća 0,3 × dužine da trasa ne odluta daleko od zadanih tačaka.
function rdFindIdeal(opts) {
  const { startLat, startLon, endLat, endLon, sampleElev, params, zonaR = 250, maxIterations = 120000, indeks = null } = opts;
  const st = opts.stat || null;
  const nagibMax = params.nagibMax, pref = Math.max(0.1, params.nagibPreporuceni) / 100;
  const lat0 = startLat, cosL = Math.max(0.15, Math.cos(lat0 * Math.PI / 180));
  const X = lon => (lon - startLon) * 111320 * cosL, Y = lat => (lat - startLat) * 111320;
  const keyFor = (lat, lon) => Math.round(X(lon) / 8) + ':' + Math.round(Y(lat) / 8);
  const nodes = new Map(), closed = new Set(), open = [];
  const dB = (lat, lon) => rdHaversine(lat, lon, endLat, endLon);
  const put = (key, n, f) => { const e = nodes.get(key); if (!e || n.g < e.g) { nodes.set(key, n); _rdHeapPush(open, { f, key }); } };
  const hOf = (lat, lon) => Math.max(0, dB(lat, lon) - zonaR) * 1.4;
  if (st) Object.assign(st, { it: 0, strmo: 0, poprecno: 0, serp: 0, najblize: Infinity, naPutu: 0, iscrpljen: false });
  // izvori: mreža 50 m unutar zone A
  for (let dx = -zonaR; dx <= zonaR; dx += 50) for (let dy = -zonaR; dy <= zonaR; dy += 50) {
    if (Math.hypot(dx, dy) > zonaR) continue;
    const pt = rdDestPoint(rdDestPoint(startLat, startLon, 90, dx).lat, rdDestPoint(startLat, startLon, 90, dx).lon, 0, dy);
    const e = sampleElev(pt.lat, pt.lon); if (e == null) continue;
    const g = 0.3 * Math.hypot(dx, dy);
    put(keyFor(pt.lat, pt.lon), { lat: pt.lat, lon: pt.lon, elev: e, parent: null, g, len: 0, azIn: null, ex: false }, g + hOf(pt.lat, pt.lon));
  }
  if (indeks) indeks.cvorovi.forEach((c, i) => { const d = rdHaversine(startLat, startLon, c.lat, c.lon); if (d <= zonaR && c.elev != null) { const g = 0.3 * d; put('r' + i, { lat: c.lat, lon: c.lon, elev: c.elev, parent: null, g, len: 0, azIn: null, ex: false, road: i }, g + hOf(c.lat, c.lon)); } });
  const offsets = [0, 20, -20, 45, -45, 70, -70, 100, -100, 135, -135];
  let goalKey = null, it = 0;
  while (open.length && it++ < maxIterations) {
    const cur = _rdHeapPop(open);
    if (cur.goal) { goalKey = cur.goal; break; }
    if (closed.has(cur.key)) continue; closed.add(cur.key);
    const node = nodes.get(cur.key); if (!node) continue;
    if (st) { st.it++; }
    const d = dB(node.lat, node.lon);
    if (st && d < st.najblize) st.najblize = d;
    if (d <= zonaR) { _rdHeapPush(open, { f: node.g + 0.3 * d, goal: cur.key }); }
    if (node.len > params.duzinaMax) continue;
    // 1) kretanje po postojećem putu
    if (node.road != null && indeks) {
      indeks.cvorovi[node.road].adj.forEach(j => {
        const c = indeks.cvorovi[j]; if (c.elev == null || closed.has('r' + j)) return;
        const L = rdHaversine(node.lat, node.lon, c.lat, c.lon), g = node.g + L * 0.12;
        put('r' + j, { lat: c.lat, lon: c.lon, elev: c.elev, parent: cur.key, g, len: node.len + L, azIn: rdAzimuth(node.lat, node.lon, c.lat, c.lon), ex: true, road: j }, g + hOf(c.lat, c.lon));
        if (st) st.naPutu++;
      });
    }
    // 2) novi put: šestarski ugao prema B
    const azG = rdAzimuth(node.lat, node.lon, endLat, endLon);
    const ciljElev = sampleElev(endLat, endLon) ?? node.elev, dh = ciljElev - node.elev, lNeed = rdSestarKorak(dh, params.nagibPreporuceni);
    let phi = 0; if (lNeed > d && d > 0.5) phi = Math.acos(Math.max(-1, Math.min(1, d / lNeed))) * 180 / Math.PI;
    const stepLen = Math.max(12, Math.min(60, d <= 60 ? Math.max(12, d) : 40));
    for (const off of offsets) {
      const ang = off === 0 ? 0 : (off > 0 ? phi + off - 20 : -phi + off + 20), az = (azG + ang + 360) % 360, L = stepLen;
      let cand = rdDestPoint(node.lat, node.lon, az, L), candElev = sampleElev(cand.lat, cand.lon); if (candElev == null) continue;
      let road = null;
      if (indeks) { const sn = indeks.najblizi(cand.lat, cand.lon, 12); if (sn) { const c = indeks.cvorovi[sn.i]; if (c.elev != null) { cand = { lat: c.lat, lon: c.lon }; candElev = c.elev; road = sn.i; } } }
      const Lr = road != null ? rdHaversine(node.lat, node.lon, cand.lat, cand.lon) : L;
      const slope = Math.abs(candElev - node.elev) / Math.max(1, Lr) * 100;
      if (slope > nagibMax) { if (st) st.strmo++; continue; }
      let turn = 0; if (node.azIn != null) { turn = Math.abs(az - node.azIn); if (turn > 180) turn = 360 - turn; }
      if (params.bezSerpentina && turn > RD_MAX_TURN_NO_SERPENTINE) { if (st) st.serp++; continue; }
      const pa = rdDestPoint(cand.lat, cand.lon, (az + 90) % 360, 10), pb = rdDestPoint(cand.lat, cand.lon, (az + 270) % 360, 10);
      const eA = sampleElev(pa.lat, pa.lon), eB = sampleElev(pb.lat, pb.lon);
      let cross = 0; if (eA != null && eB != null) cross = Math.abs(eA - eB) / 20;
      if (cross * 100 > params.poprecniNagibMax) { if (st) st.poprecno++; continue; }
      const kazna = slope > params.nagibPreporuceni ? 1.8 + 3.2 * Math.min(1, (slope - params.nagibPreporuceni) / Math.max(1, nagibMax - params.nagibPreporuceni)) : 1;
      const key = road != null ? 'r' + road : keyFor(cand.lat, cand.lon);
      if (closed.has(key)) continue;
      const g = node.g + Lr * (road != null ? 1 : kazna * (1 + 4 * cross));
      put(key, { lat: cand.lat, lon: cand.lon, elev: candElev, parent: cur.key, g, len: node.len + Lr, azIn: az, ex: false, road: road != null ? road : undefined }, g + hOf(cand.lat, cand.lon));
    }
  }
  if (st) st.iscrpljen = !goalKey && open.length > 0;
  if (!goalKey) return { ok: false, reason: 'NO_ROUTE', path: null };
  const path = []; let k = goalKey;
  while (k) { const n = nodes.get(k); path.unshift({ lat: n.lat, lon: n.lon, elev: n.elev, ex: !!n.ex }); k = n.parent; }
  return { ok: true, path, pristupA: rdHaversine(startLat, startLon, path[0].lat, path[0].lon), pristupB: rdHaversine(endLat, endLon, path[path.length - 1].lat, path[path.length - 1].lon) };
}

function rdPojednostavi(path, sampleElev, nagibMax) { return _rdSmoothPath(path, sampleElev, nagibMax); }

// ─── Validacija generisane trase (tačka 13 — osnovna verzija za Fazu 1) ───
// Vraća statistiku po segmentu + globalne min/max/prosjek, i nivo upozorenja
// (crveno/narandžasto/zeleno) po segmentu prema parametrima.
function rdValidateRoute(path, params) {
  const segments = [];
  let totalDist = 0, maxSlope = 0, slopeSum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i];
    const d = rdHaversine(a.lat, a.lon, b.lat, b.lon);
    if (d < 0.01) continue;
    const slopePct = Math.abs(b.elev - a.elev)/d*100;
    const az = rdAzimuth(a.lat, a.lon, b.lat, b.lon);
    let level = 'ok';
    if (slopePct > params.nagibMax) level = 'bad';        // crveno — ne bi smjelo doći do ovoga (hard cutoff u pretrazi)
    else if (slopePct > params.nagibPreporuceni) level = 'warn'; // narandžasto — dozvoljeno, ali iznad preporučenog
    segments.push({ i, distM: d, slopePct, azimuthDeg: az, level, elevFrom: a.elev, elevTo: b.elev });
    totalDist += d;
    maxSlope = Math.max(maxSlope, slopePct);
    slopeSum += slopePct*d;
  }
  return {
    segments,
    totalDist,
    maxSlopePct: maxSlope,
    avgSlopePct: totalDist > 0 ? slopeSum/totalDist : 0,
    anyExceedsMax: segments.some(s => s.level === 'bad')
  };
}

// ─── Stacionaže: tačke svakih `korak` m duž trase (0+000, 0+100, …, kraj) ───
function rdStacionaze(path, korak) {
  const out = [];
  if (!path || path.length < 2) return out;
  let pred = 0, sljedeca = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i], d = rdHaversine(a.lat, a.lon, b.lat, b.lon);
    while (sljedeca <= pred + d + 1e-9) {
      const t = d > 0 ? (sljedeca - pred) / d : 0;
      out.push({ dist: sljedeca, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, elev: a.elev + (b.elev - a.elev) * t });
      sljedeca += korak;
    }
    pred += d;
  }
  const z = path[path.length - 1];
  if (!out.length || pred - out[out.length - 1].dist > 1) out.push({ dist: pred, lat: z.lat, lon: z.lon, elev: z.elev, kraj: true });
  return out;
}
function rdStacionazaTxt(m) { const km = Math.floor(m / 1000), r = Math.round(m - km * 1000); return km + '+' + String(r === 1000 ? 999 : r).padStart(3, '0'); }

// ─── Poprečni nagib terena duž trase (usjek/nasip, potporni zidovi) ───
// Na sredini svakog segmenta: visine ±pola m okomito na smjer trase.
const RD_POPRECNI_KLASE = [
  { max: 30, boja: '#22c55e', naziv: 'blag (<30 %)', opis: 'mješoviti profil, lako' },
  { max: 50, boja: '#facc15', naziv: '30–50 %', opis: 'usjek i nasip' },
  { max: 70, boja: '#f97316', naziv: '50–70 %', opis: 'pretežno puni usjek' },
  { max: Infinity, boja: '#dc2626', naziv: '>70 %', opis: 'potporni zid / izbjegavati' }
];
function rdPoprecniNagib(path, sampleElev, pola) {
  pola = pola || 20;
  const seg = [];
  let ukupno = 0;
  const po = RD_POPRECNI_KLASE.map(k => ({ k, m: 0 }));
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i], d = rdHaversine(a.lat, a.lon, b.lat, b.lon);
    if (d < 0.01) continue;
    const az = rdAzimuth(a.lat, a.lon, b.lat, b.lon), mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    const l = rdDestPoint(mid.lat, mid.lon, (az + 270) % 360, pola), r = rdDestPoint(mid.lat, mid.lon, (az + 90) % 360, pola);
    const hl = sampleElev(l.lat, l.lon), hr = sampleElev(r.lat, r.lon);
    if (!Number.isFinite(hl) || !Number.isFinite(hr)) continue;
    const q = Math.abs(hl - hr) / (2 * pola) * 100;
    const ki = RD_POPRECNI_KLASE.findIndex(k => q < k.max);
    seg.push({ i, q, distM: d, klasa: ki });
    po[ki].m += d; ukupno += d;
  }
  const qs = seg.map(x => x.q);
  return { seg, ukupno, poKlasi: po, max: qs.length ? Math.max(...qs) : 0, sr: ukupno ? seg.reduce((s, x) => s + x.q * x.distM, 0) / ukupno : 0 };
}

// ─── Zemljani radovi (gruba procjena iz poprečnog nagiba) ───
// Poprečni profil: teren y = q·x, kolovoz širine B. Pokos usjeka sc (3:2 →
// 1,5; šumski putevi u tlu s kamenom), nasipa sf (1:1,5 → 0,667). Mješoviti
// profil (pola usjek, pola nasip): A = B²·q·s / (8·(s − q)) do 50 %; strmije
// se nasip ne drži (preblizu nagibu pokosa) → puni usjek: A = B²·q·sc /
// (2·(sc − q)). Od 70 % potporni zid, bez m³ — iste granice kao RD_POPRECNI_KLASE.
function rdPresjek(q, B, sc, sf, zidOd) {
  sc = sc || 1.5; sf = sf || 2 / 3; zidOd = zidOd || 0.7;
  if (q <= 0) return { iskop: 0, nasip: 0, tip: 'ravno' };
  if (q >= zidOd || q >= sc) return { iskop: NaN, nasip: 0, tip: 'zid' };
  if (q < 0.5 && q < sf) return { iskop: B * B * q * sc / (8 * (sc - q)), nasip: B * B * q * sf / (8 * (sf - q)), tip: 'mjesoviti' };
  return { iskop: B * B * q * sc / (2 * (sc - q)), nasip: 0, tip: 'usjek' };
}
function rdZemljaniRadovi(popSeg, B, sc, sf) {
  let iskop = 0, nasip = 0, zidM = 0, usjekM = 0;
  (popSeg || []).forEach(sg => {
    const p = rdPresjek(sg.q / 100, B, sc, sf);
    if (p.tip === 'zid') zidM += sg.distM;
    else { iskop += p.iskop * sg.distM; nasip += p.nasip * sg.distM; if (p.tip === 'usjek') usjekM += sg.distM; }
  });
  return { iskop, nasip, zidM, usjekM };
}

// ─── Kritične dionice: uzastopni segmenti preko nagiba ili na strmoj padini ───
function rdKriticneDionice(path, val, pop, params, popPrag) {
  popPrag = popPrag || 50;
  const q = new Map((pop && pop.seg || []).map(x => [x.i, x.q]));
  const kum = [0];
  for (let i = 1; i < path.length; i++) kum[i] = kum[i-1] + rdHaversine(path[i-1].lat, path[i-1].lon, path[i].lat, path[i].lon);
  const out = [];
  let cur = null;
  (val.segments || []).forEach(sg => {
    const qq = q.get(sg.i) || 0;
    const uzd = sg.slopePct > params.nagibMax, pp = qq >= popPrag;
    if (!uzd && !pp) { cur = null; return; }
    if (cur && cur.i1 === sg.i - 1) { cur.i1 = sg.i; cur.do = kum[sg.i]; cur.maxUzd = Math.max(cur.maxUzd, sg.slopePct); cur.maxPop = Math.max(cur.maxPop, qq); cur.uzd = cur.uzd || uzd; cur.pop = cur.pop || pp; return; }
    cur = { i0: sg.i - 1, i1: sg.i, od: kum[sg.i - 1], do: kum[sg.i], maxUzd: sg.slopePct, maxPop: qq, uzd, pop: pp };
    out.push(cur);
  });
  return out;
}

// Najbliža tačka trase dodiru: stacionaža, indeks segmenta, interpolirana visina.
function rdNaTrasi(path, lat, lon) {
  let best = null, kum = 0;
  const cos = Math.cos(lat * Math.PI / 180);
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i], d = rdHaversine(a.lat, a.lon, b.lat, b.lon);
    const ax = (a.lon - lon) * cos, ay = a.lat - lat, bx = (b.lon - lon) * cos, by = b.lat - lat;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const r = Math.hypot(ax + t * dx, ay + t * dy) * 111320;
    if (!best || r < best.r) best = { r, i, dist: kum + t * d, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, elev: a.elev + (b.elev - a.elev) * t, slopePct: d > 0.01 ? Math.abs(b.elev - a.elev) / d * 100 : 0, az: rdAzimuth(a.lat, a.lon, b.lat, b.lon) };
    kum += d;
  }
  return best;
}

// ─── Izvoz trase ───
function _rdXml(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
function rdGpx(path, naziv) {
  const pts = path.map(p => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${Number.isFinite(p.elev) ? `<ele>${p.elev.toFixed(1)}</ele>` : ''}</trkpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Grmec Navigator" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${_rdXml(naziv)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}
function rdKml(path, naziv, stacionaze, boja) {
  const c = String(boja || '#a78bfa').replace('#', ''), kmlBoja = 'ff' + c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2);
  const koord = path.map(p => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},${Number.isFinite(p.elev) ? p.elev.toFixed(1) : 0}`).join(' ');
  const st = (stacionaze || []).map(s => `<Placemark><name>${rdStacionazaTxt(s.dist)}</name><description>${Number.isFinite(s.elev) ? Math.round(s.elev) + ' m nv' : ''}</description><Point><coordinates>${s.lon.toFixed(7)},${s.lat.toFixed(7)}</coordinates></Point></Placemark>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${_rdXml(naziv)}</name><Style id="t"><LineStyle><color>${kmlBoja}</color><width>4</width></LineStyle></Style><Placemark><name>${_rdXml(naziv)}</name><styleUrl>#t</styleUrl><LineString><tessellate>1</tessellate><coordinates>${koord}</coordinates></LineString></Placemark><Folder><name>Stacionaže</name>${st}</Folder></Document></kml>`;
}

// Node.js test okruženje (tests/js/road-design.test.js) — browser globals se
// ne diraju, isti obrazac kao offline-layer.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RD_DEFAULT_PARAMS, rdHaversine, rdAzimuth, rdDestPoint, rdSestarKorak, rdPreview, rdFindRoute, rdFindIdeal, rdIndeksPuteva, rdPojednostavi, rdZaobli, rdValidateRoute, rdStacionaze, rdStacionazaTxt, RD_POPRECNI_KLASE, rdPoprecniNagib, rdGpx, rdKml, rdPresjek, rdZemljaniRadovi, rdKriticneDionice, rdNaTrasi };
}
