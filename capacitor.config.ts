import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kavanaka.app',
  appName: 'Kavanaka',
  webDir: 'public',

  server: {
    url: 'https://pinwall-web.vercel.app',
    cleartext: false,
    // Shown natively (via WKWebView's own didFail/didFailProvisionalNavigation
    // handlers) if the initial load of `url` above ever fails -- e.g. iOS's
    // first-launch network-permission prompt briefly delaying connectivity.
    // Without this, Capacitor's default behavior is to leave the WebView
    // blank with no user-facing recovery at all. Path is relative to webDir
    // (public/); public/load-error.html hardcodes the same `url` value above
    // for its own manual/automatic retry, since a static file in webDir
    // can't import this config directly -- keep both in sync if this URL
    // ever changes.
    errorPath: 'load-error.html'
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#ffffffff',
      showSpinner: false
    }
  }
};

export default config;