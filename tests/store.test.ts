import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppError, Store, businessDate, periodRange } from '../server/store.js';

const FIXED_TIME = '2026-10-23T08:00:00.000Z';

function fixture(t: TestContext, at = FIXED_TIME) {
  const store = new Store(':memory:', false, () => new Date(at));
  t.after(() => store.close());
  const inventory: [string, string, string, number, number][] = [
    ['rice', '香米', 'kg', 5, 200],
    ['chicken', '鸡肉', 'kg', 2, 1000],
  ];
  for (const [id, name, unit, stock, cost] of inventory) {
    store.db.prepare('INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?)').run(id, name, unit, stock, 1, 10, cost, 'Test supplier');
    store.db.prepare('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)').run(`opening-${id}`, id, null, stock, cost, 'opening', 'Test opening stock', at);
  }
  const menu: [string, string, number, { inventoryId: string; quantity: number }[]][] = [
    ['bowl', '鸡肉饭', 1800, [{ inventoryId: 'rice', quantity: 0.5 }, { inventoryId: 'chicken', quantity: 0.25 }]],
    ['chicken-only', '鸡肉单点', 1200, [{ inventoryId: 'chicken', quantity: 0.5 }]],
  ];
  for (const [id, name, price, recipe] of menu) {
    store.db.prepare('INSERT INTO menu VALUES (?,?,?,?,?,?,?,?)').run(id, name, name, '主食', price, 'Test dish', '🍚', JSON.stringify(recipe));
  }
  return store;
}

function request(quantity = 1, clientRequestId: string = randomUUID()) {
  return { clientRequestId, items: [{ menuItemId: 'bowl', quantity }], tableNumber: '3', channel: 'counter' };
}

function assertMovementsReconcile(store: Store) {
  for (const row of store.inventory()) {
    const movement = store.one('SELECT SUM(quantity) AS quantity FROM movements WHERE inventory_id=?', row.id)!;
    assert.ok(Math.abs(Number(movement.quantity) - row.stock) < 0.000001, `${row.id} stock must reconcile to its movement ledger`);
  }
}

test('pending and cancelled orders do not affect inventory or revenue', (t) => {
  const store = fixture(t);
  const before = store.inventory();
  const order = store.createOrder(request(2));
  assert.equal(order.status, 'pending');
  assert.equal(order.total, 36);
  assert.deepEqual(store.inventory(), before);
  assert.equal(store.report('today').totals.revenue, 0);
  assert.equal(store.report('today').totals.orders, 0);
  assert.equal(store.report('today').totals.cogs, 0);
  assert.equal(store.rows("SELECT * FROM movements WHERE kind='sale'").length, 0);
  assert.equal(store.cancel(order.id).status, 'cancelled');
  assert.throws(() => store.pay(order.id, 'cash'), (error) => error instanceof AppError && error.status === 409);
  assert.deepEqual(store.inventory(), before);
  assertMovementsReconcile(store);
});

test('payment deducts recipe quantities exactly once and records historical COGS', (t) => {
  const store = fixture(t);
  const order = store.createOrder(request(2));
  const first = store.pay(order.id, 'cash');
  assert.equal(first.alreadyPaid, false);
  assert.equal(first.order.status, 'paid');
  assert.equal(first.order.businessDate, '2026-10-23');
  assert.equal(first.order.paymentMethod, 'cash');
  assert.equal(first.order.demo, true);
  assert.equal(store.inventory().find(i => i.id === 'rice')!.stock, 4);
  assert.equal(store.inventory().find(i => i.id === 'chicken')!.stock, 1.5);
  assert.equal(store.one('SELECT cogs FROM orders WHERE id=?', order.id)!.cogs, 700);
  const second = store.pay(order.id, 'demo_card');
  assert.equal(second.alreadyPaid, true);
  assert.equal(second.order.paymentMethod, 'cash');
  assert.equal(store.rows("SELECT * FROM movements WHERE kind='sale'").length, 2);
  assert.equal(store.report('today').totals.revenue, 36);
  assert.equal(store.report('today').totals.cogs, 7);
  assert.equal(store.report('today').totals.orders, 1);
  assertMovementsReconcile(store);
});

test('a shortage rolls back earlier stock deductions and all COGS updates', (t) => {
  const store = fixture(t);
  // Each chicken requirement can fit alone, but their aggregate cannot.
  store.db.prepare('UPDATE inventory SET stock=? WHERE id=?').run(0.6, 'chicken');
  const order = store.createOrder({ ...request(), items: [{ menuItemId: 'bowl', quantity: 1 }, { menuItemId: 'chicken-only', quantity: 1 }] });
  const before = store.inventory();
  assert.throws(() => store.pay(order.id, 'cash'), (error) => error instanceof AppError && error.status === 409);
  assert.deepEqual(store.inventory(), before);
  assert.equal(store.order(order.id).status, 'pending');
  assert.equal(store.order(order.id).paidAt, null);
  assert.equal(store.one('SELECT cogs FROM orders WHERE id=?', order.id)!.cogs, 0);
  assert.ok(store.rows('SELECT unit_cogs FROM order_items WHERE order_id=?', order.id).every(i => i.unit_cogs === 0));
  assert.equal(store.rows("SELECT * FROM movements WHERE kind='sale'").length, 0);
  assert.equal(store.report('today').totals.orders, 0);
});

