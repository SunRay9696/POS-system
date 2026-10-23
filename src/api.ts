export type Period = "today" | "week" | "month";
export type AgentId = "accounting" | "inventory" | "sales";
export interface Settings {
  restaurantName: string;
  currency: string;
  timeZone: string;
  taxRate: number;
  serviceChargeRate: number;
  demoMode: boolean;
  aiConfigured?: boolean;
}
export interface MenuItem {
  id: string;
  name: string;
  englishName: string;
  category: string;
  price: number;
  description: string;
  emoji: string;
  available: boolean;
  cost: number;
  recipe: { inventoryId: string; quantity: number }[];
}
export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  reorderPoint: number;
  targetStock: number;
  unitCost: number;
  supplier: string;
  receivedToday: number;
  consumedToday: number;
}
export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  paidAt: string | null;
  businessDate: string;
  status: "pending" | "paid" | "cancelled";
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  total: number;
  paymentMethod: string | null;
  channel: string;
  tableNumber: string;
  items: {
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
}
export interface Report {
  period: Period;
  startDate: string;
  endDate: string;
  totals: {
    revenue: number;
    cogs: number;
    expenses: number;
    profit: number;
    orders: number;
    averageOrderValue: number;
    taxCollected: number;
    grossReceipts: number;
  };
  daily: { date: string; revenue: number; orders: number; profit: number }[];
  topProducts: {
    id: string;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  expenseBreakdown: { category: string; total: number }[];
  payments: { method: string; total: number; count: number }[];
}
export interface Insight {
  id: AgentId;
  title: string;
  summary: string;
  findings: string[];
  actions: string[];
  mode: "rules";
}
export interface Bootstrap {
  settings: Settings;
  menu: MenuItem[];
  inventory: InventoryItem[];
  orders: Order[];
  report: Report;
  insights: Insight[];
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  const result = await response
    .json()
    .catch(() => ({ error: "服务器没有返回有效数据，请稍后重试。" }));
  if (!response.ok)
    throw new ApiError(
      result.error || `请求失败 (${response.status})`,
      response.status,
    );
  return result as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
