package ba.spd.usf.forest;

import java.io.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/** Durable handoff: rotate the active log, acknowledge only the exact batch read. */
final class NativeGpsBuffer {
    static final Object LOCK = new Object();
    private final File active, pending;
    NativeGpsBuffer(File dir) {
        active = new File(dir, "gps_native_buffer.jsonl");
        pending = new File(dir, "gps_native_pending.jsonl");
    }
    void append(String line) throws IOException {
        synchronized (LOCK) {
            try (FileOutputStream out = new FileOutputStream(active, true)) {
                // Leading newline isolates a truncated last line after a process/power loss.
                out.write(("\n" + line + "\n").getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
        }
    }
    String[] read() throws IOException {
        synchronized (LOCK) {
            if (!pending.exists() && active.exists() && !active.renameTo(pending))
                throw new IOException("GPS batch rotation failed");
            if (!pending.exists()) return new String[]{"", ""};
            byte[] bytes = bytes(pending);
            return new String[]{digest(bytes), new String(bytes, StandardCharsets.UTF_8)};
        }
    }
    boolean ack(String token) throws IOException {
        synchronized (LOCK) {
            return pending.exists() && digest(bytes(pending)).equals(token) && pending.delete();
        }
    }
    private static byte[] bytes(File file) throws IOException {
        try (InputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }
    private static String digest(byte[] bytes) throws IOException {
        try {
            StringBuilder result = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) result.append(String.format("%02x", b & 255));
            return result.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new IOException(e); }
    }
}
