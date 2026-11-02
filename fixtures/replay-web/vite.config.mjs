import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { foundationRuntime } from '../../desktop/runtime/vite-plugin.mjs';
function fixtureAPI() {
  return { name: 'replay-fixture-api', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const route = new URL(request.url, 'http://127.0.0.1').pathname;
      if (!route.startsWith('/api/fixture/')) return next();
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      if (route === '/api/fixture/offline') { request.socket.destroy(); return; }
      if (!['/api/fixture/success', '/api/fixture/error'].includes(route)) { response.writeHead(404).end(); return; }
      const timer = setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(route.endsWith('/error') ? 503 : 200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
        response.end(JSON.stringify({ fixture: true }));
      }, 160);
      response.once('close', () => clearTimeout(timer));
    });
  } };
}
export default defineConfig({ plugins:[foundationRuntime(), react(), fixtureAPI()], server:{host:'127.0.0.1'}, build:{outDir:'dist'} });
