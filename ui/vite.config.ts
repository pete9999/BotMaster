import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 9200, proxy: { '/api': 'http://localhost:9100', '/dashboard': 'http://localhost:9100', '/health': 'http://localhost:9100' } },
  build: { outDir: '../hub/ui_dist' },
})
