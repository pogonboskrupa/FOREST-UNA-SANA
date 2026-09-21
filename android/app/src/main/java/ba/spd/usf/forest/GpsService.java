package ba.spd.usf.forest;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.IOException;
import java.util.Locale;

public class GpsService extends Service {

    private static final String CHANNEL_ID = "gps_recording";
    private static final int NOTIF_ID = 1001;
    // CPU se ne smije uspavati dok se snima (ekran ugašen / app u pozadini) —
    // bez ovoga Doze nakon nekog vremena zaustavi obradu GPS lokacija čak i
    // dok foreground service formalno radi. Safety timeout 12h štiti od
    // "zaboravljenog" lock-a ako servis ikad ne dobije "stop" akciju.
    private PowerManager.WakeLock wakeLock;

    // ── Native GPS bafer (nezavisan od WebView-a) ────────────────────────────
    // isRecordingActive (MainActivity) drži WebView živ dok se snima, ali to NE
    // garantuje da navigator.geolocation.watchPosition() nastavlja da dostavlja
    // fiksove dok WebView nema nijedan prozor (Activity uništena, "osiroćen" u
    // pozadini) — Chromium interno može ograničiti geolokaciju za stranicu bez
    // prikaza, nezavisno od toga da li je JS kontekst živ. Zato GpsService ovdje
    // SAM prikuplja pozicije preko LocationManager-a (potpuno nezavisno od
    // WebView-a) dok snimanje traje, i piše ih u fajl. Kad se app ponovo otvori
    // (WebView dobije prozor), JS strana (_drainNativeGpsBuffer, na
    // visibilitychange) povuče sve što je native sloj prikupio u međuvremenu i
    // popuni prazninu u tragu.
    public static final Object BUFFER_LOCK = NativeGpsBuffer.LOCK;
    private boolean paused;
    private android.content.SharedPreferences state() { return getSharedPreferences("gps_session", MODE_PRIVATE); }
    private LocationManager locationManager;
    private LocationListener locationListener;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        paused = state().getBoolean("paused", false);
        if (intent == null && !state().getBoolean("active", false)) { stopSelf(); return START_NOT_STICKY; }
        if (intent == null) {
            // START_STICKY restart od sistema (proces ubijen pa vraćen) — intent
            // je null. Bez ponovnog startForeground() + wake lock-a servis bi se
            // vratio "gol" (na O+ i rizik 'did not call startForeground' kill-a),
            // a snimanje u WebView-u bi tiho umrlo. Podigni oboje odmah.
            acquireWakeLock();
            showForegroundNotification("GPS Snimanje", "Snimanje traga aktivno");
            startNativeLocationUpdates();
            return START_STICKY;
        }

        String action = intent.getAction();
        if ("stop".equals(action)) {
            state().edit().putBoolean("active", false).putBoolean("paused", false).commit();
            sendBroadcastToWeb("stop");
            releaseWakeLock();
            stopNativeLocationUpdates();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if ("setPaused".equals(action)) {
            paused = intent.getBooleanExtra("paused", false);
            state().edit().putBoolean("paused", paused).commit();
            updateNotification("GPS Snimanje", paused ? "Pauzirano — otvori aplikaciju za nastavak" : "Snimanje traga aktivno");
            return START_STICKY;
        }

        if ("update".equals(action)) {
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            updateNotification(
                title != null ? title : "GPS Snimanje",
                body != null ? body : "Snimanje traga aktivno"
            );
            return START_STICKY;
        }

        String title = intent.getStringExtra("title");
        if (title == null) title = "GPS Snimanje";

        state().edit().putBoolean("active", true).commit();
        acquireWakeLock();
        showForegroundNotification(title, "Snimanje traga aktivno");
        // Ovo je stvarni početak NOVE sesije snimanja (poziv iz MainActivity) —
        // Retain unacknowledged fixes across start/restart. JS filters session time.
        startNativeLocationUpdates();
        return START_STICKY;
    }

    private void startNativeLocationUpdates() {
        if (locationManager != null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (locationManager == null) return;
        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                synchronized (BUFFER_LOCK) {
                    if (!state().getBoolean("paused", false)) appendToBuffer(location);
                }
            }
            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override
            public void onProviderEnabled(String provider) {}
            @Override
            public void onProviderDisabled(String provider) {}
        };
        try {
            // SAMO GPS provider, namjerno bez NETWORK_PROVIDER-a: mrežni fiksovi
            // (bazne stanice/wifi) znaju biti pomjereni desetine metara uz
            // prijavljeno "dobro" accuracy — naizmjenično isprepleteni sa pravim
            // GPS fiksovima u baferu prave cik-cak liniju koju JS filteri po
            // tačnosti ne mogu pouzdano uhvatiti. Na terenu (šuma) network
            // provider ionako nema šta ponuditi.
            {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 2000L, 0f, locationListener);
            }
        } catch (SecurityException ignored) {
            // dozvola oduzeta između provjere i poziva — nema šta, pobjegli fiksovi
            // se ionako ne mogu ni dobiti preko WebView-a u istoj situaciji
        }
    }

    private void stopNativeLocationUpdates() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (SecurityException ignored) {}
        }
        locationManager = null;
        locationListener = null;
    }

    private void appendToBuffer(Location location) {
        String line = String.format(Locale.US,
            "{\"la\":%.7f,\"lo\":%.7f,\"ac\":%.2f,\"al\":%.2f,\"sp\":%.2f,\"t\":%d}",
            location.getLatitude(), location.getLongitude(),
            location.hasAccuracy() ? location.getAccuracy() : 999.0,
            location.hasAltitude() ? location.getAltitude() : 0.0,
            location.hasSpeed() ? location.getSpeed() : 0.0, location.getTime());
        try { new NativeGpsBuffer(getFilesDir()).append(line); }
        catch (IOException e) { android.util.Log.e("UNA-SANA-FOREST", "GPS storage write failed"); }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "unasanaforest:gps_recording");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(12 * 60 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void showForegroundNotification(String title, String body) {
        Notification notification = buildNotification(title, body);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private void updateNotification(String title, String body) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification(title, body));
        }
    }

    private Notification buildNotification(String title, String body) {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingOpen = PendingIntent.getActivity(this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(pendingOpen)
                .addAction(android.R.drawable.ic_menu_edit, "Otvori snimanje", pendingOpen)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void sendBroadcastToWeb(String action) {
        Intent i = new Intent("ba.spd.usf.forest.REC_ACTION");
        i.putExtra("action", action);
        i.setPackage(getPackageName());
        sendBroadcast(i);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "GPS Snimanje",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Obavještenje tokom GPS snimanja traga");
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    // Korisnik je izbacio app iz "recent apps" (swipe) usred snimanja. Activity
    // se uništava, ali snimanje MORA teći dalje — zato se ovdje NE zove
    // stopSelf(). Uz android:stopWithTask="false" u manifestu ovo je drugi,
    // nezavisan sloj iste namjere.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        acquireWakeLock();
        showForegroundNotification("GPS Snimanje", "Snimanje se nastavlja — app je zatvorena");
        startNativeLocationUpdates();
        // super se NAMJERNO ne zove: podrazumijevana implementacija u nekim
        // slučajevima zaustavi servis zajedno sa taskom.
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        stopNativeLocationUpdates();
        super.onDestroy();
    }
}
