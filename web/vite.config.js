import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const whisperUrl = process.env.WHISPER_URL || 'http://127.0.0.1:9000'
const pronounceUrl = process.env.PRONOUNCE_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 4378,
    strictPort: true,
    proxy: {
      '/asr': {
        target: whisperUrl,
        changeOrigin: true,
      },
      '/pronunciation': {
        target: pronounceUrl,
        changeOrigin: true,
      },
      '/phonemes': {
        target: pronounceUrl,
        changeOrigin: true,
      },
    },
  },
})
