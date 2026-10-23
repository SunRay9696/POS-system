import { useEffect, useState, type FormEvent } from "react";
import { Loader2, PackagePlus, X } from "lucide-react";
import { post } from "./api";

type Props = {
  onUpdated: () => Promise<void>;
  notify: (message: string) => void;
  close: () => void;
};
export default function IngredientCreate({ onUpdated, notify, close }: Props) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<"kg" | "L" | "个">("kg");
  const [stock, setStock] = useState("0");
  const [unitCost, setUnitCost] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [targetStock, setTargetStock] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [busy, close]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("请填写食材名称。");
      return;
    }
    if (
      !Number.isFinite(Number(stock)) ||
      Number(stock) < 0 ||
      !Number.isFinite(Number(unitCost)) ||
      Number(unitCost) < 0 ||
      !Number.isFinite(Number(reorderPoint)) ||
      Number(reorderPoint) < 0 ||
      !Number.isFinite(Number(targetStock)) ||
      Number(targetStock) <= 0
    ) {
      setError("请填写有效的库存数量、成本和补货目标。");
      return;
    }
    if (
      Math.abs(Number(unitCost) * 100 - Math.round(Number(unitCost) * 100)) >
      0.000001
    ) {
      setError("成本单价最多保留两位小数。");
      return;
    }
    if (Number(targetStock) < Number(reorderPoint)) {
      setError("目标库存不能低于补货提醒线。");
      return;
    }
    setBusy(true);
    try {
      await post("/api/inventory", {
        name: name.trim(),
        unit,
        stock: Number(stock),
        unitCost: Number(unitCost),
        reorderPoint: Number(reorderPoint),
        targetStock: Number(targetStock),
        supplier: supplier.trim(),
      });
      setSaved(true);
      try {
        await onUpdated();
        notify(`${name.trim()} 已加入库存，期初数量已记录。`);
        close();
      } catch {
        setError(
          "食材已保存，但工作台刷新失败。请关闭此窗口并刷新工作台，避免重复新增。",
        );
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "新增食材失败，请重试。",
      );
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
        aria-labelledby="ingredient-title"
      >
        <div className="modal-header">
          <h2 id="ingredient-title">新增库存食材</h2>
          <button
            className="icon-button"
            type="button"
            disabled={busy}
            onClick={close}
            aria-label="关闭新增食材"
            autoFocus
          >
            <X size={20} />
          </button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <fieldset
            disabled={busy || saved}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
          >
            <div className="form-grid">
              <label className="field">
                食材名称 *
                <input
                  className="form-input"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：鸡蛋"
                />
              </label>
              <label className="field">
                库存基本单位
                <select
                  className="form-select"
                  value={unit}
                  onChange={(event) =>
                    setUnit(event.target.value as typeof unit)
                  }
                >
                  <option value="kg">kg（千克）</option>
                  <option value="L">L（升）</option>
                  <option value="个">个</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                期初库存（{unit}）
                <input
                  className="form-input"
                  type="number"
                  required
                  min="0"
                  max="100000"
                  step="0.000001"
                  value={stock}
                  onChange={(event) => setStock(event.target.value)}
                />
              </label>
              <label className="field">
                成本单价（RM / {unit}）*
                <input
                  className="form-input"
                  type="number"
                  required
                  min="0"
                  max="100000"
                  step="0.01"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  placeholder="0.00"
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                补货提醒线（{unit}）
                <input
                  className="form-input"
                  type="number"
                  required
                  min="0"
                  max="100000"
                  step="0.000001"
                  value={reorderPoint}
                  onChange={(event) => setReorderPoint(event.target.value)}
                />
              </label>
              <label className="field">
                目标库存（{unit}）*
                <input
                  className="form-input"
                  type="number"
                  required
                  min="0.000001"
                  max="100000"
                  step="0.000001"
                  value={targetStock}
                  onChange={(event) => setTargetStock(event.target.value)}
                  placeholder="例如：20"
                />
              </label>
            </div>
            <label className="field">
              供应商
              <input
                className="form-input"
                maxLength={100}
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="供应商名称（可选）"
              />
            </label>
            <p className="form-hint">
              期初数量会写入库存流水。之后的采购请使用“入库”，销售时根据餐点配方自动扣料。期初库存和进货金额不会直接重复记作经营费用。
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
              className="button primary"
              type="submit"
              disabled={busy || saved}
            >
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <PackagePlus size={16} />
              )}
              新增食材
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
