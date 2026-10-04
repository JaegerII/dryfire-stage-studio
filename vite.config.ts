import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths: the build works under any sub-path (e.g. GitHub Pages /<repo>/)
  base: './',
  plugins: [react()],
  server: { port: 5180 },
});
