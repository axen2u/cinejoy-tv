package com.axen2u.cinejoytv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.widget.Toast;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Full-screen WebView for cinejoy.pk with TV remote navigation.
 * The page gets nav.js (shared with the Samsung TizenBrew module) injected
 * after every load; Back and media keys are forwarded to it.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://cinejoy.pk/";

    private WebView web;
    private FrameLayout root;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String navScript;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        navScript = readAsset("nav.js");

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // New windows go through onCreateWindow, which drops anything off-site.
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.addJavascriptInterface(new Bridge(), "CinejoyTV");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(HOME);
        web.requestFocus();
        hideSystemBars();
    }

    // ---- page loading ----

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false; // players inside iframes load normally
            return blockIfOffsite(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return blockIfOffsite(Uri.parse(url));
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            inject();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            inject(); // nav.js guards against running twice
        }
    }

    /** Stay on cinejoy.pk; ignore redirects to ad and other sites. */
    private static boolean allowed(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equals("cinejoy.pk") || host.endsWith(".cinejoy.pk"));
    }

    private long lastToast;

    /** Returns true (block) for off-site pages, with a short on-screen note. */
    private boolean blockIfOffsite(Uri uri) {
        if (allowed(uri)) return false;
        String scheme = uri.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme) || "intent".equals(scheme) || "market".equals(scheme)) {
            long now = System.currentTimeMillis();
            if (now - lastToast > 3000) {
                lastToast = now;
                Toast.makeText(this, "Blocked a pop-up / redirect", Toast.LENGTH_SHORT).show();
            }
        }
        return true;
    }

    private void inject() {
        if (navScript != null) web.evaluateJavascript(navScript, null);
    }

    // ---- full-screen video (when the site asks for it) ----

    private class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) { callback.onCustomViewHidden(); return; }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        /**
         * Pop-ups / new tabs: open a throwaway view just to learn the URL.
         * Same-site links load in the main view; everything else is dropped.
         */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final WebView probe = new WebView(MainActivity.this);
            probe.setWebViewClient(new WebViewClient() {
                private boolean done;

                private boolean handle(Uri uri) {
                    if (!done) {
                        done = true;
                        if (!blockIfOffsite(uri)) web.loadUrl(uri.toString());
                        probe.post(probe::destroy);
                    }
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    return handle(r.getUrl());
                }

                @SuppressWarnings("deprecation")
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, String url) {
                    return handle(Uri.parse(url));
                }

                @Override
                public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                    if (url != null && !url.equals("about:blank")) handle(Uri.parse(url));
                    v.stopLoading();
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(probe);
            resultMsg.sendToTarget();
            return true;
        }
    }

    private boolean exitFullscreen() {
        if (fullscreenView == null) return false;
        root.removeView(fullscreenView);
        fullscreenView = null;
        web.setVisibility(View.VISIBLE);
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        web.requestFocus();
        return true;
    }

    // ---- remote keys ----

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;

        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (down && e.getRepeatCount() == 0) handleBack();
            return true;
        }

        // Media keys -> the codes nav.js uses for Samsung remotes.
        int js = mediaKey(code);
        if (js != 0) {
            if (down) web.evaluateJavascript(
                    "window.__cinejoyTv && window.__cinejoyTv.key(" + js + ")", null);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private static int mediaKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return 10252;
            case KeyEvent.KEYCODE_MEDIA_PLAY: return 415;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return 19;
            case KeyEvent.KEYCODE_MEDIA_STOP: return 413;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return 417;
            case KeyEvent.KEYCODE_MEDIA_REWIND: return 412;
            default: return 0;
        }
    }

    private void handleBack() {
        if (exitFullscreen()) return;
        // Let nav.js decide (leave text box, leave player, go back, open menu, exit).
        web.evaluateJavascript("window.__cinejoyTv ? window.__cinejoyTv.back() : 'none'", result -> {
            if (result == null || result.contains("none")) {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });
    }

    /** Called from nav.js when Back is pressed on the home page menu. */
    private class Bridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finish);
        }
    }

    // ---- lifecycle ----

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
