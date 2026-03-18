import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
        target: 'ws://localhost:14702',
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
      },
      '/attachments': {
        target: 'http://localhost:14702',
        changeOrigin: true,
      },
    },
  },
})
