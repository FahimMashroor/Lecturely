package com.lecturely.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The whole Android app is this one screen. It shows Lecturely's pages, which
 * are packed inside the app (folder assets/www), in a built-in browser view.
 *
 * The pages are served under a pretend secure address. Nothing is fetched from
 * that address over the internet: every request to it is answered from the
 * files inside the app. A secure address is needed because Android only lets
 * secure pages use the microphone.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int ASK_MIC = 1;
    private static final int PICK_SAVE_PLACE = 2;

    private WebView web;
    private WebView printView;
    private PermissionRequest waitingMicRequest;
    private byte[] waitingFile;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // saved lectures live here
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);

        web.addJavascriptInterface(new Bridge(), "LecturelyApp");
        web.setWebViewClient(new Pages());
        web.setWebChromeClient(new Chrome());

        if (saved == null) web.loadUrl(START);
        else web.restoreState(saved);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Answers page requests from the files packed inside the app. */
    private class Pages extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null; // a real internet address: let it through
            String path = url.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open("www" + path);
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Cache-Control", path.startsWith("/assets/") ? "max-age=31536000, immutable" : "no-cache");
                String type = typeOf(path);
                String encoding = type.startsWith("text/") || type.contains("json") || type.contains("javascript") ? "utf-8" : null;
                return new WebResourceResponse(type, encoding, 200, "OK", headers, in);
            } catch (Exception e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }

        /** Links to other websites open in the phone's normal browser, not inside the app. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String address) {
            Uri url = Uri.parse(address);
            if (HOST.equals(url.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (Exception ignored) { }
            return true;
        }
    }

    private static String typeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** Passes the page's "may I use the microphone?" question on to Android. */
    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            boolean wantsMic = false;
            for (String r : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
            }
            // Only the app's own pages may ask, and only for the microphone.
            if (!wantsMic || !HOST.equals(request.getOrigin().getHost())) {
                request.deny();
                return;
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            } else {
                waitingMicRequest = request;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, ASK_MIC);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != ASK_MIC || waitingMicRequest == null) return;
        PermissionRequest request = waitingMicRequest;
        waitingMicRequest = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            request.deny();
        }
    }

    /** Extra abilities the page can ask the app for. The page calls these as LecturelyApp.name(...). */
    private class Bridge {
        /** Save a Word or text file: Android shows its own "where do you want to save?" screen. */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        waitingFile = Base64.decode(base64, Base64.DEFAULT);
                        Intent pick = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        pick.addCategory(Intent.CATEGORY_OPENABLE);
                        pick.setType(mime);
                        pick.putExtra(Intent.EXTRA_TITLE, name);
                        startActivityForResult(pick, PICK_SAVE_PLACE);
                    } catch (Exception e) {
                        waitingFile = null;
                        say("Couldn't save the file.");
                    }
                }
            });
        }

        /** Open Android's print screen, where "Save as PDF" is offered. */
        @JavascriptInterface
        public void printHtml(final String title, final String html) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    printView = new WebView(MainActivity.this);
                    printView.setWebViewClient(new WebViewClient() {
                        @Override public void onPageFinished(WebView view, String url) {
                            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            String job = title == null || title.isEmpty() ? "Lecturely" : title;
                            pm.print(job, view.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
                        }
                    });
                    printView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
                }
            });
        }

        /** Keep the screen on while recording, so the phone doesn't pause the microphone. */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("Lecturely", text));
                    say("Copied");
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_SAVE_PLACE) return;
        byte[] bytes = waitingFile;
        waitingFile = null;
        if (result != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
        try {
            OutputStream out = getContentResolver().openOutputStream(data.getData());
            try { out.write(bytes); } finally { out.close(); }
            say("Saved");
        } catch (Exception e) {
            say("Couldn't save the file.");
        }
    }

    private void say(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
