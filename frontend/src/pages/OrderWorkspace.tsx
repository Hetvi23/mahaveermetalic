import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappePostCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { FieldSchema } from "@/config/registry";
import { FieldInput } from "@/components/FieldInputs";
import PartyPicker from "@/components/PartyPicker";
import SalesOrderStockPanel from "@/components/SalesOrderStockPanel";
import { toast } from "@/components/Toaster";
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
  color_name: { fieldname: "color_name", label: "Color", fieldtype: "Link", options: "MM Item Master", reqd: true },
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
  completed?: number;
  completion_mode?: string;
  docstatus?: number;
};

/** An order is done when production hits 100% OR it was completed via inward/force. */
const isDone = (o: Row) => Math.round(o.production_completed_percent ?? 0) >= 100 || !!o.completed;

/** Status badge: Draft (unsubmitted) → then fulfilment: Completed / Partially Completed / Pending. */
function orderStatus(o: Row): { label: string; cls: string } {
  if (Number(o.docstatus) === 0) return { label: "Draft", cls: "mm-pill-muted" };
  if (isDone(o)) return { label: "Completed", cls: "mm-pill-ok" };
  if ((o.inwarded_weight ?? 0) > 0 || (o.production_completed_percent ?? 0) > 0)
    return { label: "Partially Completed", cls: "mm-pill-pending" };
  return { label: "Pending", cls: "mm-pill-muted" };
}

