import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../server/runtime.js';

test('local development stays private and honors an explicit interface/port', () => {
  assert.deepEqual(runtimeConfig({}), { host: '127.0.0.1', port: 3000, publicBaseUrl: undefined, secureCookie: false });
  assert.equal(runtimeConfig({ HOST: '192.0.2.1', PORT: '4000' }).host, '192.0.2.1');
  assert.equal(runtimeConfig({ HOST: '127.0.0.1', PORT: '4000' }).port, 4000);
});

test('Render binds publicly and uses its HTTPS URL for origin checks and QR codes', () => {
  assert.deepEqual(runtimeConfig({ RENDER: 'true', PORT: '10000', RENDER_EXTERNAL_URL: 'https://squarebox-example.onrender.com/' }), {
    host: '0.0.0.0', port: 10000, publicBaseUrl: 'https://squarebox-example.onrender.com', secureCookie: true,
  });
  assert.equal(runtimeConfig({ RENDER_EXTERNAL_URL: 'https://ignored.example' }).publicBaseUrl, undefined);
});

test('custom domain and explicit cookie settings override Render defaults', () => {
  const config = runtimeConfig({ RENDER: 'true', HOST: '127.0.0.1', RENDER_EXTERNAL_URL: 'https://example.onrender.com', PUBLIC_BASE_URL: 'https://restaurant.example/', COOKIE_SECURE: 'false' });
  assert.equal(config.publicBaseUrl, 'https://restaurant.example');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.secureCookie, false);
});

test('invalid ports and non-web public URLs fail with a configuration error', () => {
  for (const PORT of ['0', '65536', 'nan', '10000.5', '-1']) assert.throws(() => runtimeConfig({ PORT }), /PORT/);
  for (const PUBLIC_BASE_URL of ['not-a-url', 'file:///tmp/app', 'https://user:password@example.com']) assert.throws(() => runtimeConfig({ PUBLIC_BASE_URL }));
});
