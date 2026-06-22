import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { FieldSchema } from "@/config/registry";
import { FieldInput } from "@/components/FieldInputs";
import SalesOrderStockPanel from "@/components/SalesOrderStockPanel";
import { extractErrorMessage } from "@/utils/frappeError";

const today = () => new Date().toISOString().slice(0, 10);

type Item = {
  name?: string;
  color_name: string;
  cut: string;
  delivery_date: string;
  qty_weight: number | "";
  qty_box: number | "";
  sale_rate: number | "";
  purchase_party: string;
  purchase_rate: number | "";
};

const blankItem = (): Item => ({
  color_name: "",
  cut: "",
  delivery_date: "",
  qty_weight: "",
  qty_box: "",
  sale_rate: "",
  purchase_party: "",
  purchase_rate: "",
});

const F: Record<string, FieldSchema> = {
  transaction_date: { fieldname: "transaction_date", label: "Order date", fieldtype: "Date", reqd: true },
  delivery_date: { fieldname: "delivery_date", label: "Delivery date", fieldtype: "Date" },
  party: { fieldname: "party", label: "Company / Party", fieldtype: "Link", options: "MM Party Master", reqd: true },
  cut: { fieldname: "cut", label: "Size", fieldtype: "Data" },
  item_delivery_date: { fieldname: "delivery_date", label: "Delivery date", fieldtype: "Date" },
  qty_weight: { fieldname: "qty_weight", label: "Weight (Kg)", fieldtype: "Float" },
  qty_box: { fieldname: "qty_box", label: "Box", fieldtype: "Float" },
  sale_rate: { fieldname: "sale_rate", label: "Sale rate", fieldtype: "Currency", reqd: true },
  purchase_party: { fieldname: "purchase_party", label: "Supplier", fieldtype: "Link", options: "MM Vendor Master" },
  purchase_rate: { fieldname: "purchase_rate", label: "Purchase rate", fieldtype: "Currency" },
};

type Chip = "all" | "pending" | "completed";

type Row = {
  name: string;
  transaction_date?: string;
  delivery_date?: string | null;
  party?: string;
  ordered_weight?: number;
  inwarded_weight?: number;
  required_weight?: number;
  production_completed_percent?: number | null;
  order_locked?: number;
};

