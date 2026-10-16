import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 4378,
    strictPort: true,
    proxy: {
      '/asr': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true,
      },
      '/pronunciation': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/phonemes': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