test('creation is idempotent for equivalent items and rejects reused request IDs with changed content or ownership', (t) => {
  const store = fixture(t);
  const input = request(2, 'stable-request-001');
  const first = store.createOrder(input);
  store.db.prepare('UPDATE menu SET price=1900 WHERE id=?').run('bowl');
  const replay = store.createOrder({ ...input, items: [{ menuItemId: 'bowl', quantity: 1 }, { menuItemId: 'bowl', quantity: 1 }] });
  assert.equal(replay.id, first.id);
  assert.equal(replay.total, 36, 'replay preserves the original price snapshot');
  assert.equal(store.rows('SELECT id FROM orders').length, 1);
  assert.equal(store.rows('SELECT id FROM order_items').length, 1);
  assert.throws(() => store.createOrder({ ...input, items: [{ menuItemId: 'bowl', quantity: 3 }] }), (error) => error instanceof AppError && error.status === 409);
  assert.throws(() => store.createOrder(input, 'different-guest-owner'), (error) => error instanceof AppError && error.status === 409);
});

test('restocking uses weighted average cost without rewriting previous sales or charging purchases as expenses', (t) => {
  const store = fixture(t);
  const first = store.createOrder(request(2));
  store.pay(first.id, 'cash');
  store.expense({ amount: 5, category: '水电', description: '营业水电', date: '2026-10-23' });
  const before = store.report('today');
  assert.equal(before.totals.profit, 24); // RM36 - RM7 - RM5.
  const received = store.restock('rice', { quantity: 4, unitCost: 4, notes: 'Purchase at RM4/kg' });
  assert.equal(received.stock, 8);
  assert.equal(received.unitCost, 3); // 4kg at RM2 + 4kg at RM4.
  assert.equal(store.report('today').totals.cogs, 7);
  assert.equal(store.report('today').totals.expenses, 5);
  assert.equal(store.report('today').totals.profit, 24);
  assert.equal(store.one('SELECT unit_cogs FROM order_items WHERE order_id=?', first.id)!.unit_cogs, 350);
  const second = store.createOrder(request(2));
  store.pay(second.id, 'demo_card');
  const report = store.report('today');
  assert.equal(report.totals.revenue, 72);
  assert.equal(report.totals.cogs, 15); // First two servings RM7, next two RM8.
  assert.equal(report.totals.expenses, 5);
  assert.equal(report.totals.profit, 52);
  assert.equal(report.topProducts[0].quantity, 4);
  assert.equal(report.topProducts[0].revenue, 72);
  assertMovementsReconcile(store);
});

test('Malaysia midnight, Monday and month boundaries select the correct paid orders', (t) => {
  const store = fixture(t, '2026-11-01T16:01:00Z'); // Monday, November 2, 00:01 MYT.
  for (const at of ['2026-10-31T15:59:59Z', '2026-10-31T16:00:00Z', '2026-11-01T15:59:59Z', '2026-11-01T16:00:00Z']) {
    const order = store.createOrder(request());
    store.pay(order.id, 'cash', new Date(at));
  }
  const today = store.report('today');
  assert.equal(today.startDate, '2026-11-02');
  assert.equal(today.endDate, '2026-11-02');
  assert.equal(today.totals.orders, 1);
  assert.equal(today.hourly[0].orders, 1);
  assert.equal(today.hourly[16].orders, 0, 'hours use MYT, not UTC');
  const week = store.report('week');
  assert.equal(week.startDate, '2026-11-02');
  assert.equal(week.totals.orders, 1);
  const month = store.report('month');
  assert.equal(month.startDate, '2026-11-01');
  assert.equal(month.totals.orders, 3);
  assert.equal(month.totals.revenue, 54);
  assert.equal(month.daily.length, 2);
  assert.equal(month.daily.reduce((sum, d) => sum + d.orders, 0), month.totals.orders);
  const previousWeek = store.report('week', new Date('2026-11-01T15:59:59Z'));
  assert.equal(previousWeek.startDate, '2026-10-26');
  assert.equal(previousWeek.endDate, '2026-11-01');
  assert.equal(previousWeek.totals.orders, 3);
  assert.equal(businessDate(new Date('2026-10-23T16:30:00Z')), '2026-10-24');
  assert.deepEqual(periodRange('month', new Date('2026-10-31T16:00:00Z'), 'Asia/Kuala_Lumpur'), { startDate: '2026-11-01', endDate: '2026-11-01' });
  assertMovementsReconcile(store);
});