function isAdmin(): boolean {
  const roles =
    (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot?.user?.roles ?? [];
  return roles.includes("Administrator") || roles.includes("MM Admin");
}

export default function OrderWorkspace() {
  const [selected, setSelected] = useState<string | null>(null);
  const [header, setHeader] = useState({ transaction_date: today(), delivery_date: "", party: "", company: "" });
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Item>(blankItem());
  const [locked, setLocked] = useState(false);
  const [prodPct, setProdPct] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const hydrated = useRef<string | null>(null);

  // Only search is server-side; the pending/completed chip is filtered client-side because
  // "completed" now means production 100% OR the inward/force completed flag (an OR the
  // list query can't express cleanly).
  const filters = useMemo(() => {
    const f: unknown[] = [];
    if (q.trim()) f.push(["party", "like", `%${q.trim()}%`]);
    return f.length ? (f as unknown as undefined) : undefined;
  }, [q]);

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
      "completed",
      "completion_mode",
      "docstatus",
    ],
    filters,
    limit: 200,
    orderBy: { field: "modified", order: "desc" },
  });

  const { data: doc } = useFrappeGetDoc<Record<string, unknown>>("MM Sales Order", selected || undefined);
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
  const { call: submitOrder, loading: submitting } = useFrappePostCall<{ message: { docstatus: number } }>(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order.submit_order",
  );
  // Companies of the chosen party (first pick party, then its company).
  const companiesCall = useFrappeGetCall<{ message: string[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.companies_for_party",
    header.party ? { party: header.party } : undefined,
    header.party ? `party-companies-${header.party}` : null,
  );
  const companies = companiesCall.data?.message ?? [];

  useEffect(() => {
    if (!selected || !doc || String(doc.name) !== selected) return;
    const stamp = `${String(doc.name)}:${String(doc.modified)}`;
    if (hydrated.current === stamp) return;
    hydrated.current = stamp;
    setHeader({
      transaction_date: String(doc.transaction_date || today()),
      delivery_date: doc.delivery_date ? String(doc.delivery_date) : "",
      party: String(doc.party || ""),
      company: String(doc.company_name || ""),
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

  // A submitted order is final: read-only for everyone. A draft locked at 5% production
  // is read-only for non-admins.
  const submitted = !!selected && Number((doc as { docstatus?: number } | undefined)?.docstatus) === 1;
  const ro = submitted || (locked && !isAdmin());

  function resetNew() {
    setSelected(null);
    hydrated.current = null;
    setHeader({ transaction_date: today(), delivery_date: "", party: "", company: "" });
    setItems([]);
    setDraft(blankItem());
    setLocked(false);
    setProdPct(0);
    setFormError(null);
  }

  // Shared item rules (also enforced server-side in mm_sales_order._validate_lines).
  function itemError(d: Item): string | null {
    if (!d.color_name.trim()) return "Pick a colour for the item.";
    if (d.cut.trim() && /[A-Za-z]/.test(d.cut)) return "Size must not contain letters (digits only, e.g. 50/85).";
    const w = Number(d.qty_weight) || 0;
    const b = Number(d.qty_box) || 0;
    if (w < 0 || b < 0) return "Weight and box cannot be negative.";
    if (!(w > 0) && !(b > 0)) return "Enter a weight or a box quantity (at least one).";
    if (d.sale_rate === "" || Number(d.sale_rate) < 0) return "Enter a valid (non-negative) sale rate.";
    if (d.purchase_rate !== "" && Number(d.purchase_rate) < 0) return "Purchase rate cannot be negative.";
    return null;
  }

  function addItem() {
    const err = itemError(draft);
    if (err) return setFormError(err);
    setFormError(null);
    setItems((prev) => [...prev, draft]);
    setDraft(blankItem());
  }

  // Keyboard: Enter anywhere in the item builder adds the item (no mouse needed) — but
  // leave Enter alone while a colour/supplier dropdown is open so it can pick a suggestion.
  function onBuilderKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    // Cmd/Ctrl+Enter saves the whole order from anywhere in the builder.
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); void onSave(); return; }
    const el = e.target as HTMLElement;
    if (el.tagName === "TEXTAREA") return;
    if (el.closest(".mm-link-wrap")?.querySelector(".mm-suggest")) return;
    e.preventDefault();
    addItem();
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }

  async function onSave(submitAfter = false) {
    setFormError(null);
    setFlash(null);
    if (!header.party) return setFormError("Choose the company / party.");
    if (header.delivery_date && header.transaction_date && header.delivery_date < header.transaction_date)
      return setFormError("Delivery date cannot be before the order date.");
    // Fold in an item that was typed into the builder but not yet "Added", so it
    // isn't silently dropped on save.
    let effectiveItems = items;
    if (draft.color_name.trim()) {
      const err = itemError(draft);
      if (err) return setFormError(err);
      effectiveItems = [...items, draft];
      setItems(effectiveItems);
      setDraft(blankItem());
    }
    if (effectiveItems.length === 0) return setFormError("Add at least one item.");
    for (const it of effectiveItems) {
      if (it.delivery_date && header.transaction_date && it.delivery_date < header.transaction_date)
        return setFormError("An item's delivery date is before the order date.");
    }
    const payload: Record<string, unknown> = {
      doctype: "MM Sales Order",
      naming_series: "MM-SO-.YYYY.-",
      transaction_date: header.transaction_date,
      delivery_date: header.delivery_date || null,
      party: header.party,
      company_name: header.company || null,
      items: effectiveItems.map((it, idx) => ({
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
    async function submitAll(names: string[]) {
      const errs: string[] = [];
      for (const n of names) {
        try { await submitOrder({ sales_order: n }); }
        catch (e) { errs.push(`${n}: ${extractErrorMessage(e)}`); }
      }
      return errs;
    }

    try {
      if (selected) {
        // Editing an existing draft: save, then optionally submit (locks order + PO).
        await updateDoc("MM Sales Order", selected, payload);
        hydrated.current = null;
        if (submitAfter) {
          const errs = await submitAll([selected]);
          await mutate();
          if (errs.length) return setFormError(`Submit failed: ${errs.join("; ")}`);
          setFlash(`Order ${selected} submitted.`);
          toast(`Order ${selected} submitted`);
        } else {
          await mutate();
          setFlash("Saved as draft.");
          toast(`Draft ${selected} saved`);
        }
        return;
      }

      // New: one Sales Order per item (each item = its own SO + its own PO), created as
      // drafts. A rejected line (e.g. duplicate-order guard) only skips that item.
      const created: string[] = [];
      const skippedItems: Item[] = [];
      const skippedMsgs: string[] = [];
      for (const it of effectiveItems) {
        const oneLine = {
          idx: 1,
          color_name: it.color_name,
          cut: it.cut,
          delivery_date: it.delivery_date || null,
          qty_weight: it.qty_weight || 0,
          qty_box: it.qty_box || 0,
          sale_rate: it.sale_rate || 0,
          purchase_party: it.purchase_party || null,
          purchase_rate: it.purchase_rate || 0,
        };
        try {
          const res = await createDoc("MM Sales Order", { ...payload, items: [oneLine] });
          const name = (res as { name?: string }).name;
          if (name) created.push(name);
        } catch (e) {
          skippedItems.push(it);
          skippedMsgs.push(`${it.color_name}${it.cut ? "/" + it.cut : ""}: ${extractErrorMessage(e)}`);
        }
      }
      if (created.length === 0) {
        await mutate();
        setFormError(`No orders created. ${skippedMsgs.join("; ")}`);
        return;
      }
      let subNote = "";
      if (submitAfter) {
        const errs = await submitAll(created);
        if (errs.length) subNote = ` Submit issues: ${errs.join("; ")}`;
      }
      await mutate();
      const verb = submitAfter ? "Submitted" : "Saved draft";
      if (skippedItems.length > 0) {
        setItems(skippedItems);
        setDraft(blankItem());
        setFlash(`${verb} ${created.join(", ")}.${subNote} ${skippedItems.length} item(s) need attention — ${skippedMsgs.join("; ")}`);
        toast(`${verb} ${created.length}; ${skippedItems.length} need attention`, "info");
        return;
      }
      resetNew();
      setFlash(`${verb} ${created.length} order${created.length > 1 ? "s" : ""}: ${created.join(", ")}.${subNote}`);
      toast(`${verb} ${created.length} order${created.length > 1 ? "s" : ""}: ${created.join(", ")}`);
    } catch (e) {
      const msg = extractErrorMessage(e);
      setFormError(msg);
      toast(msg, "error");
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

  const busy = creating || updating || deleting || submitting;
  const list = (rows ?? []).filter((o) => {
    if (chip === "completed") return isDone(o);
    if (chip === "pending") return !isDone(o);
    return true;
  });
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

          {submitted && <div className="mm-banner mm-banner-ok">Submitted — this order and its purchase order are locked.</div>}
          {!submitted && ro && <div className="mm-banner mm-banner-warn">Locked (production started). Only an admin can edit.</div>}
          {formError && <p className="mm-error">{formError}</p>}

          <div className="mm-form-grid">
            <FieldInput field={F.transaction_date} value={header.transaction_date} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, transaction_date: String(v ?? "") }))} />
            <FieldInput field={F.delivery_date} value={header.delivery_date} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, delivery_date: String(v ?? "") }))} />
          </div>
          <div className="mm-form-grid">
            <PartyPicker value={header.party} required disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, party: v, company: "" }))} />
            <label className="mm-field">
              <span className="mm-field-label">Company</span>
              <select className="mm-input" value={header.company} disabled={ro || !header.party}
                onChange={(e) => setHeader((h) => ({ ...h, company: e.target.value }))}>
                <option value="">{!header.party ? "Pick a party first" : companiesCall.isLoading ? "Loading…" : "— select company —"}</option>
                {header.company && !companies.includes(header.company) && <option value={header.company}>{header.company}</option>}
                {companies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          {/* Item builder */}
          {!ro && (
            <div className="mm-ow-builder" onKeyDown={onBuilderKeyDown}>
              <div className="mm-ow-builder-title">Add item <span className="mm-kbd-hint">press Enter to add</span></div>
              <div className="mm-form-grid">
                <FieldInput field={F.color_name} value={draft.color_name} onChange={(v) => setDraft((d) => ({ ...d, color_name: String(v ?? "") }))} />
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
                    <td colSpan={3}><strong>{selected ? "Total" : `${items.length} separate order${items.length > 1 ? "s" : ""}`}</strong></td>
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
              <SalesOrderStockPanel docname={selected} readOnly={submitted} />
            </>
          )}

          <div className="mm-ws-form-actions">
            {!ro && (
              <>
                <button type="button" className="mm-btn-secondary" disabled={busy} onClick={() => void onSave(false)}>
                  {busy ? "Saving…" : "Save Draft"}
                </button>
                <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onSave(true)}>
                  {busy ? "Working…" : "Submit"}
                </button>
              </>
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
                  const done = isDone(o);
                  const st = orderStatus(o);
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
                        <span className={`mm-pill ${st.cls}`}>{st.label}</span>
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
