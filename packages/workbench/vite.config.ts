import { defineConfig } from 'vite'

export default defineConfig({
  base: '/', // the Fly deployment serves the site at the domain root
  publicDir: '../../examples',
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  worker: { format: 'es' },
  // one HTML file per page of the site
  build: { rollupOptions: { input: { home: 'index.html', explore: 'explore/index.html', sim: 'sim/index.html', gallery: 'gallery/index.html', blog: 'blog/index.html', about: 'about/index.html', guide: 'guide/index.html' } } },
})
