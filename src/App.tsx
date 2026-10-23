import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";
import CatalogManager from "./CatalogManager";
import IngredientCreate from "./IngredientCreate";
import {
  ApiError,
  api,
  post,
  type AgentId,
  type Bootstrap,
  type Insight,
  type InventoryItem,
  type MenuItem,
  type Order,
  type Period,
  type Report,
  type Settings,
} from "./api";

type Page = "dashboard" | "pos" | "inventory" | "reports" | "agents";
type OrderingData = Pick<Bootstrap, "settings" | "menu"> & { orders?: Order[] };
type CartItem = { item: MenuItem; quantity: number };
const periods: { id: Period; label: string }[] = [
  { id: "today", label: "今日" },
  { id: "week", label: "本周" },
  { id: "month", label: "本月" },
];
const navItems = [
  {
    id: "dashboard" as Page,
    label: "经营总览",
    english: "Overview",
    icon: LayoutDashboard,
  },
  {
    id: "pos" as Page,
    label: "点餐收银",
    english: "Point of sale",
    icon: UtensilsCrossed,
  },
  {
    id: "inventory" as Page,
    label: "库存管理",
    english: "Inventory",
    icon: Package,
  },
  {
    id: "reports" as Page,
    label: "财务报表",
    english: "Reports",
    icon: BarChart3,
  },
  {
    id: "agents" as Page,
    label: "AI 经营助理",
    english: "AI assistants",
    icon: Sparkles,
  },
];
const agentMeta = {
  accounting: {
    label: "财务助理",
    english: "Finance",
    icon: Wallet,
    color: "#e9f0e8",
  },
  inventory: {
    label: "库存助理",
    english: "Inventory",
    icon: Package,
    color: "#f7ebde",
  },
  sales: {
    label: "营业分析师",
    english: "Business insights",
    icon: TrendingUp,
    color: "#eeeafa",
  },
};
const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const precise = (n: number) => Number(n.toFixed(3)).toLocaleString("zh-CN");
function money(value: number, currency = "MYR") {
  try {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`brand ${dark ? "brand-dark" : ""}`}>
      <div className="brand-mark">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div>
        <div className="brand-title">THE SQUARE BOX</div>
        <div className="brand-subtitle">用心经营 · 每一餐</div>
      </div>
    </div>
  );
}
function PeriodTabs({
  period,
  setPeriod,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
}) {
  return (
    <div className="period-tabs" aria-label="报表周期">
      {periods.map((p) => (
        <button
          className={`period-tab ${period === p.id ? "active" : ""}`}
          key={p.id}
          onClick={() => setPeriod(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeHandler = useRef(close);
  closeHandler.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandler.current();
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button
            ref={closeRef}
            className="icon-button"
            onClick={close}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function RevenueChart({
  report,
  currency,
}: {
  report: Report;
  currency: string;
}) {
  const values = report.daily;
  const max = Math.max(...values.map((v) => v.revenue), 1);
  const width = 680,
    height = 210,
    left = 0,
    top = 20,
    graphHeight = 160;
  const points = values.map((v, i) => [
    left + (i * width) / Math.max(values.length - 1, 1),
    top + graphHeight - (v.revenue / max) * graphHeight,
  ]);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`)
    .join(" ");
  const fill = points.length
    ? `${path} L${points.at(-1)![0]},${height} L0,${height} Z`
    : "";
  return (
    <div className="chart-wrap">
      <div className="chart-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((n) => (
          <span key={n}>{money(max * n, currency).replace(/\.00$/, "")}</span>
        ))}
      </div>
      <div className="chart-main">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${report.startDate} 至 ${report.endDate} 每日营业额趋势`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chart-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#bd7459" stopOpacity=".2" />
              <stop offset="100%" stopColor="#bd7459" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((n) => (
            <line
              key={n}
              x1="0"
              x2={width}
              y1={top + graphHeight * n}
              y2={top + graphHeight * n}
              stroke="#efefeb"
              strokeDasharray="4 5"
            />
          ))}
          <path d={fill} fill="url(#chart-area)" />
          <path
            d={path}
            fill="none"
            stroke="#b66d51"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.length <= 8 &&
            points.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r="4"
                fill="white"
                stroke="#b66d51"
                strokeWidth="2"
              >
                <title>
                  {values[i].date}：{money(values[i].revenue, currency)}
                </title>
              </circle>
            ))}
        </svg>
        <div className="chart-labels">
          {values
            .filter(
              (_, i) =>
                values.length <= 8 ||
                i % Math.ceil(values.length / 7) === 0 ||
                i === values.length - 1,
            )
            .map((v) => (
              <span key={v.date}>{v.date.slice(5).replace("-", "/")}</span>
            ))}
        </div>
      </div>
    </div>
  );
}
function StatCards({ report, currency }: { report: Report; currency: string }) {
  const { totals } = report;
  const cards = [
    {
      label: "营业收入",
      value: money(totals.revenue, currency),
      icon: CircleDollarSign,
      detail: "已收款订单 · 不含代收税",
      tone: "green",
    },
    {
      label: "完成订单",
      value: totals.orders.toLocaleString(),
      suffix: "单",
      icon: ShoppingBag,
      detail: "每一份好味道，都有记录",
      tone: "orange",
    },
    {
      label: "平均客单价",
      value: money(totals.averageOrderValue, currency),
      icon: CreditCard,
      detail: "营业收入 ÷ 完成订单",
      tone: "purple",
    },
    {
      label: "经营利润",
      value: money(totals.profit, currency),
      icon: TrendingUp,
      detail: "净销售额 − 食材成本 − 费用",
      tone: "green",
    },
  ];
  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <div className="stat-card" key={card.label}>
          <div className="stat-top">
            <span className="stat-label">{card.label}</span>
            <span className={`stat-icon ${card.tone}`}>
              <card.icon size={18} />
            </span>
          </div>
          <div className="stat-value">
            {card.value}
            {card.suffix && <small>{card.suffix}</small>}
          </div>
          <div className="stat-foot">{card.detail}</div>
        </div>
      ))}
    </div>
  );
}
function TopProducts({
  report,
  currency,
}: {
  report: Report;
  currency: string;
}) {
  const max = Math.max(...report.topProducts.map((p) => p.quantity), 1);
  return (
    <div className="top-products">
      {report.topProducts.length ? (
        report.topProducts.slice(0, 5).map((p, i) => (
          <div className="top-product-row" key={p.id}>
            <span className={`rank ${i === 0 ? "rank-first" : ""}`}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="top-product-info">
              <div className="top-product-label">
                <strong>{p.name}</strong>
                <span>{p.quantity} 份</span>
              </div>
              <div className="product-progress">
                <span style={{ width: `${(p.quantity / max) * 100}%` }} />
              </div>
            </div>
            <span className="product-revenue">
              {money(p.revenue, currency)}
            </span>
          </div>
        ))
      ) : (
        <div className="empty-state">这个周期还没有已收款订单。</div>
      )}
    </div>
  );
}
function InventoryTable({
  inventory,
  onRestock,
  onEdit,
  onHistory,
  compact = false,
}: {
  inventory: InventoryItem[];
  onRestock: (i: InventoryItem) => void;
  onEdit?: (i: InventoryItem) => void;
  onHistory?: (i: InventoryItem) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>食材 / 物料</th>
            <th>当前库存</th>
            {!compact && (
              <>
                <th>今日入库</th>
                <th>今日售出消耗</th>
              </>
            )}
            <th>补货提醒</th>
            {!compact && <th>供应商</th>}
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {inventory.length ? (
            inventory.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="product-cell">
                    <span className="product-avatar">
                      <Package size={18} />
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      {!compact && (
                        <span className="muted">
                          成本单价 {precise(item.unitCost)} / {item.unit}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <div className="stock-cell">
                    <strong>
                      {precise(item.stock)} <small>{item.unit}</small>
                    </strong>
                    <div className="stock-bar">
                      <span
                        className={`stock-fill ${item.stock <= item.reorderPoint ? "low" : ""}`}
                        style={{
                          width: `${Math.min(100, (item.stock / Math.max(item.targetStock, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </td>
                {!compact && (
                  <>
                    <td className="text-success">
                      +{precise(item.receivedToday || 0)} {item.unit}
                    </td>
                    <td>
                      {precise(item.consumedToday || 0)} {item.unit}
                    </td>
                  </>
                )}
                <td>
                  {precise(item.reorderPoint)} {item.unit}
                </td>
                {!compact && (
                  <td className="muted">{item.supplier || "未设置"}</td>
                )}
                <td>
                  <span
                    className={`status-pill ${item.stock <= item.reorderPoint ? "warning" : "success"}`}
                  >
                    <span />
                    {item.stock <= item.reorderPoint ? "需要补货" : "库存充足"}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="button secondary small"
                      onClick={() => onRestock(item)}
                    >
                      <Plus size={14} />
                      入库
                    </button>
                    {onHistory && (
                      <button
                        className="icon-button"
                        onClick={() => onHistory(item)}
                        aria-label={`查看${item.name}库存记录`}
                      >
                        <Clock3 size={16} />
                      </button>
                    )}
                    {onEdit && (
                      <button
                        className="icon-button"
                        onClick={() => onEdit(item)}
                        aria-label={`设置${item.name}库存提醒`}
                      >
                        <Settings2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={compact ? 5 : 8} className="empty-state">
                没有匹配的库存物料。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function AgentSummary({
  insight,
  onView,
}: {
  insight: Insight;
  onView: () => void;
}) {
  const meta = agentMeta[insight.id];
  return (
    <div className="dashboard-agent">
      <div className="agent-heading">
        <div className="agent-icon" style={{ background: meta.color }}>
          <meta.icon size={19} />
        </div>
        <div>
          <strong>{meta.label}</strong>
          <span className="muted">{meta.english}</span>
        </div>
        <span className="status-pill muted">规则分析</span>
      </div>
      <p>{insight.summary}</p>
      <button className="agent-link" onClick={onView}>
        查看分析 <ArrowRight size={14} />
      </button>
    </div>
  );
}
function Dashboard({
  data,
  period,
  setPeriod,
  navigate,
  onRestock,
}: {
  data: Bootstrap;
  period: Period;
  setPeriod: (p: Period) => void;
  navigate: (p: Page) => void;
  onRestock: (i: InventoryItem) => void;
}) {
  const lowStock = data.inventory.filter((i) => i.stock <= i.reorderPoint);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A GOOD DAY STARTS HERE</div>
          <h1 className="page-title">
            经营有数，好好开店<span className="heading-spark">✳</span>
          </h1>
          <p className="page-description">
            The Square Box 的每一笔生意，都在这里。
          </p>
        </div>
        <div className="heading-actions">
          <a
            className="button secondary"
            href={`/api/reports/export?period=${period}`}
            download
          >
            <ArrowDownToLine size={16} />
            导出报表
          </a>
          <button className="button primary" onClick={() => navigate("pos")}>
            <Plus size={17} />
            新增订单
          </button>
        </div>
      </div>
      <div className="overview-period">
        <span>
          <span className="live-dot" />
          经营数据概览
        </span>
        <PeriodTabs period={period} setPeriod={setPeriod} />
      </div>
      <StatCards report={data.report} currency={data.settings.currency} />
      <div className="dashboard-grid section-gap">
        <Panel
          title="营业趋势"
          subtitle={`${data.report.startDate} — ${data.report.endDate}`}
          action={
            <span className="legend">
              <i className="legend-dot" />
              营业收入
            </span>
          }
        >
          <div className="chart-summary">
            <strong>
              {money(data.report.totals.revenue, data.settings.currency)}
            </strong>
            <span>本周期营业总收入</span>
          </div>
          <RevenueChart
            report={data.report}
            currency={data.settings.currency}
          />
        </Panel>
        <Panel
          title="你的经营小帮手"
          subtitle="把数据变成下一步行动"
          action={<Sparkles size={20} className="accent-icon" />}
        >
          <div className="dashboard-agents">
            {data.insights.map((insight) => (
              <AgentSummary
                key={insight.id}
                insight={insight}
                onView={() => navigate("agents")}
              />
            ))}
          </div>
        </Panel>
      </div>
      <div className="dashboard-lower section-gap">
        <Panel
          title="库存待办"
          subtitle={
            lowStock.length
              ? `${lowStock.length} 项物料达到补货提醒线`
              : "物料充足，今天也能安心出餐"
          }
          action={
            <button
              className="text-button"
              onClick={() => navigate("inventory")}
            >
              全部库存 <ChevronRight size={15} />
            </button>
          }
        >
          <InventoryTable
            inventory={(lowStock.length ? lowStock : data.inventory).slice(
              0,
              4,
            )}
            onRestock={onRestock}
            compact
          />
        </Panel>
        <Panel
          title="人气好味道"
          subtitle="看看大家最爱点什么"
          action={<span className="status-pill muted">销量排行</span>}
        >
          <TopProducts report={data.report} currency={data.settings.currency} />
        </Panel>
      </div>
      <div className="page-footer">
        <span>
          <span className="store-dot" />
          本地数据库已连接
        </span>
        <span>每一份用心经营，都值得被看见。</span>
      </div>
    </>
  );
}

function OrderEntry({
  data,
  guest = false,
  onUpdated,
  notify,
  onManageMenu,
}: {
  data: OrderingData;
  guest?: boolean;
  onUpdated: () => Promise<void>;
  notify: (s: string) => void;
  onManageMenu?: () => void;
}) {
  const [category, setCategory] = useState("全部");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [table, setTable] = useState("");
  const [method, setMethod] = useState<"cash" | "demo_card">(
    guest ? "demo_card" : "cash",
  );
  const [pending, setPending] = useState<Order | null>(null);
  const checkoutToken = useRef<string | null>(null);
  const [completed, setCompleted] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const categories = ["全部", ...new Set(data.menu.map((i) => i.category))];
  const items = data.menu.filter(
    (i) =>
      (category === "全部" || i.category === category) &&
      `${i.name} ${i.englishName}`.toLowerCase().includes(search.toLowerCase()),
  );
  const subtotal = cart.reduce((sum, c) => sum + c.item.price * c.quantity, 0);
  const service =
    Math.round(subtotal * data.settings.serviceChargeRate * 100) / 100;
  const tax =
    Math.round((subtotal + service) * data.settings.taxRate * 100) / 100;
  const total = subtotal + service + tax;
  const changeQuantity = (item: MenuItem, amount: number) => {
    if (pending) return;
    setCompleted(null);
    setCart((previous) => {
      const existing = previous.find((c) => c.item.id === item.id);
      if (!existing)
        return amount > 0 ? [...previous, { item, quantity: 1 }] : previous;
      return previous
        .map((c) =>
          c.item.id === item.id ? { ...c, quantity: c.quantity + amount } : c,
        )
        .filter((c) => c.quantity > 0);
    });
  };
  const checkout = async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    setError("");
    try {
      let order = pending;
      if (!order) {
        const response = await post<{ order: Order; checkoutToken?: string }>(
          guest ? "/api/guest/orders" : "/api/orders",
          {
            clientRequestId: requestId.current,
            items: cart.map((c) => ({
              menuItemId: c.item.id,
              quantity: c.quantity,
            })),
            tableNumber: table,
            channel: guest ? "guest" : "counter",
          },
        );
        order = response.order;
        checkoutToken.current = response.checkoutToken || null;
        setPending(order);
      }
      if (!(guest && method === "cash")) {
        const response = await post<{ order: Order }>(
          `${guest ? "/api/guest/orders" : "/api/orders"}/${order.id}/pay`,
          {
            method,
            ...(guest ? { checkoutToken: checkoutToken.current } : {}),
          },
        );
        order = response.order;
      }
      setCompleted(order);
      setCart([]);
      setPending(null);
      requestId.current = crypto.randomUUID();
      await onUpdated().catch(() => {});
      notify(
        order.status === "paid"
          ? "示例订单收款成功，配方库存已扣除。"
          : "订单已提交，请到柜台付款。",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelPending = async () => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      await post(`/api/orders/${pending.id}/cancel`, {});
      setPending(null);
      requestId.current = crypto.randomUUID();
      await onUpdated().catch(() => {});
      notify("待付款订单已取消，可以重新编辑。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {guest ? "MADE FRESH, JUST FOR YOU" : "MAKE EVERY ORDER COUNT"}
          </div>
          <h1 className="page-title">
            {guest ? "今天，想吃点什么？" : "点一份好味道"}
          </h1>
          <p className="page-description">
            {guest
              ? "欢迎来到 The Square Box。选择喜欢的餐点，慢慢享用。"
              : "选择餐点、确认订单，收款后自动扣减食材库存。"}
          </p>
        </div>
        {!guest && (
          <div className="heading-actions">
            <button className="button secondary" onClick={onManageMenu}>
              <Settings2 size={16} />
              菜单与配方
            </button>
            <a
              className="button secondary"
              href="/order"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} />
              顾客点餐页面
            </a>
          </div>
        )}
      </div>
      <div className="pos-layout">
        <section className="menu-section">
          <div className="inventory-toolbar">
            <div className="category-tabs">
              {categories.map((c) => (
                <button
                  key={c}
                  className={`category-tab ${category === c ? "active" : ""}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索餐点"
                aria-label="搜索餐点"
              />
            </label>
          </div>
          <div className="menu-grid">
            {items.map((item) => (
              <article className="menu-card" key={item.id}>
                <div className={`menu-art art-${item.category.length % 4}`}>
                  <span>{item.emoji}</span>
                  <div className="menu-art-line" />
                </div>
                <div className="menu-card-body">
                  <span className="menu-category">{item.category}</span>
                  <h2 className="menu-name">{item.name}</h2>
                  <p className="menu-english">{item.englishName}</p>
                  <p className="menu-desc">{item.description}</p>
                  <div className="menu-footer">
                    <strong className="menu-price">
                      {money(item.price, data.settings.currency)}
                    </strong>
                    <button
                      className="add-button"
                      disabled={!item.available || !!pending}
                      onClick={() => changeQuantity(item, 1)}
                      aria-label={`添加${item.name}`}
                    >
                      {item.available ? <Plus size={18} /> : "售罄"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!items.length && (
              <div className="empty-state full-width">
                没有找到餐点，换个关键词试试。
              </div>
            )}
          </div>
          {!guest && (
            <Panel
              title="最近订单"
              subtitle="未付款订单可在这里完成收款"
              className="section-gap"
            >
              <RecentOrders
                orders={(data.orders || []).slice(0, 8)}
                currency={data.settings.currency}
                onUpdated={onUpdated}
                notify={notify}
              />
            </Panel>
          )}
        </section>
        <aside className="cart-panel">
          <div className="cart-header">
            <div>
              <h2>
                <ShoppingBag size={19} />
                {guest ? "你的餐点" : "当前订单"}
              </h2>
              <span className="muted">
                {cart.reduce((n, c) => n + c.quantity, 0)} 份餐点
              </span>
            </div>
            {cart.length > 0 && !pending && (
              <button
                className="text-button"
                onClick={() => {
                  setCart([]);
                  setError("");
                  requestId.current = crypto.randomUUID();
                }}
              >
                清空
              </button>
            )}
          </div>
          {completed && (
            <div className="order-success" role="status">
              <CheckCircle2 size={28} />
              <strong>
                {completed.status === "paid" ? "示例收款完成" : "订单提交成功"}
              </strong>
              <span>
                {completed.orderNumber} ·{" "}
                {money(completed.total, data.settings.currency)}
              </span>
              <p>
                {completed.status === "paid"
                  ? "这是模拟交易，没有发生真实扣款。"
                  : "请向柜台出示订单编号并付款。"}
              </p>
            </div>
          )}
          <label className="field">
            桌号 / 取餐备注
            <input
              className="form-input"
              value={table}
              onChange={(event) => setTable(event.target.value)}
              disabled={!!pending}
              placeholder="例如：A03 / 打包"
              maxLength={60}
            />
          </label>
          <div className="cart-list">
            {cart.length ? (
              cart.map((c) => (
                <div className="cart-item" key={c.item.id}>
                  <div className="cart-item-art">{c.item.emoji}</div>
                  <div className="cart-item-info">
                    <strong className="cart-item-name">{c.item.name}</strong>
                    <span className="cart-item-price">
                      {money(c.item.price, data.settings.currency)}
                    </span>
                    <div className="quantity-control">
                      <button
                        disabled={!!pending}
                        onClick={() => changeQuantity(c.item, -1)}
                        aria-label={`减少${c.item.name}`}
                      >
                        <Minus size={12} />
                      </button>
                      <span>{c.quantity}</span>
                      <button
                        disabled={!!pending}
                        onClick={() => changeQuantity(c.item, 1)}
                        aria-label={`增加${c.item.name}`}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                  <strong>
                    {money(c.item.price * c.quantity, data.settings.currency)}
                  </strong>
                </div>
              ))
            ) : (
              <div className="empty-cart">
                <ShoppingCart size={35} strokeWidth={1.3} />
                <strong>好味道，等你来选</strong>
                <p>点击餐点上的 + 加入订单</p>
              </div>
            )}
          </div>
          <div className="cart-bottom">
            <div className="cart-totals">
              <div className="total-row">
                <span>餐点小计</span>
                <span>{money(subtotal, data.settings.currency)}</span>
              </div>
              <div className="total-row">
                <span>服务费 ({data.settings.serviceChargeRate * 100}%)</span>
                <span>{money(service, data.settings.currency)}</span>
              </div>
              <div className="total-row">
                <span>税费 ({data.settings.taxRate * 100}%)</span>
                <span>{money(tax, data.settings.currency)}</span>
              </div>
              <div className="total-row grand">
                <strong>合计</strong>
                <strong>{money(total, data.settings.currency)}</strong>
              </div>
            </div>
            <div className="payment-options">
              <button
                className={`payment-option ${method === "cash" ? "active" : ""}`}
                onClick={() => setMethod("cash")}
                disabled={busy}
              >
                <Wallet size={17} />
                {guest ? "柜台付款" : "现金记账"}
              </button>
              <button
                className={`payment-option ${method === "demo_card" ? "active" : ""}`}
                onClick={() => setMethod("demo_card")}
                disabled={busy}
              >
                <CreditCard size={17} />
                模拟电子支付
              </button>
            </div>
            <p className="payment-note">
              示例环境 · 不会处理真实银行卡或扣款。
            </p>
            {pending && (
              <p className="pending-note">
                订单 {pending.orderNumber} 已建立。
                {guest
                  ? "可重试模拟支付，或选择到柜台付款。"
                  : "可重试收款，或取消后编辑。"}
              </p>
            )}
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="button primary checkout-button"
              disabled={!cart.length || busy}
              onClick={checkout}
            >
              {busy ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <Check size={18} />
              )}
              {guest && method === "cash"
                ? "提交订单 · 柜台付款"
                : pending
                  ? "重试收款"
                  : "确认收款"}
              <span>{money(total, data.settings.currency)}</span>
            </button>
            {pending && !guest && (
              <button
                className="button ghost full-width"
                onClick={cancelPending}
                disabled={busy}
              >
                取消待付款订单
              </button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
function RecentOrders({
  orders,
  currency,
  onUpdated,
  notify,
}: {
  orders: Order[];
  currency: string;
  onUpdated: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const action = async (order: Order, cancel = false) => {
    setBusy(order.id);
    setError("");
    try {
      await post(
        `/api/orders/${order.id}/${cancel ? "cancel" : "pay"}`,
        cancel ? {} : { method: "cash" },
      );
      await onUpdated().catch(() => {});
      notify(cancel ? "订单已取消。" : "现金收款已记账，配方库存已扣除。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {error && <div className="inline-error">{error}</div>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>订单</th>
              <th>餐点</th>
              <th>金额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <strong>{order.orderNumber}</strong>
                  <span className="muted">
                    {order.tableNumber || "未填桌号"}
                  </span>
                </td>
                <td>
                  {order.items
                    .map((item) => `${item.name} ×${item.quantity}`)
                    .join("、")}
                </td>
                <td>{money(order.total, currency)}</td>
                <td>
                  <span
                    className={`status-pill ${order.status === "paid" ? "success" : order.status === "pending" ? "warning" : "muted"}`}
                  >
                    {order.status === "paid"
                      ? "已收款"
                      : order.status === "pending"
                        ? "待付款"
                        : "已取消"}
                  </span>
                </td>
                <td>
                  {order.status === "pending" ? (
                    <div className="row-actions">
                      <button
                        className="button secondary small"
                        disabled={busy === order.id}
                        onClick={() => action(order)}
                      >
                        现金收款
                      </button>
                      <button
                        className="text-button"
                        disabled={busy === order.id}
                        onClick={() => action(order, true)}
                      >
                        取消
                      </button>
                    </div>
                  ) : order.status === "paid" ? (
                    <button
                      className="button secondary small"
                      onClick={() => setInvoiceOrder(order)}
                    >
                      <FileText size={13} />
                      e-Invoice 草稿
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!orders.length && (
              <tr>
                <td colSpan={5} className="empty-state">
                  还没有订单。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {invoiceOrder && (
        <InvoiceModal
          order={invoiceOrder}
          close={() => setInvoiceOrder(null)}
        />
      )}
    </>
  );
}

function Reports({
  data,
  period,
  setPeriod,
  onAddExpense,
}: {
  data: Bootstrap;
  period: Period;
  setPeriod: (p: Period) => void;
  onAddExpense: () => void;
}) {
  const { report, settings } = data;
  const max = Math.max(...report.hourly.map((h) => h.orders), 1);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">KNOW YOUR NUMBERS</div>
          <h1 className="page-title">每一笔经营，都算得清</h1>
          <p className="page-description">
            按日、周、月查看收入、食材成本和经营利润。
          </p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={onAddExpense}>
            <Plus size={16} />
            记录费用
          </button>
          <a
            className="button primary"
            href={`/api/reports/export?period=${period}`}
            download
          >
            <ArrowDownToLine size={16} />
            导出 CSV
          </a>
        </div>
      </div>
      <div className="overview-period">
        <span>
          {report.startDate} — {report.endDate}
        </span>
        <PeriodTabs period={period} setPeriod={setPeriod} />
      </div>
      <StatCards report={report} currency={settings.currency} />
      <div className="report-note">
        <FileText size={17} />
        <span>
          经营报表用于门店管理。利润按净销售额扣除已售食材成本与已记录费用计算；进货先计入库存，不重复计为费用。未包含尚未录入的房租、工资等项目。
        </span>
      </div>
      <div className="dashboard-grid section-gap">
        <Panel title="收支概览" subtitle="清楚知道，钱从哪里来、到哪里去">
          <div className="profit-statement">
            <div>
              <span>净销售额（不含代收税）</span>
              <strong>{money(report.totals.revenue, settings.currency)}</strong>
            </div>
            <div>
              <span>已售食材成本</span>
              <strong>− {money(report.totals.cogs, settings.currency)}</strong>
            </div>
            <div>
              <span>已记录经营费用</span>
              <strong>
                − {money(report.totals.expenses, settings.currency)}
              </strong>
            </div>
            <div>
              <span>代收税（不计入收入）</span>
              <strong>
                {money(report.totals.taxCollected, settings.currency)}
              </strong>
            </div>
            <div>
              <span>实收总额（含代收税）</span>
              <strong>
                {money(report.totals.grossReceipts, settings.currency)}
              </strong>
            </div>
            <div className="statement-total">
              <span>经营利润</span>
              <strong
                className={
                  report.totals.profit >= 0 ? "text-success" : "text-danger"
                }
              >
                {money(report.totals.profit, settings.currency)}
              </strong>
            </div>
            <p>
              利润 = 净销售额 − 已售食材成本 − 已记录经营费用。代收税单独列示。
            </p>
          </div>
        </Panel>
        <Panel title="费用分布" subtitle="及时记录费用，让利润更接近实际">
          <div className="expense-list">
            {report.expenseBreakdown.length ? (
              report.expenseBreakdown.map((e) => (
                <div className="expense-row" key={e.category}>
                  <span>
                    <span className="expense-dot" />
                    {e.category}
                  </span>
                  <strong>{money(e.total, settings.currency)}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state">本周期没有记录经营费用。</div>
            )}
            <button
              className="button secondary full-width"
              onClick={onAddExpense}
            >
              <Plus size={15} />
              记录一笔费用
            </button>
          </div>
        </Panel>
      </div>
      <div className="dashboard-grid section-gap">
        <Panel title="每日经营明细" subtitle="同一套账，每一天都看得见">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>订单</th>
                  <th>营业收入</th>
                  <th>经营利润</th>
                </tr>
              </thead>
              <tbody>
                {report.daily.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.orders} 单</td>
                    <td>{money(day.revenue, settings.currency)}</td>
                    <td
                      className={
                        day.profit >= 0 ? "text-success" : "text-danger"
                      }
                    >
                      {money(day.profit, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="来客时段" subtitle="按已付款订单时间统计">
          <div className="hourly-chart">
            {report.hourly
              .filter((h) => h.hour >= 8 && h.hour <= 23)
              .map((h) => (
                <div
                  className="hourly-column"
                  key={h.hour}
                  title={`${h.hour}:00 · ${h.orders} 单`}
                >
                  <div className="hourly-bar-wrap">
                    <div
                      style={{
                        height: `${(h.orders / max) * 100}%`,
                        minHeight: h.orders ? 4 : 0,
                      }}
                    />
                  </div>
                  <span>{h.hour}</span>
                </div>
              ))}
          </div>
          <p className="chart-caption">小时 · {settings.timeZone}</p>
          <div className="panel-divider" />
          <TopProducts report={report} currency={settings.currency} />
        </Panel>
      </div>
    </>
  );
}

function AgentPage({
  data,
  period,
  setPeriod,
}: {
  data: Bootstrap;
  period: Period;
  setPeriod: (p: Period) => void;
}) {
  const [analysis, setAnalysis] = useState<
    Partial<Record<AgentId, { mode: string; analysis: string }>>
  >({});
  const [busy, setBusy] = useState<AgentId | null>(null);
  const [error, setError] = useState("");
  useEffect(() => setAnalysis({}), [period]);
  const analyze = async (id: AgentId) => {
    setBusy(id);
    setError("");
    try {
      const result = await post<{ mode: string; analysis: string }>(
        `/api/agents/${id}/analyze`,
        { period },
      );
      setAnalysis((old) => ({ ...old, [id]: result }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EVERYDAY BUSINESS PARTNERS</div>
          <h1 className="page-title">三个助理，一起好好经营</h1>
          <p className="page-description">
            财务、库存、营业分析，各有专长，都基于同一套门店数据。
          </p>
        </div>
        <PeriodTabs period={period} setPeriod={setPeriod} />
      </div>
      <div className="agent-notice">
        <Sparkles size={21} />
        <div>
          <strong>
            {data.settings.aiConfigured ? "AI 解读已配置" : "当前使用规则分析"}
          </strong>
          <p>
            {data.settings.aiConfigured
              ? "基础数字由账本计算，点击生成解读调用已配置的模型。"
              : "目前的建议由可验证的经营规则生成，尚未连接语言模型。基础功能可直接使用，接入模型后可生成更自然的经营解读。"}
          </p>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="agent-grid">
        {data.insights.map((insight) => {
          const meta = agentMeta[insight.id];
          return (
            <section className="agent-card" key={insight.id}>
              <div className="agent-card-top">
                <div className="agent-icon" style={{ background: meta.color }}>
                  <meta.icon size={24} />
                </div>
                <span className="status-pill muted">规则分析</span>
              </div>
              <span className="eyebrow">{meta.english}</span>
              <h2>{meta.label}</h2>
              <p className="agent-description">{insight.summary}</p>
              <h3>经营观察</h3>
              <ul className="insight-list">
                {insight.findings.map((finding, i) => (
                  <li className="insight-item" key={i}>
                    <span className="insight-dot" />
                    {finding}
                  </li>
                ))}
              </ul>
              <h3>建议下一步</h3>
              <ul className="agent-actions">
                {insight.actions.map((action, i) => (
                  <li key={i}>
                    <CheckCircle2 size={15} />
                    {action}
                  </li>
                ))}
              </ul>
              <button
                className="button secondary full-width"
                disabled={busy !== null}
                onClick={() => analyze(insight.id)}
              >
                {busy === insight.id ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                {data.settings.aiConfigured ? "生成 AI 解读" : "生成规则报告"}
              </button>
              {analysis[insight.id] && (
                <div className="generated-analysis">
                  <span className="status-pill muted">
                    {analysis[insight.id]!.mode === "ai"
                      ? "AI 生成解读"
                      : "规则报告"}
                  </span>
                  <p>{analysis[insight.id]!.analysis}</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="report-note">
        <ClipboardList size={18} />
        <span>
          助理提供经营参考；不会自动采购、修改账目或操作真实支付。关键经营决定由你确认。
        </span>
      </div>
    </>
  );
}

function StaffApp() {
  const guest = false;
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [ingredientOpen, setIngredientOpen] = useState(false);
  const [page, setPage] = useState<Page>(() => {
    const value = window.location.hash.slice(1);
    return navItems.some((n) => n.id === value) ? (value as Page) : "dashboard";
  });
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [restock, setRestock] = useState<InventoryItem | null>(null);
  const [editStock, setEditStock] = useState<InventoryItem | null>(null);
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestNumber = useRef(0);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5500);
  }, []);
  const refresh = useCallback(async () => {
    const number = ++requestNumber.current;
    try {
      const response = await api<Bootstrap>(`/api/bootstrap?period=${period}`);
      if (number === requestNumber.current) {
        setData(response);
        setFetchError("");
      }
    } catch (e) {
      if (number === requestNumber.current) {
        setFetchError(errorMessage(e));
        if (e instanceof ApiError && e.status === 401) {
          setData(null);
          setAuthenticated(false);
        }
      }
      throw e;
    } finally {
      if (number === requestNumber.current) setLoading(false);
    }
  }, [period]);
  useEffect(() => {
    void api<{ authenticated: boolean }>("/api/session")
      .then((session) => setAuthenticated(session.authenticated))
      .catch((e) => {
        setFetchError(errorMessage(e));
        setAuthenticated(false);
      });
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    void refresh().catch(() => {});
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 15000);
    const focused = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", focused);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focused);
    };
  }, [refresh, authenticated]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const navigate = (next: Page) => {
    setPage(next);
    window.history.replaceState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (authenticated === null)
    return (
      <div className="initial-state">
        <Logo dark />
        <Loader2 className="spin" size={28} />
        <p>正在连接门店…</p>
      </div>
    );
  if (!authenticated)
    return (
      <Login
        onLogin={() => {
          setLoading(true);
          setAuthenticated(true);
        }}
      />
    );
  if (!data)
    return (
      <div className="initial-state">
        <Logo dark />
        {loading ? (
          <>
            <Loader2 className="spin" size={28} />
            <p>正在准备门店工作台…</p>
          </>
        ) : (
          <>
            <p role="alert">{fetchError || "暂时无法连接门店服务。"}</p>
            <button
              className="button primary"
              onClick={() => {
                setLoading(true);
                void refresh().catch(() => {});
              }}
            >
              <RefreshCw size={16} />
              重新连接
            </button>
          </>
        )}
      </div>
    );
  const lowStock = data.inventory.filter((i) => i.stock <= i.reorderPoint);
  const selected = navItems.find((n) => n.id === page)!;
  const contents = guest ? (
    <OrderEntry data={data} guest onUpdated={refresh} notify={notify} />
  ) : page === "dashboard" ? (
    <Dashboard
      data={data}
      period={period}
      setPeriod={setPeriod}
      navigate={navigate}
      onRestock={setRestock}
    />
  ) : page === "pos" ? (
    <OrderEntry
      data={data}
      onUpdated={refresh}
      notify={notify}
      onManageMenu={() => setCatalogOpen(true)}
    />
  ) : page === "inventory" ? (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A WELL-STOCKED KITCHEN</div>
          <h1 className="page-title">厨房有底，出餐有数</h1>
          <p className="page-description">
            进货及时入账，售出按配方扣减，低库存提前提醒。
          </p>
        </div>
        <div className="heading-actions">
          <span className="status-pill success">
            <CheckCircle2 size={14} />
            收款后自动扣料
          </span>
          <button
            className="button primary"
            onClick={() => setIngredientOpen(true)}
          >
            <Plus size={16} />
            新增物料
          </button>
        </div>
      </div>
      <div className="inventory-stats">
        <div>
          <Package size={22} />
          <span>
            库存物料
            <strong>
              {data.inventory.length} <small>项</small>
            </strong>
          </span>
        </div>
        <div>
          <Bell size={22} />
          <span>
            需要补货
            <strong>
              {lowStock.length} <small>项</small>
            </strong>
          </span>
        </div>
        <div>
          <CircleDollarSign size={22} />
          <span>
            当前库存估值
            <strong>
              {money(
                data.inventory.reduce((v, i) => v + i.stock * i.unitCost, 0),
                data.settings.currency,
              )}
            </strong>
          </span>
        </div>
      </div>
      <Panel title="食材与物料" subtitle="单位按配方统一，入库与出库都有记录">
        <div className="inventory-toolbar inventory-table-toolbar">
          <div className="category-tabs">
            <button
              className={`category-tab ${!lowOnly ? "active" : ""}`}
              onClick={() => setLowOnly(false)}
            >
              全部物料 <span>{data.inventory.length}</span>
            </button>
            <button
              className={`category-tab ${lowOnly ? "active" : ""}`}
              onClick={() => setLowOnly(true)}
            >
              需要补货 <span>{lowStock.length}</span>
            </button>
          </div>
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="搜索库存"
              placeholder="搜索食材 / 供应商"
            />
          </label>
        </div>
        <InventoryTable
          inventory={data.inventory.filter(
            (i) =>
              (!lowOnly || i.stock <= i.reorderPoint) &&
              `${i.name} ${i.supplier}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )}
          onRestock={setRestock}
          onEdit={setEditStock}
          onHistory={setMovementItem}
        />
      </Panel>
      <div className="report-note">
        <Package size={18} />
        <span>
          入库更新库存数量和平均成本。只有已付款订单会扣减配方物料；待付款和已取消订单不扣库存。
        </span>
      </div>
    </>
  ) : page === "reports" ? (
    <Reports
      data={data}
      period={period}
      setPeriod={setPeriod}
      onAddExpense={() => setExpenseOpen(true)}
    />
  ) : (
    <AgentPage data={data} period={period} setPeriod={setPeriod} />
  );
  return (
    <>
      {guest ? (
        <div className="guest-shell">
          <header className="guest-header">
            <Logo dark />
            <span className="status-pill muted">顾客点餐 · 演示门店</span>
          </header>
          <main className="guest-content">
            <div className="demo-banner">
              <span className="banner-icon">
                <ShoppingBag size={15} />
              </span>
              <span>
                欢迎试用示例点餐。所有电子支付均为模拟，不会产生真实扣款。
              </span>
            </div>
            {contents}
          </main>
        </div>
      ) : (
        <div className="app-shell">
          <aside className="sidebar">
            <Logo />
            <div className="sidebar-label">门店工作台</div>
            <nav className="sidebar-nav" aria-label="主导航">
              {navItems.map((item) => (
                <button
                  className={`nav-item ${page === item.id ? "active" : ""}`}
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  title={item.label}
                >
                  <item.icon size={19} className="nav-icon" />
                  <span className="nav-label">{item.label}</span>
                  {item.id === "inventory" && lowStock.length > 0 && (
                    <span className="nav-badge">{lowStock.length}</span>
                  )}
                  {item.id === "agents" && <span className="nav-ai">AI</span>}
                </button>
              ))}
            </nav>
            <div className="sidebar-promo">
              <div className="promo-square">✳</div>
              <strong>小店，也有大智慧。</strong>
              <p>
                让琐碎的事更简单，
                <br />
                把时间留给好味道。
              </p>
              <button onClick={() => navigate("agents")}>
                认识经营助理 <ArrowRight size={14} />
              </button>
            </div>
            <div className="sidebar-bottom">
              <button
                className="nav-item"
                onClick={() => setSettingsOpen(true)}
                title="门店设置"
              >
                <Settings2 size={19} />
                <span className="nav-label">门店设置</span>
              </button>
              <div className="store-indicator">
                <span className="avatar">SB</span>
                <div>
                  <strong>The Square Box</strong>
                  <span>
                    <i className="store-dot" />
                    演示门店
                  </span>
                </div>
                <ChevronDown size={15} />
              </div>
            </div>
          </aside>
          <main className="main">
            <header className="topbar">
              <div className="breadcrumb">
                工作台 <ChevronRight size={14} />
                <strong>{selected.label}</strong>
              </div>
              <div className="topbar-actions">
                <span className="topbar-date">
                  {new Intl.DateTimeFormat("zh-CN", {
                    timeZone: data.settings.timeZone,
                    month: "long",
                    day: "numeric",
                    weekday: "long",
                  }).format(new Date())}
                </span>
                <button className="guest-link" onClick={() => setQrOpen(true)}>
                  <ExternalLink size={15} />
                  扫码点餐
                </button>
                <button
                  className="icon-button"
                  onClick={() => void refresh().catch(() => {})}
                  aria-label="刷新门店数据"
                >
                  <RefreshCw size={17} />
                </button>
                <button
                  className="icon-button notification-button"
                  onClick={() => {
                    navigate("inventory");
                    setLowOnly(true);
                  }}
                  aria-label={`${lowStock.length} 项低库存提醒`}
                >
                  <Bell size={19} />
                  {lowStock.length > 0 && <span />}
                </button>
                <div className="topbar-divider" />
                <button
                  className="icon-button"
                  aria-label="退出登录"
                  onClick={() => {
                    void post("/api/auth/logout", {}).then(() => {
                      setData(null);
                      setAuthenticated(false);
                    });
                  }}
                >
                  <LogOut size={18} />
                </button>
                <button
                  className="user-avatar"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="门店设置"
                >
                  SB
                </button>
              </div>
            </header>
            <div className="workspace">
              <div className="demo-banner">
                <span className="banner-icon">
                  <Sparkles size={15} />
                </span>
                <span>
                  <strong>示例门店</strong> ·
                  当前展示演示数据，电子支付为模拟。币种与税费可在门店设置中调整。
                </span>
                <button onClick={() => setSettingsOpen(true)}>
                  门店设置 <ArrowRight size={13} />
                </button>
              </div>
              {fetchError && (
                <div className="error-banner" role="alert">
                  数据更新失败：{fetchError}
                  <button
                    className="text-button"
                    onClick={() => void refresh().catch(() => {})}
                  >
                    重试
                  </button>
                </div>
              )}
              {contents}
            </div>
          </main>
          <nav className="mobile-nav" aria-label="移动导航">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
      {restock && (
        <RestockModal
          item={restock}
          currency={data.settings.currency}
          close={() => setRestock(null)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {movementItem && (
        <MovementModal
          item={movementItem}
          close={() => setMovementItem(null)}
        />
      )}
      {editStock && (
        <StockModal
          item={editStock}
          close={() => setEditStock(null)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {expenseOpen && (
        <ExpenseModal
          currency={data.settings.currency}
          close={() => setExpenseOpen(false)}
          refresh={refresh}
          notify={notify}
        />
      )}
      {catalogOpen && (
        <CatalogManager
          menu={data.menu}
          inventory={data.inventory}
          onUpdated={refresh}
          notify={notify}
          close={() => setCatalogOpen(false)}
        />
      )}
      {ingredientOpen && (
        <IngredientCreate
          onUpdated={refresh}
          notify={notify}
          close={() => setIngredientOpen(false)}
        />
      )}
      {qrOpen && <QrModal close={() => setQrOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          settings={data.settings}
          close={() => setSettingsOpen(false)}
          refresh={refresh}
          notify={notify}
        />
      )}
    </>
  );
}
function RestockModal({
  item,
  currency,
  close,
  refresh,
  notify,
}: {
  item: InventoryItem;
  currency: string;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [quantity, setQuantity] = useState(
    String(Math.max(0, item.targetStock - item.stock)),
  );
  const [unitCost, setUnitCost] = useState(String(item.unitCost));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/api/inventory/${item.id}/restock`, {
        quantity: Number(quantity),
        unitCost: Number(unitCost),
        notes,
      });
      await refresh().catch(() => {});
      notify(`${item.name} 已入库 ${quantity} ${item.unit}。`);
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${item.name} · 采购入库`} close={close}>
      <form className="modal-form" onSubmit={submit}>
        <div className="modal-context">
          当前库存{" "}
          <strong>
            {precise(item.stock)} {item.unit}
          </strong>
          <span>
            建议补至 {precise(item.targetStock)} {item.unit}
          </span>
        </div>
        <div className="form-grid">
          <label className="field">
            本次入库数量（{item.unit}）
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              className="form-input"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="field">
            采购单价（{currency}/{item.unit}）
            <input
              required
              type="number"
              min="0"
              step="0.01"
              className="form-input"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          采购备注
          <input
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            placeholder="例如：送货单编号、供应商"
          />
        </label>
        <p className="form-hint">
          本次采购金额：
          {money(Number(quantity) * Number(unitCost) || 0, currency)}
          。入库更新平均成本，不直接重复记入经营费用。
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            确认入库
          </button>
        </div>
      </form>
    </Modal>
  );
}
function StockModal({
  item,
  close,
  refresh,
  notify,
}: {
  item: InventoryItem;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [reorder, setReorder] = useState(String(item.reorderPoint));
  const [target, setTarget] = useState(String(item.targetStock));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/inventory/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          reorderPoint: Number(reorder),
          targetStock: Number(target),
        }),
      });
      await refresh().catch(() => {});
      notify("库存提醒已更新。");
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${item.name} · 补货提醒`} close={close}>
      <form className="modal-form" onSubmit={submit}>
        <label className="field">
          低库存提醒线（{item.unit}）
          <input
            className="form-input"
            required
            type="number"
            min="0"
            step="0.001"
            value={reorder}
            onChange={(e) => setReorder(e.target.value)}
          />
        </label>
        <label className="field">
          建议备货量（{item.unit}）
          <input
            className="form-input"
            required
            type="number"
            min={reorder || 0}
            step="0.001"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <p className="form-hint">
          库存达到或低于提醒线时，会在工作台与库存助理中提示。
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存提醒
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ExpenseModal({
  currency,
  close,
  refresh,
  notify,
}: {
  currency: string;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("其他");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(localDate());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/expenses", {
        amount: Number(amount),
        category,
        description,
        date,
      });
      await refresh().catch(() => {});
      notify("费用已记录，相关报表已更新。");
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="记录一笔经营费用" close={close}>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            金额（{currency}）
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="field">
            费用日期
            <input
              className="form-input"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          费用类别
          <select
            className="form-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["租金", "人工", "水电", "营销", "其他"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          费用说明
          <input
            className="form-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder="例如：本月电费"
            required
          />
        </label>
        <p className="form-hint">
          食材采购请从库存入库记录，避免重复计算成本。
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存费用
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsModal({
  settings,
  close,
  refresh,
  notify,
}: {
  settings: Settings;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(settings.restaurantName);
  const [currency, setCurrency] = useState(settings.currency);
  const [zone, setZone] = useState(settings.timeZone);
  const [tax, setTax] = useState(String(settings.taxRate * 100));
  const [service, setService] = useState(
    String(settings.serviceChargeRate * 100),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          restaurantName: name,
          currency,
          timeZone: zone,
          taxRate: Number(tax) / 100,
          serviceChargeRate: Number(service) / 100,
        }),
      });
      await refresh().catch(() => {});
      notify("门店设置已保存。");
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="门店设置" close={close}>
      <form className="modal-form" onSubmit={submit}>
        <label className="field">
          门店名称
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            币种
            <select
              className="form-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["MYR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            营业时区
            <select
              className="form-select"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            >
              {["Asia/Kuala_Lumpur"].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            税率（%）
            <input
              className="form-input"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              required
              type="number"
              min="0"
              max="30"
              step="0.01"
            />
          </label>
          <label className="field">
            服务费（%）
            <input
              className="form-input"
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled
              required
              type="number"
              min="0"
              max="30"
              step="0.01"
            />
          </label>
        </div>
        <p className="form-hint">
          营业地区：马来西亚，使用 RM（MYR），不收服务费。SST
          是否适用及税率需根据实际注册情况确认；修改仅用于之后的新订单。
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存设置
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function App() {
  return window.location.pathname.startsWith("/order") ? (
    <GuestApp />
  ) : (
    <StaffApp />
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { pin });
      onLogin();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <Logo dark />
        </div>
        <div className="login-intro">
          <div className="eyebrow">YOUR RESTAURANT, IN GOOD HANDS</div>
          <h1>
            用心经营，
            <br />
            从这里开始。
          </h1>
          <p>
            点餐、库存、财务和三个经营助理。
            <br />为 The Square Box 量身打造的门店工作台。
          </p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            员工 PIN
            <input
              className="form-input"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              maxLength={32}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="请输入门店访问 PIN"
              autoFocus
            />
          </label>
          <div className="login-pin-hint">
            示例门店 PIN：<strong>2468</strong>
            <span>仅用于开发演示，正式使用前需配置门店身份与权限。</span>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full-width" disabled={busy}>
            {busy ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <ArrowRight size={17} />
            )}
            进入工作台
          </button>
        </form>
        <a className="login-guest-link" href="/order">
          我是顾客，前往点餐 <ArrowRight size={14} />
        </a>
      </div>
      <div className="login-decoration" aria-hidden="true">
        <div className="login-large-mark">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p>
          GOOD FOOD.
          <br />
          GOOD BUSINESS.
        </p>
        <span>THE SQUARE BOX</span>
      </div>
    </main>
  );
}
function GuestApp() {
  const [data, setData] = useState<OrderingData | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await api<OrderingData>("/api/guest/menu");
      setData(result);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <div className="guest-shell">
      <header className="guest-header">
        <Logo dark />
        <span className="status-pill muted">顾客点餐 · 演示门店</span>
      </header>
      <main className="guest-content">
        <div className="demo-banner">
          <span className="banner-icon">
            <ShoppingBag size={15} />
          </span>
          <span>
            欢迎试用示例点餐。电子支付均为模拟，不会产生真实扣款。现金请到柜台付款。
          </span>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() => void refresh().catch(() => {})}
            >
              重新连接
            </button>
          </div>
        )}
        {data ? (
          <OrderEntry data={data} guest onUpdated={refresh} notify={setToast} />
        ) : (
          !error && (
            <div className="initial-state">
              <Loader2 size={28} className="spin" />
              <p>正在准备菜单…</p>
            </div>
          )
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function QrModal({ close }: { close: () => void }) {
  const [qr, setQr] = useState<{
    url: string;
    svg: string;
    localOnly: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ url: string; svg: string; localOnly: boolean }>("/api/guest-qr")
      .then(setQr)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <Modal title="扫码点餐" close={close}>
      <div className="modal-form">
        <p className="muted">把 The Square Box 的菜单放到每一张餐桌。</p>
        {qr ? (
          <>
            <img
              className="qr-code"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`}
              alt="The Square Box 顾客点餐二维码"
            />
            <a
              className="qr-url"
              href={qr.url}
              target="_blank"
              rel="noreferrer"
            >
              {qr.url} <ExternalLink size={13} />
            </a>
            {qr.localOnly && (
              <div className="invoice-notice">
                本机演示地址；跨设备扫码需配置公开 HTTPS 地址。
              </div>
            )}
            <a
              className="button primary full-width"
              href={qr.url}
              target="_blank"
              rel="noreferrer"
            >
              打开顾客菜单 <ArrowRight size={16} />
            </a>
          </>
        ) : error ? (
          <div className="inline-error">{error}</div>
        ) : (
          <div className="empty-state">
            <Loader2 className="spin" size={25} />
            正在生成二维码…
          </div>
        )}
      </div>
    </Modal>
  );
}
function InvoiceModal({ order, close }: { order: Order; close: () => void }) {
  const [type, setType] = useState<"individual" | "business">("individual");
  const [name, setName] = useState("");
  const [tin, setTin] = useState("");
  const [idType, setIdType] = useState<"BRN" | "NRIC" | "PASSPORT">("NRIC");
  const [idNumber, setIdNumber] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [draft, setDraft] = useState<{
    draftReference?: string;
    notice?: string;
    issuer?: { missingFields?: string[] };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post<{
        draft: {
          draftReference?: string;
          notice?: string;
          issuer?: { missingFields?: string[] };
        };
      }>(`/api/orders/${order.id}/einvoice`, {
        buyer: {
          type,
          name,
          tin,
          ...(idNumber.trim()
            ? {
                identificationType: type === "business" ? "BRN" : idType,
                identificationNumber: idNumber,
              }
            : {}),
          email,
          address,
        },
      });
      setDraft(result.draft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="e-Invoice 准备草稿" close={close}>
      <form className="modal-form" onSubmit={submit}>
        <div className="invoice-notice">
          <FileText size={18} />
          <span>
            仅生成内部 JSON 草稿，尚未提交 LHDN /
            MyInvois，也不是已验证的电子发票。正式提交需配置发行人资料与官方接入。
          </span>
        </div>
        <div className="modal-context">
          订单 <strong>{order.orderNumber}</strong>
          <span>只适用于已付款订单</span>
        </div>
        <label className="field">
          买方类型
          <select
            className="form-select"
            value={type}
            onChange={(e) => {
              setType(e.target.value as "individual" | "business");
              setDraft(null);
            }}
          >
            <option value="individual">个人（内部草稿可暂缺买方资料）</option>
            <option value="business">公司（需填写必填资料）</option>
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            买方名称{type === "business" && " *"}
            <input
              className="form-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDraft(null);
              }}
              required={type === "business"}
              maxLength={160}
            />
          </label>
          <label className="field">
            TIN{type === "business" && " *"}
            <input
              className="form-input"
              value={tin}
              onChange={(e) => {
                setTin(e.target.value);
                setDraft(null);
              }}
              required={type === "business"}
              maxLength={40}
            />
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            证件类型
            <select
              className="form-select"
              value={type === "business" ? "BRN" : idType}
              disabled={type === "business"}
              onChange={(e) => {
                setIdType(e.target.value as typeof idType);
                setDraft(null);
              }}
            >
              <option value="NRIC">NRIC</option>
              <option value="PASSPORT">Passport</option>
              <option value="BRN">BRN</option>
            </select>
          </label>
          <label className="field">
            证件 / 注册号码{type === "business" && " *"}
            <input
              className="form-input"
              value={idNumber}
              onChange={(e) => {
                setIdNumber(e.target.value);
                setDraft(null);
              }}
              required={type === "business"}
              maxLength={60}
            />
          </label>
        </div>
        <label className="field">
          电子邮件
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setDraft(null);
            }}
            maxLength={160}
          />
        </label>
        <label className="field">
          买方地址{type === "business" && " *"}
          <input
            className="form-input"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setDraft(null);
            }}
            required={type === "business"}
            maxLength={500}
          />
        </label>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {draft && (
          <div className="order-success">
            <CheckCircle2 size={22} />
            <strong>内部草稿已保存 · 尚未提交</strong>
            <span>{draft.draftReference}</span>
            {draft.issuer?.missingFields?.length ? (
              <p>仍缺发行人资料：{draft.issuer.missingFields.join("、")}</p>
            ) : null}
            <a
              className="button secondary full-width"
              href={`/api/orders/${order.id}/einvoice`}
              download
            >
              <ArrowDownToLine size={16} />
              下载 JSON 草稿
            </a>
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            关闭
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <FileText size={16} />
            )}
            保存草稿
          </button>
        </div>
      </form>
    </Modal>
  );
}
function MovementModal({
  item,
  close,
}: {
  item: InventoryItem;
  close: () => void;
}) {
  const [movements, setMovements] = useState<
    | {
        id: string;
        quantity: number;
        kind: string;
        notes: string;
        created_at: string;
        unit_cost: number;
      }[]
    | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ movements: NonNullable<typeof movements> }>(
      `/api/inventory/${item.id}/movements`,
    )
      .then((result) => setMovements(result.movements))
      .catch((e) => setError(errorMessage(e)));
  }, [item.id]);
  const kindLabel: Record<string, string> = {
    receipt: "采购入库",
    sale: "售出扣减",
    opening: "期初库存",
    demo_adjustment: "示例调整",
  };
  return (
    <Modal title={`${item.name} · 库存流水`} close={close}>
      <div className="modal-form">
        <div className="modal-context">
          仓库剩余{" "}
          <strong>
            {precise(item.stock)} {item.unit}
          </strong>
          <span>
            今日入库 +{precise(item.receivedToday || 0)} · 今日消耗{" "}
            {precise(item.consumedToday || 0)}
          </span>
        </div>
        {error ? (
          <div className="inline-error">{error}</div>
        ) : movements ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间 / 类型</th>
                  <th>数量</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{kindLabel[m.kind] || m.kind}</strong>
                      <span className="muted">
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Kuala_Lumpur",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(m.created_at))}
                      </span>
                    </td>
                    <td
                      className={
                        m.quantity >= 0 ? "text-success" : "text-danger"
                      }
                    >
                      {m.quantity > 0 ? "+" : ""}
                      {precise(m.quantity)} {item.unit}
                    </td>
                    <td>{m.notes || "—"}</td>
                  </tr>
                ))}
                {!movements.length && (
                  <tr>
                    <td colSpan={3} className="empty-state">
                      没有库存记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Loader2 className="spin" size={24} />
            正在读取流水…
          </div>
        )}
        <p className="form-hint">
          最近 100 条库存记录，时间按马来西亚时区显示。
        </p>
      </div>
    </Modal>
  );
}
