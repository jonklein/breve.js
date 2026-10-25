import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: '../../examples',
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  worker: { format: 'es' },
})
