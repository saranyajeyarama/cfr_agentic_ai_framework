import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const backendPort = env.PORT || '8080';

  // Build identity injected into the bundle. Used by the sessionStorage
  // cache layer to invalidate stale client data on a new deploy. We
  // prefer an explicit BUILD_ID (set by Cloud Build / docker build),
  // fall back to a fresh timestamp per build so local rebuilds also
  // bust the cache.
  const BUILD_ID = env.BUILD_ID || env.VITE_BUILD_ID || String(Date.now());

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        }
      }
    },
  };
});
