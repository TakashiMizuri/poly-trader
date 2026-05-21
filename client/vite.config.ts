import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  // Load VITE_* from repo-root .env (same file as WEB_API_TOKEN)
  envDir: path.resolve(__dirname, '..'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Loopback only — avoids VPN hijacking "localhost" on Windows
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5088',
        changeOrigin: true,
      },
      '/hubs': {
        target: 'http://127.0.0.1:5088',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
