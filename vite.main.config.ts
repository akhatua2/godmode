import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// https://vitejs.dev/config
// Back to simpler config, relying on env vars for ws native addon handling
export default defineConfig({
  resolve: {
    // Remove aliases for optional ws dependencies
    // alias: {
    //   'bufferutil': resolve(__dirname, './stub.js'), 
    //   'utf-8-validate': resolve(__dirname, './stub.js'),
    // },
  },
  optimizeDeps: {
    // Let Vite handle 'ws'
    // exclude: ['ws'],
  },
  ssr: {
    // Explicitly tell Vite to BUNDLE these for the main process (SSR-like build)
    noExternal: ['electron-squirrel-startup', 'debug', 'ms', 'ws', 'uuid']
  },
  build: {
    rollupOptions: {
      // Let Vite bundle 'ws'
      // external: ['ws'],
      // Specify the entry point to the new main index file
      input: resolve(__dirname, 'src/main/index.ts'),
    },
    // Ensure we target a Node.js environment for the main process build
    // (This might be handled by the Electron Forge plugin, but explicit is safer)
    ssr: true, 
    target: 'node18', // Or match your Node version
  },
});
