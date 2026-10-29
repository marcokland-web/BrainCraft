import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages liefert die App unter https://marcokland-web.github.io/BrainCraft/ aus
const base = process.env.VITE_BASE ?? '/BrainCraft/'
const SUPABASE = 'https://asfwbuptsfcrgmmgdgim.supabase.co'

// Strenge CSP wie bei Rechenstern, nur im Build (der Dev-Server braucht Inline-Skripte)
const csp: Plugin = {
  name: 'braincraft-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<!--csp-->',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' ${SUPABASE}; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">`,
    ),
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
  plugins: [
    react(),
    csp,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['early.js', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        id: './',
        name: 'BrainCraft',
        short_name: 'BrainCraft',
        description: 'Lernstoff aus dem Schulheft wird zum Spiel.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FAF7F2',
        theme_color: '#5A1028',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
