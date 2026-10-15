import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
      // Include specific polyfills
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Polyfill Node.js built-ins that solc might need
      polyfills: {
        util: true,
        stream: true,
        crypto: true,
        fs: false, // Don't polyfill fs (not needed)
        path: false, // Don't polyfill path (not needed)
      },
    }),
  ],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Provide browser-compatible alternatives
    }
  },
  optimizeDeps: {
    exclude: ['solc'], // Don't pre-bundle solc, load it dynamically
  },
  worker: {
    format: 'iife', // Use IIFE format for classic workers (needed for importScripts)
    // Note: We use classic workers because soljson scripts require importScripts()
  }
})
