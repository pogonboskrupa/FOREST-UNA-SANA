// Dekodiranje lokalnog DEM-a (GeoTIFF, deflate) u Web Worker-u: na sporijem telefonu je to višesekundno
// blokiranje glavne niti (karta se ne da pomjerati). Rezultat se vraća kao transferable niz (bez kopiranja).
self.onmessage = async e => {
  try {
    importScripts(e.data.lib);
    const r = await fetch(e.data.url);
    if (!r.ok) throw new Error('nema lokalnog DEM-a (' + r.status + ')');
    const img = await (await self.GeoTIFF.fromArrayBuffer(await r.arrayBuffer())).getImage(0);
    const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
    const data = (await img.readRasters({ samples: [0], interleave: false }))[0];
    self.postMessage({ ok: true, data, W: img.getWidth(), H: img.getHeight(), ox, oy, rx, ry }, [data.buffer]);
  } catch (er) { self.postMessage({ ok: false, err: String(er && er.message || er) }); }
};
