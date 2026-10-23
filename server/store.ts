import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const money = (sen: number) => Number((sen / 100).toFixed(2));
const roundQty = (n: number) => Number(n.toFixed(6));
const cents = (n: number) => Math.round(n * 100);
type Row = Record<string, any>;
export type Period = 'today' | 'week' | 'month';
export const orderSchema = z.object({
  clientRequestId: z.string().min(8).max(100),
  items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
  tableNumber: z.string().max(30).default(''),
  channel: z.enum(['counter', 'guest']).default('counter'),
});
export function businessDate(date: Date, timeZone = 'Asia/Kuala_Lumpur') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function periodRange(period: Period, now: Date, timeZone: string) {
  const endDate = businessDate(now, timeZone);
  const start = new Date(endDate + 'T12:00:00Z');
  if (period === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === 'month') start.setUTCDate(1);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
function validDate(value: string) {
  const parsed = new Date(value + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new AppError('日期格式无效');
  return value;
}
export class Store {
  db: DatabaseSync;
  constructor(filename: string, seed = true, public now: () => Date = () => new Date()) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, stock REAL NOT NULL CHECK(stock>=0), reorder_point REAL NOT NULL, target_stock REAL NOT NULL, unit_cost INTEGER NOT NULL, supplier TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS menu (id TEXT PRIMARY KEY, name TEXT NOT NULL, english_name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL, description TEXT NOT NULL, emoji TEXT NOT NULL, recipe TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, order_number TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, paid_at TEXT, business_date TEXT, status TEXT NOT NULL, subtotal INTEGER NOT NULL, service_charge INTEGER NOT NULL, tax_amount INTEGER NOT NULL, total INTEGER NOT NULL, cogs INTEGER NOT NULL DEFAULT 0, payment_method TEXT, channel TEXT NOT NULL, table_number TEXT NOT NULL, guest_token_hash TEXT, demo INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), menu_id TEXT NOT NULL REFERENCES menu(id), name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, line_total INTEGER NOT NULL, unit_cogs INTEGER NOT NULL DEFAULT 0, recipe TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, inventory_id TEXT NOT NULL REFERENCES inventory(id), order_id TEXT REFERENCES orders(id), quantity REAL NOT NULL, unit_cost INTEGER NOT NULL, kind TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoices (order_id TEXT PRIMARY KEY REFERENCES orders(id), buyer TEXT NOT NULL, draft TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    if (!this.db.prepare('SELECT 1 FROM config WHERE key=?').get('settings')) {
      this.db.prepare('INSERT INTO config VALUES (?, ?)').run('settings', JSON.stringify({ restaurantName: 'The Square Box', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur', taxRate: 0, serviceChargeRate: 0, demoMode: true }));
    }
    if (seed && !(this.db.prepare('SELECT 1 FROM menu LIMIT 1').get())) this.seed();
  }
  close() { this.db.close(); }
  rows(sql: string, ...args: (string | number | null)[]) { return this.db.prepare(sql).all(...args) as Row[]; }
  one(sql: string, ...args: (string | number | null)[]) { return this.db.prepare(sql).get(...args) as Row | undefined; }
  tx<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  settings() { return { ...JSON.parse(this.one('SELECT value FROM config WHERE key=?', 'settings')!.value), aiConfigured: Boolean(process.env.SQUAREBOX_AI_API_KEY || process.env.OPENAI_API_KEY) }; }
  updateSettings(input: unknown) {
    const value = z.object({ restaurantName: z.string().trim().min(1).max(80), currency: z.literal('MYR'), timeZone: z.literal('Asia/Kuala_Lumpur'), taxRate: z.number().min(0).max(0.3), serviceChargeRate: z.literal(0) }).parse(input);
    this.db.prepare('UPDATE config SET value=? WHERE key=?').run(JSON.stringify({ ...value, demoMode: true }), 'settings');
    return this.settings();
  }
  inventory() {
    const start = new Date(businessDate(this.now()) + 'T00:00:00+08:00');
    const end = new Date(start.getTime() + 86400000);
    const daily = new Map(this.rows(`SELECT inventory_id,SUM(CASE WHEN kind='receipt' THEN quantity ELSE 0 END) AS received,SUM(CASE WHEN kind='sale' THEN -quantity ELSE 0 END) AS consumed FROM movements WHERE created_at>=? AND created_at<? GROUP BY inventory_id`, start.toISOString(), end.toISOString()).map(r => [r.inventory_id, r]));
    return this.rows('SELECT * FROM inventory ORDER BY name').map(r => ({ id: r.id, name: r.name, unit: r.unit, stock: r.stock, reorderPoint: r.reorder_point, targetStock: r.target_stock, unitCost: money(r.unit_cost), supplier: r.supplier, receivedToday: roundQty(daily.get(r.id)?.received ?? 0), consumedToday: roundQty(daily.get(r.id)?.consumed ?? 0) }));
  }
  menu() {
    const stocks = new Map(this.inventory().map(i => [i.id, i]));
    return this.rows('SELECT * FROM menu ORDER BY rowid').map(r => {
      const recipe = JSON.parse(r.recipe) as { inventoryId: string; quantity: number }[];
      return { id: r.id, name: r.name, englishName: r.english_name, category: r.category, price: money(r.price), description: r.description, emoji: r.emoji, recipe, available: recipe.every(i => (stocks.get(i.inventoryId)?.stock ?? 0) >= i.quantity), cost: Number(recipe.reduce((s, i) => s + i.quantity * (stocks.get(i.inventoryId)?.unitCost ?? 0), 0).toFixed(2)) };
    });
  }
  order(id: string) {
    const r = this.one('SELECT * FROM orders WHERE id=?', id);
    if (!r) throw new AppError('找不到订单', 404);
    return { id: r.id, orderNumber: r.order_number, createdAt: r.created_at, paidAt: r.paid_at, businessDate: r.business_date, status: r.status, subtotal: money(r.subtotal), serviceCharge: money(r.service_charge), taxAmount: money(r.tax_amount), total: money(r.total), paymentMethod: r.payment_method, channel: r.channel, tableNumber: r.table_number, demo: Boolean(r.demo), items: this.rows('SELECT * FROM order_items WHERE order_id=?', id).map(i => ({ menuItemId: i.menu_id, name: i.name, quantity: i.quantity, unitPrice: money(i.unit_price), lineTotal: money(i.line_total) })) };
  }
  orders() { return this.rows("SELECT id FROM orders ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 60").map(r => this.order(r.id)); }
  saveMenu(input: unknown, id?: string) {
    const data = z.object({
      name: z.string().trim().min(1).max(80), englishName: z.string().trim().min(1).max(100),
      category: z.string().trim().min(1).max(30), price: z.number().positive().max(10000),
      description: z.string().max(300), emoji: z.string().min(1).max(12),
      recipe: z.array(z.object({ inventoryId: z.string().min(1), quantity: z.number().min(0.000001).max(10000) })).min(1).max(40),
    }).parse(input);
    if (Math.abs(data.price * 100 - cents(data.price)) > 0.000001) throw new AppError('售价最多两位小数');
    if (new Set(data.recipe.map(r => r.inventoryId)).size !== data.recipe.length) throw new AppError('配方中同一食材请合并为一行');
    for (const ingredient of data.recipe) if (!this.one('SELECT 1 FROM inventory WHERE id=?', ingredient.inventoryId)) throw new AppError('配方食材不存在');
    if (id && !this.one('SELECT 1 FROM menu WHERE id=?', id)) throw new AppError('餐品不存在', 404);
    const menuId = id || randomUUID();
    const values = [data.name, data.englishName, data.category, cents(data.price), data.description, data.emoji, JSON.stringify(data.recipe)];
    if (id) this.db.prepare('UPDATE menu SET name=?,english_name=?,category=?,price=?,description=?,emoji=?,recipe=? WHERE id=?').run(...values, menuId);
    else this.db.prepare('INSERT INTO menu(name,english_name,category,price,description,emoji,recipe,id) VALUES (?,?,?,?,?,?,?,?)').run(...values, menuId);
    return this.menu().find(m => m.id === menuId)!;
  }
  createInventory(input: unknown) {
    const data = z.object({ name: z.string().trim().min(1).max(80), unit: z.enum(['kg','L','个']), stock: z.number().nonnegative().max(100000), unitCost: z.number().nonnegative().max(100000), reorderPoint: z.number().nonnegative().max(100000), targetStock: z.number().positive().max(100000), supplier: z.string().max(120) }).refine(d => d.targetStock >= d.reorderPoint, '目标库存不能低于补货线').parse(input);
    if (Math.abs(data.unitCost * 100 - cents(data.unitCost)) > 0.000001) throw new AppError('单价最多两位小数');
    const id = randomUUID();
    return this.tx(() => {
      this.db.prepare('INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?)').run(id,data.name,data.unit,roundQty(data.stock),data.reorderPoint,data.targetStock,cents(data.unitCost),data.supplier);
      this.db.prepare('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,roundQty(data.stock),cents(data.unitCost),'opening','新增食材期初盘点',this.now().toISOString());
      return this.inventory().find(i => i.id === id)!;
    });
  }

  createOrder(input: unknown, guestTokenHash: string | null = null) {
    const data = orderSchema.parse(input);
    const merged = new Map<string, number>();
    for (const i of data.items) merged.set(i.menuItemId, (merged.get(i.menuItemId) ?? 0) + i.quantity);
    const items = [...merged].sort(([a], [b]) => a.localeCompare(b));
    if (items.some(([, q]) => q > 99)) throw new AppError('单品数量上限为 99');
    const fingerprint = createHash('sha256').update(JSON.stringify({ items, table: data.tableNumber, channel: data.channel })).digest('hex');
    return this.tx(() => {
      const existing = this.one('SELECT id,fingerprint,guest_token_hash FROM orders WHERE request_id=?', data.clientRequestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.guest_token_hash !== guestTokenHash) throw new AppError('重复请求编号与订单内容不一致', 409);
        return this.order(existing.id);
      }
      const lines = items.map(([id, quantity]) => { const m = this.one('SELECT * FROM menu WHERE id=?', id); if (!m) throw new AppError('餐品不存在'); return { m, quantity }; });
      const subtotal = lines.reduce((sum, { m, quantity }) => sum + m.price * quantity, 0);
      const settings = this.settings();
      const service = Math.round(subtotal * settings.serviceChargeRate);
      const tax = Math.round((subtotal + service) * settings.taxRate);
      const id = randomUUID();
      const sequence = Number(this.one('SELECT count(*) AS n FROM orders')!.n) + 1;
      const number = `SB-${businessDate(this.now()).replaceAll('-', '')}-${String(sequence).padStart(4, '0')}`;
      this.db.prepare('INSERT INTO orders (id,request_id,fingerprint,order_number,created_at,status,subtotal,service_charge,tax_amount,total,channel,table_number,guest_token_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, data.clientRequestId, fingerprint, number, this.now().toISOString(), 'pending', subtotal, service, tax, subtotal + service + tax, data.channel, data.tableNumber, guestTokenHash);
      for (const { m, quantity } of lines) this.db.prepare('INSERT INTO order_items(order_id,menu_id,name,quantity,unit_price,line_total,recipe) VALUES (?,?,?,?,?,?,?)').run(id, m.id, m.name, quantity, m.price, m.price * quantity, m.recipe);
      return this.order(id);
    });
  }
  pay(id: string, method: 'cash' | 'demo_card', at = this.now()) {
    return this.tx(() => {
      const order = this.one('SELECT * FROM orders WHERE id=?', id);
      if (!order) throw new AppError('找不到订单', 404);
      if (order.status === 'paid') return { order: this.order(id), alreadyPaid: true };
      if (order.status !== 'pending') throw new AppError('订单已取消，无法付款', 409);
      const requirements = new Map<string, number>();
      let cogs = 0;
      for (const line of this.rows('SELECT * FROM order_items WHERE order_id=?', id)) {
        let unitCogs = 0;
        for (const item of JSON.parse(line.recipe)) {
          const stock = this.one('SELECT * FROM inventory WHERE id=?', item.inventoryId);
          if (!stock) throw new AppError('食材配置不存在', 409);
          requirements.set(stock.id, roundQty((requirements.get(stock.id) ?? 0) + item.quantity * line.quantity));
          unitCogs += item.quantity * stock.unit_cost;
        }
        const roundedCost = Math.round(unitCogs);
        cogs += roundedCost * line.quantity;
        this.db.prepare('UPDATE order_items SET unit_cogs=? WHERE id=?').run(roundedCost, line.id);
      }
      for (const [inventoryId, required] of requirements) {
        const stock = this.one('SELECT * FROM inventory WHERE id=?', inventoryId)!;
        if (stock.stock + 0.000001 < required) throw new AppError(`${stock.name} 库存不足（需要 ${required} ${stock.unit}，现有 ${stock.stock}）`, 409);
        this.db.prepare('UPDATE inventory SET stock=? WHERE id=?').run(roundQty(stock.stock - required), inventoryId);
        this.db.prepare('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), inventoryId, id, -required, stock.unit_cost, 'sale', '订单配方扣料', at.toISOString());
      }
      this.db.prepare('UPDATE orders SET status=?,paid_at=?,business_date=?,cogs=?,payment_method=? WHERE id=?').run('paid', at.toISOString(), businessDate(at, this.settings().timeZone), cogs, method, id);
      return { order: this.order(id), alreadyPaid: false };
    });
  }
  cancel(id: string) {
    const order = this.order(id);
    if (order.status !== 'pending') throw new AppError('只能取消待付款订单', 409);
    this.db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(id);
    return this.order(id);
  }
  restock(id: string, input: unknown) {
    const data = z.object({ quantity: z.number().positive().max(100000), unitCost: z.number().nonnegative().max(100000).optional(), notes: z.string().max(300).default('') }).parse(input);
    if (data.unitCost !== undefined && Math.abs(data.unitCost * 100 - cents(data.unitCost)) > 0.000001) throw new AppError('单价最多两位小数');
    if (data.quantity < 0.000001) throw new AppError('入库数量太小');
    return this.tx(() => {
      const row = this.one('SELECT * FROM inventory WHERE id=?', id);
      if (!row) throw new AppError('找不到食材', 404);
      const receiptCost = data.unitCost === undefined ? row.unit_cost : cents(data.unitCost);
      const nextStock = roundQty(row.stock + data.quantity);
      const averageCost = Math.round((row.stock * row.unit_cost + data.quantity * receiptCost) / nextStock);
      this.db.prepare('UPDATE inventory SET stock=?,unit_cost=? WHERE id=?').run(nextStock, averageCost, id);
      this.db.prepare('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, null, data.quantity, receiptCost, 'receipt', data.notes, this.now().toISOString());
      return this.inventory().find(r => r.id === id)!;
    });
  }
  updateInventory(id: string, input: unknown) {
    const data = z.object({ reorderPoint: z.number().nonnegative().max(100000), targetStock: z.number().positive().max(100000) }).refine(x => x.targetStock >= x.reorderPoint, '目标库存不能低于补货线').parse(input);
    if (!this.one('SELECT 1 FROM inventory WHERE id=?', id)) throw new AppError('找不到食材', 404);
    this.db.prepare('UPDATE inventory SET reorder_point=?,target_stock=? WHERE id=?').run(data.reorderPoint, data.targetStock, id);
    return this.inventory().find(r => r.id === id)!;
  }
  expense(input: unknown) {
    const data = z.object({ amount: z.number().positive().max(1000000), category: z.enum(['租金', '人工', '水电', '营销', '其他']), description: z.string().trim().min(1).max(300), date: z.string() }).parse(input);
    validDate(data.date);
    const amount = cents(data.amount);
    if (Math.abs(data.amount * 100 - amount) > 0.000001) throw new AppError('金额最多两位小数');
    if (amount <= 0) throw new AppError('费用必须至少 RM 0.01');
    const id = randomUUID();
    this.db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?,?)').run(id, data.date, data.category, data.description, amount, this.now().toISOString());
    return { id, ...data, amount: money(amount) };
  }
  report(period: Period, now = this.now()) {
    const settings = this.settings();
    const { startDate, endDate } = periodRange(period, now, settings.timeZone);
    const paid = this.rows("SELECT * FROM orders WHERE status='paid' AND business_date BETWEEN ? AND ?", startDate, endDate);
    const expenses = this.rows('SELECT * FROM expenses WHERE date BETWEEN ? AND ?', startDate, endDate);
    const revenue = paid.reduce((s, o) => s + o.subtotal + o.service_charge, 0);
    const cogs = paid.reduce((s, o) => s + o.cogs, 0);
    const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const daily = [];
    for (let d = new Date(startDate + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10), orders = paid.filter(o => o.business_date === date);
      const sales = orders.reduce((s, o) => s + o.subtotal + o.service_charge, 0);
      daily.push({ date, revenue: money(sales), orders: orders.length, profit: money(sales - orders.reduce((s, o) => s + o.cogs, 0) - expenses.filter(e => e.date === date).reduce((s, e) => s + e.amount, 0)) });
    }
    const products = this.rows("SELECT i.menu_id AS id,i.name,SUM(i.quantity) AS quantity,SUM(i.line_total) AS revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='paid' AND o.business_date BETWEEN ? AND ? GROUP BY i.menu_id,i.name ORDER BY quantity DESC,revenue DESC,i.menu_id", startDate, endDate).map(p => ({ id: String(p.id), name: String(p.name), quantity: Number(p.quantity), revenue: money(p.revenue) }));
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0 }));
    for (const o of paid) { const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: settings.timeZone }).format(new Date(o.paid_at))); hourly[hour].orders++; hourly[hour].revenue += o.subtotal + o.service_charge; }
    return {
      period, startDate, endDate,
      totals: { revenue: money(revenue), cogs: money(cogs), expenses: money(expenseTotal), profit: money(revenue - cogs - expenseTotal), orders: paid.length, averageOrderValue: money(paid.length ? Math.round(revenue / paid.length) : 0), grossReceipts: money(paid.reduce((s, o) => s + o.total, 0)), taxCollected: money(paid.reduce((s, o) => s + o.tax_amount, 0)) },
      daily, topProducts: products, hourly: hourly.map(h => ({ ...h, revenue: money(h.revenue) })),
      expenseBreakdown: this.rows('SELECT category,SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category', startDate, endDate).map(e => ({ ...e, total: money(e.total) })),
      payments: this.rows("SELECT payment_method AS method,SUM(total) AS total,COUNT(*) AS count FROM orders WHERE status='paid' AND business_date BETWEEN ? AND ? GROUP BY payment_method", startDate, endDate).map(p => ({ ...p, total: money(p.total) })),
    };
  }
  insights(period: Period) {
    const r = this.report(period), t = r.totals;
    const low = this.inventory().filter(i => i.stock <= i.reorderPoint);
    const peak = [...r.hourly].sort((a, b) => b.orders - a.orders || a.hour - b.hour)[0];
    const best = r.topProducts[0];
    const rm = (n: number) => `RM ${n.toFixed(2)}`;
    return [
      { id: 'accounting', title: '财务 Agent', mode: 'rules', summary: `${r.startDate} 至 ${r.endDate}：${t.profit >= 0 ? '经营盈利' : '经营亏损'} ${rm(Math.abs(t.profit))}`, findings: [`净销售额 ${rm(t.revenue)}，已付款订单 ${t.orders} 单。`, `销售成本 ${rm(t.cogs)}，经营费用 ${rm(t.expenses)}。`, `经营利润 = 净销售额 − 销售成本 − 经营费用；不含所得税、折旧和未录入费用。`], actions: ['每天补录租金分摊、人工和水电等费用，避免高估利润。', '进货记入库存，销售时按配方计入成本，避免重复扣费。'] },
      { id: 'inventory', title: '库存 Agent', mode: 'rules', summary: low.length ? `${low.length} 项食材达到补货线` : '所有食材均高于补货线', findings: low.length ? low.map(i => `${i.name}：现存 ${i.stock} ${i.unit}，补货线 ${i.reorderPoint} ${i.unit}。`) : ['目前无需紧急补货。'], actions: low.length ? low.map(i => `建议补入 ${roundQty(Math.max(0, i.targetStock - i.stock))} ${i.unit} ${i.name}，达到目标库存。`) : ['每天盘点易腐食材，并记录入库。'] },
      { id: 'sales', title: '营业分析 Agent', mode: 'rules', summary: best ? `销量第一：${best.name}，共 ${best.quantity} 份` : '当前期间还没有已付款订单', findings: t.orders ? [`最繁忙时段：${String(peak.hour).padStart(2, '0')}:00–${String(peak.hour + 1).padStart(2, '0')}:00，共 ${peak.orders} 单。`, `平均每单净销售额 ${rm(t.averageOrderValue)}。`, '高峰根据付款时间推算，不代表实际到店人数。'] : ['录入并收款后将自动生成销售与高峰分析。'], actions: best ? [`在高峰时段前备好 ${best.name} 所需食材。`, '结合近期销量安排人员；这些结论是历史观察，并非销量预测。'] : ['先完成一笔订单以开始分析。'] },
    ];
  }
  bootstrap(period: Period) { return { settings: this.settings(), menu: this.menu(), inventory: this.inventory(), orders: this.orders(), report: this.report(period), insights: this.insights(period) }; }
  seed() {
    this.tx(() => {
      const ingredients: [string, string, string, number, number, number, number, string][] = [
        ['chicken', '去骨鸡腿肉', 'kg', 160, 5, 20, 1800, 'Fresh Farm 肉类供应'],
        ['rice', '香米', 'kg', 180, 10, 30, 480, '本地粮油批发'],
        ['pasta', '意大利面', 'kg', 110, 5, 15, 750, 'Kitchen Pantry'],
        ['beef', '牛肉饼', '个', 250, 15, 50, 420, 'Fresh Farm 肉类供应'],
        ['bun', '汉堡面包', '个', 250, 20, 60, 130, 'Daily Bake'],
        ['vegetables', '时蔬', 'kg', 150, 4, 15, 680, 'Green Market'],
        ['coffee', '咖啡豆', 'kg', 30, 1.5, 5, 6800, 'Roast & Co.'],
        ['milk', '鲜牛奶', 'L', 140, 8, 25, 720, 'Dairy Fresh'],
        ['tea', '茶叶', 'kg', 10, 0.4, 1.5, 4200, '本地粮油批发'],
        ['sauce', '自制酱汁', 'L', 50, 2, 8, 1200, '中央厨房'],
      ];
      for (const [id, name, unit, stock, reorder, target, unitCost, supplier] of ingredients) {
        this.db.prepare('INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?)').run(id, name, unit, stock, reorder, target, unitCost, supplier);
        this.db.prepare('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, null, stock, unitCost, 'opening', '示例期初库存', new Date(new Date(businessDate(this.now()) + 'T00:00:00+08:00').getTime() - 29 * 86400000).toISOString());
      }
      const menus = [
        { id: 'chicken-rice', name: '招牌香烤鸡饭', en: 'Signature Chicken Bowl', cat: '主食', price: 1850, desc: '香烤鸡腿 · 香米 · 时蔬 · 秘制酱汁', emoji: '🍗', recipe: { chicken: 0.18, rice: 0.1, vegetables: 0.08, sauce: 0.03 } },
        { id: 'pasta', name: '奶油鸡肉意面', en: 'Creamy Chicken Pasta', cat: '主食', price: 2290, desc: '嫩鸡肉 · 奶油酱 · 意大利面', emoji: '🍝', recipe: { chicken: 0.12, pasta: 0.12, milk: 0.08, sauce: 0.04 } },
        { id: 'burger', name: '经典牛肉汉堡', en: 'The Square Burger', cat: '主食', price: 2490, desc: '香煎牛肉饼 · 松软面包 · 新鲜蔬菜', emoji: '🍔', recipe: { beef: 1, bun: 1, vegetables: 0.06, sauce: 0.02 } },
        { id: 'salad', name: '田园轻食沙拉', en: 'Garden Greens', cat: '轻食', price: 1490, desc: '每日时蔬 · 自制清爽酱汁', emoji: '🥗', recipe: { vegetables: 0.25, sauce: 0.03 } },
        { id: 'latte', name: '冰拿铁', en: 'Iced Latte', cat: '饮品', price: 1190, desc: '双份浓缩 · 香滑鲜奶', emoji: '☕', recipe: { coffee: 0.018, milk: 0.2 } },
        { id: 'milk-tea', name: '招牌奶茶', en: 'House Milk Tea', cat: '饮品', price: 890, desc: '浓香红茶 · 鲜奶 · 门店招牌', emoji: '🧋', recipe: { tea: 0.008, milk: 0.16 } },
      ];
      for (const m of menus) this.db.prepare('INSERT INTO menu VALUES (?,?,?,?,?,?,?,?)').run(m.id, m.name, m.en, m.cat, m.price, m.desc, m.emoji, JSON.stringify(Object.entries(m.recipe).map(([inventoryId, quantity]) => ({ inventoryId, quantity }))));
    });
    // Seed paid demo orders using exactly the same payment/inventory path as real work.
    const today = businessDate(this.now());
    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date(today + 'T00:00:00+08:00');
      date.setUTCDate(date.getUTCDate() - offset);
      for (let n = 0; n < 12 + (offset % 8); n++) {
        const at = new Date(date.getTime() + (n % 3 === 0 ? 12 : n % 3 === 1 ? 13 : 18) * 3600000 + (n * 7 % 60) * 60000);
        if (at > this.now()) continue;
        const mains = ['chicken-rice', 'chicken-rice', 'pasta', 'burger', 'salad'];
        const order = this.createOrder({ clientRequestId: `demo-${offset}-${n}-order`, items: [{ menuItemId: mains[(n + offset) % mains.length], quantity: 1 + (n % 5 === 0 ? 1 : 0) }, { menuItemId: n % 2 ? 'latte' : 'milk-tea', quantity: 1 }], tableNumber: String(n % 8 + 1), channel: n % 2 ? 'counter' : 'guest' });
        this.db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(new Date(at.getTime() - 5 * 60000).toISOString(), order.id);
        this.pay(order.id, n % 3 === 0 ? 'cash' : 'demo_card', at);
      }
      if (date <= this.now()) {
        const day = businessDate(date);
        this.expense({ amount: 120, category: '人工', description: '示例每日人工分摊', date: day });
        this.expense({ amount: 70, category: '租金', description: '示例每日租金分摊', date: day });
        this.expense({ amount: 18, category: '水电', description: '示例每日水电分摊', date: day });
      }
    }
    // Demonstrate replenishment alerts with auditable demo spoilage/count adjustments.
    for (const [id, desired] of [['chicken', 3.2], ['coffee', 1.1], ['milk', 6.5]] as [string, number][]) {
      const row = this.one('SELECT * FROM inventory WHERE id=?', id)!;
      const diff = roundQty(desired - row.stock);
      this.db.prepare('UPDATE inventory SET stock=? WHERE id=?').run(desired, id);
      this.db.prepare('INSERT INTO movements VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, null, diff, row.unit_cost, 'demo_adjustment', '示例盘点调整：用于展示低库存提醒；非真实损耗', this.now().toISOString());
    }
  }
}
