package ba.spd.usf.forest;

import java.util.Locale;

/** Prepoznavanje birača fajlova po accept tipovima iz WebView-a (bez Android zavisnosti). */
final class IzborFajla {
    private IzborFajla() {}

    /**
     * Birač offline karata (MBTiles/SQLite). Poredi CIJELE tokene: ".dbf" (SHP atributi u
     * biraču KML/SHP) sadrži ".db" i ranije je slao svaki KML u uvoz offline karte.
     */
    static boolean jeOfflineKarta(String[] tipovi) {
        if (tipovi == null) return false;
        for (String tip : tipovi) {
            if (tip == null) continue;
            for (String t : tip.split(",")) {
                String s = t.trim().toLowerCase(Locale.ROOT);
                if (s.equals(".mbtiles") || s.equals(".sqlitedb") || s.equals(".sqlite") || s.equals(".sqlmap") || s.equals(".db")
                        || s.equals("application/vnd.sqlite3") || s.equals("application/x-sqlite3")) return true;
            }
        }
        return false;
    }
}
