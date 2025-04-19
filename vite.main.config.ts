import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// https://vitejs.dev/config
// Back to simpler config, relying on env vars for ws native addon handling
export default defineConfig({
  resolve: {
    // Keep alias as a potential fallback
    alias: {
      'bufferutil': resolve(__dirname, './stub.js'), 
      'utf-8-validate': resolve(__dirname, './stub.js'),
    },
  },
  optimizeDeps: {
    // Also exclude in optimizeDeps for good measure
    exclude: ['ws'],
  },
  ssr: {
    // Ensure it's external during SSR-like builds (which main process resembles)
    external: ['ws']
  },
  build: {
    rollupOptions: {
      // Explicitly tell Rollup (Vite's bundler) to treat 'ws' as external
      external: ['ws'],
    },
    // Ensure we target a Node.js environment for the main process build
    // (This might be handled by the Electron Forge plugin, but explicit is safer)
    ssr: true, 
    target: 'node18', // Or match your Node version
  },
});
