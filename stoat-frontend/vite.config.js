import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react/')) return 'react';
            if (id.includes('react-router')) return 'router';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['opic.fun', 'www.opic.fun'],
    proxy: {
      '/api': {
        target: 'http://localhost:14702',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        // Use http + changeOrigin so the upgrade is proxied reliably (ws:// target can fail on some setups).
        target: 'http://localhost:14702',
        changeOrigin: true,
        ws: true,
        // Path must stay a valid URL path: `/ws?token=…` → `/?token=…` (not `?token=…` alone).
        rewrite: (path) => {
          const rest = path.replace(/^\/ws/, '') || '/';
          if (rest.startsWith('?')) return `/${rest}`;
          return rest.startsWith('/') ? rest : `/${rest}`;
        },
        configure: (proxy) => {
          proxy.on('error', (err, _req, _res) => {
            // Harmless closes: backend restart, HMR reconnect, tab close. Node/http-proxy may set code
            // and/or message ("read ECONNRESET") inconsistently.
            const code = err?.code;
            const msg = String(err?.message || '');
            const benign =
              code === 'ECONNRESET' ||
              code === 'EPIPE' ||
              code === 'ECONNABORTED' ||
              /ECONNRESET|EPIPE|socket hang up/i.test(msg);
            if (!benign) console.error('[vite] ws proxy error:', err);
          });
        },
      },
      '/attachments': {
        target: 'http://localhost:14702',
        changeOrigin: true,
      },
    },
  },
})
