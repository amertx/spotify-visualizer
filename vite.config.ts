import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      // Route Spotify CDN preview MP3s through the dev server to avoid CORS.
      // fetch('/preview/mp3-preview/...') → https://p.scdn.co/mp3-preview/...
      '/preview': {
        target: 'https://p.scdn.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/preview/, ''),
      },
    },
  },
})
