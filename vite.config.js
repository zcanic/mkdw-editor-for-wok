import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production'
  }
}))