import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';

async function fixture(t: TestContext) {
  const store = new Store(':memory:', false, () => new Date('2026-10-23T08:00:00Z'));
  store.db.prepare('INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?)').run('rice', '米', 'kg', 10, 2, 10, 200, 'test');
  store.db.prepare('INSERT INTO menu VALUES (?,?,?,?,?,?,?,?)').run('bowl', '米饭', 'Rice bowl', '主食', 1000, 'test', '🍚', JSON.stringify([{ inventoryId: 'rice', quantity: 0.2 }]));
  const server = createApp(store, { pin: '2468', aiKey: null }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); });
  let cookie = '';
  async function call(path: string, method = 'GET', body?: unknown, useCookie = true, extraHeaders: Record<string, string> = {}) {
    return fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(useCookie && cookie ? { cookie } : {}), ...extraHeaders }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function login() {
    const response = await call('/api/auth/login', 'POST', { pin: '2468', aiKey: null });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(response.headers.get('set-cookie')!, /SameSite=Strict/);
  }
  return { store, call, login };
}

test('staff reports, expenses, inventory and invoice exports require a staff session', async t => {
  const { call, login } = await fixture(t);
  for (const path of ['/api/bootstrap', '/api/reports', '/api/guest-qr', '/api/orders/anything/einvoice', '/api/inventory/rice/movements']) assert.equal((await call(path)).status, 401);
  assert.equal((await call('/api/inventory/rice/restock', 'POST', { quantity: 2 })).status, 401);
  assert.equal((await call('/api/auth/login', 'POST', { pin: 'wrong' })).status, 401);
  await login();
  assert.equal((await call('/api/bootstrap')).status, 200);
  assert.equal((await call('/api/session')).status, 200);
  assert.equal((await call('/api/auth/logout', 'POST', {})).status, 200);
  assert.equal((await call('/api/bootstrap')).status, 401, 'old cookie must be revoked');
});

test('guest menu omits cost, recipes, inventory, orders and financial settings', async t => {
  const { call } = await fixture(t);
  const data = await (await call('/api/guest/menu')).json();
  assert.equal(data.menu.length, 1);
  assert.equal(data.menu[0].cost, undefined);
  assert.equal(data.menu[0].recipe, undefined);
  assert.equal(data.orders, undefined);
  assert.equal(data.inventory, undefined);
  assert.equal(data.report, undefined);
  assert.equal(data.settings.aiConfigured, undefined);
});

test('guest demo checkout is token protected and duplicate concurrent payment is counted once', async t => {
  const { store, call, login } = await fixture(t);
  const input = { clientRequestId: randomUUID(), items: [{ menuItemId: 'bowl', quantity: 2 }], tableNumber: '5' };
  const response = await call('/api/guest/orders', 'POST', input, false);
  assert.equal(response.status, 201);
  const { order, checkoutToken } = await response.json();
  assert.equal(order.status, 'pending');
  assert.equal(store.report('today').totals.orders, 0);
  const replay = await (await call('/api/guest/orders', 'POST', input, false)).json();
  assert.equal(replay.order.id, order.id);
  assert.equal(replay.checkoutToken, checkoutToken);
  assert.equal((await call(`/api/guest/orders/${order.id}/pay`, 'POST', { checkoutToken: 'a'.repeat(64), method: 'demo_card' }, false)).status, 403);
  assert.equal((await call(`/api/guest/orders/${order.id}/pay`, 'POST', { checkoutToken, method: 'cash' }, false)).status, 400);
  const payments = await Promise.all(Array.from({ length: 5 }, () => call(`/api/guest/orders/${order.id}/pay`, 'POST', { checkoutToken, method: 'demo_card' }, false)));
  assert.ok(payments.every(r => r.status === 200));
  assert.equal(store.report('today').totals.orders, 1);
  assert.equal(store.report('today').totals.revenue, 20);
  assert.equal(store.inventory()[0].stock, 9.6);
  assert.equal(store.order(order.id).paymentMethod, 'demo_card');
  await login();
  const invoice = await call(`/api/orders/${order.id}/einvoice`, 'POST', { buyer: {} });
  assert.equal(invoice.status, 200);
  assert.equal((await invoice.json()).draft.status, 'draft_not_submitted');
  const download = await call(`/api/orders/${order.id}/einvoice`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition')!, /attachment/);
  assert.equal((await download.json()).readiness.submittedToMyInvois, false);
});

test('staff can collect guest cash, export reports, and get honest rule analysis', async t => {
  const { call, login } = await fixture(t);
  const { order } = await (await call('/api/guest/orders', 'POST', { clientRequestId: randomUUID(), items: [{ menuItemId: 'bowl', quantity: 1 }], tableNumber: '8' })).json();
  await login();
  assert.equal((await call(`/api/orders/${order.id}/pay`, 'POST', { method: 'cash' })).status, 200);
  assert.equal((await call('/api/expenses', 'POST', { amount: 2, category: '水电', description: 'test', date: '2026-10-23' })).status, 201);
  const report = await (await call('/api/reports?period=today')).json();
  assert.equal(report.totals.revenue, 10);
  assert.equal(report.totals.cogs, 0.4);
  assert.equal(report.totals.profit, 7.6);
  const csv = await call('/api/reports/export?period=today');
  assert.match(csv.headers.get('content-type')!, /text\/csv/);
  assert.match(await csv.text(), /Operating profit,7.60/);
  const insight = await (await call('/api/agents/accounting/analyze', 'POST', { period: 'today' })).json();
  assert.equal(insight.mode, 'rules');
  assert.match(insight.analysis, /RM 7.60/);
  const qr = await (await call('/api/guest-qr')).json();
  assert.equal(qr.localOnly, true);
  assert.match(qr.svg, /<svg/);
  assert.match(qr.url, /\/order$/);
});

test('mutation requests reject cross-origin forms, malformed data and impossible dates', async t => {
  const { call, login } = await fixture(t);
  await login();
  assert.equal((await call('/api/expenses', 'POST', { amount: 2, category: '水电', description: 'x', date: '2026-13-01' })).status, 400);
  assert.equal((await call('/api/expenses', 'POST', {}, true, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await call('/api/orders', 'POST', { items: [] })).status, 400);
  assert.equal((await call('/api/reports?period=invalid')).status, 400);
  assert.equal((await call('/api/inventory/rice/restock', 'POST', { quantity: -1 })).status, 400);
});
