import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { foundationRuntime } from '../../desktop/runtime/vite-plugin.mjs';

function localFixtureAPI() {
  return { name: 'foundation-local-fixture-api', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/')) return next();
      if (url.pathname.endsWith('/network-failure')) { request.socket.destroy(); return; }
      if (!['/api/orbit/profile','/api/ping'].includes(url.pathname)) { response.writeHead(404).end(); return; }
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      let bytes = 0, chunks = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) { response.writeHead(413).end(); return; } chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { response.writeHead(400).end(); return; }
      const failure = url.searchParams.get('scenario') === 'failure' || body.simulateError === true;
      const timer = setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(failure ? 503 : 200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        response.end(JSON.stringify(failure ? {error:'Fixture failure'} : {saved:true}));
      }, url.searchParams.get('scenario') === 'slow' ? 1400 : 180);
      response.once('close', () => clearTimeout(timer));
    });
  } };
}
export default defineConfig({ plugins:[foundationRuntime(),react(),localFixtureAPI()], server:{host:'127.0.0.1'}, build:{outDir:'dist'} });
