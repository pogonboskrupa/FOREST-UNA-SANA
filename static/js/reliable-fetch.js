// Ograničen transport, uključujući čitanje tijela odgovora. Bez automatskog
// ponavljanja upisa: izgubljen odgovor rješava trajni, idempotentni red.

// Posmatrač kvaliteta veze. Ovo je JEDINO mjesto kroz koje prolazi SVAKI
// Supabase poziv (klijent je napravljen sa `global:{fetch:reliableFetch}`), pa
// se stvarno stanje linka mjeri OVDJE — iz saobraćaja koji app ionako pravi.
// NAMJERNO nema zasebnog "ping" poziva: na terenskoj vezi od ~1.4 KB/s svaki
// dodatni zahtjev otima propusnost onome što korisnik stvarno čeka (ista pouka
// kao paralelni FIRMS dohvat, v3.104.1). Posmatrač je opcion i njegova greška
// se guta — mjerenje ne smije oboriti prenos koji mjeri.
let _netPosmatrac = null;
function setNetObserver(fn) { _netPosmatrac = typeof fn === 'function' ? fn : null; }
function _javiPosmatracu(ishod) {
  if (!_netPosmatrac) return;
  try { _netPosmatrac(ishod); } catch (e) {}
}

async function reliableFetch(url, options = {}, timeoutMs = 15000) {
  const t0 = Date.now();
  const controller = new AbortController();
  const upstream = options.signal;
  const abort = () => controller.abort(upstream && upstream.reason);
  if (upstream) {
    if (upstream.aborted) abort();
    else upstream.addEventListener('abort', abort, { once: true });
  }
  let timer;
  try {
    const odgovor = await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
        const body = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers
        });
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Network timeout');
          error.name = 'TimeoutError';
          reject(error);
          controller.abort(error);
        }, timeoutMs);
      })
    ]);
    // Za kvalitet LINKA je bitno da su bajtovi protekli, ne kakav je HTTP kod —
    // 500 je uredno primljen odgovor, dakle veza radi.
    _javiPosmatracu({ ok:true, ms:Date.now() - t0, vrsta:'ok', status:odgovor.status });
    return odgovor;
  } catch (error) {
    // Prekid koji je tražio POZIVALAC (npr. korisnik napustio ekran) nije kvar
    // veze i ne smije obojiti mjerenje kao lošu vezu.
    const prekinuoPozivalac = !!(upstream && upstream.aborted && error && error.name === 'AbortError');
    if (!prekinuoPozivalac) {
      _javiPosmatracu({ ok:false, ms:Date.now() - t0,
        vrsta:(error && error.name === 'TimeoutError') ? 'istek' : 'greska' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (upstream) upstream.removeEventListener('abort', abort);
  }
}
if (typeof module !== 'undefined') module.exports = { reliableFetch, setNetObserver };
