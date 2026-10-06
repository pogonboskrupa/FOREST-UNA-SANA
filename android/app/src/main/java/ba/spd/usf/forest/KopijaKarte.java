package ba.spd.usf.forest;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Trajna kopija offline karte u pozadini (karta se već prikazuje iz izvornog fajla).
 * Piše u &lt;cilj&gt;.part i tek provjerena kopija (dužina + SQLite zaglavlje) dobija
 * konačno ime — prekid ili greška nikad ne ostave poluzapisanu kartu pod pravim imenom.
 */
final class KopijaKarte {
    interface Napredak { void javi(long imam, long ukupno); }

    private volatile boolean prekid;
    void prekini() { prekid = true; }
    boolean prekinuta() { return prekid; }

    static File part(File cilj) { return new File(cilj.getPath() + ".part"); }

    /** @param ukupno očekivana dužina (-1 ako je izvor ne zna) */
    void kopiraj(InputStream in, long ukupno, File cilj, Napredak napredak, long razmakMs) throws IOException {
        File part = part(cilj);
        long imam = 0, zadnje = 0;
        try {
            try (FileOutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[1024 * 1024];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    if (prekid) throw new IOException("Kopiranje prekinuto");
                    out.write(buf, 0, n);
                    imam += n;
                    long sad = System.currentTimeMillis();
                    if (napredak != null && sad - zadnje >= razmakMs) { zadnje = sad; napredak.javi(imam, ukupno); }
                }
                out.getFD().sync();
            }
            if (ukupno >= 0 && imam != ukupno) throw new IOException("Kopija nepotpuna (" + imam + " od " + ukupno + " B)");
            if (!jeSqlite(part)) throw new IOException("Fajl nije SQLite karta");
            if (cilj.exists() && !cilj.delete()) throw new IOException("Stara kopija se ne može zamijeniti");
            if (!part.renameTo(cilj)) throw new IOException("Kopija se ne može preimenovati");
            if (napredak != null) napredak.javi(imam, ukupno);
        } catch (IOException e) {
            part.delete();
            throw e;
        }
    }

    static boolean jeSqlite(File f) {
        byte[] zag = new byte[16];
        try (InputStream in = new FileInputStream(f)) {
            return in.read(zag) == 16 && new String(zag, 0, 15, StandardCharsets.US_ASCII).equals("SQLite format 3");
        } catch (IOException e) { return false; }
    }
}
