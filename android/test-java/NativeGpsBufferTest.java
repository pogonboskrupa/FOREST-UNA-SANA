package ba.spd.usf.forest;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;

// Trajna predaja GPS fiksova iz GpsService u JS: ništa se ne smije izgubiti ni kad
// novi fiksovi stižu dok JS još obrađuje prethodni paket (sati pod zaključanim ekranom).
public class NativeGpsBufferTest {
    static int pass = 0;
    static void ok(boolean c, String m) { if (!c) throw new AssertionError(m); pass++; System.out.println("  ✓ " + m); }
    static int linije(String raw) { int n = 0; for (String l : raw.split("\n")) if (!l.trim().isEmpty()) n++; return n; }

    public static void main(String[] a) throws Exception {
        System.out.println("NativeGpsBuffer:");
        File dir = Files.createTempDirectory("gpsbuf").toFile();
        NativeGpsBuffer b = new NativeGpsBuffer(dir);
        ok(b.read()[1].isEmpty(), "prazan bafer vraća prazan paket");

        for (int i = 0; i < 5400; i++) b.append("{\"la\":44.8,\"lo\":16.0,\"t\":" + i + "}"); // 3 h po 2 s
        String[] p1 = b.read();
        ok(linije(p1[1]) == 5400, "3 h fiksova u jednom paketu");

        b.append("{\"t\":9001}"); // stiže dok JS obrađuje
        ok(!b.ack("pogresan"), "pogrešan token ne briše paket");
        String[] ponovo = b.read();
        ok(ponovo[0].equals(p1[0]), "dok nema potvrde vraća se isti paket (bez gubitka)");
        ok(b.ack(p1[0]), "potvrda ispravnim tokenom");
        String[] p2 = b.read();
        ok(linije(p2[1]) == 1 && p2[1].contains("9001"), "fiks stigao za vrijeme obrade nije izgubljen");
        ok(b.ack(p2[0]) && b.read()[1].isEmpty(), "poslije potvrde bafer prazan");

        b.append("{\"t\":1}");
        try (FileOutputStream o = new FileOutputStream(new File(dir, "gps_native_buffer.jsonl"), true)) { o.write("{\"t\":2,\"la\":4".getBytes("UTF-8")); }
        b.append("{\"t\":3}");
        String raw = b.read()[1];
        ok(raw.contains("\n{\"t\":3}\n"), "krnja linija (nestanak struje) ne kvari sljedeći fiks");
        System.out.println("  " + pass + " testova prošlo");
    }
}
