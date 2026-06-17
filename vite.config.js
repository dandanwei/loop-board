import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.BOARD_PORT || 5151;

// The React app lives in web/. In dev, Vite serves it on 5173 and proxies
// /api to the Express server. In prod, `npm run build` emits web/dist, which
// the Express server serves directly (single origin, single port).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
