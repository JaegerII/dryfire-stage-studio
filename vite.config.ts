import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
// @ts-expect-error -- plain ESM helper without type declarations
import { traceRelayPlugin } from './scripts/trace-relay.mjs';

// `--mode lan` (npm run dev:lan / preview:lan): HTTPS with a self-signed cert, because phones only
// allow camera access in a secure context — plain http://<pc-ip> would have no camera.
export default defineConfig(({ mode }) => ({
  // relative asset paths: the build works under any sub-path (e.g. GitHub Pages /<repo>/)
  base: './',
  plugins: [react(), traceRelayPlugin(), ...(mode === 'lan' ? [basicSsl()] : [])],
  server: { port: 5180 },
  preview: { port: 5180 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