test('server prices and tax rounding determine receipts, while collected tax is excluded from profit', (t) => {
  const store = fixture(t);
  store.updateSettings({ restaurantName: 'The Square Box', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur', taxRate: 0.06, serviceChargeRate: 0 });
  const order = store.createOrder({ ...request(2), total: 0.01, unitPrice: 0.01, status: 'paid' });
  assert.equal(order.status, 'pending');
  assert.equal(order.subtotal, 36);
  assert.equal(order.serviceCharge, 0);
  assert.equal(order.taxAmount, 2.16);
  assert.equal(order.total, 38.16);
  store.pay(order.id, 'cash');
  const totals = store.report('today').totals;
  assert.equal(totals.revenue, 36);
  assert.equal(totals.taxCollected, 2.16);
  assert.equal(totals.grossReceipts, 38.16);
  assert.equal(totals.profit, 29);
});

test('rejects invalid quantities, unknown menu items and impossible expense dates without partial writes', (t) => {
  const store = fixture(t);
  for (const quantity of [0, -1, 0.5, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => store.createOrder(request(quantity)), `quantity ${quantity} should be rejected`);
  }
  assert.throws(() => store.createOrder({ ...request(), items: [] }));
  assert.throws(() => store.createOrder({ ...request(), items: [{ menuItemId: 'bowl', quantity: 60 }, { menuItemId: 'bowl', quantity: 60 }] }));
  assert.throws(() => store.createOrder({ ...request(), items: [{ menuItemId: 'missing', quantity: 1 }] }));
  assert.equal(store.rows('SELECT id FROM orders').length, 0);
  assert.equal(store.rows('SELECT id FROM order_items').length, 0);
  for (const date of ['2026-02-30', 'not-a-date', '2026-13-01']) {
    assert.throws(() => store.expense({ amount: 10, category: '水电', description: 'Invalid date', date }));
  }
  assert.throws(() => store.expense({ amount: 0.001, category: '水电', description: 'Too small', date: '2026-10-23' }));
  assert.equal(store.rows('SELECT id FROM expenses').length, 0);
  assertMovementsReconcile(store);
});

test('reorder alerts include the threshold exactly and clear after a sufficient receipt', (t) => {
  const store = fixture(t);
  store.updateInventory('chicken', { reorderPoint: 1.5, targetStock: 4 });
  const order = store.createOrder(request(2));
  store.pay(order.id, 'cash');
  const agent = store.insights('today').find(i => i.id === 'inventory')!;
  assert.equal(agent.mode, 'rules');
  assert.match(agent.summary, /1 项/);
  assert.ok(agent.findings.some(f => f.includes('鸡肉')));
  store.restock('chicken', { quantity: 2.5 });
  assert.match(store.insights('today').find(i => i.id === 'inventory')!.summary, /所有食材均高于/);
  assertMovementsReconcile(store);
});

test('restaurant catalog edits preserve existing order prices and recipe snapshots', t => {
  const store = fixture(t);
  const order = store.createOrder(request());
  const ingredient = store.createInventory({ name: '青菜', unit: 'kg', stock: 3, unitCost: 4, reorderPoint: 0.5, targetStock: 5, supplier: 'Local farm' });
  const menuInput = { name: '新版鸡肉饭', englishName: 'Updated bowl', category: '主食', price: 25, description: 'updated', emoji: '🍚', recipe: [{ inventoryId: ingredient.id, quantity: 0.3 }] };
  store.saveMenu(menuInput, 'bowl');
  store.pay(order.id, 'cash');
  assert.equal(store.order(order.id).subtotal, 18);
  assert.equal(store.inventory().find(i => i.id === ingredient.id)!.stock, 3);
  assert.equal(store.inventory().find(i => i.id === 'rice')!.stock, 4.5);
  const newOrder = store.createOrder(request());
  assert.equal(newOrder.total, 25);
  store.pay(newOrder.id, 'cash');
  assert.equal(store.inventory().find(i => i.id === ingredient.id)!.stock, 2.7);
  assert.throws(() => store.saveMenu({ ...menuInput, price: 2.999 }));
  assert.throws(() => store.saveMenu({ ...menuInput, recipe: [...menuInput.recipe, ...menuInput.recipe] }));
  assert.throws(() => store.saveMenu({ ...menuInput, recipe: [{ inventoryId: 'missing', quantity: 0.1 }] }));
  assertMovementsReconcile(store);
});

test('today stock receipts and sale consumption respect Malaysian date boundaries', t => {
  const store = fixture(t);
  const before = store.inventory().find(i => i.id === 'rice')!;
  assert.equal(before.receivedToday, 0);
  assert.equal(before.consumedToday, 0);
  store.restock('rice', { quantity: 2, unitCost: 2 });
  const previous = store.createOrder(request());
  store.pay(previous.id, 'cash', new Date('2026-10-22T15:59:00Z'));
  const today = store.createOrder(request());
  store.pay(today.id, 'cash', new Date('2026-10-22T16:00:00Z'));
  const current = store.inventory().find(i => i.id === 'rice')!;
  assert.equal(current.receivedToday, 2);
  assert.equal(current.consumedToday, 0.5);
  assert.equal(current.stock, 6);
  assertMovementsReconcile(store);
});
