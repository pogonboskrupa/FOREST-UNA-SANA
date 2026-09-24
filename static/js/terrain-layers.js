'use strict';
// Derivatives in ground metres: x east, y south (Web Mercator tile rows).
function terrainGradient(east, south) {
  const slope = Math.atan(Math.hypot(east, south)) * 180 / Math.PI;
  const aspect = (Math.atan2(-east, south) * 180 / Math.PI + 360) % 360;
  return { slope, aspect };
}
const terrainAspectColors = ['#3b82f6','#06b6d4','#22c55e','#a3e635','#facc15','#f97316','#ef4444','#a855f7'];
function terrainColor(mode, east, south) {
  const g = terrainGradient(east, south);
  if (mode === 'aspect') return g.slope <= 10 ? '#a1a1aa' : terrainAspectColors[Math.floor((g.aspect+22.5)/45)%8];
  if (mode === 'slope') {
    if (g.slope <= 30) return null;
    const t=Math.max(0,Math.min(1,(g.slope-30)/30));
    const from=[254,202,202],to=[185,28,28];
    return '#'+from.map((v,i)=>Math.round(v+(to[i]-v)*t).toString(16).padStart(2,'0')).join('');
  }
  // Sun from NW, elevation 45 degrees; unit normal (-east,+south,1).
  const light = Math.max(0, (east*0.5 + south*0.5 + Math.SQRT1_2)/Math.sqrt(1+east*east+south*south));
  const n = Math.round(35 + 220*light);
  return '#' + n.toString(16).padStart(2,'0').repeat(3);
}
if (typeof module !== 'undefined') module.exports = {terrainGradient,terrainColor};
if (typeof window !== 'undefined') {
  const saved = (()=>{try{return JSON.parse(localStorage.getItem('usf_terrain')||'{}');}catch(e){return {};}})();
  const layers = {}, decoded = new Map();
  let opacity = Math.max(.15,Math.min(.85,Number(saved.opacity)||.55));
  document.querySelector('input[aria-label="Prozirnost slojeva terena"]').value=Math.round(opacity*100);
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
        const [a,w,e,n,s]=await Promise.all([dem(c.z,c.x,c.y),dem(c.z,c.x-1,c.y),dem(c.z,c.x+1,c.y),dem(c.z,c.x,c.y-1),dem(c.z,c.x,c.y+1)]);
        const ctx=canvas.getContext('2d'), out=ctx.createImageData(256,256);
        for(let y=0;y<256;y++) {
          const lat=Math.atan(Math.sinh(Math.PI*(1-2*(c.y+(y+.5)/256)/2**c.z)));
          const metres=40075016.686*Math.cos(lat)/(256*2**c.z);
          for(let x=0;x<256;x++) {
            const dx=((x===255?e[y*256]:a[y*256+x+1])-(x===0?w[y*256+255]:a[y*256+x-1]))/(2*metres);
            const dy=((y===255?s[x]:a[(y+1)*256+x])-(y===0?n[255*256+x]:a[(y-1)*256+x]))/(2*metres);
            const color=terrainColor(this.options.mode,dx,dy), i=(y*256+x)*4;
            if(!color){out.data[i+3]=0;continue;}
            out.data[i]=parseInt(color.slice(1,3),16);out.data[i+1]=parseInt(color.slice(3,5),16);out.data[i+2]=parseInt(color.slice(5,7),16);out.data[i+3]=255;
          }
        }
        ctx.putImageData(out,0,0);done(null,canvas);
      })().catch(err=>{document.getElementById('terrain-status').textContent='Dio terena nije dostupan. Za nepreuzete pločice uključi internet.';done(err,canvas);});
      return canvas;
    }
  });
  const persist=()=>localStorage.setItem('usf_terrain',JSON.stringify({...saved,opacity}));
  const legend=()=>{
    let rows=[];
    if(saved.slope)rows.push(...[['transparent','≤30° bez boje'],['#f9b4b4','30–40°'],['#e86d6d','40–50°'],['#b91c1c','≥60°']]);
    if(saved.aspect)rows.push(['#a1a1aa','Neutralno ≤10°'],...['Sjever','Sjeveroistok','Istok','Jugoistok','Jug','Jugozapad','Zapad','Sjeverozapad'].map((t,i)=>[terrainAspectColors[i],t]));
    document.getElementById('terrain-legend').innerHTML=rows.map(([c,t])=>`<span style="display:inline-block;margin-right:12px"><i style="display:inline-block;width:12px;height:12px;background:${c};margin-right:5px"></i>${t}</span>`).join('')+(saved.shade?'<div>Hillshade: osvjetljenje sa sjeverozapada.</div>':'');
  };
  window._terrainToggle=(mode,on)=>{
    // Two categorical rasters cannot be read reliably on top of one another.
    if(on && mode!=='shade') {const other=mode==='slope'?'aspect':'slope';saved[other]=false;if(layers[other])map.removeLayer(layers[other]);document.getElementById('terrain-'+other).checked=false;}
    saved[mode]=on;
    if(on){if(!layers[mode])layers[mode]=new TerrainLayer({mode,pane:mode==='shade'?'terrainShade':'terrainColor',opacity,maxNativeZoom:14,maxZoom:22,keepBuffer:1,attribution:'DEM © Mapzen / AWS Terrain Tiles'});layers[mode].addTo(map);}
    else if(layers[mode])map.removeLayer(layers[mode]);
    document.getElementById('terrain-'+mode).checked=on;persist();legend();
  };
  window._terrainOpacity=value=>{opacity=Number(value)/100;Object.values(layers).forEach(l=>l.setOpacity(opacity));persist();};
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

// Offline SQLite/MBTiles UI — aktivna karta je već vidljiva; drugi prekidač
// zato nije Sakrij nego Zoom. Veže se poslije glavnog runtime-a.
(function _usfOfflineMapUiFix() {
  // Node testovi učitavaju isti fajl bez DOM-a; UI patch je samo za WebView.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const apply = () => {
    const previous = window._sqlmapRegRender;
    if (typeof previous !== 'function' || previous.__usfZoomFix) return false;
    const wrapped = async function() {
      await previous.apply(this, arguments);
      const list = document.getElementById('sqlmap-list');
      if (!list) return;
      list.querySelectorAll('.treg-row').forEach(row => {
        const buttons = row.querySelectorAll('.treg-btns button');
        if (buttons.length < 2 || !/Aktivna/.test(buttons[0].textContent)) return;
        const useButton = buttons[0], zoomButton = buttons[1];
        zoomButton.textContent = '🔍 Zoom';
        zoomButton.title = 'Zumiraj na granice aktivne karte';
        zoomButton.onclick = () => useButton.click();
      });
    };
    wrapped.__usfZoomFix = true;
    window._sqlmapRegRender = wrapped;
    return true;
  };
  if (!apply()) setTimeout(apply, 0);
  const oldSettings = window._renderPostavke;
  if (typeof oldSettings === 'function' && !oldSettings.__usfVersionFix) {
    const wrappedSettings = function() {
      oldSettings.apply(this, arguments);
      const label = document.getElementById('set-ver-txt');
      if (label) label.textContent = 'v1.4.7';
    };
    wrappedSettings.__usfVersionFix = true;
    window._renderPostavke = wrappedSettings;
  }
  const badge = document.getElementById('meni-ver-badge');
  if (badge) badge.textContent = 'Una Sana Forest v1.4.7';
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