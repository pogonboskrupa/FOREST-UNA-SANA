// Set linijskih SVG ikona (24×24, stroke currentColor) umjesto emojija. Unicode nema motornu pilu
// (🪚 je ručna testera), pa je sjekira 🪓 zamijenjena vlastitom ikonom `pila`. Isti stil kao ikone u Meniju.
// USFIk(ime) → inline SVG (HTML, ne ide kroz esc()); USFIkPath(ime) → path za canvas (Path2D), samo
// ikone bez maske. Prefiks USFIk* da se ne sudara s globalnim imenima u index.html.
const USFIK_SADRZAJ = {
  // motorna pila: vodilica sa zubima lanca (lijevo), kućište, gornja ručka i dugme (desno)
  pila: '<path d="M5 12h9v4.5H5a2.25 2.25 0 0 1 0-4.5z"/><path d="M4 10l1.3 2M7.5 10l1.3 2M11 10l1.3 2M4 18.5l1.3-2M7.5 18.5l1.3-2M11 18.5l1.3-2" stroke-width="1.5"/><path d="M14 8h6a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-6"/><path d="M16 8V5.2A1.5 1.5 0 0 1 17.5 3.7H19A1.5 1.5 0 0 1 20.5 5.2V8"/><path d="M18 13.8h.01" stroke-width="3"/>',
  oko: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'oko-off': '<mask id="usfik-oko"><rect width="24" height="24" fill="#fff"/><path d="M4.5 4.5l15 15" stroke="#000" stroke-width="5"/></mask><g mask="url(#usfik-oko)"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></g><path d="M4.5 4.5l15 15"/>',
  vodi: '<path d="M12 3l7 17-7-4-7 4z"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  lom: '<path d="M4.5 18l5-8 5 5 5-9"/><circle cx="4.5" cy="18" r="1.6"/><circle cx="9.5" cy="10" r="1.6"/><circle cx="14.5" cy="15" r="1.6"/><circle cx="19.5" cy="6" r="1.6"/>',
  ponisti: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V9H8"/>',
  razdvoji: '<path d="M12 21v-8l-6-7M12 13l6-7"/><path d="M6 10V6h4M18 10V6h-4"/>',
  salji: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  smece: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  preuzmi: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  slika: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/>',
  planina: '<path d="M3 20l6.5-11 3.5 6 2-3 6 8z"/>',
  spoj: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lepeza: '<path d="M12 20L4 7M12 20V4M12 20l8-13"/><path d="M4 7a14 14 0 0 1 16 0"/>',
  upozorenje: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  sirenje: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  lokacija: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  poligon: '<path d="M4 8l8-4 8 5-2 11-10 1z"/><circle cx="4" cy="8" r="1.4"/><circle cx="12" cy="4" r="1.4"/><circle cx="20" cy="9" r="1.4"/><circle cx="18" cy="20" r="1.4"/><circle cx="8" cy="21" r="1.4"/>'
};
function USFIk(ime, vel) {
  const s = USFIK_SADRZAJ[ime];
  if (!s) return '';
  return `<svg class="ik" viewBox="0 0 24 24" width="${vel || 18}" height="${vel || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`;
}
// Path za Path2D: samo ikone čiji su elementi <path> bez maske i bez stroke-dasharray/atributa.
function USFIkPath(ime) {
  const s = USFIK_SADRZAJ[ime];
  if (!s || /<mask|<circle|<rect/.test(s)) return '';
  return [...s.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]).join(' ');
}
// Statični HTML: <span data-ik="pila" data-ikv="22"></span> → ikona (skripta je pri dnu stranice).
function usfIkHidriraj() {
  document.querySelectorAll('[data-ik]').forEach(el => { if (!el.firstChild) el.innerHTML = USFIk(el.dataset.ik, Number(el.dataset.ikv) || 18); });
}
if (typeof document !== 'undefined') { usfIkHidriraj(); document.addEventListener('DOMContentLoaded', usfIkHidriraj); }
if (typeof module !== 'undefined' && module.exports) module.exports = { USFIk, USFIkPath, USFIK_SADRZAJ };
