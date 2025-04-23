import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // Ensure output is in the same directory as main process build
    outDir: resolve(__dirname, '.vite/build'), 
    rollupOptions: {
      input: resolve(__dirname, 'src/preload/index.ts'),
      output: {
        // Specify the output filename
        entryFileNames: 'preload.js',
        // Ensure format is CommonJS (needed for Electron preload)
        format: 'cjs',
      }
    },
    // Recommended: Minify preload scripts for production
    minify: process.env.NODE_ENV === 'production', 
    // Disable sourcemaps if not needed, or configure as desired
    sourcemap: false, 
  }
});
