import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

test('Render startup exposes its assigned port and supports HTTPS proxy login and QR links', { timeout: 15000 }, async t => {
  const probe = createServer();
  probe.listen(0, '0.0.0.0');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const directory = mkdtempSync(join(tmpdir(), 'squarebox-render-test-'));
  const externalUrl = 'https://squarebox-test.onrender.com';
  const env = { ...process.env, NODE_ENV: 'production', RENDER: 'true', RENDER_EXTERNAL_URL: externalUrl, PORT: String(port), DATABASE_PATH: join(directory, 'render.sqlite'), STAFF_PIN: 'render-test-pin' };
  for (const key of ['HOST', 'PUBLIC_BASE_URL', 'COOKIE_SECURE']) delete (env as NodeJS.ProcessEnv)[key];
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'close'); }
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Render-mode server did not become ready')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Render-mode server exited early (${code})`)); });
    child.stdout.on('data', data => {
      output += String(data);
      if (output.includes(`running on 0.0.0.0:${port}`)) { clearTimeout(timer); resolve(); }
    });
  });

  // A request to the actual container interface would fail for loopback-only binding.
  const address = Object.values(networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';
  const base = `http://${address}:${port}`;
  const request = (path: string, options?: RequestInit) => fetch(base + path, { signal: AbortSignal.timeout(3000), ...options });
  assert.equal((await (await request('/api/health')).json()).ok, true);
  assert.ok((await (await request('/api/guest/menu')).json()).menu.length > 0);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: externalUrl }, body: JSON.stringify({ pin: 'render-test-pin' }) });
  assert.equal(login.status, 200, 'HTTPS browser origin must work behind HTTP proxy transport');
  assert.match(login.headers.get('set-cookie')!, /Secure/);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const qr = await (await request('/api/guest-qr', { headers: { Cookie: cookie } })).json();
  assert.equal(qr.url, externalUrl + '/order');
  assert.equal(qr.localOnly, false);
  const forbidden = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ pin: 'render-test-pin' }) });
  assert.equal(forbidden.status, 403);
});
