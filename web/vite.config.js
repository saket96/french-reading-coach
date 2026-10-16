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
        // Whisper can take a while on first request while the model warms up
        timeout: 180_000,
        proxyTimeout: 180_000,
      },
      '/pronunciation': {
        target: pronounceUrl,
        changeOrigin: true,
      },
      '/phonemes': {
        target: pronounceUrl,
        changeOrigin: true,
      },
      // Reverso (often Cloudflare 403 from Docker — client falls back automatically)
      '/reverso-translate': {
        target: 'https://api.reverso.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/reverso-translate/, '/translate/v1/translation'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'https://www.reverso.net')
            proxyReq.setHeader('Referer', 'https://www.reverso.net/text-translation')
            proxyReq.setHeader(
              'User-Agent',
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            )
            proxyReq.setHeader('X-Reverso-Origin', 'translation.web')
            proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
          })
        },
      },
    },
  },
})
