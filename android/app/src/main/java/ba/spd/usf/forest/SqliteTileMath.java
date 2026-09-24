package ba.spd.usf.forest;

/**
 * Čista matematika za offline SQLite karte (bez Android zavisnosti, testira se
 * u CI-ju bez emulatora — vidi android/test-java/SqliteTileMathTest.java).
 *
 * .sqlitedb (RMaps / Locus / OsmAnd / MOBAC izvoz za njih) čuva zoom OBRNUTO:
 * z_u_bazi = 17 - zoom ("BigPlanet" numeracija). OsmAnd pravilo: obrnuto je
 * ako je info.tilenumbering = "BigPlanet" ILI ako ta kolona ne postoji (stari
 * fajlovi); bilo koja druga vrijednost (npr. "simple") znači normalan zoom.
 */
final class SqliteTileMath {
    static final int BIGPLANET_BASE = 17;

    private SqliteTileMath() {}

    /** tileNumbering == null znači da info.tilenumbering kolona/vrijednost ne postoji. */
    static boolean invertedFromInfo(String tileNumbering) {
        if (tileNumbering == null || tileNumbering.trim().isEmpty()) return true;
        return "BigPlanet".equalsIgnoreCase(tileNumbering.trim());
    }

    /**
     * Odluka iz samih podataka: u piramidi pločica viši STVARNI zoom ima više
     * pločica (~4× po nivou). Ako nivo sa najmanjom vrijednošću z u bazi ima
     * VIŠE pločica od nivoa sa najvećom, z je obrnut. null = ne može se odlučiti
     * (samo jedan nivo ili isti broj) — tada važi pravilo iz info tabele.
     */
    static Boolean invertedFromCounts(int minStoredZ, int maxStoredZ, long countAtMin, long countAtMax) {
        if (minStoredZ == maxStoredZ || countAtMin == countAtMax) return null;
        return countAtMin > countAtMax;
    }

    /** Konačna odluka: podaci > info tabela; BigPlanet nikad izvan 0..17. */
    static boolean decideInverted(String tileNumbering, int minStoredZ, int maxStoredZ, long countAtMin, long countAtMax) {
        if (!invertedPlausible(minStoredZ, maxStoredZ)) return false;
        Boolean byData = invertedFromCounts(minStoredZ, maxStoredZ, countAtMin, countAtMax);
        return byData != null ? byData : invertedFromInfo(tileNumbering);
    }

    /**
     * Obrnuta numeracija ne može predstaviti zoom > 17: ako u bazi postoji z < 0
     * ili z > 17, fajl sigurno NIJE BigPlanet bez obzira na info tabelu.
     */
    static boolean invertedPlausible(int minStoredZ, int maxStoredZ) {
        return minStoredZ >= 0 && maxStoredZ <= BIGPLANET_BASE;
    }

    static int storedZoom(int zoom, boolean inverted) {
        return inverted ? BIGPLANET_BASE - zoom : zoom;
    }

    static int realZoom(int storedZoom, boolean inverted) {
        return inverted ? BIGPLANET_BASE - storedZoom : storedZoom;
    }

    /** {min, max} u stvarnim (Leaflet) zoom nivoima. */
    static int[] realZoomRange(int minStored, int maxStored, boolean inverted) {
        int a = realZoom(minStored, inverted), b = realZoom(maxStored, inverted);
        return new int[]{Math.min(a, b), Math.max(a, b)};
    }

    static int tmsY(int zoom, int xyzY) {
        return (int) (Math.pow(2d, zoom) - 1d - xyzY);
    }

    /**
     * Granice "west,south,east,north" iz raspona pločica na jednom STVARNOM
     * zoom nivou. minY/maxY su onako kako stoje u bazi (TMS ili XYZ).
     * Vraća "" ako rezultat nije smislen.
     */
    static String boundsFromTileRange(int zoom, long minX, long maxX, long minY, long maxY, boolean tms) {
        if (zoom < 0 || zoom > 30) return "";
        double n = Math.pow(2d, zoom);
        double west = minX / n * 360d - 180d;
        double east = (maxX + 1d) / n * 360d - 180d;
        double southY = tms ? n - minY : maxY + 1d;
        double northY = tms ? n - 1d - maxY : minY;
        double south = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1d - 2d * southY / n))));
        double north = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1d - 2d * northY / n))));
        if (!Double.isFinite(west) || !Double.isFinite(south) || !Double.isFinite(east) || !Double.isFinite(north)
                || west >= east || south >= north) return "";
        return west + "," + south + "," + east + "," + north;
    }
}
