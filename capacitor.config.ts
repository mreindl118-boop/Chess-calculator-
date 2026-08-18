import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android shell loads the production site directly (server.url), so every
 * web deploy updates the app instantly with no store release. The service
 * worker keeps it fully offline-capable after first load.
 *
 * Set PROD_URL to the real Cloudflare Pages domain before building the APK.
 */
const PROD_URL = process.env.GAMBITLAB_URL ?? 'https://gambitlab.pages.dev';

const config: CapacitorConfig = {
  appId: 'app.gambitlab',
  appName: 'GambitLab',
  webDir: 'dist',
  server: {
    url: PROD_URL,
    cleartext: false,
  },
  android: {
    backgroundColor: '#16191d',
  },
  plugins: {
    StatusBar: {
      backgroundColor: '#16191d',
      style: 'DARK',
    },
  },
};

export default config;
