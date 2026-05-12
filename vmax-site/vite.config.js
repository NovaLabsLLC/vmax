import { dirname, resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

function copySiteLogoFavicon() {
  return {
    name: 'copy-site-logo-favicon',
    buildStart() {
      // Site build must not depend on repo-root `electron/` (ignored / missing on Vercel).
      const siteLogo = resolve(__dirname, 'src/assets/logo.png')
      const fallback = resolve(__dirname, '../electron/assets/logo.png')
      const logoPath = existsSync(siteLogo) ? siteLogo : fallback
      const publicDir = resolve(__dirname, 'public')
      const dest = resolve(publicDir, 'favicon.png')
      if (!existsSync(logoPath)) return
      mkdirSync(publicDir, { recursive: true })
      copyFileSync(logoPath, dest)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copySiteLogoFavicon()],
  server: {
    fs: {
      allow: [resolve(__dirname, '..')],
    },
  },
})
