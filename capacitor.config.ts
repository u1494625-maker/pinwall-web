import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kavanaka.app',
  appName: 'Kavanaka',
  webDir: 'public',
  server: {
    url: 'https://pinwall-web.vercel.app',
    cleartext: false
  }
};

export default config;