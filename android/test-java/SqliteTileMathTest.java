package ba.spd.usf.forest;

/**
 * Bez JUnit-a (radi u CI-ju samo sa javac/java, bez Gradle zavisnosti).
 * Pokretanje: javac -d /tmp/jt android/app/src/main/java/ba/spd/usf/forest/SqliteTileMath.java \
 *               android/test-java/SqliteTileMathTest.java && java -ea -cp /tmp/jt ba.spd.usf.forest.SqliteTileMathTest
 */
public class SqliteTileMathTest {
    private static int pass = 0;

    private static void check(boolean ok, String msg) {
        if (!ok) throw new AssertionError(msg);
        pass++;
        System.out.println("  ✔ " + msg);
    }

    public static void main(String[] args) {
        System.out.println("SqliteTileMath — .sqlitedb (BigPlanet) zoom i granice:");

        check(SqliteTileMath.invertedFromInfo(null), "bez info.tilenumbering → obrnut zoom (OsmAnd/RMaps/Locus)");
        check(SqliteTileMath.invertedFromInfo("BigPlanet"), "tilenumbering=BigPlanet → obrnut zoom");
        check(!SqliteTileMath.invertedFromInfo("simple"), "tilenumbering=simple → normalan zoom");

        // Bihać na zoomu 14 u BigPlanet fajlu je spremljen kao z = 17 - 14 = 3.
        check(SqliteTileMath.storedZoom(14, true) == 3, "zoom 14 se u bazi traži kao z=3");
        check(SqliteTileMath.storedZoom(14, false) == 14, "bez obrtanja zoom ostaje 14");
        check(SqliteTileMath.realZoom(3, true) == 14, "z=3 iz baze je stvarni zoom 14");

        int[] r = SqliteTileMath.realZoomRange(3, 9, true); // stvarno 8..14
        check(r[0] == 8 && r[1] == 14, "raspon u bazi 3..9 → stvarni zoom 8..14 (min/max zamijenjeni)");

        check(SqliteTileMath.invertedPlausible(3, 9), "z 3..9 može biti BigPlanet");
        check(!SqliteTileMath.invertedPlausible(12, 18), "z do 18 ne može biti BigPlanet (max je 17)");

        // MOBAC RMaps: zoom 12..14 spremljen kao z 5..3; z=3 (zoom 14) ima najviše pločica.
        check(SqliteTileMath.decideInverted(null, 3, 5, 144, 9), "više pločica na najmanjem z → obrnut (RMaps/Locus)");
        // Normalan .sqlitedb bez info tabele: z 12..14, z=14 ima najviše pločica.
        check(!SqliteTileMath.decideInverted(null, 12, 14, 9, 144), "više pločica na najvećem z → normalan, iako nema info tabele");
        check(SqliteTileMath.decideInverted(null, 4, 4, 9, 9), "jedan nivo, bez info → OsmAnd pravilo (obrnut)");
        check(!SqliteTileMath.decideInverted("simple", 4, 4, 9, 9), "jedan nivo, tilenumbering=simple → normalan");
        check(!SqliteTileMath.decideInverted(null, 10, 18, 900, 4), "z iznad 17 → nikad obrnut");

        // XYZ pločica Bihaća (44.8167N, 15.87E) na z12: x=2228, y=1476.
        String b = SqliteTileMath.boundsFromTileRange(12, 2228, 2228, 1476, 1476, false);
        String[] p = b.split(",");
        double west = Double.parseDouble(p[0]), south = Double.parseDouble(p[1]);
        double east = Double.parseDouble(p[2]), north = Double.parseDouble(p[3]);
        check(west < 15.87 && east > 15.87 && south < 44.8167 && north > 44.8167,
                "granice XYZ pločice sadrže Bihać (" + b + ")");

        int tms = SqliteTileMath.tmsY(12, 1476);
        String bt = SqliteTileMath.boundsFromTileRange(12, 2228, 2228, tms, tms, true);
        check(b.equals(bt), "ista pločica kao TMS daje iste granice");

        check(SqliteTileMath.boundsFromTileRange(-1, 0, 0, 0, 0, false).isEmpty(), "neispravan zoom → prazne granice");

        System.out.println("\n" + pass + " prošlo, 0 palo — SqliteTileMath");
    }
}