function isAdmin(): boolean {
  const roles =
    (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot?.user?.roles ?? [];
  return roles.includes("Administrator") || roles.includes("MM Admin");
}

export default function OrderWorkspace() {
  const [selected, setSelected] = useState<string | null>(null);
  const [header, setHeader] = useState({ transaction_date: today(), delivery_date: "", party: "" });
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Item>(blankItem());
  const [locked, setLocked] = useState(false);
  const [prodPct, setProdPct] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const hydrated = useRef<string | null>(null);

  // Colour suggestions (our "colours" live in Item Master) for the datalist.
  const { data: colorOpts } = useFrappeGetDocList<{ name: string; item_name?: string }>("MM Item Master", {
    fields: ["name", "item_name"],
    limit: 500,
  });

  const filters = useMemo(() => {
    const f: unknown[] = [];
    if (q.trim()) f.push(["party", "like", `%${q.trim()}%`]);
    if (chip === "pending") f.push(["production_completed_percent", "<", 100]);
    if (chip === "completed") f.push(["production_completed_percent", ">=", 100]);
    return f.length ? (f as unknown as undefined) : undefined;
  }, [q, chip]);

  const { data: rows, isLoading, mutate } = useFrappeGetDocList<Row>("MM Sales Order", {
    fields: [
      "name",
      "transaction_date",
      "delivery_date",
      "party",
      "ordered_weight",
      "inwarded_weight",
      "required_weight",
      "production_completed_percent",
      "order_locked",
    ],
    filters,
    limit: 200,
    orderBy: { field: "modified", order: "desc" },
  });

  const { data: doc } = useFrappeGetDoc<Record<string, unknown>>("MM Sales Order", selected || undefined);
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();

  useEffect(() => {
    if (!selected || !doc || String(doc.name) !== selected) return;
    const stamp = `${String(doc.name)}:${String(doc.modified)}`;
    if (hydrated.current === stamp) return;
    hydrated.current = stamp;
    setHeader({
      transaction_date: String(doc.transaction_date || today()),
      delivery_date: doc.delivery_date ? String(doc.delivery_date) : "",
      party: String(doc.party || ""),
    });
    const docItems = (doc.items as Record<string, unknown>[] | undefined) || [];
    setItems(
      docItems.map((r) => ({
        name: r.name as string,
        color_name: String(r.color_name ?? ""),
        cut: String(r.cut ?? ""),
        delivery_date: r.delivery_date ? String(r.delivery_date) : "",
        qty_weight: (r.qty_weight as number) ?? "",
        qty_box: (r.qty_box as number) ?? "",
        sale_rate: (r.sale_rate as number) ?? "",
        purchase_party: String(r.purchase_party ?? ""),
        purchase_rate: (r.purchase_rate as number) ?? "",
      })),
    );
    setLocked(Boolean(doc.order_locked));
    setProdPct(Math.round((doc.production_completed_percent as number) ?? 0));
  }, [doc, selected]);

  const ro = locked && !isAdmin();

  function resetNew() {
    setSelected(null);
    hydrated.current = null;
    setHeader({ transaction_date: today(), delivery_date: "", party: "" });
    setItems([]);
    setDraft(blankItem());
    setLocked(false);
    setProdPct(0);
    setFormError(null);
  }

  function addItem() {
    if (!draft.color_name.trim()) return setFormError("Pick a colour for the item.");
    const hasWeight = !!draft.qty_weight && Number(draft.qty_weight) > 0;
    const hasBox = !!draft.qty_box && Number(draft.qty_box) > 0;
    if (!hasWeight && !hasBox) return setFormError("Enter a weight or a box quantity (at least one).");
    if (draft.sale_rate === "" || Number(draft.sale_rate) < 0) return setFormError("Enter the sale rate.");
    setFormError(null);
    setItems((prev) => [...prev, draft]);
    setDraft(blankItem());
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }

  async function onSave() {
    setFormError(null);
    setFlash(null);
    if (!header.party) return setFormError("Choose the company / party.");
    if (items.length === 0) return setFormError("Add at least one item.");
    const payload: Record<string, unknown> = {
      doctype: "MM Sales Order",
      naming_series: "MM-SO-.YYYY.-",
      transaction_date: header.transaction_date,
      delivery_date: header.delivery_date || null,
      party: header.party,
      items: items.map((it, idx) => ({
        ...(it.name ? { name: it.name } : {}),
        idx: idx + 1,
        color_name: it.color_name,
        cut: it.cut,
        delivery_date: it.delivery_date || null,
        qty_weight: it.qty_weight || 0,
        qty_box: it.qty_box || 0,
        sale_rate: it.sale_rate || 0,
        purchase_party: it.purchase_party || null,
        purchase_rate: it.purchase_rate || 0,
      })),
    };
    try {
      if (selected) {
        await updateDoc("MM Sales Order", selected, payload);
        hydrated.current = null;
        setFlash("Saved.");
      } else {
        const res = await createDoc("MM Sales Order", payload);
        const name = (res as { name?: string }).name;
        await mutate();
        if (name) {
          setSelected(name);
          setFlash("Order created.");
        }
        return;
      }
      await mutate();
    } catch (e) {
      setFormError(extractErrorMessage(e));
    }
  }

  async function onDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected}?`)) return;
    try {
      await deleteDoc("MM Sales Order", selected);
      resetNew();
      setFlash("Deleted.");
      await mutate();
    } catch (e) {
      setFormError(extractErrorMessage(e));
    }
  }

  const busy = creating || updating || deleting;
  const list = rows ?? [];
  const itemsTotal = items.reduce((s, it) => s + (Number(it.qty_weight) || 0), 0);

  return (
    <div className="mm-ow">
      <header className="mm-ws-head">
        <div>
          <h1 className="mm-page-title">Sales Orders</h1>
          <p className="mm-page-sub">Create an order, then track inwards against it — all on one screen.</p>
        </div>
      </header>

      <div className="mm-ow-grid">
        {/* LEFT — order builder */}
        <section className="mm-card mm-ow-form">
          <div className="mm-ws-form-head">
            <h2 className="mm-panel-title">{selected ? `Editing ${selected}` : "New order"}</h2>
            {selected && (
              <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={resetNew} title="Close — back to new order">
                <X size={14} /> Close
              </button>
            )}
          </div>

          {ro && <div className="mm-banner mm-banner-warn">Locked (production started). Only an admin can edit.</div>}
          {formError && <p className="mm-error">{formError}</p>}

          <div className="mm-form-grid">
            <FieldInput field={F.transaction_date} value={header.transaction_date} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, transaction_date: String(v ?? "") }))} />
            <FieldInput field={F.delivery_date} value={header.delivery_date} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, delivery_date: String(v ?? "") }))} />
          </div>
          <FieldInput field={F.party} value={header.party} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, party: String(v ?? "") }))} />

          {/* Item builder */}
          {!ro && (
            <div className="mm-ow-builder">
              <div className="mm-ow-builder-title">Add item</div>
              <datalist id="mm-color-opts">
                {(colorOpts ?? []).map((c) => (
                  <option key={c.name} value={c.item_name || c.name} />
                ))}
              </datalist>
              <div className="mm-form-grid">
                <label className="mm-field">
                  <span className="mm-field-label">Color *</span>
                  <input className="mm-input" list="mm-color-opts" value={draft.color_name} onChange={(e) => setDraft((d) => ({ ...d, color_name: e.target.value }))} />
                </label>
                <FieldInput field={F.cut} value={draft.cut} onChange={(v) => setDraft((d) => ({ ...d, cut: String(v ?? "") }))} />
                <FieldInput field={F.item_delivery_date} value={draft.delivery_date} onChange={(v) => setDraft((d) => ({ ...d, delivery_date: String(v ?? "") }))} />
                <FieldInput field={F.qty_weight} value={draft.qty_weight} onChange={(v) => setDraft((d) => ({ ...d, qty_weight: v as number }))} />
                <FieldInput field={F.qty_box} value={draft.qty_box} onChange={(v) => setDraft((d) => ({ ...d, qty_box: v as number }))} />
                <FieldInput field={F.sale_rate} value={draft.sale_rate} onChange={(v) => setDraft((d) => ({ ...d, sale_rate: v as number }))} />
                <FieldInput field={F.purchase_rate} value={draft.purchase_rate} onChange={(v) => setDraft((d) => ({ ...d, purchase_rate: v as number }))} />
              </div>
              <FieldInput field={F.purchase_party} value={draft.purchase_party} onChange={(v) => setDraft((d) => ({ ...d, purchase_party: String(v ?? "") }))} />
              <button type="button" className="mm-btn-secondary mm-ow-additem" onClick={addItem}>
                <Plus size={15} /> Add item
              </button>
            </div>
          )}

          {/* Items list */}
          {items.length > 0 && (
            <div className="mm-ow-items">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr>
                    <th>Color</th>
                    <th>Size</th>
                    <th>Delivery</th>
                    <th className="mm-num">Wt</th>
                    <th className="mm-num">Box</th>
                    <th className="mm-num">Rate</th>
                    <th>Supplier</th>
                    {!ro && <th />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.color_name}</td>
                      <td>{it.cut || "—"}</td>
                      <td>{it.delivery_date || "—"}</td>
                      <td className="mm-num">{Number(it.qty_weight) || 0}</td>
                      <td className="mm-num">{Number(it.qty_box) || 0}</td>
                      <td className="mm-num">{Number(it.sale_rate) || 0}</td>
                      <td>{it.purchase_party || "—"}</td>
                      {!ro && (
                        <td className="mm-num">
                          <button type="button" className="mm-icon-btn" title="Remove" onClick={() => removeItem(i)}>
                            <X size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}><strong>Total</strong></td>
                    <td className="mm-num"><strong>{itemsTotal.toLocaleString()}</strong></td>
                    <td colSpan={ro ? 3 : 4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Fulfilment + stock panel when editing */}
          {selected && (
            <>
              <div className="mm-ow-prod">Production: <strong>{prodPct}%</strong></div>
              <SalesOrderStockPanel docname={selected} />
            </>
          )}

          <div className="mm-ws-form-actions">
            {!ro && (
              <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onSave()}>
                {busy ? "Saving…" : selected ? "Save changes" : "Create order"}
              </button>
            )}
            {selected && !ro && (
              <button type="button" className="mm-btn-danger" disabled={busy} onClick={() => void onDelete()}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            {flash && <span className="mm-ws-flash">{flash}</span>}
          </div>
        </section>

        {/* RIGHT — orders list */}
        <section className="mm-card mm-ow-list">
          <div className="mm-ow-list-head">
            <div className="mm-chips">
              {(["all", "pending", "completed"] as Chip[]).map((c) => (
                <button key={c} type="button" className={`mm-chip ${chip === c ? "mm-chip-active" : ""}`} onClick={() => setChip(c)}>
                  {c[0].toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
            <div className="mm-search-wrap mm-ow-search">
              <Search size={15} className="mm-search-icon" aria-hidden />
              <input className="mm-input mm-search-pill" placeholder="Search party…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="mm-pill mm-pill-muted">{isLoading ? "…" : list.length}</span>
          </div>

          <div className="mm-table-scroll mm-ow-table-scroll">
            <table className="mm-table mm-table-hover">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Party</th>
                  <th>Delivery</th>
                  <th className="mm-ow-fulfil-col">Inwards / Required</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const ordered = o.ordered_weight ?? 0;
                  const inw = o.inwarded_weight ?? 0;
                  const req = o.required_weight ?? 0;
                  const pct = ordered > 0 ? Math.min(100, Math.round((inw / ordered) * 100)) : 0;
                  const done = Math.round(o.production_completed_percent ?? 0) >= 100;
                  const overdue = !!o.delivery_date && !done && o.delivery_date < today();
                  return (
                    <tr key={o.name} className={`mm-ws-row ${selected === o.name ? "mm-ws-row-active" : ""}`} onClick={() => { setSelected(o.name); setFlash(null); setFormError(null); }}>
                      <td className="mm-ow-cell-order">{o.name}</td>
                      <td>{o.party || "—"}</td>
                      <td className={overdue ? "mm-open-overdue" : undefined}>{o.delivery_date || "—"}{overdue ? " · overdue" : ""}</td>
                      <td>
                        <div className="mm-ow-fulfil">
                          <span className="mm-open-bar"><span className="mm-open-bar-fill" style={{ width: `${pct}%` }} /></span>
                          <span className="mm-ow-fulfil-txt">{inw.toLocaleString()}/{ordered.toLocaleString()} · req {req.toLocaleString()}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`mm-pill ${done ? "mm-pill-ok" : "mm-pill-pending"}`}>{done ? "Completed" : "Pending"}</span>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && list.length === 0 && (
                  <tr><td colSpan={5} className="mm-empty">No orders.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
