import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { existsSync } from 'fs'

const cryptoRealPath = resolve(__dirname, 'src/crypto/crypto.real.js')

// Redirect crypto.js imports to the local (gitignored) crypto.real.js when present.
function cryptoImplPlugin() {
  return {
    name: 'crypto-impl',
    resolveId(id) {
      if (existsSync(cryptoRealPath) && id.includes('crypto/crypto.js')) {
        return cryptoRealPath
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), cryptoImplPlugin()],
  // Chrome extensions need relative paths, not absolute
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background.js'),
      },
      output: {
        // Both entries go to dist root as named files (no hash)
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
