import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const whisperUrl = process.env.WHISPER_URL || 'http://127.0.0.1:9000'
const whisperSmallUrl = process.env.WHISPER_SMALL_URL || 'http://127.0.0.1:9001'
const pronounceUrl = process.env.PRONOUNCE_URL || 'http://127.0.0.1:8000'

const asrProxy = (target) => ({
  target,
  changeOrigin: true,
  timeout: 180_000,
  proxyTimeout: 180_000,
})

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 4378,
    strictPort: true,
    proxy: {
      // Use /small-asr (not /asr-small): Vite matches proxy prefixes with
      // startsWith, so /asr would otherwise swallow /asr-small → 404 on base.
      '/small-asr': {
        ...asrProxy(whisperSmallUrl),
        rewrite: (path) => path.replace(/^\/small-asr/, '/asr'),
      },
      '/asr': asrProxy(whisperUrl),
      '/whisper-small-health': {
        target: whisperSmallUrl,
        changeOrigin: true,
        rewrite: () => '/docs',
      },
      '/whisper-health': {
        target: whisperUrl,
        changeOrigin: true,
        rewrite: () => '/docs',
      },
      // First French OpenPronounce call can download ~1.2GB — allow long waits.
      '/pronunciation': {
        target: pronounceUrl,
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
      '/phonemes': {
        target: pronounceUrl,
        changeOrigin: true,
        timeout: 180_000,
        proxyTimeout: 180_000,
      },
      '/pronounce-health': {
        target: pronounceUrl,
        changeOrigin: true,
        rewrite: () => '/health',
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
