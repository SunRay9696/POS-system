import express from 'express';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';

const store = new Store(process.env.DATABASE_PATH || resolve('data/squarebox.sqlite'));
const app = createApp(store);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`The Square Box running on ${host}:${port} (demo data; simulated electronic payments)`));
