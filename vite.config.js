import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Content Security Policy for production builds. The page holds private keys, so no
// script may load from anywhere but this origin. connect-src allows any https host
// because users can add their own RPC endpoints and API keys.
// Not applied in `npm run dev`: Vite's dev server needs inline scripts for hot reload.
// Hosts should also send `frame-ancestors 'none'` as an HTTP header (a meta tag cannot set it).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "worker-src 'none'"
].join('; ')

function contentSecurityPolicy() {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' }]
    },
  }
}

export default defineConfig({
  plugins: [
    contentSecurityPolicy(),
    react(),
  ],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
})
