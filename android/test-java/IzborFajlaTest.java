package ba.spd.usf.forest;

public class IzborFajlaTest {
    public static void main(String[] args) {
        // birač KML/SHP (index.html #kml-file-input) — NE smije u uvoz offline karte
        assert !IzborFajla.jeOfflineKarta(new String[]{".kml", ".kmz", ".shp", ".dbf", ".prj", ".shx"}) : ".dbf nije .db";
        assert !IzborFajla.jeOfflineKarta(new String[]{".kml,.kmz,.shp,.dbf,.prj,.shx"});
        assert !IzborFajla.jeOfflineKarta(new String[]{"image/*"});
        assert !IzborFajla.jeOfflineKarta(null);
        assert !IzborFajla.jeOfflineKarta(new String[]{""});
        // birač offline karata (#sqlmap-file-input)
        assert IzborFajla.jeOfflineKarta(new String[]{".mbtiles", ".sqlitedb", ".sqlite", ".sqlmap", ".db"});
        assert IzborFajla.jeOfflineKarta(new String[]{".MBTILES"});
        assert IzborFajla.jeOfflineKarta(new String[]{".mbtiles,.sqlitedb"});
        System.out.println("IzborFajlaTest: OK");
    }
}
