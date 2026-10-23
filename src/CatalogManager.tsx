import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2, UtensilsCrossed, X } from "lucide-react";
import { api, post, type InventoryItem, type MenuItem } from "./api";

type Props = {
  menu: MenuItem[];
  inventory: InventoryItem[];
  onUpdated: () => Promise<void>;
  notify: (message: string) => void;
  close: () => void;
};
type RecipeRow = { key: string; inventoryId: string; quantity: string };
const emptyFields = {
  name: "",
  englishName: "",
  category: "主食",
  price: "",
  description: "",
  emoji: "🍽️",
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "保存失败，请稍后重试。";

export default function CatalogManager({
  menu,
  inventory,
  onUpdated,
  notify,
  close,
}: Props) {
  const [selected, setSelected] = useState("new");
  const [fields, setFields] = useState(emptyFields);
  const [recipe, setRecipe] = useState<RecipeRow[]>([
    {
      key: crypto.randomUUID(),
      inventoryId: inventory[0]?.id || "",
      quantity: "",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [busy, close]);

  function selectItem(id: string) {
    setSelected(id);
    setError("");
    setSaved(false);
    const item = menu.find((item) => item.id === id);
    if (!item) {
      setFields(emptyFields);
      setRecipe([
        {
          key: crypto.randomUUID(),
          inventoryId: inventory[0]?.id || "",
          quantity: "",
        },
      ]);
      return;
    }
    setFields({
      name: item.name,
      englishName: item.englishName,
      category: item.category,
      price: item.price.toFixed(2),
      description: item.description,
      emoji: item.emoji,
    });
    setRecipe(
      item.recipe.map((row) => ({
        key: crypto.randomUUID(),
        inventoryId: row.inventoryId,
        quantity: String(row.quantity),
      })),
    );
  }
  const updateField = (key: keyof typeof fields, value: string) =>
    setFields((old) => ({ ...old, [key]: value }));
  function updateRecipe(key: string, patch: Partial<RecipeRow>) {
    setRecipe((old) =>
      old.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }
  const approximateCost = recipe.reduce(
    (sum, row) =>
      sum +
      (inventory.find((item) => item.id === row.inventoryId)?.unitCost || 0) *
        (Number(row.quantity) || 0),
    0,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const price = Number(fields.price);
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 10000 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.000001
    ) {
      setError("售价必须大于 RM 0，最多两位小数，上限 RM 10,000。");
      return;
    }
    if (
      !recipe.length ||
      recipe.some(
        (row) =>
          !inventory.some((item) => item.id === row.inventoryId) ||
          !Number.isFinite(Number(row.quantity)) ||
          Number(row.quantity) <= 0,
      )
    ) {
      setError("请添加至少一项食材，并填写有效的每份用量。");
      return;
    }
    if (new Set(recipe.map((row) => row.inventoryId)).size !== recipe.length) {
      setError("同一食材请合并到一行，避免重复填写。");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...fields,
        name: fields.name.trim(),
        englishName: fields.englishName.trim(),
        category: fields.category.trim(),
        price,
        recipe: recipe.map((row) => ({
          inventoryId: row.inventoryId,
          quantity: Number(row.quantity),
        })),
      };
      if (selected === "new") await post("/api/menu", payload);
      else
        await api(`/api/menu/${selected}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      setSaved(true);
      try {
        await onUpdated();
        notify(
          selected === "new"
            ? "新餐点已加入菜单。"
            : "餐点与配方已更新；既有订单保持原始记录。",
        );
        close();
      } catch {
        setError(
          "餐点已保存，但工作台刷新失败。请关闭此窗口并刷新工作台，避免重复新增。",
        );
      }
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-title"
        style={{ maxWidth: 660 }}
      >
        <div className="modal-header">
          <h2 id="catalog-title">菜单与食材配方</h2>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            onClick={close}
            aria-label="关闭菜单管理"
            autoFocus
          >
            <X size={20} />
          </button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <label className="field">
            选择餐点
            <select
              className="form-select"
              value={selected}
              disabled={busy}
              onChange={(event) => selectItem(event.target.value)}
            >
              <option value="new">＋ 新增餐点</option>
              {menu.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset
            disabled={busy || saved}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="form-grid">
              <label className="field">
                餐点名称 *
                <input
                  className="form-input"
                  required
                  maxLength={100}
                  value={fields.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="例如：招牌鸡肉饭"
                />
              </label>
              <label className="field">
                英文名称
                <input
                  className="form-input"
                  maxLength={100}
                  value={fields.englishName}
                  onChange={(event) =>
                    updateField("englishName", event.target.value)
                  }
                  placeholder="Signature Chicken Rice"
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                分类 *
                <input
                  className="form-input"
                  required
                  maxLength={30}
                  value={fields.category}
                  onChange={(event) =>
                    updateField("category", event.target.value)
                  }
                  list="menu-category-options"
                />
                <datalist id="menu-category-options">
                  <option value="主食" />
                  <option value="轻食" />
                  <option value="饮品" />
                  <option value="甜品" />
                </datalist>
              </label>
              <label className="field">
                售价（RM）*
                <input
                  className="form-input"
                  type="number"
                  required
                  min="0.01"
                  max="10000"
                  step="0.01"
                  value={fields.price}
                  onChange={(event) => updateField("price", event.target.value)}
                  placeholder="18.50"
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                餐点说明
                <input
                  className="form-input"
                  maxLength={300}
                  value={fields.description}
                  onChange={(event) =>
                    updateField("description", event.target.value)
                  }
                  placeholder="主要食材或口味"
                />
              </label>
              <label className="field">
                餐点图标
                <input
                  className="form-input"
                  maxLength={12}
                  value={fields.emoji}
                  onChange={(event) => updateField("emoji", event.target.value)}
                  placeholder="🍗"
                />
              </label>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                margin: "4px 0 14px",
              }}
            >
              <h3 className="panel-title">
                <UtensilsCrossed size={16} />
                每份配方
              </h3>
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  setRecipe((old) => [
                    ...old,
                    {
                      key: crypto.randomUUID(),
                      inventoryId:
                        inventory.find(
                          (item) =>
                            !old.some((row) => row.inventoryId === item.id),
                        )?.id || "",
                      quantity: "",
                    },
                  ])
                }
                disabled={
                  !inventory.length || recipe.length >= inventory.length
                }
              >
                <Plus size={14} />
                添加食材
              </button>
            </div>
            {!inventory.length && (
              <div className="inline-error">
                请先在库存管理中新增食材，再建立餐点配方。
              </div>
            )}
            {recipe.map((row, index) => {
              const ingredient = inventory.find(
                (item) => item.id === row.inventoryId,
              );
              return (
                <div
                  key={row.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) minmax(95px,.7fr) 34px",
                    alignItems: "end",
                    gap: 10,
                  }}
                >
                  <label className="field">
                    食材 {index + 1}
                    <select
                      className="form-select"
                      required
                      value={row.inventoryId}
                      onChange={(event) =>
                        updateRecipe(row.key, {
                          inventoryId: event.target.value,
                        })
                      }
                    >
                      <option value="" disabled>
                        选择食材
                      </option>
                      {inventory.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}（{item.unit}）
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    每份用量（{ingredient?.unit || "基本单位"}）
                    <input
                      className="form-input"
                      type="number"
                      required
                      min="0.000001"
                      max="10000"
                      step="0.000001"
                      value={row.quantity}
                      onChange={(event) =>
                        updateRecipe(row.key, { quantity: event.target.value })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    style={{ marginBottom: 18 }}
                    disabled={recipe.length <= 1}
                    onClick={() =>
                      setRecipe((old) =>
                        old.filter((item) => item.key !== row.key),
                      )
                    }
                    aria-label={`移除第 ${index + 1} 项食材`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
            <p className="form-hint">
              预估每份食材成本：RM {approximateCost.toFixed(2)}
              。请以库存基本单位填写（例如 180g 鸡肉填写 0.18
              kg）。付款成功后按配方扣库存；修改配方只影响之后创建的订单。
            </p>
          </fieldset>
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
              关闭
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={busy || saved || !inventory.length}
            >
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {selected === "new" ? "新增餐点" : "保存餐点"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
