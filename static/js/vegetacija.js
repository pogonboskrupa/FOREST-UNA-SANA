// Vegetacijski indeksi (NDVI, EVI, NDMI, GNDVI, NBR, MSAVI, MNDWI, Tasseled Cap) i promjene (dNDVI, dNBR) iz Sentinel-2 L2A snimaka
// preko Copernicus Data Space (Sentinel Hub WMS). Korisnik unosi ID svoje
// konfiguracije (instance) — čuva se SAMO na uređaju, nikad u repozitoriju.
// Boje računa naš EVALSCRIPT (diskretna paleta → dodir na kartu vraća raspon
// vrijednosti), oblaci/sjene/snijeg (SCL) su prozirni. Promjena = prosjek čistih
// snimaka zadnjeg perioda prema istom periodu lani (mosaicking ORBIT, ≤ 4 snimka po periodu
// u preProcessScenes da PU ostane nizak) — isto doba godine, pa sezona ne lažira pad. Pločice 512 px se
// pamte u Cache Storage i rade bez interneta.
(function (root) {
  'use strict';
  const KLJUC = 'usf_veg', BROJAC = 'usf_veg_brojac', KES = 'usf-veg';
  const WMS = 'https://sh.dataspace.copernicus.eu/ogc/wms/';
  const USK = [[44.20, 15.65], [45.30, 16.98]];
  const PL = 512, Z_MIN = 8, Z_MAX = 14, SVJEZE_DANA = 5, E = 20037508.342789244;
  const MASKA = [0, 1, 3, 8, 9, 10, 11]; // bez podatka, zasićeno, sjena oblaka, oblaci, cirus, snijeg
  const ZEMLJA = ['#4b5563', '#a0522d', '#d2a24c', '#e6d36a', '#c7e07a', '#9ccc65', '#66bb3a', '#2e9e2e', '#137a2a', '#0a4d1c'];
  // Tasseled Cap: koeficijenti Baig i sar. 2014 (Landsat 8 OLI) na ekvivalentnim S2 kanalima
  // B02 B03 B04 B08 B11 B12 — uobičajena zamjena; vrijednosti su približne (L2A površinska refleksija).
  const TC_ULAZI = ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'];
  const tc = k => k.map((c, i) => c + '*s.' + TC_ULAZI[i]).join('+').replace(/\+-/g, '-');
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
        'normalna vlažnost krošnje', 'dobra vlažnost', 'visoka vlažnost', 'vrlo visoka (gusti četinari, voda)'] },
    gndvi: { naziv: 'GNDVI', ulazi: ['B03', 'B08'], v: '(s.B08-s.B03)/(s.B08+s.B03)', pragovi: [0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8], boje: ZEMLJA,
      opis: 'Hlorofil u krošnji (zeleni kanal umjesto crvenog). Osjetljiviji od NDVI na rani stres — blijeđenje krošnje kod potkornjaka i sušenja.',
      klase: ['voda, stijena, sjena', 'golo tlo, putevi', 'sječina, suha krošnja', 'rijetka vegetacija, jako oslabljena krošnja', 'oslabljena krošnja — provjeriti na terenu',
        'blag stres, travnjak', 'šuma umjerene vitalnosti', 'vitalna šuma', 'gusta vitalna šuma', 'najviše hlorofila'] },
    nbr: { naziv: 'NBR', ulazi: ['B08', 'B12'], v: '(s.B08-s.B12)/(s.B08+s.B12)', pragovi: [-0.2, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], boje: ZEMLJA,
      opis: 'Normalized Burn Ratio: zdrava šuma visoko, opožarena površina i golo tlo nisko. Za jačinu požara koristi „dNBR — promjena”.',
      klase: ['svježe opožareno, voda', 'opožareno ili golo tlo', 'sječina, teško oštećeno', 'rijetka vegetacija', 'travnjak, oslabljena šuma',
        'prorijeđena ili mlada šuma', 'šuma umjerene vitalnosti', 'vitalna šuma', 'gusta vitalna šuma', 'vrlo gusta, najveća vitalnost'] },
    msavi: { naziv: 'MSAVI', ulazi: ['B04', 'B08'], v: '(2*s.B08+1-Math.sqrt(Math.max(0,(2*s.B08+1)*(2*s.B08+1)-8*(s.B08-s.B04))))/2', pragovi: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], boje: ZEMLJA,
      opis: 'NDVI s korekcijom za golo tlo — tačniji na sječinama, podmlatku i rijetkoj vegetaciji, gdje tlo kod NDVI daje lažno niske vrijednosti.',
      klase: ['voda, stijena', 'golo tlo, putevi, svježa sječina', 'sječina s prvom vegetacijom', 'rijetka vegetacija, mlad podmladak', 'podmladak, travnjak',
        'mlada ili prorijeđena šuma', 'šuma umjerene gustoće', 'vitalna šuma', 'gusta šuma', 'najveća gustoća'] },
    mndwi: { naziv: 'MNDWI', ulazi: ['B03', 'B11'], v: '(s.B03-s.B11)/(s.B03+s.B11)', pragovi: [-0.5, -0.3, -0.1, 0, 0.2, 0.4],
      boje: ['#5b3a1a', '#8c6d31', '#bfa76a', '#e7dfb8', '#9ecae1', '#4292c6', '#08519c'],
      opis: 'Voda (zeleni i SWIR kanal): rijeke, poplavljene površine, mokrišta. Vrijednost > 0 je gotovo uvijek voda.',
      klase: ['gusta vegetacija', 'vegetacija', 'rijetka vegetacija, suho tlo', 'vlažno tlo, rub vode', 'mokrište, plitka ili mutna voda', 'voda', 'čista, duboka voda'] },
    tcw: { naziv: 'TC Wetness', ulazi: TC_ULAZI, v: tc([0.1511, 0.1973, 0.3283, 0.3407, -0.7117, -0.4559]), pragovi: [-0.2, -0.15, -0.1, -0.07, -0.05, -0.03, -0.01, 0.02],
      boje: ['#7f3b08', '#b35806', '#e08214', '#fdb863', '#d9f0d3', '#a6dba0', '#5aae61', '#2b83ba', '#1a5490'],
      opis: 'Tasseled Cap vlažnost: voda u krošnji i tlu. Najpouzdaniji pojedinačni pokazatelj poremećaja šume — sječa, sušenje i požar ga spuštaju.',
      klase: ['golo suho tlo, kamenjar, putevi', 'svježa sječina, opožareno', 'teško oštećena ili suha šuma', 'rijetka vegetacija, travnjak', 'oslabljena ili prorijeđena šuma',
        'listopadna šuma', 'zatvorena vitalna šuma', 'gusta četinarska šuma, vlažno tlo', 'voda, mokrište'] },
    tcg: { naziv: 'TC Greenness', ulazi: TC_ULAZI, v: tc([-0.2941, -0.243, -0.5424, 0.7276, 0.0713, -0.1608]), pragovi: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4], boje: ZEMLJA,
      opis: 'Tasseled Cap zelenilo: količina zelene biomase (slično NDVI, ali u jedinicama refleksije — manje zasićuje u gustoj šumi).',
      klase: ['voda, sjena', 'golo tlo, putevi', 'sječina, suha vegetacija', 'rijetka vegetacija', 'oslabljena šuma, travnjak', 'mlada ili prorijeđena šuma',
        'šuma umjerene vitalnosti', 'vitalna šuma', 'gusta vitalna šuma', 'najviše zelene biomase'] },
    tcb: { naziv: 'TC Brightness', ulazi: TC_ULAZI, v: tc([0.3029, 0.2786, 0.4733, 0.5599, 0.508, 0.1872]), pragovi: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
      boje: ['#14213d', '#2d3a4a', '#3f5a5c', '#5f7a5a', '#8a9a5b', '#b5a76a', '#d2b48c', '#e6cfa8', '#f5ead6'],
      opis: 'Tasseled Cap svjetloća: ukupna refleksija. Golo tlo, kamenjar i putevi su svijetli, gusta četinarska šuma tamna — ističe sječine i vlake.',
      klase: ['voda, duboka sjena', 'gusta četinarska šuma', 'listopadna ili mješovita šuma', 'mlada šuma, podmladak', 'livada, travnjak', 'rijetka vegetacija',
        'golo tlo, sječina', 'svijetlo tlo, šljunak', 'kamenjar, putevi, krovovi'] },
    dndvi: { naziv: 'dNDVI', baza: 'ndvi', znak: 1, pragovi: [-0.3, -0.2, -0.1, -0.05, 0.05, 0.1, 0.2],
      boje: ['#67001f', '#d6604d', '#f4a582', '#fddbc7', '#f0f0f0', '#d9f0d3', '#7fbf7b', '#1b7837'],
      opis: 'Promjena NDVI (sada − isti period lani). Jak pad = nova sječa, vjetroizvala, sušenje ili požar; rast = obnova.',
      klase: ['jak gubitak — sječa, vjetroizvala, požar', 'izražen gubitak — sječa, sušenje', 'umjeren gubitak — prorjeda, sušenje', 'blag pad', 'bez promjene',
        'blag rast', 'rast — obnova, podmladak', 'jak rast (lani golo tlo ili oblak)'] },
    dnbr: { naziv: 'dNBR', baza: 'nbr', znak: -1, pragovi: [-0.25, -0.1, 0.1, 0.27, 0.44, 0.66],
      boje: ['#1a9850', '#91cf60', '#d9d9d9', '#fee08b', '#fdae61', '#f46d43', '#a50026'],
      opis: 'Jačina požara po USGS (NBR lani − NBR sada). Isti prag važi i za druga teška oštećenja (vjetroizvala, čista sječa).',
      klase: ['jak oporavak vegetacije', 'blag oporavak', 'bez promjene (neopožareno)', 'niska jačina / blago oštećenje', 'umjereno niska jačina', 'umjereno visoka jačina', 'visoka jačina požara'] }
  };
  const jePromjena = k => !!(INDEKSI[k] && INDEKSI[k].baza);
  const ulazi = k => (INDEKSI[INDEKSI[k].baza] || INDEKSI[k]).ulazi;
  const PERIODI = { '15': '15 dana', '30': '30 dana', '60': '60 dana', 'pg': 'isti mjesec prošle godine' };

  const st = (() => { const p = { on: false, id: '', sloj: '', ind: 'ndvi', per: '30', op: 80 }; try { Object.assign(p, JSON.parse(localStorage.getItem(KLJUC) || '{}')); } catch (e) {} return p; })();
  const pamti = () => { try { localStorage.setItem(KLJUC, JSON.stringify(st)); } catch (e) {} };
  const imaKes = typeof caches !== 'undefined';
  const vezaLosa = () => navigator.onLine === false || (typeof _vezaLoša === 'function' && _vezaLoša());
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idIspravan = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  // Zajednička CDSE konfiguracija pogona: ID šifrovan AES-GCM ključem iz PIN-a (isti kod kao Drive karte,
  // USFDriveKarte) — u repozitoriju nema ni ID-a ni PIN-a. 4 cifre su brava za radoznale, ne zaštita od napada.
  const CDSE_ENC = 'qq7Lk6CI7fvwfOS228D9Av0t0/LCPsNw6rLVUJSIAHrVU4bC52uCsu7eCBBsni5wM4Tg1KsNm6wgBbALTV0XCxOw2Mlg50Zaag==';
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  // ── Evalscript i URL ─────────────────────────────────────────────────
  function evalscript(k, per, danas) {
    const I = INDEKSI[k];
    if (I.baza) return evalscriptPromjena(k, per, danas);
    return `//VERSION=3
function setup(){return{input:[{bands:${JSON.stringify(I.ulazi.concat(['SCL', 'dataMask']))}}],output:{bands:4}}}
const T=${JSON.stringify(I.pragovi)},C=${JSON.stringify(I.boje.map(hexRgb))},M=${JSON.stringify(MASKA)};
function evaluatePixel(s){if(!s.dataMask||M.indexOf(s.SCL)>=0)return[0,0,0,0];const v=${I.v};if(!isFinite(v))return[0,0,0,0];let i=0;while(i<T.length&&v>=T[i])i++;const c=C[i];return[c[0]/255,c[1]/255,c[2]/255,1]}`;
  }
  function evalscriptPromjena(k, per, danas) {
    const I = INDEKSI[k], p = periodPromjene(per, danas);
    return `//VERSION=3
function setup(){return{input:[{bands:${JSON.stringify(ulazi(k).concat(['SCL', 'dataMask']))}}],output:{bands:4},mosaicking:'ORBIT'}}
const T=${JSON.stringify(I.pragovi)},C=${JSON.stringify(I.boje.map(hexRgb))},M=${JSON.stringify(MASKA)},N0=Date.parse('${p.novoOd}'),S1=Date.parse('${p.staroDo}')+864e5,K=4,Z=${I.znak};
const D=o=>Date.parse(o.dateFrom);
function preProcessScenes(c){const o=c.scenes.orbits.slice().sort((a,b)=>D(b)-D(a));c.scenes.orbits=o.filter(x=>D(x)>=N0).slice(0,K).concat(o.filter(x=>D(x)<S1).slice(0,K));return c}
function ix(s){return ${INDEKSI[I.baza].v}}
function evaluatePixel(ss,sc){let a=0,na=0,b=0,nb=0;for(let i=0;i<ss.length;i++){const s=ss[i];if(!s.dataMask||M.indexOf(s.SCL)>=0)continue;const v=ix(s);if(!isFinite(v))continue;if(D(sc.orbits[i])>=N0){a+=v;na++}else{b+=v;nb++}}if(!na||!nb)return[0,0,0,0];const v=Z*(a/na-b/nb);let i=0;while(i<T.length&&v>=T[i])i++;const c=C[i];return[c[0]/255,c[1]/255,c[2]/255,1]}`;
  }
  // Novi period = zadnjih n dana, stari = isti datumi godinu ranije (bez 'pg' — to je već poređenje s lani).
  function periodPromjene(per, danas) {
    const d = danas || new Date(), n = per === 'pg' || !PERIODI[per] ? 30 : Number(per);
    const f = t => t.toISOString().slice(0, 10), lani = t => new Date(Date.UTC(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()));
    const od = new Date(d.getTime() - n * 864e5);
    return { novoOd: f(od), novoDo: f(d), staroOd: f(lani(od)), staroDo: f(lani(d)) };
  }
  function perTekst(o) {
    if (!jePromjena(o.ind)) return PERIODI[o.per];
    const p = periodPromjene(o.per);
    return 'zadnjih ' + (o.per === 'pg' ? 30 : o.per) + ' dana prema istom periodu ' + p.staroOd.slice(0, 4) + '.';
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
    const b = okvir(z, x, y), pr = jePromjena(o.ind) ? periodPromjene(o.per) : null;
    return WMS + encodeURIComponent(o.id) + '?' + [
      'SERVICE=WMS', 'REQUEST=GetMap', 'VERSION=1.3.0', 'CRS=EPSG:3857', 'BBOX=' + b.map(v => v.toFixed(2)).join(','),
      'WIDTH=' + PL, 'HEIGHT=' + PL, 'FORMAT=image/png', 'TRANSPARENT=TRUE', 'LAYERS=' + encodeURIComponent(o.sloj),
      'TIME=' + encodeURIComponent(pr ? pr.staroOd + '/' + pr.novoDo : period(o.per)), 'MAXCC=' + (pr ? 40 : 60), 'PRIORITY=leastCC', 'WARNINGS=NO',
      'EVALSCRIPT=' + encodeURIComponent(btoa(evalscript(o.ind, o.per)))
    ].join('&');
  }
  const kljuc = (o, z, x, y) => new URL('__veg/' + o.ind + '/' + (jePromjena(o.ind) && o.per === 'pg' ? '30' : o.per) + '/' + z + '/' + x + '/' + y + '.png', location.href).href;
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
        if (((o.per === 'pg' && !jePromjena(o.ind)) || dob < SVJEZE_DANA || vezaLosa() || !o.id) && !prisili) return await m.blob();
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
    el.textContent = t || zadnjaGreska || (!st.id ? 'Otključaj CDSE konfiguraciju PIN-om ili unesi svoj ID ispod.' : vezaLosa() ? '📴 Bez veze — prikazane zapamćene pločice.' : 'Ovaj uređaj ovaj mjesec: ' + brojOvajMjesec() + ' zahtjeva (račun: 10 000/mj).');
  }
  function legenda() {
    const el = document.getElementById('veg-leg'); if (!el) return;
    const I = INDEKSI[st.ind];
    el.innerHTML = `<div class="veg-skala">${I.boje.map(b => `<i style="background:${b}"></i>`).join('')}</div>
      <div class="veg-skala-br"><span>${br(I.pragovi[0])}</span><span>${br(I.pragovi[Math.floor(I.pragovi.length / 2)])}</span><span>${br(I.pragovi[I.pragovi.length - 1])}</span></div>
      <p class="uk-izvor"><b>${I.naziv}</b> — ${I.opis} Period: ${esc(perTekst(st))}, ${I.baza ? 'prosjek do 4 čista snimka po periodu; troši više PU po pločici (račun: 10 000 PU/mj)' : 'najmanje oblačan snimak po pločici'}; oblaci i snijeg prozirni.</p>`;
  }
  // Pokretna legenda na karti: ručka za prevlačenje, ▾ skupi/raširi, ✕ sakrij SAMO legendu (sloj ostaje,
  // na karti ostaje čip „🛰 Legenda” za vraćanje); položaj i stanje u localStorage `usf_veg_leg`.
  // Zadano dolje lijevo iznad zooma — gore desno je legenda požara (preklapale su se na telefonu).
  const KLJUC_LEG = 'usf_veg_leg';
  const leg = (() => { const p = { skrivena: false, sazeta: false, x: null, y: null }; try { Object.assign(p, JSON.parse(localStorage.getItem(KLJUC_LEG) || '{}')); } catch (e) {} return p; })();
  const pamtiLeg = () => { try { localStorage.setItem(KLJUC_LEG, JSON.stringify(leg)); } catch (e) {} };
  function legKutija() {
    let box = document.getElementById('veg-map-leg');
    if (box || typeof document === 'undefined' || !document.body) return box;
    box = document.createElement('div'); box.id = 'veg-map-leg'; box.hidden = true;
    box.innerHTML = '<div class="vml-ruc"><span class="vml-nasl"><b></b><small></small></span><button class="vml-saz" aria-label="Skupi legendu">▾</button><button class="vml-x" aria-label="Sakrij legendu (sloj ostaje)">✕</button></div><div class="vml-tijelo"></div>';
    document.body.appendChild(box);
    const cip = document.createElement('button'); cip.id = 'veg-leg-chip'; cip.hidden = true; cip.type = 'button';
    cip.onclick = () => legendaPokazi();
    document.body.appendChild(cip);
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
    box._zadano = () => smjesti(8, innerHeight - box.offsetHeight - 190);
    box._smjesti = smjesti;
    return box;
  }
  function legendaNaKarti() {
    const box = legKutija(); if (!box) return;
    box.hidden = !st.on || leg.skrivena;
    const cip = document.getElementById('veg-leg-chip');
    if (cip) { cip.hidden = !st.on || !leg.skrivena; cip.textContent = '🛰 Legenda ' + INDEKSI[st.ind].naziv; }
    if (box.hidden) return;
    const I = INDEKSI[st.ind], n = I.boje.length;
    box.querySelector('.vml-nasl b').textContent = '⠿ ' + I.naziv;
    box.querySelector('.vml-nasl small').textContent = perTekst(st);
    box.querySelector('.vml-saz').textContent = leg.sazeta ? '▸' : '▾';
    const red = i => { const o = { od: i ? I.pragovi[i - 1] : null, do: i < I.pragovi.length ? I.pragovi[i] : null }; return `<div class="vml-red"><i style="background:${I.boje[i]}"></i><b>${raspon(o)}</b><span>${esc((I.klase || [])[i] || '')}</span></div>`; };
    box.querySelector('.vml-tijelo').innerHTML = leg.sazeta
      ? `<div class="veg-skala">${I.boje.map(b => `<i style="background:${b}"></i>`).join('')}</div><div class="veg-skala-br"><span>${br(I.pragovi[0])}</span><span>${br(I.pragovi[I.pragovi.length - 1])}</span></div>`
      : Array.from({ length: n }, (_, k) => red(n - 1 - k)).join('') + '<p class="vml-opis">Dodir na kartu = vrijednost · oblaci prozirni</p>';
    if (leg.x != null && box._smjesti) box._smjesti(leg.x, leg.y); else if (box._zadano) box._zadano();
  }
  function legendaPokazi() { leg.skrivena = false; pamtiLeg(); legendaNaKarti(); uiSync(); }
  function uiSync() {
    document.getElementById('uk-veg-switch')?.classList.toggle('on', !!st.on);
    const o = document.getElementById('uk-veg-opts'); if (o) o.style.display = st.on ? '' : 'none';
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    s('veg-ind', st.ind); s('veg-per', jePromjena(st.ind) && st.per === 'pg' ? '30' : st.per);
    const pg = document.querySelector('#veg-per option[value="pg"]'); if (pg) pg.disabled = jePromjena(st.ind); s('veg-op', st.op); s('veg-id', st.id);
    const lb = document.getElementById('veg-leg-karta'); if (lb) lb.hidden = !st.on || !leg.skrivena;
    const p = document.getElementById('veg-povezano'); if (p) p.textContent = st.id ? (st.sloj ? '✓ Povezano · sloj ' + st.sloj : '⚠ Nije provjereno') : '';
  }
  function prekidac(on) { st.on = on === undefined ? !st.on : !!on; pamti(); uiSync(); crtaj(); }
  function postavi(k, v) {
    if (k === 'op') { st.op = Number(v); pamti(); if (sloj) sloj.setOpacity(st.op / 100); return; }
    if (k === 'ind' && INDEKSI[v]) st.ind = v;
    if (k === 'per' && PERIODI[v]) st.per = v;
    if (jePromjena(st.ind) && st.per === 'pg') st.per = '30';
    pamti(); uiSync(); crtaj();
  }
  async function otkljucaj() {
    const D = root.USFDriveKarte;
    if (!D || typeof _pinUnos !== 'function') { javiStatus('⚠ Otključavanje nije dostupno.'); return; }
    let id = '';
    const pin = await _pinUnos('Unesi PIN za CDSE konfiguraciju pogona.', 'usf_veg_greske', async p => {
      const o = await D.desifruj(await D.kljucIzPina(p), CDSE_ENC);
      id = o && idIspravan(o.id) ? o.id : '';
      return !!id;
    });
    if (pin == null || !id) return;
    const el = document.getElementById('veg-id'); if (el) el.value = id;
    // Sačuvaj odmah: bez mreže provjera ne prolazi, a ID ne smije nestati pri restartu (sloj se dobija prvim „Spremi” online).
    if (st.id !== id) { st.id = id; st.sloj = ''; pamti(); uiSync(); }
    await povezi(id);
  }
  async function povezi(dati) {
    const id = (typeof dati === 'string' ? dati : document.getElementById('veg-id')?.value || '').trim();
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
    if (!confirm('Preuzeti ' + lista.length + ' pločica (' + INDEKSI[st.ind].naziv + ', ' + perTekst(st) + ')? Troši ' + lista.length + ' od 10 000 mjesečnih zahtjeva računa' + (jePromjena(st.ind) ? ' i do ~8 PU po pločici (promjena, 10 000 PU/mj).' : '.'))) return;
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
          ikona: '🛰', boja: o.boja || '#64748b', naslov: I.naziv, tip: 'Sentinel-2', meta: perTekst(st), redovi, opis: I.opis })).openOn(map);
      } }];
    });
  }

  root.USFVeg = { legendaPokazi, prekidac, postavi, povezi, otkljucaj, CDSE_ENC, preuzmi, obrisiKes, evalscript, period, periodPromjene, okvir, urlPlocice, idIspravan, INDEKSI, stanje: () => ({ ...st }) };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.USFVeg;
  if (typeof L !== 'undefined' && typeof map !== 'undefined' && map && map.getContainer) {
    registruj(); uiSync(); legenda(); if (st.on) crtaj();
    window.addEventListener('online', () => javiStatus()); window.addEventListener('offline', () => javiStatus());
  }
})(typeof window !== 'undefined' ? window : globalThis);
