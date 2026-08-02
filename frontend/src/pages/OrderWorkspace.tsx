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
  company_name?: string;
};

/** An order is done when production hits 100% OR it was completed via inward/force. */
const isDone = (o: Row) => Math.round(o.production_completed_percent ?? 0) >= 100 || !!o.completed;

/** Status badge: Draft (unsubmitted) → then fulfilment: Completed / Partially Completed / Pending. */
function orderStatus(o: Row): { label: string; cls: string } {
  if (Number(o.docstatus) === 2) return { label: "Rejected", cls: "mm-pill-muted" };
  if (Number(o.docstatus) === 0) return { label: "Pending Approval", cls: "mm-pill-pending" };
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
  // Available roll stock per "colour||cut" (for the shortage calc) + per-item PO overrides.
  const [availByKey, setAvailByKey] = useState<Record<string, number>>({});
  const [poByIndex, setPoByIndex] = useState<Record<number, { weight: number | ""; rate: number | ""; vendor: string }>>({});
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
    const f: unknown[] = [["docstatus", "<", 2]];
    if (q.trim()) f.push(["party", "like", `%${q.trim()}%`]);
    return f as unknown as undefined;
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
      "company_name",
    ],
    filters,
    limit: 200,
    orderBy: { field: "modified", order: "desc" },
  });

  // Colour lives on the order's child items — pull them once and map order → colours so
  // the list can show it alongside party/company.
  const { data: itemRows } = useFrappeGetDocList<{ parent: string; color_name?: string }>("MM Sales Order Item", {
    fields: ["parent", "color_name"],
    limit: 0,
  });
  const coloursByOrder = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const r of itemRows ?? []) {
      if (!r.parent || !r.color_name) continue;
      (m[r.parent] ||= []).includes(r.color_name) || m[r.parent].push(r.color_name);
    }
    return m;
  }, [itemRows]);

  const { data: doc, mutate: mutateDoc } = useFrappeGetDoc<Record<string, unknown>>("MM Sales Order", selected || undefined);
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
  const SO_API = "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order";
  const { call: approveOrder, loading: approving } = useFrappePostCall<{ message: { docstatus: number } }>(`${SO_API}.approve_order`);
  const { call: rejectOrder, loading: rejecting } = useFrappePostCall<{ message: { docstatus: number } }>(`${SO_API}.reject_order`);
  const { call: createPoForOrder } = useFrappePostCall("mahaveermetalic.mahaveer_metallic.api.stock.create_po_for_order");
  const { call: fetchAvailability } = useFrappePostCall<{ message: { color: string; cut: string; available: number }[] }>(
    "mahaveermetalic.mahaveer_metallic.api.stock.availability_for_lines",
  );
  // Companies of the chosen party (first pick party, then its company).
  const companiesCall = useFrappeGetCall<{ message: string[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.companies_for_party",
    header.party ? { party: header.party } : undefined,
    header.party ? `party-companies-${header.party}` : null,
  );
  const companies = companiesCall.data?.message ?? [];

  const itemKey = (it: { color_name: string; cut: string }) => `${it.color_name}||${it.cut || ""}`;
  const shortageOf = (it: Item) => Math.round(Math.max(0, (Number(it.qty_weight) || 0) - (availByKey[itemKey(it)] ?? 0)) * 1000) / 1000;

  // Refresh available roll stock for the current items → drives the shortage → PO table.
  useEffect(() => {
    const lines = items.filter((it) => it.color_name).map((it) => ({ color: it.color_name, cut: it.cut || "" }));
    if (lines.length === 0) { setAvailByKey({}); return; }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetchAvailability({ lines: JSON.stringify(lines) });
        if (cancelled) return;
        const m: Record<string, number> = {};
        for (const row of r?.message ?? []) m[`${row.color}||${row.cut || ""}`] = Number(row.available || 0);
        setAvailByKey(m);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [items, fetchAvailability]);

  // Party → auto-select the first company.
  useEffect(() => {
    if (header.party && !header.company && companies.length > 0) {
      setHeader((h) => ({ ...h, company: companies[0] }));
    }
  }, [companies, header.party, header.company]);

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
    // Prefill the PO row (rate/vendor) from the order's stored purchase fields.
    const po: Record<number, { weight: number | ""; rate: number | ""; vendor: string }> = {};
    docItems.forEach((r, i) => {
      if (r.purchase_party || r.purchase_rate) {
        po[i] = { weight: "", rate: (r.purchase_rate as number) || "", vendor: String(r.purchase_party ?? "") };
      }
    });
    setPoByIndex(po);
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
    setPoByIndex({});
    setAvailByKey({});
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
    // One order = one item (each item becomes its own order + its own shortage PO), so a
    // second item can only be added while building a NEW order, never onto a saved one.
    if (selected) return setFormError("This order holds one item. Close it and create a new order for another colour.");
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
    // poByIndex is keyed by the item's position — shift the keys above the removed row
    // down, otherwise the PO weight/rate/vendor attach to the wrong item (or vanish).
    setPoByIndex((prev) => {
      const next: typeof prev = {};
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k);
        if (idx === i) continue;
        next[idx > i ? idx - 1 : idx] = v;
      }
      return next;
    });
  }

  async function onSave() {
    setFormError(null);
    setFlash(null);
    if (!header.party) return setFormError("Choose the company / party.");
    if (header.delivery_date && header.transaction_date && header.delivery_date < header.transaction_date)
      return setFormError("Delivery date cannot be before the order date.");
    // Fold in an item typed into the builder but not yet "Added", so it isn't dropped.
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

    const headerPayload = {
      doctype: "MM Sales Order",
      naming_series: "MM-SO-.YYYY.-",
      transaction_date: header.transaction_date,
      delivery_date: header.delivery_date || null,
      party: header.party,
      company_name: header.company || null,
    };
    const lineFor = (it: Item, builderIndex: number, lineIdx: number) => ({
      ...(it.name ? { name: it.name } : {}),
      idx: lineIdx,
      color_name: it.color_name,
      cut: it.cut,
      delivery_date: it.delivery_date || null,
      qty_weight: it.qty_weight || 0,
      qty_box: it.qty_box || 0,
      sale_rate: it.sale_rate || 0,
      purchase_party: poByIndex[builderIndex]?.vendor || it.purchase_party || null,
      purchase_rate: poByIndex[builderIndex]?.rate || it.purchase_rate || 0,
    });

    // Create / update / remove the shortage PO for one saved order.
    async function syncPo(soName: string, builderIndex: number, it: Item) {
      const short = shortageOf(it);
      const po = poByIndex[builderIndex] ?? {};
      const wt = short <= 0 ? 0 : (po.weight === undefined || po.weight === "" ? short : Number(po.weight) || 0);
      try {
        await createPoForOrder({ sales_order: soName, qty_kg: wt, rate: Number(po.rate) || 0, supplier: po.vendor || undefined });
      } catch { /* PO sync is non-fatal to the order save */ }
    }

    try {
      if (selected) {
        await updateDoc("MM Sales Order", selected, { ...headerPayload, items: effectiveItems.map((it, i) => lineFor(it, i, i + 1)) });
        hydrated.current = null;
        // One PO per order (create_po_for_order binds to items[0]) — sync it from the
        // FIRST SHORT line, and only pass 0 (which deletes the PO) when no line is short.
        const shortIdx = effectiveItems.findIndex((it) => shortageOf(it) > 0);
        await syncPo(selected, shortIdx >= 0 ? shortIdx : 0, effectiveItems[shortIdx >= 0 ? shortIdx : 0]);
        await mutate();
        setFlash("Saved — pending admin approval.");
        toast(`Order ${selected} saved`);
        return;
      }

      // New: one Sales Order per item (pending approval). A rejected line skips only itself.
      const created: string[] = [];
      const skippedItems: Item[] = [];
      const skippedMsgs: string[] = [];
      for (let i = 0; i < effectiveItems.length; i++) {
        const it = effectiveItems[i];
        try {
          const res = await createDoc("MM Sales Order", { ...headerPayload, items: [lineFor(it, i, 1)] });
          const name = (res as { name?: string }).name;
          if (name) { created.push(name); await syncPo(name, i, it); }
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
      await mutate();
      if (skippedItems.length > 0) {
        setItems(skippedItems);
        setDraft(blankItem());
        setPoByIndex({});
        setFlash(`Saved ${created.join(", ")} (pending approval). ${skippedItems.length} item(s) need attention — ${skippedMsgs.join("; ")}`);
        toast(`Saved ${created.length}; ${skippedItems.length} need attention`, "info");
        return;
      }
      resetNew();
      setFlash(`Saved ${created.length} order${created.length > 1 ? "s" : ""} (pending admin approval): ${created.join(", ")}.`);
      toast(`Saved ${created.length} order${created.length > 1 ? "s" : ""}: ${created.join(", ")}`);
    } catch (e) {
      const msg = extractErrorMessage(e);
      setFormError(msg);
      toast(msg, "error");
    }
  }

  async function onApprove() {
    if (!selected) return;
    setFormError(null);
    const name = selected;
    try {
      await approveOrder({ sales_order: name });
      // Revalidate the SINGLE-doc cache too, else the form keeps the pre-approval
      // docstatus and stays editable with Approve/Reject showing.
      hydrated.current = null;
      await Promise.all([mutateDoc(), mutate()]);
      setFlash(`Order ${name} approved.`);
      toast(`Order ${name} approved`);
    } catch (e) { setFormError(extractErrorMessage(e)); }
  }

  async function onReject() {
    if (!selected) return;
    const name = selected;
    if (!window.confirm(`Reject order ${name}? A pending order is removed.`)) return;
    setFormError(null);
    try {
      await rejectOrder({ sales_order: name });
      resetNew(); // the pending order is gone — clear the form rather than show a stale doc
      await mutate();
      setFlash(`Order ${name} rejected.`);
      toast(`Order ${name} rejected`, "info");
    } catch (e) { setFormError(extractErrorMessage(e)); }
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

  const busy = creating || updating || deleting || approving || rejecting;
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

          {submitted && <div className="mm-banner mm-banner-ok">Approved — this order and its purchase order are locked.</div>}
          {!submitted && ro && <div className="mm-banner mm-banner-warn">Locked (production started). Only an admin can edit.</div>}
          {formError && <p className="mm-error">{formError}</p>}

          <div className="mm-form-grid">
            <FieldInput field={F.transaction_date} value={header.transaction_date} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, transaction_date: String(v ?? "") }))} />
            <FieldInput field={F.delivery_date} value={header.delivery_date} disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, delivery_date: String(v ?? "") }))} />
          </div>
          <div className="mm-form-grid">
            <PartyPicker label="Party" value={header.party} required disabled={ro} onChange={(v) => setHeader((h) => ({ ...h, party: v, company: "" }))} />
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

          {/* Item builder — new orders only (one order = one item). */}
          {!ro && !selected && (
            <div className="mm-ow-builder" onKeyDown={onBuilderKeyDown}>
              <div className="mm-ow-builder-title">Add item <span className="mm-kbd-hint">press Enter to add</span></div>
              <div className="mm-form-grid">
                <FieldInput field={F.color_name} value={draft.color_name} onChange={(v) => setDraft((d) => ({ ...d, color_name: String(v ?? "") }))} />
                <FieldInput field={F.cut} value={draft.cut} onChange={(v) => setDraft((d) => ({ ...d, cut: String(v ?? "") }))} />
                <FieldInput field={F.item_delivery_date} value={draft.delivery_date} onChange={(v) => setDraft((d) => ({ ...d, delivery_date: String(v ?? "") }))} />
                <FieldInput field={F.qty_weight} value={draft.qty_weight} onChange={(v) => setDraft((d) => ({ ...d, qty_weight: v as number }))} />
                <FieldInput field={F.qty_box} value={draft.qty_box} onChange={(v) => setDraft((d) => ({ ...d, qty_box: v as number }))} />
                <FieldInput field={F.sale_rate} value={draft.sale_rate} onChange={(v) => setDraft((d) => ({ ...d, sale_rate: v as number }))} />
              </div>
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
                    <th className="mm-num">Available</th>
                    <th className="mm-num">Short</th>
                    {!ro && <th />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const avail = availByKey[itemKey(it)];
                    const short = shortageOf(it);
                    return (
                      <tr key={i}>
                        <td>{it.color_name}</td>
                        <td>{it.cut || "—"}</td>
                        <td>{it.delivery_date || "—"}</td>
                        <td className="mm-num">{Number(it.qty_weight) || 0}</td>
                        <td className="mm-num">{Number(it.qty_box) || 0}</td>
                        <td className="mm-num">{Number(it.sale_rate) || 0}</td>
                        <td className="mm-num">{avail == null ? "…" : avail.toLocaleString()}</td>
                        <td className="mm-num">{short > 0 ? <span className="mm-var-over">{short.toLocaleString()}</span> : "—"}</td>
                        {!ro && (
                          <td className="mm-num">
                            <button type="button" className="mm-icon-btn" title="Remove" onClick={() => removeItem(i)}>
                              <X size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}><strong>{selected ? "Total" : `${items.length} separate order${items.length > 1 ? "s" : ""}`}</strong></td>
                    <td className="mm-num"><strong>{itemsTotal.toLocaleString()}</strong></td>
                    <td colSpan={ro ? 4 : 5} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Purchase Order — only for lines short on stock. Enough stock → no PO. */}
          {!ro && items.some((it) => shortageOf(it) > 0) && (
            <div className="mm-ow-po">
              <div className="mm-ow-po-head">
                <span className="mm-field-label" style={{ margin: 0 }}>Purchase Order (shortage)</span>
                <span className="mm-muted" style={{ fontSize: "0.78rem" }}>Raised on approval, only for the short quantity.</span>
              </div>
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense">
                  <thead>
                    <tr><th>Color</th><th className="mm-num">Purchase weight</th><th className="mm-num">Purchase rate</th><th>Vendor</th></tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const short = shortageOf(it);
                      if (short <= 0) return null;
                      const po = poByIndex[i] ?? {};
                      const wt = po.weight === undefined || po.weight === "" ? short : po.weight;
                      const setPo = (patch: Partial<{ weight: number | ""; rate: number | ""; vendor: string }>) =>
                        setPoByIndex((p) => ({ ...p, [i]: { weight: wt, rate: po.rate ?? "", vendor: po.vendor ?? "", ...patch } }));
                      return (
                        <tr key={i}>
                          <td>{it.color_name}{it.cut ? ` · ${it.cut}` : ""}</td>
                          <td className="mm-num">
                            <input className="mm-input mm-input-compact mm-iw-num" type="number" value={wt}
                              onChange={(e) => setPo({ weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                          </td>
                          <td className="mm-num">
                            <input className="mm-input mm-input-compact mm-iw-num" type="number" value={po.rate ?? ""}
                              onChange={(e) => setPo({ rate: e.target.value === "" ? "" : Number(e.target.value) })} />
                          </td>
                          <td>
                            <VendorSelect value={po.vendor ?? ""} onChange={(v) => setPo({ vendor: v })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
            {!ro && !selected && (
              <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onSave()}>
                {busy ? "Saving…" : "Save order"}
              </button>
            )}
            {!ro && selected && (
              <button type="button" className="mm-btn-secondary" disabled={busy} onClick={() => void onSave()}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            )}
            {selected && !ro && isAdmin() && (
              <>
                <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onApprove()} title="Approve — makes the order usable in inward">
                  {approving ? "Approving…" : "Approve"}
                </button>
                <button type="button" className="mm-btn-danger" disabled={busy} onClick={() => void onReject()}>
                  {rejecting ? "…" : "Reject"}
                </button>
              </>
            )}
            {selected && !ro && !isAdmin() && (
              <span className="mm-pill mm-pill-pending">Pending admin approval</span>
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
                  <th>Company</th>
                  <th>Color</th>
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
                      <td>{o.company_name || "—"}</td>
                      <td>{coloursByOrder[o.name]?.join(", ") || "—"}</td>
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
                  <tr><td colSpan={7} className="mm-empty">No orders.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

/* Vendor picker for the shortage PO rows. */
function VendorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useFrappeGetDocList<{ name: string; vendor_name?: string }>("MM Vendor Master", {
    fields: ["name", "vendor_name"],
    limit: 0,
    orderBy: { field: "vendor_name", order: "asc" },
  });
  const rows = data ?? [];
  return (
    <select className="mm-input mm-input-compact" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— vendor —</option>
      {value && !rows.some((v) => v.name === value) && <option value={value}>{value}</option>}
      {rows.map((v) => <option key={v.name} value={v.name}>{v.vendor_name || v.name}</option>)}
    </select>
  );
}
