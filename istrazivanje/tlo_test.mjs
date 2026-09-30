import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
const T = require('./tlo-potkornjak.js');
for (const [ime, lat, lon] of [['Bosanska Krupa', 44.883, 16.151], ['Grmeč (Lisina)', 44.73, 16.33]]) {
  const t0 = Date.now();
  try {
    const r = await T.izracunaj(lat, lon);
    console.log('=====', ime, (Date.now() - t0) + ' ms', 'visina', r.visina, 'klima', r.klima);
    console.log('rizik', r.rizik);
    console.log('rojenje', r.ph.pocetak, 'suma', r.ph.sumaRojenje, 'dijapauza', r.dijapauza, 'letDana7', r.letDana7, 'prognozaLet', r.prognozaLet);
    console.log('sunce', JSON.stringify(r.ph.sunce)); console.log('hlad', JSON.stringify(r.ph.hlad));
    for (const s of r.slojevi) console.log(s.naziv, JSON.stringify(s.zadnji), 'p', s.percentil && s.percentil.toFixed(1), s.klasa.t, 'sad', s.sad, 'temp', s.temp, 'p7', s.prognoza7);
    console.log('graf', r.graf.length, JSON.stringify(r.graf.slice(0, 2)), JSON.stringify(r.graf.slice(-2)));
    console.log('lokalno KB', Math.round(JSON.stringify(mem).length / 1024));
  } catch (e) { console.log('GREŠKA', ime, e.stack); }
}
