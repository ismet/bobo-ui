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
});
