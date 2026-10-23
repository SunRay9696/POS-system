import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('员工 PIN').fill('2468');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: /经营有数/ })).toBeVisible();
}
async function navigate(page: Page, label: string) {
  const desktop = page.getByRole('navigation', { name: '主导航' });
  const mobile = page.getByRole('navigation', { name: '移动导航' });
  await (await desktop.isVisible() ? desktop : mobile).getByRole('button', { name: label }).click();
}
async function bootstrap(page: Page, period = 'week') {
  const response = await page.request.get(`/api/bootstrap?period=${period}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
}

test('staff checkout, inventory receipts, expense reports, rule agents and invoice draft work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await expect(page.locator('.demo-banner')).toContainText('演示数据');
  await expect(page.locator('.dashboard-agent')).toHaveCount(3);
  const before = await bootstrap(page);
  await page.screenshot({ path: '/tmp/squarebox-dashboard.png', fullPage: true });
  await noOverflow(page);

  await navigate(page, '点餐收银');
  await page.getByRole('button', { name: '添加招牌香烤鸡饭', exact: true }).click();
  await page.getByLabel('桌号 / 取餐备注').fill('E2E-01');
  await page.getByRole('button', { name: '现金记账', exact: true }).click();
  await page.getByRole('button', { name: /^确认收款/ }).click();
  await expect(page.locator('.order-success')).toContainText('示例收款完成');
  const afterSale = await bootstrap(page);
  expect(afterSale.report.totals.orders).toBe(before.report.totals.orders + 1);
  expect(afterSale.report.totals.revenue).toBeCloseTo(before.report.totals.revenue + 18.5, 2);
  expect(afterSale.inventory.find((i: any) => i.id === 'chicken').stock).toBeCloseTo(before.inventory.find((i: any) => i.id === 'chicken').stock - 0.18, 6);

  await page.getByRole('button', { name: 'e-Invoice 草稿', exact: true }).first().click();
  const invoiceDialog = page.getByRole('dialog', { name: 'e-Invoice 准备草稿' });
  await expect(invoiceDialog).toContainText('尚未提交');
  await invoiceDialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(invoiceDialog).toContainText('内部草稿已保存');
  const invoiceDownload = page.waitForEvent('download');
  await invoiceDialog.getByRole('link', { name: '下载 JSON 草稿' }).click();
  const invoice = JSON.parse(await readFile((await (await invoiceDownload).path())!, 'utf8'));
  expect(invoice.status).toBe('draft_not_submitted');
  expect(invoice.readiness.submittedToMyInvois).toBe(false);
  expect(invoice.amounts.total).toBe(18.5);
  await invoiceDialog.getByRole('button', { name: '关闭', exact: true }).first().click();

  await navigate(page, '库存管理');
  const chickenRow = page.getByRole('row').filter({ has: page.getByText('去骨鸡腿肉', { exact: true }) });
  await chickenRow.getByRole('button', { name: '入库', exact: true }).click();
  const restockDialog = page.getByRole('dialog', { name: '去骨鸡腿肉 · 采购入库' });
  await restockDialog.getByLabel('本次入库数量（kg）').fill('2');
  await restockDialog.getByLabel('采购备注').fill('E2E delivery receipt');
  await restockDialog.getByRole('button', { name: '确认入库' }).click();
  await expect(restockDialog).toBeHidden();
  const afterReceipt = await bootstrap(page);
  expect(afterReceipt.inventory.find((i: any) => i.id === 'chicken').stock).toBeCloseTo(afterSale.inventory.find((i: any) => i.id === 'chicken').stock + 2, 6);
  expect(afterReceipt.inventory.find((i: any) => i.id === 'chicken').receivedToday).toBe(2);
  expect(afterReceipt.report.totals.expenses).toBe(afterSale.report.totals.expenses);

  await navigate(page, '财务报表');
  await page.getByRole('button', { name: '记录费用', exact: true }).click();
  const expenseDialog = page.getByRole('dialog', { name: '记录一笔经营费用' });
  await expenseDialog.getByLabel('金额（MYR）').fill('12.50');
  await expenseDialog.getByLabel('费用类别').selectOption('水电');
  await expenseDialog.getByLabel('费用说明').fill('E2E electricity');
  await expenseDialog.getByRole('button', { name: '保存费用' }).click();
  await expect(expenseDialog).toBeHidden();
  const afterExpense = await bootstrap(page);
  expect(afterExpense.report.totals.profit).toBeCloseTo(afterReceipt.report.totals.profit - 12.5, 2);
  expect(afterExpense.report.totals.expenses).toBeCloseTo(afterReceipt.report.totals.expenses + 12.5, 2);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出 CSV' }).click();
  expect((await csvDownload).suggestedFilename()).toMatch(/squarebox-.*\.csv/);
  for (const label of ['今日', '本月', '本周']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.period-tab.active')).toHaveText(label);
  }

  await navigate(page, 'AI 经营助理');
  await expect(page.locator('.agent-card')).toHaveCount(3);
  await expect(page.locator('.agent-notice')).toContainText('当前使用规则分析');
  await page.getByRole('button', { name: '生成规则报告', exact: true }).first().click();
  await expect(page.locator('.generated-analysis')).toContainText('规则报告');
  await expect(page.locator('.generated-analysis')).toContainText('经营');
  await page.getByRole('button', { name: '扫码点餐', exact: true }).click();
  const qrDialog = page.getByRole('dialog', { name: '扫码点餐' });
  await expect(qrDialog.getByRole('img', { name: 'The Square Box 顾客点餐二维码' })).toBeVisible();
  await expect(qrDialog).toContainText('本机演示地址');
  expect(errors).toEqual([]);
});

test('customers can simulate electronic payment or leave cash orders pending for the counter', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname); });
  await page.goto('/order');
  await expect(page.getByRole('heading', { name: '今天，想吃点什么？' })).toBeVisible();
  await expect(page.locator('.demo-banner')).toContainText('不会产生真实扣款');
  await page.getByRole('button', { name: '添加招牌奶茶', exact: true }).click();
  await page.getByLabel('桌号 / 取餐备注').fill('GUEST-E2E');
  await page.getByRole('button', { name: '模拟电子支付', exact: true }).click();
  await page.getByRole('button', { name: /^确认收款/ }).click();
  await expect(page.locator('.order-success')).toContainText('示例收款完成');
  await expect(page.locator('.order-success')).toContainText('没有发生真实扣款');
  await page.getByRole('button', { name: '添加招牌奶茶', exact: true }).click();
  await page.getByRole('button', { name: '柜台付款', exact: true }).click();
  await page.getByRole('button', { name: /^提交订单 · 柜台付款/ }).click();
  await expect(page.locator('.order-success')).toContainText('订单提交成功');
  await expect(page.locator('.order-success')).toContainText('请向柜台出示订单编号并付款');
  expect(requests).not.toContain('/api/bootstrap');
  expect(requests).not.toContain('/api/reports');
  expect(requests).not.toContain('/api/inventory');
});

test('staff dashboard and customer ordering fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('navigation', { name: '移动导航' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: '/tmp/squarebox-mobile.png', fullPage: true });
  await navigate(page, '库存管理');
  await expect(page.getByRole('heading', { name: '厨房有底，出餐有数' })).toBeVisible();
  await noOverflow(page);
  await page.goto('/order');
  await expect(page.getByRole('heading', { name: '今天，想吃点什么？' })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: '添加冰拿铁', exact: true }).click();
  await expect(page.locator('.cart-item-name')).toHaveText('冰拿铁');
  await page.getByRole('button', { name: /^确认收款/ }).click();
  await expect(page.locator('.order-success')).toContainText('示例收款完成');
  await noOverflow(page);
});

test('new ingredients and recipe dishes can be created and sold with the configured price and base-unit deduction', async ({ page }) => {
  await login(page);
  const suffix = Date.now().toString(36);
  const ingredientName = `E2E 香菇 ${suffix}`;
  const dishName = `E2E 香菇饭 ${suffix}`;
  await navigate(page, '库存管理');
  await page.getByRole('button', { name: '新增物料', exact: true }).click();
  const ingredientDialog = page.getByRole('dialog', { name: '新增库存食材' });
  await ingredientDialog.getByLabel('食材名称 *', { exact: true }).fill(ingredientName);
  await ingredientDialog.getByLabel('库存基本单位').selectOption('kg');
  await ingredientDialog.getByLabel('期初库存（kg）', { exact: true }).fill('5');
  await ingredientDialog.getByLabel('成本单价（RM / kg）*', { exact: true }).fill('8');
  await ingredientDialog.getByLabel('补货提醒线（kg）', { exact: true }).fill('1');
  await ingredientDialog.getByLabel('目标库存（kg）*', { exact: true }).fill('10');
  await ingredientDialog.getByLabel('供应商', { exact: true }).fill('E2E produce supplier');
  await ingredientDialog.getByRole('button', { name: '新增食材', exact: true }).click();
  await expect(ingredientDialog).toBeHidden();
  const afterOpening = await bootstrap(page);
  const ingredient = afterOpening.inventory.find((item: any) => item.name === ingredientName);
  expect(ingredient.stock).toBe(5);
  expect(ingredient.unit).toBe('kg');

  await navigate(page, '点餐收银');
  await page.getByRole('button', { name: '菜单与配方', exact: true }).click();
  const catalogDialog = page.getByRole('dialog', { name: '菜单与食材配方' });
  await catalogDialog.getByLabel('餐点名称 *', { exact: true }).fill(dishName);
  await catalogDialog.getByLabel('英文名称', { exact: true }).fill('E2E Mushroom Bowl');
  await catalogDialog.getByLabel('分类 *').fill('主食');
  await catalogDialog.getByLabel('售价（RM）*', { exact: true }).fill('17.25');
  await catalogDialog.getByLabel('餐点说明', { exact: true }).fill('Test recipe uses 250g of mushroom per serving');
  await catalogDialog.getByLabel('食材 1').selectOption(ingredient.id);
  await catalogDialog.getByLabel('每份用量（kg）', { exact: true }).fill('0.25');
  await catalogDialog.getByRole('button', { name: '新增餐点', exact: true }).click();
  await expect(catalogDialog).toBeHidden();
  await page.getByRole('button', { name: `添加${dishName}`, exact: true }).click();
  await page.getByRole('button', { name: `增加${dishName}`, exact: true }).click();
  await expect(page.locator('.grand')).toContainText('RM 34.50');
  await page.getByRole('button', { name: '现金记账', exact: true }).click();
  await page.getByRole('button', { name: /^确认收款/ }).click();
  await expect(page.locator('.order-success')).toContainText('RM 34.50');
  const afterSale = await bootstrap(page);
  expect(afterSale.inventory.find((item: any) => item.id === ingredient.id).stock).toBe(4.5);
  expect(afterSale.report.totals.revenue).toBeCloseTo(afterOpening.report.totals.revenue + 34.5, 2);
  expect(afterSale.report.totals.cogs).toBeCloseTo(afterOpening.report.totals.cogs + 4, 2);
});
