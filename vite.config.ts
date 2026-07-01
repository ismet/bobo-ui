import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const boboApiTarget = 'https://bobo-api.onrender.com';

const boboApiProxy = {
  '/api': {
    target: boboApiTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: boboApiProxy,
  },
  preview: {
    proxy: boboApiProxy,
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
