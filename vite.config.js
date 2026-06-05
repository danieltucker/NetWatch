import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API + SSE requests to the Express backend during development
    proxy: {
      '/api': {
        target:      'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Output the production bundle where Express expects to find it
    outDir:     'server/public',
    emptyOutDir: true,

  },
});
