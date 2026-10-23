import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { Store, AppError, type Period } from './store.js';
import { createInvoiceDraft } from './einvoice.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const periodOf = (input: unknown): Period => z.enum(['today', 'week', 'month']).default('today').parse(input);
const orderId = (req: Request) => String(req.params.id);
export function createApp(store: Store, options: { pin?: string; secureCookie?: boolean; aiKey?: string | null } = {}) {
  const app = express();
  const sessions = new Map<string, number>();
  const failedLogins = new Map<string, { failures: number; until: number }>();
  const pinHash = Buffer.from(hash(options.pin ?? process.env.STAFF_PIN ?? '2468'));
  app.disable('x-powered-by');
  app.use(express.json({ limit: '24kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  function session(req: Request) {
    const token = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('squarebox_session='))?.slice('squarebox_session='.length);
    if (!token) return false;
    const expires = sessions.get(hash(token));
    if (!expires || expires < Date.now()) { sessions.delete(hash(token)); return false; }
    return true;
  }
  const staff = (req: Request, _res: Response, next: NextFunction) => session(req) ? next() : next(new AppError('请先以店员身份登录', 401));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.is('application/json')) return next(new AppError('请使用 JSON 请求', 415));
      const origin = req.get('origin');
      const allowedOrigin = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== allowedOrigin) return next(new AppError('请求来源不受信任', 403));
    }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'The Square Box', demoMode: true }));
  app.get('/api/session', (req, res) => res.json({ authenticated: session(req), demoMode: true }));
  app.post('/api/auth/login', (req, res) => {
    const input = z.object({ pin: z.string().min(1).max(200) }).parse(req.body);
    const ip = req.ip ?? 'local';
    const attempts = failedLogins.get(ip);
    if (attempts && attempts.failures >= 8 && attempts.until > Date.now()) throw new AppError('尝试次数过多，请 15 分钟后重试', 429);
    if (!timingSafeEqual(Buffer.from(hash(input.pin)), pinHash)) {
      failedLogins.set(ip, { failures: attempts && attempts.until > Date.now() ? attempts.failures + 1 : 1, until: Date.now() + 15 * 60000 });
      throw new AppError('店员 PIN 不正确', 401);
    }
    failedLogins.delete(ip);
    const token = randomBytes(32).toString('hex');
    // Expired sessions are discarded; live sessions restart after server restart.
    for (const [key, expires] of sessions) if (expires < Date.now()) sessions.delete(key);
    sessions.set(hash(token), Date.now() + 12 * 3600000);
    res.cookie('squarebox_session', token, { httpOnly: true, sameSite: 'strict', secure: options.secureCookie ?? process.env.COOKIE_SECURE === 'true', maxAge: 12 * 3600000, path: '/' });
    res.json({ authenticated: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('squarebox_session='))?.slice(18);
    if (token) sessions.delete(hash(token));
    res.clearCookie('squarebox_session', { path: '/' }); res.json({ authenticated: false });
  });
  app.get('/api/guest/menu', (_req, res) => {
    const { restaurantName, currency, timeZone, taxRate, serviceChargeRate, demoMode } = store.settings();
    res.json({ settings: { restaurantName, currency, timeZone, taxRate, serviceChargeRate, demoMode }, menu: store.menu().map(({ cost: _cost, recipe: _recipe, ...publicItem }) => publicItem) });
  });
  // Guest tokens derive from high-entropy client request IDs; no private staff data is exposed.
  const guestTokenFor = (requestId: string) => createHash('sha256').update(guestSecret + requestId).digest('hex');
  let guestSecret = store.one('SELECT value FROM config WHERE key=?', 'guest-secret')?.value as string | undefined;
  if (!guestSecret) {
    guestSecret = randomBytes(32).toString('hex');
    store.db.prepare('INSERT INTO config VALUES (?,?)').run('guest-secret', guestSecret);
  }
  app.post('/api/guest/orders', (req, res) => {
    const id = z.string().uuid().parse(req.body.clientRequestId);
    const token = guestTokenFor(id);
    const order = store.createOrder({ ...req.body, channel: 'guest' }, hash(token));
    res.status(201).json({ order, checkoutToken: token });
  });
  app.post('/api/guest/orders/:id/pay', (req, res) => {
    const body = z.object({ checkoutToken: z.string().length(64), method: z.literal('demo_card') }).parse(req.body);
    const row = store.one('SELECT guest_token_hash FROM orders WHERE id=? AND channel=?', orderId(req), 'guest');
    if (!row?.guest_token_hash || !timingSafeEqual(Buffer.from(hash(body.checkoutToken)), Buffer.from(row.guest_token_hash))) throw new AppError('订单付款凭证无效', 403);
    try { res.json(store.pay(orderId(req), body.method)); }
    catch (error) { if (error instanceof AppError && error.status === 409) throw new AppError('餐点暂时无法完成付款，请联系柜台确认。', 409); throw error; }
  });
  app.use('/api', staff);
  app.get('/api/bootstrap', (req, res) => res.json(store.bootstrap(periodOf(req.query.period))));
  app.get('/api/reports', (req, res) => res.json(store.report(periodOf(req.query.period))));
  app.get('/api/reports/export', (req, res) => {
    const report = store.report(periodOf(req.query.period));
    const csv = ['Date,Net sales (MYR),Paid orders,Operating profit (MYR)', ...report.daily.map(d => `${d.date},${d.revenue.toFixed(2)},${d.orders},${d.profit.toFixed(2)}`), '', 'Metric,Amount (MYR)', `Net sales,${report.totals.revenue.toFixed(2)}`, `Cost of goods sold,${report.totals.cogs.toFixed(2)}`, `Operating expenses,${report.totals.expenses.toFixed(2)}`, `Operating profit,${report.totals.profit.toFixed(2)}`, `Tax collected,${report.totals.taxCollected.toFixed(2)}`, `Gross receipts,${report.totals.grossReceipts.toFixed(2)}`, '', 'DEMO DATA - NOT A STATUTORY ACCOUNTING REPORT'].join('\r\n');
    res.attachment(`squarebox-${report.startDate}-${report.endDate}.csv`).type('text/csv').send('\uFEFF' + csv);
  });
  app.get('/api/guest-qr', async (req, res) => {
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = new URL('/order', base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('PUBLIC_BASE_URL 必须为 HTTP 或 HTTPS 地址');
    res.json({ url: url.href, svg: await QRCode.toString(url.href, { type: 'svg', margin: 2, width: 256 }), localOnly: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) });
  });
  app.post('/api/menu', (req, res) => res.status(201).json({ menuItem: store.saveMenu(req.body) }));
  app.put('/api/menu/:id', (req, res) => res.json({ menuItem: store.saveMenu(req.body, orderId(req)) }));
  app.post('/api/inventory', (req, res) => res.status(201).json({ inventory: store.createInventory(req.body) }));
  app.post('/api/orders', (req, res) => res.status(201).json({ order: store.createOrder({ ...req.body, channel: 'counter' }) }));
  app.post('/api/orders/:id/pay', (req, res) => { const { method } = z.object({ method: z.enum(['cash', 'demo_card']) }).parse(req.body); res.json(store.pay(orderId(req), method)); });
  app.post('/api/orders/:id/cancel', (req, res) => res.json({ order: store.cancel(orderId(req)) }));
  app.post('/api/inventory/:id/restock', (req, res) => res.json({ inventory: store.restock(orderId(req), req.body) }));
  app.patch('/api/inventory/:id', (req, res) => res.json({ inventory: store.updateInventory(orderId(req), req.body) }));
  app.get('/api/inventory/:id/movements', (req, res) => res.json({ movements: store.rows('SELECT * FROM movements WHERE inventory_id=? ORDER BY created_at DESC LIMIT 100', orderId(req)) }));
  app.post('/api/expenses', (req, res) => res.status(201).json({ expense: store.expense(req.body) }));
  app.put('/api/settings', (req, res) => res.json({ settings: store.updateSettings(req.body) }));
  app.post('/api/orders/:id/einvoice', (req, res) => {
    const draft = createInvoiceDraft({ order: store.order(orderId(req)), settings: store.settings(), buyer: req.body.buyer ?? {} });
    store.db.prepare('INSERT INTO invoices VALUES (?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET buyer=excluded.buyer,draft=excluded.draft,updated_at=excluded.updated_at').run(orderId(req), JSON.stringify(draft.buyer), JSON.stringify(draft), new Date().toISOString());
    res.json({ draft });
  });
  app.get('/api/orders/:id/einvoice', (req, res) => {
    const row = store.one('SELECT draft FROM invoices WHERE order_id=?', orderId(req));
    if (!row) throw new AppError('请先保存发票草稿', 404);
    const draft = JSON.parse(row.draft);
    res.attachment(`${draft.draftReference}.json`).json(draft);
  });
  app.post('/api/agents/:id/analyze', async (req, res) => {
    const period = periodOf(req.body.period);
    const insight = store.insights(period).find(i => i.id === req.params.id);
    if (!insight) throw new AppError('找不到分析 Agent', 404);
    const aiKey = options.aiKey !== undefined ? options.aiKey : process.env.SQUAREBOX_AI_API_KEY || process.env.OPENAI_API_KEY;
    if (!aiKey) return res.json({ mode: 'rules', analysis: [insight.summary, ...insight.findings, ...insight.actions].join('\n\n') });
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ model: process.env.SQUAREBOX_AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini', temperature: 0.2, messages: [{ role: 'system', content: '你是马来西亚餐厅经营助理。仅解释给定的汇总数据，使用简体中文。不编造数字，不提供法定审计结论，不声称有未提供的数据。区分事实和建议。说明示例数据、经营利润并非法定净利润。你没有付款、进货或提交发票的权限。' }, { role: 'user', content: JSON.stringify({ insight, report: store.report(period), demoData: true }) }] }),
      });
      if (!response.ok) throw new Error(`AI provider ${response.status}`);
      const output = await response.json() as { choices?: { message?: { content?: string } }[] };
      const analysis = output.choices?.[0]?.message?.content;
      if (!analysis) throw new Error('AI returned no content');
      return res.json({ mode: 'ai', analysis });
    } catch { throw new AppError('AI 服务暂时无法使用；页面上的规则分析和财务数字仍可使用。请检查模型、凭证与网络配置。', 502); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'JSON 格式无效' });
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('Request failed:', error instanceof Error ? error.name : 'Unknown error');
    res.status(status).json({ error: status >= 500 && status !== 502 ? '服务暂时出现错误，请重试' : error.message });
  });
  return app;
}
