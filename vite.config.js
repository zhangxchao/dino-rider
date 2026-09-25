import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// dev:   npm run dev      → http://localhost:5173
// build: npm run build    → dist/index.html（单文件，可直接双击打开）
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 5000 },
});
