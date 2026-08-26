import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kavanaka.app',
  appName: 'Kavanaka',
  webDir: 'public',

  server: {
    url: 'https://pinwall-web.vercel.app',
    cleartext: false
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