package ba.spd.usf.forest;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicLong;

// Kopija offline karte u pozadini: napredak, prekid i provjere ne smiju ostaviti
// poluzapisanu kartu pod konačnim imenom.
public class KopijaKarteTest {
    static int pass = 0;
    static void ok(boolean c, String m) { if (!c) throw new AssertionError(m); pass++; System.out.println("  ok " + m); }
    static byte[] karta(int n) { byte[] b = new byte[n]; byte[] z = "SQLite format 3\0".getBytes(StandardCharsets.US_ASCII); System.arraycopy(z, 0, b, 0, 16); for (int i = 16; i < n; i++) b[i] = (byte) i; return b; }

    public static void main(String[] a) throws Exception {
        System.out.println("KopijaKarte:");
        File dir = Files.createTempDirectory("kopija").toFile();
        byte[] src = karta(5 * 1024 * 1024 + 123);

        File cilj = new File(dir, "k1.sqlite");
        AtomicLong zadnji = new AtomicLong(-1); int[] poziva = {0};
        new KopijaKarte().kopiraj(new ByteArrayInputStream(src), src.length, cilj, (imam, uk) -> { zadnji.set(imam); poziva[0]++; }, 0);
        ok(cilj.isFile() && cilj.length() == src.length && java.util.Arrays.equals(Files.readAllBytes(cilj.toPath()), src), "kopija identična izvoru");
        ok(zadnji.get() == src.length && poziva[0] >= 2, "napredak javljen do kraja");
        ok(!KopijaKarte.part(cilj).exists(), ".part uklonjen poslije uspjeha");

        File c2 = new File(dir, "k2.sqlite");
        KopijaKarte k = new KopijaKarte();
        try { k.kopiraj(new ByteArrayInputStream(src), src.length, c2, (imam, uk) -> k.prekini(), 0); ok(false, "prekid mora baciti"); }
        catch (IOException e) { ok(!c2.exists() && !KopijaKarte.part(c2).exists(), "prekid: nema ni karte ni .part"); }

        File c3 = new File(dir, "k3.sqlite");
        try { new KopijaKarte().kopiraj(new ByteArrayInputStream(src, 0, 1000), src.length, c3, null, 0); ok(false, "kraća kopija mora baciti"); }
        catch (IOException e) { ok(!c3.exists() && !KopijaKarte.part(c3).exists(), "nepotpuna kopija (izvor nestao) se ne prihvata"); }

        File c4 = new File(dir, "k4.sqlite"); byte[] html = "<html>nije karta</html>".getBytes(StandardCharsets.UTF_8);
        try { new KopijaKarte().kopiraj(new ByteArrayInputStream(html), html.length, c4, null, 0); ok(false, "ne-SQLite mora baciti"); }
        catch (IOException e) { ok(!c4.exists(), "fajl bez SQLite zaglavlja se odbija"); }

        File c5 = new File(dir, "k5.sqlite");
        new KopijaKarte().kopiraj(new ByteArrayInputStream(src), -1, c5, null, 1000);
        ok(c5.length() == src.length, "nepoznata dužina izvora (-1) radi");
        System.out.println("  " + pass + " testova prošlo");
    }
}
