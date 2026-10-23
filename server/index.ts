import express from 'express';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { runtimeConfig } from './runtime.js';

const runtime = runtimeConfig();
const store = new Store(process.env.DATABASE_PATH || resolve('data/squarebox.sqlite'));
const app = createApp(store, { publicBaseUrl: runtime.publicBaseUrl, secureCookie: runtime.secureCookie });
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const { port, host } = runtime;
app.listen(port, host, () => console.log(`The Square Box running on ${host}:${port} (demo data; simulated electronic payments)`));
