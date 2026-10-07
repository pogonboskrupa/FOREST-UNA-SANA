package ba.spd.usf.forest;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.provider.OpenableColumns;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {

    private WebView webView;
    // Statički — preživljava uništenje OVE Activity instance. Kad korisnik potpuno
    // zatvori app (swipe iz recent apps) dok snimanje traje, Android zove Activity
    // onDestroy() (task je uklonjen), ali PROCES ostaje živ jer GpsService (foreground
    // servis) i dalje radi u istom procesu. Ako bismo tad uništili WebView, JS/GPS
    // watch bi umro zajedno s Activity-jem. Umjesto toga, WebView se NAMJERNO ne
    // uništava (vidi onDestroy) dok je isRecordingActive true.
    private static WebView sWebView;
    // Isti razlog kao sWebView: dok je snimanje aktivno kad se Activity uništi,
    // onDestroy() NE smije unregistrovati ovaj receiver.
    private static BroadcastReceiver sRecActionReceiver;
    private boolean reusedWebView = false;
    private ValueCallback<Uri[]> fileCallback;
    // Fotografija iz kamere za terenske tačke (FileProvider u cache/foto).
    private Uri cameraUri;
    private WebViewAssetLoader assetLoader;
    private BroadcastReceiver recActionReceiver;
    private volatile File pendingUpdateApk;
    private volatile boolean updateInProgress = false;
    private boolean pendingOfflineMapImport = false;
    private final Map<String, SQLiteDatabase> mbtilesDatabases = new ConcurrentHashMap<>();
    private final Map<String, TileSchema> tileSchemas = new ConcurrentHashMap<>();
    // Prvi uvoz: karta se čita direktno iz izabranog fajla (fd) dok trajna kopija u
    // offline_maps teče u pozadini — korisnik ne čeka kopiranje 1–2 GB da bi vidio kartu.
    private static final String PREFS_IZVOR = "native_mbtiles_izvor";
    private final Map<String, ParcelFileDescriptor> mbtilesIzvori = new ConcurrentHashMap<>();
    private final Map<String, KopijaKarte> mbtilesKopije = new ConcurrentHashMap<>();

    // Podržava standardni MBTiles i česte SQLiteDB varijante: z/x/y/image.
    private static final class TileSchema {
        final String table, z, x, y, data, sql; final boolean tms, inverted;
        // Koja orijentacija Y ose stvarno pogađa pločice (0 = još nepoznato, 1 = prva, 2 = druga):
        // poslije prvog pogotka pločica koja ne postoji košta jedan upit, ne dva.
        volatile int yRed;
        TileSchema(String table, String z, String x, String y, String data, boolean tms, boolean inverted) {
            this.table = table; this.z = z; this.x = x; this.y = y; this.data = data; this.tms = tms;
            this.inverted = inverted;
            this.sql = "SELECT " + q(data) + " FROM " + q(table) + " WHERE " + q(z) + "=? AND " + q(x) + "=? AND " + q(y) + "=?";
        }
    }
    // Android SQLite bez WAL-a ima jednu konekciju po bazi — paralelni zahtjevi za pločice
    // (WebView ih šalje 4–6 odjednom) bi čekali u redu. Zato do 3 read-only konekcije na
    // istu putanju, redom; set je vezan za trenutnu glavnu bazu (zamjena izvor → kopija).
    private static final int CITACA = 3;
    private final Map<String, SQLiteDatabase[]> mbtilesCitaci = new ConcurrentHashMap<>();
    private final java.util.concurrent.atomic.AtomicInteger citacRed = new java.util.concurrent.atomic.AtomicInteger();

    private static final int REQ_FILE = 1;
    private static final int REQ_PERMS = 2;
    private static final int REQ_BG_LOC = 3;
    // Postavlja se preko GpsBridge dok GPS snimanje traje. WebView.onPause() je
    // dokumentovano da "best-effort pauzira geolocation" — ako se pozove dok se
    // snima, watchPosition() prestaje primati nove tačke čim korisnik izađe iz
    // app-a, pa snimanje izgleda "prekinuto" iako je foreground servis aktivan.
    private static volatile boolean isRecordingActive = false;
    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/index.html";

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        if (sWebView != null) {
            // Ponovno otvaranje app-a dok je snimanje preživjelo u pozadini — iskoristi
            // ISTI WebView, ne pravi novi i ne zovi loadUrl.
            webView = sWebView;
            reusedWebView = true;
            ViewGroup oldParent = (ViewGroup) webView.getParent();
            if (oldParent != null) oldParent.removeView(webView);
        } else {
            webView = new WebView(this);
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            sWebView = webView;
        }
        setContentView(webView);

        hideSystemUI();
        requestPermissions();
        setupWebView();
        registerRecActionReceiver();
        primiFajl(getIntent());

        if (!reusedWebView) {
            if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(APP_URL);
            }
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AllowAllHostsInWebView"})
    private void setupWebView() {
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(true);
        ws.setAllowFileAccessFromFileURLs(false);
        ws.setAllowUniversalAccessFromFileURLs(false);
        ws.setGeolocationEnabled(true);
        // LOAD_DEFAULT poštuje stvarna cache zaglavlja sa servera — CDN fajlovi
        // se i dalje keširaju, a Supabase odgovori se uvijek dohvataju svježe.
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setTextZoom(100);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // Service-worker fetches must resolve packaged assets too, even on a first offline launch.
        if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            final WebViewAssetLoader localAssets = assetLoader;
            androidx.webkit.ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                new androidx.webkit.ServiceWorkerClientCompat() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        WebResourceResponse tile = interceptMbtilesTile(request.getUrl());
                        if (tile != null) return tile;
                        return localAssets.shouldInterceptRequest(request.getUrl());
                    }
                });
        }

        webView.addJavascriptInterface(new DownloadBridge(), "AndroidDownload");
        webView.addJavascriptInterface(new GpsBridge(), "AndroidGps");
        webView.addJavascriptInterface(new ShareBridge(), "AndroidShare");
        webView.addJavascriptInterface(new NetBridge(), "AndroidNet");
        webView.addJavascriptInterface(new AppNotifBridge(), "AndroidNotif");
        webView.addJavascriptInterface(new UpdateBridge(), "AndroidUpdate");
        webView.addJavascriptInterface(new MbtilesBridge(), "AndroidMbtiles");
        webView.addJavascriptInterface(new KartaBridge(), "AndroidKarta");
        webView.addJavascriptInterface(new RangeBridge(), "AndroidRange");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                    WebResourceRequest request) {
                WebResourceResponse tile = interceptMbtilesTile(request.getUrl());
                if (tile != null) return tile;
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("https://appassets.androidplatform.net/")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                // Reload/navigacija resetuje JS stanje, ali native isRecordingActive bi
                // bez ovoga ostao zaglavljen na true. Nova stranica = snimanje ne postoji.
                isRecordingActive = getSharedPreferences("gps_session", MODE_PRIVATE).getBoolean("active", false);
                super.onPageStarted(view, url, favicon);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, true);
            }

            // Bez ovih override-a WebView za JS alert()/confirm()/prompt() prikazuje SVOJ
            // default dijalog sa naslovom porijekla (appassets.androidplatform.net).
            @Override
            public boolean onJsAlert(WebView view, String url, String message,
                    final android.webkit.JsResult result) {
                if (isFinishing() || isDestroyed()) { result.cancel(); return true; }
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle(getString(R.string.app_name))
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message,
                    final android.webkit.JsResult result) {
                if (isFinishing() || isDestroyed()) { result.cancel(); return true; }
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle(getString(R.string.app_name))
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel,
                                (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                    String defaultValue, final android.webkit.JsPromptResult result) {
                if (isFinishing() || isDestroyed()) { result.cancel(); return true; }
                final android.widget.EditText unos = new android.widget.EditText(MainActivity.this);
                unos.setSingleLine(true);
                if (defaultValue != null) { unos.setText(defaultValue); unos.setSelection(defaultValue.length()); }
                int pad = (int) (20 * getResources().getDisplayMetrics().density);
                android.widget.FrameLayout okvir = new android.widget.FrameLayout(MainActivity.this);
                okvir.setPadding(pad, pad / 2, pad, 0);
                okvir.addView(unos);
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle(getString(R.string.app_name))
                        .setMessage(message)
                        .setView(okvir)
                        .setPositiveButton(android.R.string.ok,
                                (dialog, which) -> result.confirm(unos.getText().toString()))
                        .setNegativeButton(android.R.string.cancel,
                                (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView wv,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = filePathCallback;
                pendingOfflineMapImport = isOfflineMapChooser(fileChooserParams);
                cameraUri = null;
                Intent intent;
                if (!pendingOfflineMapImport && isImageChooser(fileChooserParams)) {
                    intent = imageIntent(fileChooserParams.isCaptureEnabled());
                } else if (pendingOfflineMapImport) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                } else {
                    // fileChooserParams.createIntent() ograniči MIME tip na
                    // application/vnd.google-earth.kml+xml što mnogi file manageri
                    // ne prepoznaju — KML/SHP fajlovi ostanu skriveni. Koristimo
                    // ACTION_OPEN_DOCUMENT s */* pa korisnik vidi sve fajlove.
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
                try {
                    startActivityForResult(intent, REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this,
                            "Ne mogu otvoriti birač fajlova", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                    String contentDisposition, String mimetype, long contentLength) {
                if (url.startsWith("blob:")) {
                    webView.evaluateJavascript(
                        "(function(){" +
                        "var x=new XMLHttpRequest();" +
                        "x.open('GET','" + url.replace("'", "\\'") + "',true);" +
                        "x.responseType='blob';" +
                        "x.onload=function(){" +
                        "  var r=new FileReader();" +
                        "  r.onload=function(){" +
                        "    var fn=document.querySelector('a[download]');" +
                        "    var name=fn?fn.download:'download';" +
                        "    AndroidDownload.save(name,r.result);" +
                        "  };" +
                        "  r.readAsDataURL(x.response);" +
                        "};" +
                        "x.send();" +
                        "})()", null);
                }
            }
        });

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    }

    private boolean isImageChooser(WebChromeClient.FileChooserParams params) {
        String[] types = params.getAcceptTypes();
        if (types == null) return false;
        for (String type : types) if (type != null && type.toLowerCase().startsWith("image/")) return true;
        return false;
    }

    // capture=true → odmah kamera; inače izbor: kamera ili galerija (više slika).
    private Intent imageIntent(boolean samoKamera) {
        Intent kamera = null;
        try {
            File dir = new File(getCacheDir(), "foto");
            if (!dir.exists()) dir.mkdirs();
            File[] stari = dir.listFiles();
            if (stari != null) for (File o : stari) if (o.lastModified() < System.currentTimeMillis() - 86400000L) o.delete();
            File f = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
            kamera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            kamera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            kamera.setClipData(android.content.ClipData.newRawUri("foto", cameraUri));
            kamera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            cameraUri = null;
        }
        if (samoKamera && kamera != null) return kamera;
        Intent galerija = new Intent(Intent.ACTION_GET_CONTENT);
        galerija.setType("image/*");
        galerija.addCategory(Intent.CATEGORY_OPENABLE);
        galerija.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent izbor = Intent.createChooser(galerija, "Fotografija");
        if (kamera != null) izbor.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{kamera});
        return izbor;
    }

    private boolean isOfflineMapChooser(WebChromeClient.FileChooserParams params) {
        return IzborFajla.jeOfflineKarta(params.getAcceptTypes());
    }

    private File mbtilesDir() {
        File dir = new File(getFilesDir(), "offline_maps");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File mbtilesFile(String id) {
        return new File(mbtilesDir(), id + ".sqlite");
    }

    private String displayName(Uri uri) {
        String name = "offline.mbtiles";
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int col = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (col >= 0) name = c.getString(col);
            }
        } catch (Exception ignored) {}
        return name == null || name.trim().isEmpty() ? "offline.mbtiles" : name;
    }

    // Neke SQLite karte imaju standardnu MBTiles tabelu tiles, ali nemaju
    // metadata.bounds. Bez granica se karta uveze, ali ostane na staroj lokaciji.
    // Granice tada računamo iz najnižeg zoom nivoa bez čitanja cijele baze u RAM.
    private static String pickColumn(java.util.HashSet<String> cols, String... choices) {
        for (String choice : choices) if (cols.contains(choice)) return choice;
        return null;
    }

    private static String q(String column) {
        return "\"" + column.replace("\"", "\"\"") + "\"";
    }

    private TileSchema tileSchema(String id) throws Exception {
        TileSchema cached = tileSchemas.get(id);
        if (cached != null) return cached;
        SQLiteDatabase db = openMbtiles(id);
        // .mbtiles uglavnom koristi tiles(zoom_level,tile_column,tile_row,tile_data),
        // dok .sqlitedb često ima tiles(z,x,y,image), tile_cache ili drugo ime tabele.
        // Ne smijemo odbaciti fajl samo zato što se tabela ne zove doslovno "tiles".
        java.util.ArrayList<String> tables = new java.util.ArrayList<>();
        try (Cursor c = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY CASE WHEN lower(name)='tiles' THEN 0 ELSE 1 END, name", null)) {
            while (c.moveToNext()) {
                String name = c.getString(0);
                if (name != null && !name.startsWith("sqlite_")) tables.add(name);
            }
        }
        for (String table : tables) {
            java.util.HashSet<String> cols = new java.util.HashSet<>();
            try (Cursor c = db.rawQuery("PRAGMA table_info(" + q(table) + ")", null)) {
                while (c.moveToNext()) cols.add(c.getString(1).toLowerCase(java.util.Locale.ROOT));
            } catch (Exception ignored) { continue; }
            String z = pickColumn(cols, "zoom_level", "z", "zoom", "level");
            String x = pickColumn(cols, "tile_column", "x", "column", "col");
            String y = pickColumn(cols, "tile_row", "y", "row");
            String data = pickColumn(cols, "tile_data", "image", "data", "tile", "blob");
            if (z == null || x == null || y == null || data == null) continue;
            boolean mbtiles = "zoom_level".equals(z);
            boolean inverted = false;
            if (!mbtiles) {
                // .sqlitedb (RMaps/Locus/OsmAnd) često čuva zoom obrnuto (17 - zoom).
                // Odluka iz broja pločica po nivou, pa info.tilenumbering — vidi
                // SqliteTileMath. Bez ovoga se ne nađe nijedna pločica, a zoom
                // raspon i granice ispadnu pogrešni.
                int[] stored = storedZoomRange(db, table, z);
                if (stored != null) {
                    inverted = SqliteTileMath.decideInverted(infoTileNumbering(db), stored[0], stored[1],
                            tileCountAtZoom(db, table, z, stored[0]), tileCountAtZoom(db, table, z, stored[1]));
                }
            }
            TileSchema schema = new TileSchema(table, z, x, y, data, "tile_row".equals(y), inverted);
            tileSchemas.put(id, schema);
            return schema;
        }
        throw new IOException("SQLite nema raster pločice (z/x/y + slika)");
    }

    /** Vrijednost info.tilenumbering, ili null ako tabela/kolona ne postoji. */
    private static String infoTileNumbering(SQLiteDatabase db) {
        try (Cursor c = db.rawQuery("SELECT tilenumbering FROM info LIMIT 1", null)) {
            if (c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        return null;
    }

    private static long tileCountAtZoom(SQLiteDatabase db, String table, String zCol, int storedZ) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM " + q(table) + " WHERE " + q(zCol) + "=?",
                new String[]{String.valueOf(storedZ)})) {
            if (c.moveToFirst()) return c.getLong(0);
        } catch (Exception ignored) {}
        return 0;
    }

    private static int[] storedZoomRange(SQLiteDatabase db, String table, String zCol) {
        try (Cursor c = db.rawQuery("SELECT MIN(" + q(zCol) + "), MAX(" + q(zCol) + ") FROM " + q(table), null)) {
            if (c.moveToFirst() && !c.isNull(0) && !c.isNull(1)) return new int[]{c.getInt(0), c.getInt(1)};
        } catch (Exception ignored) {}
        return null;
    }

    private SQLiteDatabase citac(String id) throws Exception {
        SQLiteDatabase glavna = openMbtiles(id);
        SQLiteDatabase[] set = mbtilesCitaci.get(id);
        if (set == null || set[0] != glavna) set = noviCitaci(id, glavna);
        SQLiteDatabase db = set[(citacRed.getAndIncrement() & 0x7fffffff) % set.length];
        return db.isOpen() ? db : glavna;
    }

    private synchronized SQLiteDatabase[] noviCitaci(String id, SQLiteDatabase glavna) {
        SQLiteDatabase[] set = mbtilesCitaci.get(id);
        if (set != null && set[0] == glavna) return set;
        java.util.ArrayList<SQLiteDatabase> l = new java.util.ArrayList<>();
        l.add(glavna);
        for (int i = 1; i < CITACA; i++) {
            try {
                l.add(SQLiteDatabase.openDatabase(glavna.getPath(), null,
                        SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS));
            } catch (Exception e) { break; }
        }
        SQLiteDatabase[] novi = l.toArray(new SQLiteDatabase[0]);
        SQLiteDatabase[] stari = mbtilesCitaci.put(id, novi);
        zatvoriCitace(stari, 5000);
        return novi;
    }

    // set[0] je glavna baza — nju zatvara vlasnik (zamjena/brisanje), ovdje samo dodatni čitači.
    private void zatvoriCitace(SQLiteDatabase[] set, long odgoda) {
        if (set == null || set.length < 2) return;
        Runnable r = () -> { for (int i = 1; i < set.length; i++) try { set[i].close(); } catch (Exception ignored) {} };
        if (odgoda > 0) new Handler(Looper.getMainLooper()).postDelayed(r, odgoda); else r.run();
    }

    private byte[] tileBytes(String id, int z, int x, int xyzY) throws Exception {
        TileSchema s = tileSchema(id);
        SQLiteDatabase db = citac(id);
        int tmsY = SqliteTileMath.tmsY(z, xyzY);
        int storedZ = SqliteTileMath.storedZoom(z, s.inverted);
        // Standardni MBTiles je TMS, a mnoge .sqlitedb karte čuvaju XYZ.
        int[] ys = s.tms ? new int[]{tmsY, xyzY} : new int[]{xyzY, tmsY};
        int poznat = s.yRed;
        for (int i = 0; i < 2; i++) {
            if (poznat != 0 && poznat != i + 1) continue;
            try (Cursor c = db.rawQuery(s.sql, new String[]{String.valueOf(storedZ), String.valueOf(x), String.valueOf(ys[i])})) {
                if (c.moveToFirst()) { if (poznat == 0) s.yRed = i + 1; return c.getBlob(0); }
            }
        }
        return null;
    }

    private int[] tileZoomRange(SQLiteDatabase db, TileSchema s) {
        int[] stored = storedZoomRange(db, s.table, s.z);
        if (stored == null) return new int[]{0, 19};
        return SqliteTileMath.realZoomRange(stored[0], stored[1], s.inverted);
    }

    private String boundsFromTiles(SQLiteDatabase db, TileSchema s) {
        // Najniži STVARNI zoom (najmanje pločica) — kod obrnute numeracije to je
        // najveća vrijednost u bazi.
        String agg = s.inverted ? "MAX" : "MIN";
        try (Cursor c = db.rawQuery(
                "SELECT " + q(s.z) + ", MIN(" + q(s.x) + "), MAX(" + q(s.x) + "), "
                + "MIN(" + q(s.y) + "), MAX(" + q(s.y) + ") FROM " + q(s.table) + " WHERE " + q(s.z)
                + "=(SELECT " + agg + "(" + q(s.z) + ") FROM " + q(s.table) + ")", null)) {
            if (!c.moveToFirst() || c.isNull(0) || c.isNull(1) || c.isNull(2) || c.isNull(3) || c.isNull(4)) return "";
            int zoom = SqliteTileMath.realZoom(c.getInt(0), s.inverted);
            return SqliteTileMath.boundsFromTileRange(zoom, c.getLong(1), c.getLong(2), c.getLong(3), c.getLong(4), s.tms);
        } catch (Exception ignored) { return ""; }
    }

    private JSONObject readMbtilesInfo(String id, String name) throws Exception {
        SQLiteDatabase db = openMbtiles(id);
        TileSchema schema = tileSchema(id);
        JSONObject meta = new JSONObject();
        try (Cursor c = db.rawQuery("SELECT name,value FROM metadata", null)) {
            while (c.moveToNext()) meta.put(c.getString(0), c.getString(1));
        } catch (Exception ignored) {}
        int[] zooms = tileZoomRange(db, schema);
        String bounds = meta.optString("bounds", "");
        if (bounds.trim().isEmpty()) bounds = boundsFromTiles(db, schema);
        JSONObject out = new JSONObject();
        out.put("id", id); out.put("name", name);
        out.put("minzoom", meta.has("minzoom") ? meta.optInt("minzoom", zooms[0]) : zooms[0]);
        out.put("maxzoom", meta.has("maxzoom") ? meta.optInt("maxzoom", zooms[1]) : zooms[1]);
        out.put("format", meta.optString("format", "png"));
        out.put("bounds", bounds); out.put("native", true);
        return out;
    }
    private SQLiteDatabase openMbtiles(String id) throws Exception {
        SQLiteDatabase cached = mbtilesDatabases.get(id);
        if (cached != null && cached.isOpen()) return cached;
        File file = mbtilesFile(id);
        if (!file.isFile()) return otvoriIzIzvora(id);
        SQLiteDatabase opened = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null,
                SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
        mbtilesDatabases.put(id, opened);
        return opened;
    }

    private Uri izvorKarte(String id) {
        String u = getSharedPreferences(PREFS_IZVOR, MODE_PRIVATE).getString(id, null);
        return u != null ? Uri.parse(u) : null;
    }

    // SQLite otvara izvorni fajl preko /proc/self/fd (SAF uri nema putanju); samo čitanje.
    private synchronized SQLiteDatabase otvoriIzIzvora(String id) throws Exception {
        SQLiteDatabase cached = mbtilesDatabases.get(id);
        if (cached != null && cached.isOpen()) return cached;
        Uri uri = izvorKarte(id);
        if (uri == null) throw new IOException("Karta nije pronađena");
        ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(uri, "r");
        if (pfd == null) throw new IOException("Izvorni fajl nije dostupan");
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase("/proc/self/fd/" + pfd.getFd(), null,
                    SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
            try (Cursor c = db.rawQuery("SELECT count(*) FROM sqlite_master", null)) { c.moveToFirst(); }
        } catch (Exception e) {
            if (db != null) db.close();
            pfd.close();
            throw e;
        }
        ParcelFileDescriptor stari = mbtilesIzvori.put(id, pfd);
        if (stari != null) try { stari.close(); } catch (IOException ignored) {}
        mbtilesDatabases.put(id, db);
        return db;
    }

    private void zaboraviIzvor(String id) {
        Uri uri = izvorKarte(id);
        getSharedPreferences(PREFS_IZVOR, MODE_PRIVATE).edit().remove(id).commit();
        if (uri != null) try { getContentResolver().releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) {}
    }

    private void javiKopiju(String id, int p, String stanje, String poruka) {
        String js = "window._sqlKopija&&_sqlKopija(" + JSONObject.quote(id) + "," + p + ","
                + JSONObject.quote(stanje) + "," + JSONObject.quote(poruka) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    private void pokreniKopiju(String id) {
        KopijaKarte k = new KopijaKarte();
        if (mbtilesKopije.putIfAbsent(id, k) != null) return;
        new Thread(() -> trajnaKopija(id, k), "mbtiles-kopija").start();
    }

    // Kopija iz izvora u offline_maps; na kraju čitanje prelazi na kopiju, a stara baza i
    // fd se zatvaraju tek poslije 5 s (pločice koje se baš čitaju ne smiju dobiti prazno).
    private void trajnaKopija(String id, KopijaKarte k) {
        try {
            Uri uri = izvorKarte(id);
            if (uri == null) return;
            ParcelFileDescriptor pfd = mbtilesIzvori.get(id);
            long vel = pfd != null ? pfd.getStatSize() : -1;
            if (vel > 0 && mbtilesDir().getUsableSpace() < vel + 200L * 1024 * 1024) {
                javiKopiju(id, -1, "prostor", "Nema dovoljno prostora za trajnu kopiju (" + (vel / 1048576) + " MB) — karta radi dok je izvorni fajl na telefonu");
                return;
            }
            File cilj = mbtilesFile(id);
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("Izvorni fajl nije dostupan");
                k.kopiraj(in, vel, cilj, (imam, uk) -> javiKopiju(id, uk > 0 ? (int) (imam * 100 / uk) : -1, "kopija", String.valueOf(imam / 1048576)), 1000);
            }
            if (k.prekinuta()) { cilj.delete(); return; }
            SQLiteDatabase nova = SQLiteDatabase.openDatabase(cilj.getAbsolutePath(), null,
                    SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
            SQLiteDatabase stara = mbtilesDatabases.put(id, nova);
            zatvoriCitace(mbtilesCitaci.remove(id), 5000);
            ParcelFileDescriptor stariFd = mbtilesIzvori.remove(id);
            zaboraviIzvor(id);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (stara != null && stara != nova) try { stara.close(); } catch (Exception ignored) {}
                if (stariFd != null) try { stariFd.close(); } catch (IOException ignored) {}
            }, 5000);
            javiKopiju(id, 100, "gotovo", "");
        } catch (Exception e) {
            if (!k.prekinuta()) javiKopiju(id, -1, "greska", e.getMessage() != null ? e.getMessage() : e.toString());
        } finally {
            mbtilesKopije.remove(id, k);
        }
    }

    private WebResourceResponse interceptMbtilesTile(Uri uri) {
        try {
            if (!"appassets.androidplatform.net".equals(uri.getHost())) return null;
            String path = uri.getPath();
            if (path == null || !path.startsWith("/mbtiles/")) return null;
            String[] p = path.substring("/mbtiles/".length()).split("/");
            if (p.length != 4) return praznaPlocica();
            String id = URLDecoder.decode(p[0], StandardCharsets.UTF_8.name());
            int z = Integer.parseInt(p[1]), x = Integer.parseInt(p[2]), xyzY = Integer.parseInt(p[3]);
            byte[] bytes = tileBytes(id, z, x, xyzY);
            if (bytes == null || bytes.length == 0) return praznaPlocica();
            Map<String, String> h = new java.util.HashMap<>();
            h.put("Cache-Control", "max-age=86400");
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(tileMime(bytes), null, 200, "OK", h,
                    new java.io.ByteArrayInputStream(bytes));
        } catch (Exception e) {
            return praznaPlocica();
        }
    }

    // Pločica koje nema (van obuhvata/zoom-a): 204 — Leaflet je ostavi praznu bez dekodiranja.
    private static WebResourceResponse praznaPlocica() {
        return new WebResourceResponse("image/png", null, 204, "No Content",
                new java.util.HashMap<>(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    private static String tileMime(byte[] bytes) {
        if (bytes == null || bytes.length < 4) return "image/png";
        if ((bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8) return "image/jpeg";
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') return "image/webp";
        return "image/png";
    }

    // deadtrees.earth COG (Sušenje): HTTP range čitanje nativno, mimo WebView
    // mrežnog sloja (tamo se 206 odgovori nisu poklapali sa traženim opsegom).
    // Samo https na jedan host; JS provjerava Content-Range prije parsiranja.
    private static final String RANGE_HOST = "data2.deadtrees.earth";
    private static final long RANGE_MAX_BYTES = 16L * 1024 * 1024;
    private final java.util.concurrent.ExecutorService rangePool =
            java.util.concurrent.Executors.newFixedThreadPool(4);

    class RangeBridge {
        @JavascriptInterface
        public void get(String url, String startStr, String endStr, String cbId) {
            rangePool.execute(() -> {
                int code = 0;
                String contentRange = "", b64 = "", err = "";
                java.net.HttpURLConnection con = null;
                try {
                    Uri u = Uri.parse(url);
                    if (!"https".equals(u.getScheme()) || !RANGE_HOST.equals(u.getHost())) {
                        throw new IOException("nedozvoljen host");
                    }
                    long start = Long.parseLong(startStr), end = Long.parseLong(endStr);
                    if (start < 0 || end < start || end - start + 1 > RANGE_MAX_BYTES) {
                        throw new IOException("neispravan opseg");
                    }
                    con = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    con.setConnectTimeout(15000);
                    con.setReadTimeout(30000);
                    con.setUseCaches(false);
                    con.setRequestProperty("Range", "bytes=" + start + "-" + end);
                    con.setRequestProperty("Accept-Encoding", "identity");
                    code = con.getResponseCode();
                    String cr = con.getHeaderField("Content-Range");
                    if (cr != null) contentRange = cr;
                    if (code == 206) {
                        try (InputStream in = con.getInputStream()) {
                            ByteArrayOutputStream bo = new ByteArrayOutputStream((int) (end - start + 1));
                            byte[] buf = new byte[16384];
                            int n;
                            while ((n = in.read(buf)) > 0) {
                                bo.write(buf, 0, n);
                                if (bo.size() > RANGE_MAX_BYTES) throw new IOException("odgovor prevelik");
                            }
                            b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                        }
                    }
                } catch (Exception e) {
                    err = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                } finally {
                    if (con != null) con.disconnect();
                }
                final String js = "window._usfRangeCb&&window._usfRangeCb(" + JSONObject.quote(cbId) + "," + code + ","
                        + JSONObject.quote(contentRange) + "," + JSONObject.quote(b64) + "," + JSONObject.quote(err) + ")";
                runOnUiThread(() -> webView.evaluateJavascript(js, null));
            });
        }
    }

    class MbtilesBridge {
        @JavascriptInterface
        public String listMaps() {
            JSONArray out = new JSONArray();
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("native_mbtiles", MODE_PRIVATE);
                for (Map.Entry<String, ?> e : prefs.getAll().entrySet()) {
                    String id = e.getKey(), name = String.valueOf(e.getValue());
                    if (mbtilesFile(id).isFile()) out.put(readMbtilesInfo(id, name));
                    else if (izvorKarte(id) != null) {
                        // app ubijen usred trajne kopije: karta opet iz izvora, kopija ispočetka
                        try {
                            JSONObject info = readMbtilesInfo(id, name);
                            info.put("cuvanje", true);
                            out.put(info);
                            pokreniKopiju(id);
                        } catch (Exception izv) {
                            zaboraviIzvor(id);
                            KopijaKarte.part(mbtilesFile(id)).delete();
                            prefs.edit().remove(id).apply();
                        }
                    }
                }
            } catch (Exception ignored) {}
            return out.toString();
        }

        @JavascriptInterface
        public boolean deleteMap(String id) {
            try {
                KopijaKarte k = mbtilesKopije.remove(id);
                if (k != null) k.prekini();
                zatvoriCitace(mbtilesCitaci.remove(id), 0);
                SQLiteDatabase db = mbtilesDatabases.remove(id);
                if (db != null) db.close();
                ParcelFileDescriptor pfd = mbtilesIzvori.remove(id);
                if (pfd != null) try { pfd.close(); } catch (IOException ignored) {}
                zaboraviIzvor(id);
                tileSchemas.remove(id);
                getSharedPreferences("native_mbtiles", MODE_PRIVATE).edit().remove(id).apply();
                KopijaKarte.part(mbtilesFile(id)).delete();
                return !mbtilesFile(id).exists() || mbtilesFile(id).delete();
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public String getTile(String id, int z, int x, int xyzY) {
            try {
                byte[] bytes = tileBytes(id, z, x, xyzY);
                if (bytes != null && bytes.length > 0)
                    return Base64.encodeToString(bytes, Base64.NO_WRAP);
            } catch (Exception ignored) {}
            return "";
        }

        // Vraća stvarni MIME tip iz zaglavlja pločice. Mnoge .sqlitedb karte
        // nemaju metadata.format i sadrže JPEG/WebP, ne PNG.
        @JavascriptInterface
        public String getTileDataUri(String id, int z, int x, int xyzY) {
            try {
                byte[] bytes = tileBytes(id, z, x, xyzY);
                if (bytes != null && bytes.length > 0)
                    return "data:" + tileMime(bytes) + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
            } catch (Exception ignored) {}
            return "";
        }
    }

    private void importOfflineMap(Uri uri) {
        final String name = displayName(uri);
        final String id = UUID.randomUUID().toString();
        new Thread(() -> {
            // 1) odmah iz izvornog fajla, trajna kopija u pozadini
            try {
                try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) {}
                getSharedPreferences(PREFS_IZVOR, MODE_PRIVATE).edit().putString(id, uri.toString()).commit();
                otvoriIzIzvora(id);
                JSONObject info = readMbtilesInfo(id, name);
                info.put("cuvanje", true);
                getSharedPreferences("native_mbtiles", MODE_PRIVATE).edit().putString(id, name).commit();
                javiUvoz(true, info.toString());
                pokreniKopiju(id);
                return;
            } catch (Exception e) {
                SQLiteDatabase db = mbtilesDatabases.remove(id);
                if (db != null) try { db.close(); } catch (Exception ignored) {}
                ParcelFileDescriptor pfd = mbtilesIzvori.remove(id);
                if (pfd != null) try { pfd.close(); } catch (IOException ignored) {}
                tileSchemas.remove(id);
                zaboraviIzvor(id);
            }
            // 2) rezerva (provajder ne daje fd / SQLite odbije putanju): kopija pa otvaranje
            File target = mbtilesFile(id);
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("Fajl nije dostupan");
                long vel = -1;
                try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                    if (c != null && c.moveToFirst() && !c.isNull(0)) vel = c.getLong(0);
                } catch (Exception ignored) {}
                final long ukupno = vel;
                new KopijaKarte().kopiraj(in, ukupno, target, (imam, uk) -> {
                    String t = "⏳ Kopiram offline kartu… " + (uk > 0 ? (imam * 100 / uk) + " %" : (imam / 1048576) + " MB");
                    runOnUiThread(() -> webView.evaluateJavascript("_baseLoadStatus(" + JSONObject.quote(t) + ")", null));
                }, 1000);
                JSONObject info = readMbtilesInfo(id, name);
                getSharedPreferences("native_mbtiles", MODE_PRIVATE).edit().putString(id, name).apply();
                javiUvoz(true, info.toString());
            } catch (Exception e) {
                if (target.exists()) target.delete();
                javiUvoz(false, String.valueOf(e.getMessage()));
            }
        }, "mbtiles-import").start();
    }

    private void javiUvoz(boolean ok, String payload) {
        String b64 = Base64.encodeToString(payload.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        runOnUiThread(() -> webView.evaluateJavascript("_nativeSqlmapImported(" + ok + ",'" + b64 + "')", null));
    }

    // ── Preuzimanje offline karte s Drive-a (JS: _dkPreuzmi). URL dolazi dešifrovan iz JS-a
    // (PIN), ovdje se samo skida: <id>.part u offline_maps (nastavak preko Range), provjera
    // SQLite zaglavlja (Drive vraća HTML za kvotu/nejavno dijeljenje), pa uvoz kao
    // importOfflineMap → _nativeSqlmapImported. Napredak: _driveNapredak / _driveKraj. ──
    private final Map<String, Thread> karteUToku = new ConcurrentHashMap<>();

    class KartaBridge {
        @JavascriptInterface
        public void preuzmi(String kid, String url, String naziv) {
            if (kid == null || url == null || !url.startsWith("https://drive.usercontent.google.com/") || karteUToku.containsKey(kid)) return;
            Thread t = new Thread(() -> preuzmiKartu(kid, url, naziv), "karta-" + kid);
            karteUToku.put(kid, t);
            t.start();
        }

        @JavascriptInterface
        public void prekini(String kid) {
            Thread t = karteUToku.get(kid);
            if (t != null) t.interrupt();
        }

        // KML/KMZ s Drive-a (KML preglednik): skida u cache, JS ga uzme (uzmiKml) i učita kao "Dodaj KML"
        @JavascriptInterface
        public void preuzmiKml(String kid, String url) {
            if (kid == null || url == null || !url.startsWith("https://drive.usercontent.google.com/") || karteUToku.containsKey(kid)) return;
            Thread t = new Thread(() -> preuzmiKmlFajl(kid, url), "kml-" + kid);
            karteUToku.put(kid, t);
            t.start();
        }

        @JavascriptInterface
        public String uzmiKml(String kid) {
            File f = kmlDriveFajl(kid, ".dat");
            try (InputStream in = new java.io.FileInputStream(f)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[262144]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            } finally {
                f.delete();
            }
        }
    }

    private File kmlDriveFajl(String kid, String nastavak) {
        File dir = new File(getCacheDir(), "kml_drive");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, kid.replaceAll("[^A-Za-z0-9_-]", "") + nastavak);
    }

    private void preuzmiKmlFajl(String kid, String url) {
        File part = kmlDriveFajl(kid, ".part");
        try {
            skiniDrive(kid, url, part);
            byte[] zag = new byte[256];
            int n;
            try (InputStream in = new java.io.FileInputStream(part)) { n = in.read(zag); }
            String poc = n > 0 ? new String(zag, 0, n, StandardCharsets.ISO_8859_1).replace("\u00EF\u00BB\u00BF", "").trim() : "";
            boolean kmz = n >= 2 && zag[0] == 'P' && zag[1] == 'K';
            if (!kmz && !(poc.startsWith("<?xml") || poc.startsWith("<kml")) || poc.toLowerCase().startsWith("<!doctype html") || poc.toLowerCase().startsWith("<html")) {
                part.delete();
                throw new IOException("Preuzeti fajl nije KML (Drive je vratio stranicu umjesto fajla)");
            }
            File gotov = kmlDriveFajl(kid, ".dat");
            gotov.delete();
            if (!part.renameTo(gotov)) throw new IOException("Fajl se ne može premjestiti");
            javiKarti("window._driveKmlKraj&&_driveKmlKraj(" + JSONObject.quote(kid) + ",true,''," + kmz + ")");
        } catch (InterruptedException e) {
            javiKarti("window._driveKmlKraj&&_driveKmlKraj(" + JSONObject.quote(kid) + ",false,'prekinuto — nastavlja se od istog mjesta',false)");
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : e.toString();
            javiKarti("window._driveKmlKraj&&_driveKmlKraj(" + JSONObject.quote(kid) + ",false," + JSONObject.quote(msg) + ",false)");
        } finally {
            karteUToku.remove(kid);
        }
    }

    private void javiKarti(String js) { runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(js, null); }); }

    // Skidanje s Drive-a u `part` (nastavak preko Range, redirekti, HTML umjesto fajla = greška).
    // Napredak: _driveNapredak(kid, %, MB). Prekid: InterruptedException (part ostaje za nastavak).
    private void skiniDrive(String kid, String url, File part) throws IOException, InterruptedException {
        HttpURLConnection con = null;
        try {
            long imam = part.exists() ? part.length() : 0;
            String adresa = url;
            int status = 0;
            for (int skok = 0; skok < 6; skok++) { // redirekti (drive → usercontent), i https→https
                con = (HttpURLConnection) new URL(adresa).openConnection();
                con.setInstanceFollowRedirects(false);
                con.setConnectTimeout(20000);
                con.setReadTimeout(60000);
                if (imam > 0) con.setRequestProperty("Range", "bytes=" + imam + "-");
                status = con.getResponseCode();
                if (status >= 300 && status < 400 && con.getHeaderField("Location") != null) {
                    adresa = new URL(new URL(adresa), con.getHeaderField("Location")).toString();
                    con.disconnect(); continue;
                }
                break;
            }
            if (status == 416 && imam > 0) return; // već skinuto do kraja
            if (status != 200 && status != 206) throw new IOException("Drive HTTP " + status);
            String tip = con.getContentType();
            if (tip != null && tip.toLowerCase().startsWith("text/html"))
                throw new IOException("Drive ne daje fajl (provjeri dijeljenje \"Svako s linkom\" ili dnevnu kvotu preuzimanja)");
            boolean nastavak = status == 206 && imam > 0;
            if (!nastavak) imam = 0;
            long duzina = con.getContentLengthLong(), ukupno = duzina > 0 ? duzina + imam : -1;
            byte[] buf = new byte[256 * 1024];
            long zadnjeJavljanje = 0;
            try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(part, nastavak)) {
                int n;
                while ((n = in.read(buf)) >= 0) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                    out.write(buf, 0, n);
                    imam += n;
                    long sad = System.currentTimeMillis();
                    if (sad - zadnjeJavljanje > 500) {
                        zadnjeJavljanje = sad;
                        int p = ukupno > 0 ? (int) (imam * 100 / ukupno) : -1;
                        javiKarti("window._driveNapredak&&_driveNapredak(" + JSONObject.quote(kid) + "," + p + "," + (imam / 1048576) + ")");
                    }
                }
            }
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private void preuzmiKartu(String kid, String url, String naziv) {
        String ime = (naziv == null || naziv.trim().isEmpty()) ? "Karta" : naziv.trim();
        File part = new File(mbtilesDir(), "drive_" + kid.replaceAll("[^A-Za-z0-9_-]", "") + ".part");
        try {
            skiniDrive(kid, url, part);
            byte[] zag = new byte[16];
            try (InputStream in = new java.io.FileInputStream(part)) { if (in.read(zag) != 16) throw new IOException("Prazan fajl"); }
            if (!new String(zag, 0, 15, StandardCharsets.US_ASCII).equals("SQLite format 3")) {
                part.delete();
                throw new IOException("Preuzeti fajl nije offline karta (Drive je vratio stranicu umjesto fajla)");
            }
            String id = UUID.randomUUID().toString();
            File cilj = mbtilesFile(id);
            if (!part.renameTo(cilj)) throw new IOException("Fajl se ne može premjestiti");
            JSONObject info = readMbtilesInfo(id, ime);
            getSharedPreferences("native_mbtiles", MODE_PRIVATE).edit().putString(id, ime).apply();
            String encoded = Base64.encodeToString(info.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            javiKarti("window._driveKraj&&_driveKraj(" + JSONObject.quote(kid) + ",true,'');_nativeSqlmapImported(true,'" + encoded + "')");
        } catch (InterruptedException e) {
            javiKarti("window._driveKraj&&_driveKraj(" + JSONObject.quote(kid) + ",false,'prekinuto — nastavlja se od istog mjesta')");
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : e.toString();
            javiKarti("window._driveKraj&&_driveKraj(" + JSONObject.quote(kid) + ",false," + JSONObject.quote(msg) + ")");
        } finally {
            karteUToku.remove(kid);
        }
    }

    class DownloadBridge {
        @JavascriptInterface
        public void save(String filename, String dataUrl) {
            try {
                String base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
                byte[] data = Base64.decode(base64, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE, guessMime(filename));
                    values.put(MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        OutputStream os = getContentResolver().openOutputStream(uri);
                        if (os != null) {
                            os.write(data);
                            os.close();
                        }
                    }
                } else {
                    File dir = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS);
                    File file = new File(dir, filename);
                    FileOutputStream fos = new FileOutputStream(file);
                    fos.write(data);
                    fos.close();
                }

                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Sačuvano u Downloads: " + filename,
                        Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Greška pri čuvanju: " + e.getMessage(),
                        Toast.LENGTH_SHORT).show());
            }
        }

        private String guessMime(String filename) {
            if (filename.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
            if (filename.endsWith(".gpx")) return "application/gpx+xml";
            if (filename.endsWith(".geojson")) return "application/geo+json";
            if (filename.endsWith(".json")) return "application/json";
            if (filename.endsWith(".csv")) return "text/csv";
            if (filename.endsWith(".txt")) return "text/plain";
            return "application/octet-stream";
        }
    }

    // ── Native obavještenja (zaobilazi WebView Notification API) ────────────
    // Android WebView na mnogim OEM verzijama uopšte NEMA implementiran
    // window.Notification, iako sistem sasvim normalno prikazuje prave Android
    // notifikacije. Obična (ne-foreground) native notifikacija preko
    // NotificationManagerCompat, nezavisna od WebView Notification API-ja —
    // koristi se za upozorenja na nov požar u blizini.
    class AppNotifBridge {
        private static final String CHANNEL_ID = "pozari_upozorenja";
        private static final int NOTIF_ID_BASE = 5000;
        private int seq = 0;

        private void ensureChannel() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                    NotificationChannel ch = new NotificationChannel(
                            CHANNEL_ID, "Upozorenja na požar",
                            NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("Nov požar u zadanom krugu od tvoje pozicije");
                    nm.createNotificationChannel(ch);
                }
            }
        }

        @JavascriptInterface
        public void show(String naslov, String tijelo) {
            runOnUiThread(() -> {
                ensureChannel();
                Intent openApp = new Intent(MainActivity.this, MainActivity.class);
                openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent pending = PendingIntent.getActivity(MainActivity.this,
                        1000 + (seq % 100), openApp,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification n = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                        .setContentTitle(naslov)
                        .setContentText(tijelo)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(tijelo))
                        .setSmallIcon(android.R.drawable.stat_sys_warning)
                        .setContentIntent(pending)
                        .setAutoCancel(true)
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .build();
                try {
                    androidx.core.app.NotificationManagerCompat.from(MainActivity.this)
                            .notify(NOTIF_ID_BASE + (seq++ % 20), n);
                } catch (SecurityException e) {
                    // POST_NOTIFICATIONS nije odobrena (Android 13+, korisnik odbio pri startu) —
                    // tiho preskoči, JS stranu ionako ne čeka nikakav odgovor odavde.
                }
            });
        }
    }

    // ── Native HTTP most (zaobilazi CORS) ──────────────────────────────────
    // NASA FIRMS (detekcije požara) ne šalje CORS zaglavlja. CORS je pravilo
    // BROWSERA i iz JavaScripta se ne može zaobići — ali native Java HTTP poziv
    // ga uopšte nema. JS strana prvo proba ovaj most, pa tek onda fetch().
    //
    // NAMJERNO NIJE opšti proxy: samo https i samo dozvoljeni hostovi (FIRMS,
    // Global Forest Watch). Bez tog ograničenja bi bilo koji JS na stranici
    // mogao preko native sloja dohvatiti bilo šta.
    class NetBridge {
        private static final int MAX_BYTES = 12 * 1024 * 1024;   // evropski 7d CSV zna biti krupan

        private boolean dozvoljenHost(String host) {
            if (host == null) return false;
            // Locale.ROOT namjerno: na turskom locale-u "I".toLowerCase() daje "ı",
            // pa bi poređenje hosta tiho palo i most bi bio mrtav bez ikakve poruke.
            String h = host.toLowerCase(java.util.Locale.ROOT);
            return h.equals("firms.modaps.eosdis.nasa.gov")
                || h.endsWith(".modaps.eosdis.nasa.gov")
                || h.equals("data-api.globalforestwatch.org");
        }

        @JavascriptInterface
        public void fetchText(final String id, final String url, final int timeoutMs,
                              final String zaglavljaJson, final String tijeloJson) {
            new Thread(() -> {
                int status = 0;
                String b64 = "";
                String greska = null;
                HttpURLConnection c = null;
                try {
                    URL u = new URL(url);
                    if (!"https".equalsIgnoreCase(u.getProtocol()) || !dozvoljenHost(u.getHost())) {
                        greska = "nedozvoljena adresa";
                    } else {
                        int t = timeoutMs > 0 ? timeoutMs : 20000;
                        byte[] body = (tijeloJson != null && !tijeloJson.isEmpty())
                                ? tijeloJson.getBytes(java.nio.charset.StandardCharsets.UTF_8) : null;
                        org.json.JSONObject zg = (zaglavljaJson != null && zaglavljaJson.length() > 2)
                                ? new org.json.JSONObject(zaglavljaJson) : null;
                        // HttpURLConnection na Androidu ne prati pouzdano 307/308 za POST.
                        for (int redirect = 0; redirect <= 5; redirect++) {
                            c = (HttpURLConnection) u.openConnection();
                            c.setConnectTimeout(t);
                            c.setReadTimeout(t);
                            c.setInstanceFollowRedirects(false);
                            c.setRequestProperty("User-Agent", "UnaSanaForest-Android");
                            c.setRequestProperty("Accept", "text/csv,application/json,text/plain,*/*");
                            if (zg != null) {
                                java.util.Iterator<String> it = zg.keys();
                                while (it.hasNext()) {
                                    String k = it.next();
                                    c.setRequestProperty(k, zg.optString(k, ""));
                                }
                            }
                            if (body != null) {
                                c.setRequestMethod("POST");
                                c.setDoOutput(true);
                                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                                try (OutputStream os = c.getOutputStream()) { os.write(body); }
                            }
                            status = c.getResponseCode();
                            if (status != 307 && status != 308 && status != 301 && status != 302) break;
                            String location = c.getHeaderField("Location");
                            if (location == null || redirect == 5) { greska = "neispravno preusmjerenje"; break; }
                            URL next = new URL(u, location);
                            if (!"https".equalsIgnoreCase(next.getProtocol()) || !dozvoljenHost(next.getHost())) {
                                greska = "nedozvoljeno preusmjerenje"; break;
                            }
                            c.disconnect(); c = null; u = next;
                        }
                        InputStream is = (greska != null || c == null) ? null
                                : ((status >= 400) ? c.getErrorStream() : c.getInputStream());
                        if (is != null) {
                            ByteArrayOutputStream bos = new ByteArrayOutputStream();
                            byte[] buf = new byte[16384];
                            int n, ukupno = 0;
                            while ((n = is.read(buf)) > 0) {
                                ukupno += n;
                                if (ukupno > MAX_BYTES) { greska = "odgovor prevelik"; break; }
                                bos.write(buf, 0, n);
                            }
                            is.close();
                            if (greska == null) b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                        }
                    }
                } catch (Exception e) {
                    // Java baca konkretne izuzetke (SocketTimeoutException,
                    // UnknownHostException...) — proslijedi ime klase da JS strana
                    // može reci šta se STVARNO desilo.
                    greska = e.getClass().getSimpleName();
                    if (e.getMessage() != null) greska += ": " + e.getMessage();
                } finally {
                    if (c != null) c.disconnect();
                }
                final int fStatus = status;
                final String fB64 = b64;
                final String fGreska = greska;
                runOnUiThread(() -> {
                    if (webView == null) return;
                    StringBuilder js = new StringBuilder("if(typeof _nativeNetOdgovor==='function')_nativeNetOdgovor(");
                    js.append(jsStr(id)).append(',').append(fStatus).append(',')
                      .append(jsStr(fB64)).append(',').append(fGreska == null ? "null" : jsStr(fGreska)).append(')');
                    webView.evaluateJavascript(js.toString(), null);
                });
            }).start();
        }

        // Base64 i imena izuzetaka su bezbjedni znakovi, ali navodnik/backslash
        // iz poruke izuzetka bi razbio ubaceni JS — zato se svaki string escape-uje.
        private String jsStr(String s) {
            if (s == null) return "null";
            StringBuilder b = new StringBuilder("\"");
            for (int i = 0; i < s.length(); i++) {
                char ch = s.charAt(i);
                if (ch == '"' || ch == '\\') b.append('\\').append(ch);
                else if (ch == '\n') b.append("\\n");
                else if (ch == '\r') b.append("\\r");
                else if (ch < 0x20 || ch > 0x7e) b.append(String.format("\\u%04x", (int) ch));
                else b.append(ch);
            }
            return b.append('"').toString();
        }
    }

    // ── Auto-update: preuzmi i instaliraj najnoviji APK direktno iz app-a ──
    // GitHub Release je JAVNO dostupan preko stabilnog URL-a bez prijave
    // (CI ga objavljuje/ažurira poslije svakog uspješnog builda).
    //
    // /releases/latest NIJE korišten namjerno — taj GitHub endpoint EKSPLICITNO
    // isključuje prerelease objave, a CI ovdje objavljuje baš prerelease (debug
    // build). Zato se čita obična lista (/releases, sortirana najnovije-prvo)
    // i uzima prvi element.
    class UpdateBridge {
        private static final String RELEASES_URL =
                "https://api.github.com/repos/pogonboskrupa/forest-una-sana/releases?per_page=1";

        @JavascriptInterface
        public void checkAndInstall() {
            if (updateInProgress) {
                postUpdate("downloading", "Ažuriranje je već u toku…", -1, 0, 0);
                return;
            }
            updateInProgress = true;
            postUpdate("checking", "Provjeravam novu verziju…", -1, 0, 0);
            new Thread(() -> {
                try {
                    org.json.JSONObject rel = dohvatiJson(RELEASES_URL);
                    if (rel == null) { postUpdate("error", "Ne mogu provjeriti novu verziju — provjeri internet", -1, 0, 0); updateInProgress = false; return; }

                    String tag = rel.optString("tag_name", "");
                    String verNova = tag.startsWith("v") ? tag.substring(1) : tag;
                    String verTrenutna = "0";
                    try {
                        verTrenutna = getPackageManager()
                                .getPackageInfo(getPackageName(), 0).versionName;
                    } catch (Exception ignored) {}
                    if (verNova.isEmpty() || !jeNovija(verNova, verTrenutna)) {
                        postUpdate("latest", "Već imaš najnoviju verziju (v" + verTrenutna + ")", 100, 0, 0);
                        updateInProgress = false;
                        return;
                    }

                    String apkUrl = null;
                    org.json.JSONArray assets = rel.optJSONArray("assets");
                    if (assets != null) {
                        for (int i = 0; i < assets.length(); i++) {
                            org.json.JSONObject a = assets.getJSONObject(i);
                            if (a.optString("name", "").endsWith(".apk")) {
                                apkUrl = a.optString("browser_download_url", null);
                                break;
                            }
                        }
                    }
                    if (apkUrl == null) {
                        postUpdate("error", "Verzija v" + verNova + " postoji, ali APK nije pronađen u objavi", -1, 0, 0);
                        updateInProgress = false;
                        return;
                    }

                    postUpdate("downloading", "Preuzimam verziju v" + verNova + "…", 0, 0, 0);
                    File dir = new File(getCacheDir(), "update");
                    if (!dir.exists()) dir.mkdirs();
                    File apk = new File(dir, "UnaSanaForest-v" + verNova + ".apk");
                    File part = new File(dir, apk.getName() + ".part");
                    if (part.exists()) part.delete();
                    if (!preuzmiFajl(apkUrl, part, verNova)) {
                        postUpdate("error", "Preuzimanje nije uspjelo — provjeri vezu i pokušaj ponovo", -1, 0, 0);
                        updateInProgress = false;
                        return;
                    }
                    if (apk.exists() && !apk.delete()) throw new IOException("old_apk_delete");
                    if (!part.renameTo(apk)) throw new IOException("apk_finalize");
                    pendingUpdateApk = apk;
                    postUpdate("ready", "APK je preuzet — otvaram instalaciju…", 100, apk.length(), apk.length());
                    updateInProgress = false;
                    runOnUiThread(() -> instalirajApk(apk));
                } catch (Exception e) {
                    postUpdate("error", "Greška pri ažuriranju: " + e.getClass().getSimpleName(), -1, 0, 0);
                    updateInProgress = false;
                }
            }).start();
        }

        private org.json.JSONObject dohvatiJson(String urlStr) throws IOException, org.json.JSONException {
            URL u = new URL(urlStr);
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            try {
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "UnaSanaForest-Android");
                int status = c.getResponseCode();
                if (status != 200) return null;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                try (InputStream is = c.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                }
                // /releases (lista) vraća JSON NIZ — uzmi prvi (najnoviji) element.
                org.json.JSONArray arr = new org.json.JSONArray(bos.toString("UTF-8"));
                return arr.length() > 0 ? arr.getJSONObject(0) : null;
            } finally {
                c.disconnect();
            }
        }

        private boolean preuzmiFajl(String urlStr, File dest, String verzija) throws IOException {
            URL u = new URL(urlStr);
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            try {
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "UnaSanaForest-Android");
                int status = c.getResponseCode();
                if (status != 200) return false;
                long ukupno = c.getContentLengthLong(), procitano = 0;
                int zadnjiPostotak = -1;
                long zadnjaObjava = 0;
                try (InputStream is = c.getInputStream(); FileOutputStream fos = new FileOutputStream(dest)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        procitano += n;
                        if (ukupno > 0) {
                            int pct = (int) ((procitano * 100L) / ukupno);
                            long sada = System.currentTimeMillis();
                            if (pct != zadnjiPostotak && (sada - zadnjaObjava >= 180 || pct >= 100)) {
                                zadnjiPostotak = pct;
                                zadnjaObjava = sada;
                                postUpdate("downloading", "Preuzimam verziju v" + verzija + "…", Math.min(100, pct), procitano, ukupno);
                            }
                        } else if (System.currentTimeMillis() - zadnjaObjava >= 500) {
                            zadnjaObjava = System.currentTimeMillis();
                            postUpdate("downloading", "Preuzimam verziju v" + verzija + "…", -1, procitano, 0);
                        }
                    }
                }
                if (dest.length() < 1024 * 1024) { dest.delete(); return false; }
                try (InputStream check = new java.io.FileInputStream(dest)) {
                    if (check.read() != 'P' || check.read() != 'K') { dest.delete(); return false; }
                }
                android.content.pm.PackageInfo info = getPackageManager().getPackageArchiveInfo(dest.getAbsolutePath(), 0);
                if (info == null || !getPackageName().equals(info.packageName)) {
                    dest.delete();
                    return false;
                }
                return true;
            } finally {
                c.disconnect();
            }
        }

        private void instalirajApk(File apk) {
            if (apk == null || !apk.isFile()) {
                pendingUpdateApk = null;
                postUpdate("error", "Preuzeti APK više nije dostupan — pokušaj ponovo", -1, 0, 0);
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getPackageManager().canRequestPackageInstalls()) {
                pendingUpdateApk = apk;
                postUpdate("permission", "Dozvoli instalaciju iz ovog izvora; zatim se vrati u aplikaciju", 100, apk.length(), apk.length());
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {}
                return;
            }
            Uri uri = FileProvider.getUriForFile(MainActivity.this,
                    getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                postUpdate("installing", "Potvrdi instalaciju na Android ekranu", 100, apk.length(), apk.length());
                startActivity(intent);
                pendingUpdateApk = null;
            } catch (Exception e) {
                postUpdate("error", "Android ne može otvoriti instalaciju APK-a", -1, 0, 0);
            }
        }

        // Poredi "X.Y.Z" segment po segment (numerički, ne leksikografski).
        private boolean jeNovija(String a, String b) {
            String[] pa = a.split("\\.");
            String[] pb = b.split("\\.");
            for (int i = 0; i < Math.max(pa.length, pb.length); i++) {
                int va = i < pa.length ? parseSegment(pa[i]) : 0;
                int vb = i < pb.length ? parseSegment(pb[i]) : 0;
                if (va != vb) return va > vb;
            }
            return false;
        }

        private int parseSegment(String s) {
            try { return Integer.parseInt(s.replaceAll("[^0-9]", "")); }
            catch (Exception e) { return 0; }
        }

        private void postUpdate(String phase, String msg, int progress, long downloaded, long total) {
            runOnUiThread(() -> {
                if (webView == null) return;
                webView.evaluateJavascript(
                        "if(typeof _azurirajStatus==='function')_azurirajStatus(" + jsStr(msg) + "," +
                                progress + "," + jsStr(phase) + "," + downloaded + "," + total + ")", null);
            });
        }

        private String jsStr(String s) {
            if (s == null) return "null";
            StringBuilder b = new StringBuilder("\"");
            for (int i = 0; i < s.length(); i++) {
                char ch = s.charAt(i);
                if (ch == '"' || ch == '\\') b.append('\\').append(ch);
                else if (ch == '\n') b.append("\\n");
                else if (ch < 0x20 || ch > 0x7e) b.append(String.format("\\u%04x", (int) ch));
                else b.append(ch);
            }
            return b.append('"').toString();
        }
    }

    // navigator.share() u Android WebView-u (za razliku od Chrome-a) ne otvara
    // sistemski share-sheet za fajlove — canShare({files:[...]}) tiho vraća
    // false. Koristi se VEĆ postojeći FileProvider da se privremeni fajl u
    // cache-u podijeli preko pravog Intent.ACTION_SEND chooser-a.
    class ShareBridge {
        // Fajl otvoren iz druge aplikacije (primiFajl) — JS ga uzima jednom.
        @JavascriptInterface
        public String uzmiDolazni() {
            String ime = dolazniIme, b64 = dolazniB64;
            dolazniIme = null; dolazniB64 = null;
            if (b64 == null) return "";
            try { return new JSONObject().put("ime", ime).put("b64", b64).toString(); } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public void shareFile(String filename, String dataUrl, String title, String text) {
            try {
                String base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
                byte[] data = Base64.decode(base64, Base64.DEFAULT);

                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File file = new File(dir, filename);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(data);
                fos.close();

                Uri uri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", file);
                String mime = guessMime(filename);

                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType(mime);
                sendIntent.putExtra(Intent.EXTRA_STREAM, uri);
                if (text != null) sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                if (title != null) sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(sendIntent,
                        title != null ? title : "Pošalji");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                runOnUiThread(() -> startActivity(chooser));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Greška pri dijeljenju: " + e.getMessage(),
                        Toast.LENGTH_SHORT).show());
            }
        }

        private String guessMime(String filename) {
            if (filename.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
            if (filename.endsWith(".gpx")) return "application/gpx+xml";
            if (filename.endsWith(".geojson")) return "application/geo+json";
            if (filename.endsWith(".json")) return "application/json";
            return "application/octet-stream";
        }
    }

    // ── KML/KMZ iz Vibera, WhatsAppa, maila, Quick Sharea ("Otvori u Grmeč Navigator") ──
    // launchMode singleTask: novi fajl dok je app otvoren dolazi kroz onNewIntent u isti WebView.
    private volatile String dolazniIme, dolazniB64;
    private static final int MAX_DOLAZNI = 40 * 1024 * 1024;

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        primiFajl(intent);
    }

    @SuppressWarnings("deprecation")
    private void primiFajl(Intent intent) {
        if (intent == null) return;
        String akcija = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(akcija)) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(akcija)) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        final Uri u = uri;
        intent.setAction(Intent.ACTION_MAIN); // rotacija/ponovno kreiranje ne učitava isti fajl dvaput
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(u)) {
                if (in == null) throw new IOException("prazan fajl");
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_DOLAZNI) throw new IOException("fajl je veći od 40 MB");
                }
                dolazniIme = imeFajla(u);
                dolazniB64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript("window._dolazniFajl&&_dolazniFajl()", null); });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Fajl nije otvoren: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private String imeFajla(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        String s = u.getLastPathSegment();
        return s != null ? s : "dijeljeno.kml";
    }

    class GpsBridge {
        @JavascriptInterface
        public void startRecording(String title) {
            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw new SecurityException("Dozvoli preciznu lokaciju");
            isRecordingActive = true;
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.putExtra("title", title != null ? title : "GPS Snimanje");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
        }

        @JavascriptInterface
        public boolean isRecording() {
            return getSharedPreferences("gps_session", MODE_PRIVATE).getBoolean("active", false);
        }

        @JavascriptInterface
        public void setPaused(boolean paused) {
            synchronized (GpsService.BUFFER_LOCK) {
                getSharedPreferences("gps_session", MODE_PRIVATE).edit().putBoolean("paused", paused).commit();
            }
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.setAction("setPaused");
            intent.putExtra("paused", paused);
            startService(intent);
        }

        @JavascriptInterface
        public void stopRecording() {
            getSharedPreferences("gps_session", MODE_PRIVATE).edit().putBoolean("active", false).commit();
            isRecordingActive = false;
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.setAction("stop");
            startService(intent);
            // Ako je OVA Activity već uništena, niko drugi neće pozvati webView.destroy().
            // Sad kad je snimanje stvarno gotovo, oslobodi ga.
            if (isFinishing() || isDestroyed()) {
                runOnUiThread(() -> {
                    if (webView != null) { webView.destroy(); }
                    if (sWebView == webView) sWebView = null;
                    if (recActionReceiver != null) {
                        try { unregisterReceiver(recActionReceiver); } catch (Exception ignored) {}
                    }
                    sRecActionReceiver = null;
                });
            }
        }

        @JavascriptInterface
        public void updateNotification(String title, String body) {
            Intent intent = new Intent(MainActivity.this, GpsService.class);
            intent.setAction("update");
            intent.putExtra("title", title);
            intent.putExtra("body", body);
            startService(intent);
        }

        @JavascriptInterface
        public boolean hasBackgroundLocation() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
            return ContextCompat.checkSelfPermission(MainActivity.this,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public boolean hasBatteryOptExemption() {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return true;
            return pm.isIgnoringBatteryOptimizations(getPackageName());
        }

        @JavascriptInterface
        public void requestBatteryOptExemption() {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception ignored) {}
            }
        }

        // Xiaomi/Redmi/POCO (MIUI/HyperOS): osim baterije postoji i "Autostart" — bez njega
        // sistem ne vraća ubijen GpsService (START_STICKY) i snimanje tiho stane.
        @JavascriptInterface
        public boolean jeXiaomi() {
            String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(java.util.Locale.ROOT);
            return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco");
        }

        @JavascriptInterface
        public void otvoriAutostart() {
            try {
                Intent i = new Intent();
                i.setComponent(new android.content.ComponentName("com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                startActivity(i);
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {}
            }
        }

        // Poziva se sinhrono iz JS-a (visibilitychange, app opet vidljiv) — vraća
        // sve tačke koje je GpsService prikupio preko native LocationManager-a dok
        // je WebView bio "osiroćen"/bez prozora. Čitanje rotira fajl u pending;
        // briše ga tek zaseban ack nakon trajnog JS journala.
        @JavascriptInterface
        public String readNativeBuffer() {
            try {
                String[] batch = new NativeGpsBuffer(getFilesDir()).read();
                return new org.json.JSONObject().put("token", batch[0]).put("raw", batch[1]).toString();
            } catch (Exception e) { return ""; } // no ack, file remains intact
        }

        @JavascriptInterface
        public boolean ackNativeBuffer(String token) {
            try { return new NativeGpsBuffer(getFilesDir()).ack(token); }
            catch (IOException e) { return false; }
        }
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private void registerRecActionReceiver() {
        if (sRecActionReceiver != null) {
            // Već registrovan (preživio iz prethodne Activity instance dok je
            // snimanje trajalo) — reuse, ne registruj drugi.
            recActionReceiver = sRecActionReceiver;
            return;
        }
        recActionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getStringExtra("action");
                if (action != null && webView != null) {
                    runOnUiThread(() -> webView.evaluateJavascript(
                        "if(typeof _nativeRecAction==='function')_nativeRecAction('" + action + "')",
                        null));
                }
            }
        };
        sRecActionReceiver = recActionReceiver;
        IntentFilter filter = new IntentFilter("ba.spd.usf.forest.REC_ACTION");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(recActionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(recActionReceiver, filter);
        }
    }

    private void requestBackgroundLocationIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED) return;
        if (ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},
                REQ_BG_LOC);
    }

    private void requestPermissions() {
        String[] perms;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS
            };
        } else {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
        }

        boolean needRequest = false;
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p)
                    != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }
        if (needRequest) {
            ActivityCompat.requestPermissions(this, perms, REQ_PERMS);
        } else {
            requestBackgroundLocationIfNeeded();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
            @NonNull String[] permissions, @NonNull int[] grantResults) {
        if (requestCode == REQ_PERMS) {
            boolean fineGranted = ContextCompat.checkSelfPermission(this,
                    Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            for (int i = 0; i < permissions.length; i++) {
                if (permissions[i].equals(Manifest.permission.ACCESS_FINE_LOCATION)
                        && grantResults[i] != PackageManager.PERMISSION_GRANTED) {
                    Toast.makeText(this,
                            "GPS dozvola je potrebna za snimanje traga",
                            Toast.LENGTH_LONG).show();
                }
            }
            if (fineGranted) requestBackgroundLocationIfNeeded();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                }
            }
            // Kamera ne vraća Uri u data — fotografija je u cameraUri fajlu.
            if (resultCode == RESULT_OK && results == null && cameraUri != null) {
                File f = new File(new File(getCacheDir(), "foto"), cameraUri.getLastPathSegment());
                if (f.length() > 0) results = new Uri[]{cameraUri};
            }
            cameraUri = null;
            if (pendingOfflineMapImport && results != null && results.length > 0) {
                fileCallback.onReceiveValue(null);
                webView.evaluateJavascript("_baseLoadStatus('⏳ Otvaram kartu…')", null);
                importOfflineMap(results[0]);
            } else {
                fileCallback.onReceiveValue(results);
            }
            fileCallback = null;
            pendingOfflineMapImport = false;
        }
    }

    private void hideSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        hideSystemUI();
        if (pendingUpdateApk != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getPackageManager().canRequestPackageInstalls()) {
            File apk = pendingUpdateApk;
            runOnUiThread(() -> new UpdateBridge().instalirajApk(apk));
        }
    }

    @Override
    protected void onPause() {
        // Dok traje GPS snimanje NE smijemo pauzirati WebView — to bi prekinulo
        // watchPosition() čim korisnik izađe iz app-a. Foreground servis
        // (GpsService) + partial wake lock drže CPU budnim.
        if (!isRecordingActive) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        // Isto kao WebView ispod — dok snimanje traje, receiver MORA ostati
        // registrovan da Pauza/Stop dugmad na notifikaciji i dalje rade dok je
        // app zatvoren.
        if (recActionReceiver != null && !isRecordingActive) {
            try { unregisterReceiver(recActionReceiver); } catch (Exception ignored) {}
            sRecActionReceiver = null;
        }
        // Dok snimanje traje NAMJERNO ne uništavamo WebView — Activity se gasi,
        // ali proces ostaje živ zbog GpsService foreground servisa.
        if (webView != null && !isRecordingActive) {
            webView.destroy();
            sWebView = null;
        }
        super.onDestroy();
    }
}
