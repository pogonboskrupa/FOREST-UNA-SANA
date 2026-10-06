'use strict';
// Derivatives in ground metres: x east, y south (Web Mercator tile rows).
function terrainGradient(east, south) {
  const slope = Math.atan(Math.hypot(east, south)) * 180 / Math.PI;
  const aspect = (Math.atan2(-east, south) * 180 / Math.PI + 360) % 360;
  return { slope, aspect };
}
const terrainAspectColors = ['#3b82f6','#06b6d4','#22c55e','#a3e635','#facc15','#f97316','#ef4444','#a855f7'];
// Šumarske klase nagiba u PROCENTIMA (max = gornja granica u %); stepeni samo za prikaz.
const terrainPct = deg => Math.tan(deg * Math.PI / 180) * 100;
const terrainDeg = pct => Math.round(Math.atan(pct / 100) * 180 / Math.PI);
const terrainSlopeClasses = [
  { max: 10, color: '#22c55e', label: '0–9,99 %', labelSt: '(0–6°)' },
  { max: 20, color: '#84cc16', label: '10–19,99 %', labelSt: '(6–11°)' },
  { max: 30, color: '#facc15', label: '20–29,99 %', labelSt: '(11–17°)' },
  { max: 40, color: '#f97316', label: '30–39,99 %', labelSt: '(17–22°)' },
  { max: 50, color: '#dc2626', label: '40–49,99 %', labelSt: '(22–27°)' },
  { max: Infinity, color: '#7e22ce', label: '>50 %', labelSt: '(>27°)' }
];
const terrainAspectLabels = ['S','SI','I','JI','J','JZ','Z','SZ'];
// Ekspozicija: 8 strana ili samo 4 glavne (S/I/J/Z, sektori po 90°).
// Nagib do 5 % je ravan teren — nema ekspozicije i ne boji se.
const terrainAspectRavnoPct = 5;
const terrainAspect4 = { boje: ['#3b82f6', '#22c55e', '#ef4444', '#facc15'], oznake: ['S', 'I', 'J', 'Z'], nazivi: ['Sjever', 'Istok', 'Jug', 'Zapad'] };
const terrainAspect8 = { boje: terrainAspectColors, oznake: terrainAspectLabels, nazivi: ['Sjever', 'Sjeveroistok', 'Istok', 'Jugoistok', 'Jug', 'Jugozapad', 'Zapad', 'Sjeverozapad'] };
let terrainAspectBroj = 8;
const terrainAspectSema = n => ((n || terrainAspectBroj) === 4 ? terrainAspect4 : terrainAspect8);
// aspect u ° od sjevera (kazaljka), slope u °; null = ravno.
function terrainAspectKlasa(aspect, slope, n) {
  if (!(terrainPct(slope) > terrainAspectRavnoPct + 1e-9)) return null;
  const k = (n || terrainAspectBroj) === 4 ? 4 : 8, sektor = 360 / k;
  return Math.floor((((aspect % 360) + 360) % 360 + sektor / 2) / sektor) % k;
}
// Korisnički rasponi: [{max, color, on}] — max je gornja granica (°), zadnji
// raspon ide do beskonačnosti. Isključen raspon se ne crta (prozirno).
const terrainSlopePaleta = ['#22c55e','#84cc16','#facc15','#f59e0b','#f97316','#dc2626','#be185d','#7e22ce'];
function terrainSlopeBoje(n) {
  if (n <= 1) return [terrainSlopePaleta[0]];
  return Array.from({ length: n }, (_, i) => terrainSlopePaleta[Math.round(i * (terrainSlopePaleta.length - 1) / (n - 1))]);
}
function terrainSlopeNormalize(list) {
  const granice = [...new Set((list || []).map(k => Number(k.max)).filter(v => Number.isFinite(v) && v > 0 && v < 1000).map(v => Math.round(v)))].sort((a, b) => a - b);
  const stare = list || [];
  const nadji = max => stare.find(k => (Number.isFinite(Number(k.max)) ? Math.round(Number(k.max)) : Infinity) === max);
  const boje = terrainSlopeBoje(granice.length + 1);
  return [...granice, Infinity].map((max, i) => {
    const od = i ? granice[i - 1] : 0, k = nadji(max) || {};
    const dispMax = max === Infinity ? null : (max - 1) + ',99';
    return { max, color: /^#[0-9a-f]{6}$/i.test(k.color || '') ? k.color : boje[i], on: k.on !== false,
      label: max === Infinity ? '>' + od + ' %' : od + '–' + dispMax + ' %',
      labelSt: max === Infinity ? '(>' + terrainDeg(od) + '°)' : '(' + terrainDeg(od) + '–' + terrainDeg(max) + '°)' };
  });
}
let terrainSlopeAktivne = terrainSlopeClasses;
function terrainSetSlopeKlase(list) { terrainSlopeAktivne = list && list.length ? terrainSlopeNormalize(list) : terrainSlopeClasses; return terrainSlopeAktivne; }
// slope u STEPENIMA (iz DEM-a), klase u procentima.
function terrainSlopeKlasa(slope, klase) { const p = terrainPct(slope); return (klase || terrainSlopeAktivne).find(k => p < k.max) || null; }
function terrainColor(mode, east, south) {
  const g = terrainGradient(east, south);
  if (mode === 'aspect') { const i = terrainAspectKlasa(g.aspect, g.slope); return i === null ? null : terrainAspectSema().boje[i]; }
  if (mode === 'slope') { const k = terrainSlopeKlasa(g.slope); return k && k.on !== false ? k.color : null; }
  // Sun from NW, elevation 45 degrees; unit normal (-east,+south,1).
  const light = Math.max(0, (east*0.5 + south*0.5 + Math.SQRT1_2)/Math.sqrt(1+east*east+south*south));
  const n = Math.round(35 + 220*light);
  return '#' + n.toString(16).padStart(2,'0').repeat(3);
}
if (typeof module !== 'undefined') module.exports = {terrainAspectKlasa,terrainAspectSema,terrainAspectRavnoPct,setAspectBroj:n=>{terrainAspectBroj=n===4?4:8;},terrainGradient,terrainColor,terrainSlopeClasses,terrainSlopeNormalize,terrainSetSlopeKlase,terrainSlopeKlasa,terrainPct,terrainDeg};
if (typeof window !== 'undefined') {
  const saved = (()=>{try{return JSON.parse(localStorage.getItem('usf_terrain')||'{}');}catch(e){return {};}})();
  const layers = {}, decoded = new Map();
  if (saved.aspectBroj === 4) terrainAspectBroj = 4;
  let opacity = Math.max(.15,Math.min(.85,Number(saved.opacity)||.55));
  // Stari zapis (granice u stepenima) se pretvara u procente.
  if (Array.isArray(saved.nagibKlase)) terrainSetSlopeKlase(saved.nagibKlase.map(k => ({ ...k, max: k.max === null ? Infinity : (saved.nagibJed === 'pct' ? k.max : Math.round(terrainPct(k.max))) })));
  const klizaci=()=>document.querySelectorAll('input[aria-label="Prozirnost slojeva terena"]');
  klizaci().forEach(i=>{i.value=Math.round(opacity*100);});
  map.createPane('terrainShade'); map.getPane('terrainShade').style.zIndex='320';
  map.createPane('terrainColor'); map.getPane('terrainColor').style.zIndex='330';
  ['terrainShade','terrainColor'].forEach(p=>map.getPane(p).style.pointerEvents='none');
  async function dem(z,x,y) {
    const n=2**z; x=(x%n+n)%n; y=Math.max(0,Math.min(n-1,y));
    const key=z+'/'+x+'/'+y;
    if (!decoded.has(key)) {
      const promise=(async()=>{
        const bitmap=await _getTerrariumTile(z,x,y);
        if(!bitmap) throw Error('Nedostaje DEM pločica');
        const values=_terrariumDecodeTile(bitmap); if(bitmap.close)bitmap.close(); return values;
      })();
      decoded.set(key,promise);
      promise.catch(()=>decoded.delete(key));
      if(decoded.size>48)decoded.delete(decoded.keys().next().value);
    }
    return decoded.get(key);
  }
  const TerrainLayer=L.GridLayer.extend({
    createTile(c,done) {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
      (async()=>{
        // Neighbour pixels make central differences continuous at tile boundaries.
        // Susjedne pločice su opcione: na rubu obuhvata (offline, van 5 općina)
        // nema ih, pa se rub pločice računa iz njenih vlastitih piksela.
        const opc=(z,x,y)=>Promise.race([dem(z,x,y).catch(()=>null),new Promise(r=>setTimeout(()=>r(null),3000))]);
        const [a,w,e,n,s]=await Promise.all([dem(c.z,c.x,c.y),opc(c.z,c.x-1,c.y),opc(c.z,c.x+1,c.y),opc(c.z,c.x,c.y-1),opc(c.z,c.x,c.y+1)]);
        const ctx=canvas.getContext('2d'), out=ctx.createImageData(256,256);
        // Ekspozicija na širem razmaku (3 px ≈ 20 m) — manje šuma piksela i krošnji.
        const K=this.options.mode==='aspect'?3:1;
        const vx=(x,y)=>x<0?(w?w[y*256+256+x]:a[y*256]):x>255?(e?e[y*256+x-256]:a[y*256+255]):a[y*256+x];
        const vy=(x,y)=>y<0?(n?n[(256+y)*256+x]:a[x]):y>255?(s?s[(y-256)*256+x]:a[255*256+x]):a[y*256+x];
        for(let y=0;y<256;y++) {
          const lat=Math.atan(Math.sinh(Math.PI*(1-2*(c.y+(y+.5)/256)/2**c.z)));
          const metres=40075016.686*Math.cos(lat)/(256*2**c.z);
          for(let x=0;x<256;x++) {
            const dx=(vx(x+K,y)-vx(x-K,y))/(2*K*metres);
            const dy=(vy(x,y+K)-vy(x,y-K))/(2*K*metres);
            const color=terrainColor(this.options.mode,dx,dy), i=(y*256+x)*4;
            if(!color){out.data[i+3]=0;continue;}
            out.data[i]=parseInt(color.slice(1,3),16);out.data[i+1]=parseInt(color.slice(3,5),16);out.data[i+2]=parseInt(color.slice(5,7),16);out.data[i+3]=255;
          }
        }
        ctx.putImageData(out,0,0);done(null,canvas);
      })().catch(err=>{document.getElementById('terrain-status').textContent='Bez interneta teren radi unutar 5 općina (ugrađeni DEM) i za ranije pregledana područja; ostalo se učita kad veza proradi.';done(err,canvas);});
      return canvas;
    }
  });
  const persist=()=>{try{localStorage.setItem('usf_terrain',JSON.stringify({...saved,opacity}));}catch(e){}};
  // Legenda na karti: dolje u sredini, između zuma (lijevo) i dugmadi (desno),
  // iznad donje trake. Dodir je skuplja na naslov (npr. kad je otvorena traka traga).
  const mapLegend=document.createElement('div');
  mapLegend.id='terrain-map-legend';
  document.body.appendChild(mapLegend);
  mapLegend.addEventListener('click',()=>{mapLegend.classList.toggle('mini');try{localStorage.setItem('usf_terrain_leg_mini',mapLegend.classList.contains('mini')?'1':'0');}catch(e){}});
  try{if(localStorage.getItem('usf_terrain_leg_mini')==='1')mapLegend.classList.add('mini');}catch(e){}
  const legend=()=>{
    let rows=[];
    if(saved.slope)rows.push(...terrainSlopeAktivne.filter(k=>k.on!==false).map(k=>[k.color,k.label+' '+k.labelSt]));
    if(saved.aspect){const sm=terrainAspectSema();rows.push(...sm.nazivi.map((t,i)=>[sm.boje[i],t]));}
    document.getElementById('terrain-legend').innerHTML=rows.map(([c,t])=>`<span style="display:inline-block;margin-right:12px"><i style="display:inline-block;width:12px;height:12px;background:${c};margin-right:5px"></i>${t}</span>`).join('')+(saved.aspect?'<div>Ravan teren (nagib do 5 %) nema ekspoziciju i ostaje bez boje.</div>':'')+(saved.shade?'<div>Hillshade: osvjetljenje sa sjeverozapada.</div>':'');
    const stavka=(c,t)=>`<span class="tml-item"><i style="background:${c}"></i>${t}</span>`;
    let html='';
    const vidljive=terrainSlopeAktivne.filter(k=>k.on!==false);
    if(saved.slope)html=`<div class="tml-title">Nagib terena (%)</div><div class="tml-row tml-slope" style="grid-template-columns:repeat(${Math.min(5,Math.max(1,vidljive.length))},minmax(0,1fr))">${vidljive.map(k=>stavka(k.color,k.label.replace(' %',''))).join('')}</div>`;
    else if(saved.aspect){const sm=terrainAspectSema();html=`<div class="tml-title">Ekspozicija · ravno ≤5 % bez boje</div><div class="tml-row tml-aspect${terrainAspectBroj===4?' a4':''}">${sm.oznake.map((t,i)=>stavka(sm.boje[i],t)).join('')}</div>`;}
    document.querySelectorAll('[data-asp-broj]').forEach(b=>b.classList.toggle('on',Number(b.dataset.aspBroj)===terrainAspectBroj));
    mapLegend.innerHTML=html;
    mapLegend.style.display=html?'block':'none';
  };
  window._terrainToggle=(mode,on)=>{
    // Two categorical rasters cannot be read reliably on top of one another.
    if(on && mode!=='shade') {const other=mode==='slope'?'aspect':'slope';saved[other]=false;if(layers[other])map.removeLayer(layers[other]);document.getElementById('terrain-'+other).checked=false;}
    saved[mode]=on;
    if(on){if(!layers[mode])layers[mode]=new TerrainLayer({mode,pane:mode==='shade'?'terrainShade':'terrainColor',opacity,maxNativeZoom:14,maxZoom:22,keepBuffer:1,attribution:'DEM © Mapzen / AWS Terrain Tiles'});layers[mode].addTo(map);}
    else if(layers[mode])map.removeLayer(layers[mode]);
    document.getElementById('terrain-'+mode).checked=on;persist();legend();
  };
  // Urednik raspona nagiba (od–do): granice, boja, prikaz po rasponu.
  const primijeni=list=>{
    terrainSetSlopeKlase(list);
    saved.nagibKlase=terrainSlopeAktivne.map(k=>({max:k.max===Infinity?null:k.max,color:k.color,on:k.on}));saved.nagibJed='pct';
    persist();if(layers.slope)layers.slope.redraw();legend();urednik();
    try{window.dispatchEvent(new CustomEvent('usf-nagib-klase'));}catch(e){}
  };
  const urednik=()=>{
    const el=document.getElementById('terrain-slope-editor');if(!el)return;
    const k=terrainSlopeAktivne;
    el.innerHTML=k.map((r,i)=>{const od=i?k[i-1].max:0;
      return `<div class="tse-red"><input type="checkbox" data-i="${i}" data-f="on" ${r.on!==false?'checked':''} aria-label="Prikaži raspon"><input type="color" data-i="${i}" data-f="color" value="${r.color}" aria-label="Boja raspona"><span class="tse-od">${od} %</span><span>–</span>${r.max===Infinity?'<span class="tse-inf">i više</span>':`<input type="number" inputmode="numeric" min="1" max="999" step="1" data-i="${i}" data-f="max" value="${r.max}" aria-label="Gornja granica u procentima"> %`}<span class="tse-pct">${r.labelSt||''}</span>${k.length>2&&r.max!==Infinity?`<button data-i="${i}" data-f="del" aria-label="Ukloni granicu">✕</button>`:''}</div>`;}).join('')
      +`<div class="tse-akcije"><button data-f="add">+ Dodaj raspon</button><button data-f="reset">↺ Zadano</button></div>`;
  };
  const edEl=document.getElementById('terrain-slope-editor');
  if(edEl){
    edEl.addEventListener('change',e=>{
      const t=e.target,i=Number(t.dataset.i),f=t.dataset.f;if(!f)return;
      const list=terrainSlopeAktivne.map(k=>({...k}));
      if(f==='on')list[i].on=t.checked;
      else if(f==='color')list[i].color=t.value;
      else if(f==='max'){const v=Number(t.value);if(!(v>0&&v<1000)){urednik();return;}list[i].max=v;delete list[i].color;}
      primijeni(list);
    });
    edEl.addEventListener('click',e=>{
      const f=e.target.dataset?.f;if(f!=='add'&&f!=='del'&&f!=='reset')return;
      if(f==='reset'){primijeni(terrainSlopeClasses.map(k=>({...k,on:true})));return;}
      let list=terrainSlopeAktivne.map(k=>({max:k.max,on:k.on,color:k.color}));
      if(f==='del')list.splice(Number(e.target.dataset.i),1);
      else{const kon=list.filter(k=>k.max!==Infinity).map(k=>k.max),zad=kon.length?kon[kon.length-1]:0;
        if(zad>=990){showToast('Najviša granica je 999 %');return;}list.push({max:Math.min(999,zad+(zad>=100?50:10)),on:true});}
      primijeni(list);
    });
  }
  urednik();
  window._terrainAspectBroj=n=>{
    terrainAspectBroj=n===4?4:8;saved.aspectBroj=terrainAspectBroj;persist();
    if(layers.aspect)layers.aspect.redraw();
    if(!saved.aspect)window._terrainToggle('aspect',true);else legend();
    try{window.dispatchEvent(new CustomEvent('usf-nagib-klase'));}catch(e){}
  };
  window._terrainOpacity=value=>{opacity=Number(value)/100;klizaci().forEach(i=>{if(Number(i.value)!==Number(value))i.value=value;});Object.values(layers).forEach(l=>l.setOpacity(opacity));persist();};
  for(const mode of ['shade','slope','aspect'])if(saved[mode])window._terrainToggle(mode,true);
  legend();
  const protoName='🌐 Protomaps';
  function setup(key) {
    if(!key || typeof protomapsL==='undefined')return;
    if(TL[protoName] && map.hasLayer(TL[protoName]))map.removeLayer(TL[protoName]);
    TL[protoName]=protomapsL.leafletLayer({pane:'tilePane',url:'https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key='+encodeURIComponent(key),flavor:'light',lang:'bs',attribution:'© Protomaps © OpenStreetMap contributors'});
    _renderKartaBaseList();
    if(!document.querySelector('#layer-switch [data-layer="'+protoName+'"]')) {
      const button=document.createElement('button');button.dataset.layer=protoName;button.textContent=protoName;
      button.onclick=()=>{_closeLayerSwitch();_selectBaseLayer(protoName);};document.getElementById('layer-switch').appendChild(button);
    }
    document.getElementById('protomaps-status').textContent='Protomaps je spreman za izbor podloge.';
  }
  const key=localStorage.getItem('usf_protomaps_key')||'';
  document.getElementById('protomaps-key').value=key;setup(key);
  window._terrainProtomapsSave=()=>{const k=document.getElementById('protomaps-key').value.trim();if(!k){showToast('Unesi Protomaps API ključ');return;}localStorage.setItem('usf_protomaps_key',k);setup(k);if(_currentBaseName===protoName)_currentBaseName='';_selectBaseLayer(protoName);};
  const startupChoice=typeof _baseChoiceRead==='function'?_baseChoiceRead():null;
  if(key && startupChoice?.type==='online' && startupChoice.name===protoName)_selectBaseLayer(protoName);
}

