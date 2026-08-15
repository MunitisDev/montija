import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base keeps the build portable (static hosting, and later a
  // Capacitor webview which serves from a file-like origin).
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // Phaser is a single large dependency; keep it in its own chunk so game
    // code can be re-downloaded without invalidating the engine.
    // Vite 8 bundles with Rolldown, hence `codeSplitting` rather than Rollup's
    // `manualChunks`.
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'phaser', test: /[\\/]node_modules[\\/]phaser[\\/]/ }],
        },
      },
    },
    // Phaser alone is ~1.4 MB before gzip, which is expected for a game engine
    // and not a signal worth warning about on every build.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true,
    port: 5173,
  },
});
