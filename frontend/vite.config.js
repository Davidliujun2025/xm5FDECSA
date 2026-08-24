import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    root: '.',
    server: {
      proxy: {
        '/api': env.RAG_PROXY_TARGET || 'http://localhost:3000'
      }
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: 'index.html'
      }
    }
  };
});