// Oznaka verzije u Postavkama i meniju. Veže se poslije glavnog runtime-a.
(function _usfOfflineMapUiFix() {
  // Node testovi učitavaju isti fajl bez DOM-a; UI patch je samo za WebView.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const oldSettings = window._renderPostavke;
  if (typeof oldSettings === 'function' && !oldSettings.__usfVersionFix) {
    const wrappedSettings = function() {
      oldSettings.apply(this, arguments);
      const label = document.getElementById('set-ver-txt');
      if (label) label.textContent = 'v1.9.7';
    };
    wrappedSettings.__usfVersionFix = true;
    window._renderPostavke = wrappedSettings;
  }
  const badge = document.getElementById('meni-ver-badge');
  if (badge) badge.textContent = 'Grmeč Navigator v1.9.7';
})();


// SQLitedb raster fix: stvarni sadržaj pločice određuje JPEG/PNG/WebP,
// jer mnoge karte nemaju metadata.format. Ovaj patch vrijedi i za slojeve
// koje je glavni runtime već otvorio prije učitavanja ove modularne skripte.
(function _usfSqlitedbTileDecodeFix() {
  if (typeof window === 'undefined') return;
  const apply = () => {
    if (typeof _NativeSqlCanvasLayer === 'undefined' || !_NativeSqlCanvasLayer.prototype) return false;
    const proto = _NativeSqlCanvasLayer.prototype;
    if (proto.__usfMimeAwareTiles) return true;
    proto.createTile = function(coords, done) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const finish = () => { try { done(null, canvas); } catch(e) {} };
      setTimeout(() => {
        try {
          if (typeof AndroidMbtiles === 'undefined') { finish(); return; }
          const uri = typeof AndroidMbtiles.getTileDataUri === 'function'
            ? AndroidMbtiles.getTileDataUri(this.options.nativeId, coords.z, coords.x, coords.y) : '';
          const b64 = (uri || typeof AndroidMbtiles.getTile !== 'function') ? '' :
            AndroidMbtiles.getTile(this.options.nativeId, coords.z, coords.x, coords.y);
          if (!uri && !b64) { finish(); return; }
          const image = new Image();
          image.onload = () => {
            try { canvas.getContext('2d', { alpha:true }).drawImage(image, 0, 0, 256, 256); } catch(e) {}
            finish();
          };
          image.onerror = finish;
          image.src = uri || ('data:image/png;base64,' + b64);
        } catch(e) { finish(); }
      }, 0);
      return canvas;
    };
    proto.__usfMimeAwareTiles = true;
    if (Array.isArray(window._sqlLayers)) window._sqlLayers.filter(r => r.native && r.layer).forEach(r => {
      try { r.layer.redraw(); } catch(e) {}
    });
    return true;
  };
  if (!apply()) setTimeout(apply, 0);
})();