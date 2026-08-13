import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import SearchSelect from "@/components/SearchSelect";
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

const SO_API_PATH = "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order";

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

/**
 * Status badge: Draft (unsubmitted) → then fulfilment.
 *
 * "Material In" and "Completed" are kept apart on purpose: an order whose INWARD matched
 * the ordered weight has its raw material in, but nothing has been made or sent yet —
 * calling that Completed read as though the job were finished. Production, dispatch and a
 * force-close are the real completions.
 */
function orderStatus(o: Row): { label: string; cls: string } {
  if (Number(o.docstatus) === 2) return { label: "Rejected", cls: "mm-pill-muted" };
  if (Number(o.docstatus) === 0) return { label: "Pending Approval", cls: "mm-pill-pending" };
  if (o.completed && o.completion_mode === "Inward" && Math.round(o.production_completed_percent ?? 0) < 100)
    return { label: "Material In", cls: "mm-pill-pending" };
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
  // The pre-save purchase dialog: `poSheet` holds the items awaiting a decision (null =
  // closed), `poDraft` the supplier/rate/weight being entered for them.
  const [poSheet, setPoSheet] = useState<Item[] | null>(null);
  const [poDraft, setPoDraft] = useState<Record<number, { weight: number | ""; rate: number | ""; vendor: string }>>({});
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

  // Colour lives on the order's child items. Reading `MM Sales Order Item` straight from
  // the client returns nothing (Frappe refuses a child-table get_list over REST without a
  // parent), which left the list's Color column blank — so ask the server for the map.
  const { data: colourData } = useFrappeGetCall<{ message: Record<string, string[]> }>(
    `${SO_API_PATH}.order_colours`,
    undefined,
    "mm-so-colours",
  );
  const coloursByOrder = useMemo(() => colourData?.message ?? {}, [colourData]);

  const { data: doc, mutate: mutateDoc } = useFrappeGetDoc<Record<string, unknown>>("MM Sales Order", selected || undefined);

  // Purchase orders already raised against the open order — shown as the three details at
  // the end of the form. Creating/updating them happens in the pre-save dialog.
  const { data: poRows, mutate: mutatePos } = useFrappeGetDocList<{ name: string; qty_kg?: number; rate?: number; supplier?: string; so_item?: string; docstatus?: number }>(
    "MM Purchase Order",
    {
      fields: ["name", "qty_kg", "rate", "supplier", "so_item", "docstatus"],
      filters: selected ? ([["sales_order", "=", selected]] as unknown as undefined) : undefined,
      limit: 0,
    },
    selected ? `mm-so-pos-${selected}` : null,
  );
  const orderPos = useMemo(() => poRows ?? [], [poRows]);

  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
  const SO_API = "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order";
  const { call: approveOrder, loading: approving } = useFrappePostCall<{ message: { docstatus: number } }>(`${SO_API}.approve_order`);
  const { call: rejectOrder, loading: rejecting } = useFrappePostCall<{ message: { docstatus: number } }>(`${SO_API}.reject_order`);
  // One draft PO per short line, and ONLY for the lines the user ticked in the purchase
  // dialog — nothing is raised implicitly on save any more.
  const { call: syncShortagePos } = useFrappePostCall("mahaveermetalic.mahaveer_metallic.api.stock.sync_shortage_pos");
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

  /**
   * Shortage for a line against a known availability map.
   *
   * An UNKNOWN availability (not yet fetched — e.g. the size was just edited, which
   * changes the lookup key) must never be read as "zero stock", or a well-stocked line
   * looks fully short and wrongly triggers the purchase dialog. Unknown → no shortage;
   * the save path re-fetches before it decides anything.
   */
  const shortageIn = (avail: Record<string, number>, it: Item) => {
    const a = avail[itemKey(it)];
    if (a === undefined) return 0;
    return Math.round(Math.max(0, (Number(it.qty_weight) || 0) - a) * 1000) / 1000;
  };
  const shortageOf = (it: Item) => shortageIn(availByKey, it);
  const availKnown = (it: Item) => availByKey[itemKey(it)] !== undefined;

  /** Fetch availability for these lines, publish it to the table, and return the map. */
  const loadAvailability = useCallback(
    async (list: Item[]): Promise<Record<string, number>> => {
      const lines = list.filter((it) => it.color_name).map((it) => ({ color: it.color_name, cut: it.cut || "" }));
      if (lines.length === 0) { setAvailByKey({}); return {}; }
      try {
        const r = await fetchAvailability({ lines: JSON.stringify(lines), exclude_order: selected || undefined });
        const m: Record<string, number> = {};
        for (const row of r?.message ?? []) m[`${row.color}||${row.cut || ""}`] = Number(row.available || 0);
        setAvailByKey(m);
        return m;
      } catch {
        return {};
      }
    },
    [fetchAvailability, selected],
  );

  // Keep stock info live for the queued items AND whatever is in the form. Only the
  // colour/size are dependencies — weight doesn't change what's in stock, and refetching
  // on every keystroke of it would be pointless traffic.
  useEffect(() => {
    void loadAvailability(draft.color_name.trim() ? [...items, draft] : items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, draft.color_name, draft.cut, loadAvailability]);

  /**
   * Purchase rows for the open order: one per line that already HAS a purchase order or is
   * short on stock, so purchase details can be added or corrected without re-saving the
   * whole order. Keyed by the line's idx — an order carries one item, so normally one row.
   */
  const [poEdit, setPoEdit] = useState<Record<number, { weight: number | ""; rate: number | ""; vendor: string }>>({});
  const [savingPo, setSavingPo] = useState(false);

  /** The purchase order already covering a line, if there is one. */
  const poForItem = (it: Item, lines: Item[]) =>
    orderPos.find((p) => p.so_item && p.so_item === it.name) ?? (lines.length === 1 ? orderPos[0] : undefined);

  const purchaseLines = useMemo(() => {
    if (!selected) return [];
    const lines = draft.color_name.trim() ? [draft, ...items] : items;
    return lines
      .map((it, i) => ({ idx: i + 1, item: it, po: poForItem(it, lines) }))
      .filter((r) => r.po || shortageOf(r.item) > 0);
  }, [selected, draft, items, orderPos, availByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the editors from whatever is already on the purchase orders.
  useEffect(() => {
    setPoEdit(
      Object.fromEntries(
        purchaseLines.map((r) => [r.idx, {
          weight: (r.po?.qty_kg as number | undefined) ?? ("" as number | ""),
          rate: (r.po?.rate as number | undefined) ?? r.item.purchase_rate ?? "",
          vendor: r.po?.supplier || r.item.purchase_party || "",
        }]),
      ),
    );
  }, [purchaseLines]);

  /** Save the purchase details typed into the order view. Weight 0 removes the PO. */
  async function savePurchase() {
    if (!selected) return;
    setSavingPo(true);
    setFormError(null);
    try {
      const lines = purchaseLines
        .map((r) => {
          const e = poEdit[r.idx] ?? {};
          return { idx: r.idx, qty_kg: Number(e.weight) || 0, rate: Number(e.rate) || 0, supplier: e.vendor || undefined };
        })
        .filter((l) => l.qty_kg > 0);
      // clamp_to_shortage=0: the weight typed here is deliberate, so don't shrink it
      // against stock that arrived after the purchase order was raised.
      await syncShortagePos({ sales_order: selected, lines: JSON.stringify(lines), clamp_to_shortage: 0 });
      await mutatePos();
      setFlash(lines.length ? "Purchase details saved." : "Purchase order removed.");
      toast(lines.length ? "Purchase saved" : "Purchase order removed");
    } catch (e) {
      const msg = extractErrorMessage(e);
      setFormError(msg);
      toast(msg, "error");
    } finally {
      setSavingPo(false);
    }
  }

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
    const asItem = (r: Record<string, unknown>): Item => ({
      name: r.name as string,
      color_name: String(r.color_name ?? ""),
      cut: String(r.cut ?? ""),
      delivery_date: r.delivery_date ? String(r.delivery_date) : "",
      qty_weight: (r.qty_weight as number) ?? "",
      qty_box: (r.qty_box as number) ?? "",
      sale_rate: (r.sale_rate as number) ?? "",
      purchase_party: String(r.purchase_party ?? ""),
      purchase_rate: (r.purchase_rate as number) ?? "",
    });
    // An order holds ONE item, so editing loads it straight back into the same entry form
    // the order was typed into — no separate items table to learn. (Any extra lines on a
    // legacy multi-line order still show below, so they can't be silently dropped.)
    setDraft(docItems.length ? asItem(docItems[0]) : blankItem());
    setItems(docItems.slice(1).map(asItem));
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
    // A saved order can hold several items (they save onto the one order). A NEW order
    // still splits one order per item, so each gets its own number from the start.
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
    // Leave Enter alone while a suggestion list is open so it picks the suggestion. The
    // list is portalled onto <body>, so look for it there — not inside the field.
    if (el.closest(".mm-link-wrap") && document.querySelector("[data-mm-menu]")) return;
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

  /** Validate the form and return the items to save (folding in a half-typed builder row),
   *  or null when something is wrong (the message is already on screen). */
  function prepareSave(): Item[] | null {
    setFormError(null);
    setFlash(null);
    if (!header.party) { setFormError("Choose the company / party."); return null; }
    if (header.delivery_date && header.transaction_date && header.delivery_date < header.transaction_date) {
      setFormError("Delivery date cannot be before the order date."); return null;
    }
    // Editing: the form IS the order's item, so it stays first. New: fold in an item typed
    // into the builder but not yet "Added", so it isn't dropped.
    let effectiveItems = items;
    if (draft.color_name.trim()) {
      const err = itemError(draft);
      if (err) { setFormError(err); return null; }
      effectiveItems = selected ? [draft, ...items] : [...items, draft];
      if (!selected) {
        setItems(effectiveItems);
        setDraft(blankItem());
      }
    }
    if (effectiveItems.length === 0) { setFormError("Add at least one item."); return null; }
    for (const it of effectiveItems) {
      const err = itemError(it);
      if (err) { setFormError(err); return null; }
      if (it.delivery_date && header.transaction_date && it.delivery_date < header.transaction_date) {
        setFormError("An item's delivery date is before the order date."); return null;
      }
    }
    return effectiveItems;
  }

  /**
   * Save is a two-step now: nothing is purchased behind the operator's back. If any line
   * is short on stock we open the purchase dialog first and let them choose "create the
   * PO too" or "just save the sales order".
   */
  async function onSave() {
    const prepared = prepareSave();
    if (!prepared) return;
    // Decide on FRESHLY fetched stock, never on whatever is in state: an item added or
    // re-sized a moment ago has no availability yet, and guessing "0" would pop the
    // purchase dialog on a line that is fully in stock.
    const avail = await loadAvailability(prepared);
    const shorts = prepared.map((it) => shortageIn(avail, it));
    // Only ask about lines that are short AND not already covered by a purchase order —
    // re-saving an order that already has one shouldn't offer to raise it again. Edits to
    // an existing PO happen in the purchase table on the form.
    if (shorts.some((s, i) => s > 0 && !poForItem(prepared[i], prepared))) {
      // Seed the dialog with the shortfall as the default purchase weight, plus whatever
      // supplier/rate the line already carries.
      setPoDraft(
        Object.fromEntries(
          prepared.map((it, i) => [i, {
            weight: shorts[i] > 0 ? shorts[i] : ("" as number | ""),
            rate: poByIndex[i]?.rate ?? it.purchase_rate ?? "",
            vendor: poByIndex[i]?.vendor || it.purchase_party || "",
          }]),
        ),
      );
      setPoSheet(prepared);
      return;
    }
    void doSave(prepared, false);
  }

  async function doSave(effectiveItems: Item[], withPo: boolean) {
    setPoSheet(null);
    setFormError(null);

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
      purchase_party: (withPo ? poDraft[builderIndex]?.vendor : "") || it.purchase_party || null,
      purchase_rate: (withPo ? poDraft[builderIndex]?.rate : "") || it.purchase_rate || 0,
    });

    /** Raise the draft shortage POs the operator asked for. `rows` maps a saved line's idx
     *  to the builder row it came from. Never called unless they chose "create PO". */
    async function raisePos(soName: string, rows: { idx: number; builderIndex: number; item: Item }[]) {
      const lines = rows
        .map(({ idx, builderIndex, item }) => {
          const short = shortageOf(item);
          if (short <= 0) return null;
          const po = poDraft[builderIndex] ?? {};
          const wt = po.weight === undefined || po.weight === "" ? short : Number(po.weight) || 0;
          if (wt <= 0) return null;
          return { idx, qty_kg: wt, rate: Number(po.rate) || 0, supplier: po.vendor || undefined };
        })
        .filter(Boolean);
      if (lines.length === 0) return;
      try {
        await syncShortagePos({ sales_order: soName, lines: JSON.stringify(lines) });
      } catch { /* PO creation is non-fatal to the order save */ }
    }

    try {
      if (selected) {
        await updateDoc("MM Sales Order", selected, { ...headerPayload, items: effectiveItems.map((it, i) => lineFor(it, i, i + 1)) });
        hydrated.current = null;
        if (withPo) {
          await raisePos(selected, effectiveItems.map((it, i) => ({ idx: i + 1, builderIndex: i, item: it })));
        }
        await mutate();
        await mutateDoc();
        await mutatePos();
        setFlash(withPo ? "Saved — purchase order raised, pending admin approval." : "Saved — pending admin approval.");
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
          if (name) {
            created.push(name);
            if (withPo) await raisePos(name, [{ idx: 1, builderIndex: i, item: it }]);
          }
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
      // Save any purchase edits FIRST. An admin who changed the supplier (or rate/weight)
      // and then hit Approve had those edits thrown away — approval submits the purchase
      // order, so it was submitted with the old supplier still on it.
      if (purchaseLines.length > 0) await savePurchase();
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
              <SearchSelect
                value={header.company}
                disabled={ro || !header.party}
                placeholder={!header.party ? "Pick a party first" : companiesCall.isLoading ? "Loading…" : "— select company —"}
                options={companies.map((c) => ({ value: c, label: c }))}
                onChange={(v) => setHeader((h) => ({ ...h, company: v }))}
              />
            </label>
          </div>

          {/* The order's item — always shown, so an approved (locked) order still displays
              its sales data instead of just the header. Editing loads it right back into
              this same form; a new order uses it to queue items. */}
          {(!ro || draft.color_name.trim() !== "") && (
            <div className="mm-ow-builder" onKeyDown={onBuilderKeyDown}>
              <div className="mm-ow-builder-title">
                {ro ? "Item" : selected ? "Item" : <>Add item <span className="mm-kbd-hint">press Enter to add</span></>}
              </div>
              <div className="mm-form-grid">
                <FieldInput field={F.color_name} value={draft.color_name} disabled={ro} onChange={(v) => setDraft((d) => ({ ...d, color_name: String(v ?? "") }))} />
                <FieldInput field={F.cut} value={draft.cut} disabled={ro} onChange={(v) => setDraft((d) => ({ ...d, cut: String(v ?? "") }))} />
                <FieldInput field={F.item_delivery_date} value={draft.delivery_date} disabled={ro} onChange={(v) => setDraft((d) => ({ ...d, delivery_date: String(v ?? "") }))} />
                <FieldInput field={F.qty_weight} value={draft.qty_weight} disabled={ro} onChange={(v) => setDraft((d) => ({ ...d, qty_weight: v as number }))} />
                <FieldInput field={F.qty_box} value={draft.qty_box} disabled={ro} onChange={(v) => setDraft((d) => ({ ...d, qty_box: v as number }))} />
                <FieldInput field={F.sale_rate} value={draft.sale_rate} disabled={ro} onChange={(v) => setDraft((d) => ({ ...d, sale_rate: v as number }))} />
              </div>
              {/* One order = one item, so there is nothing to "add" onto a saved order. */}
              {!ro && !selected && (
                <button type="button" className="mm-btn-secondary mm-ow-additem" onClick={addItem}>
                  <Plus size={15} /> Add item
                </button>
              )}
              {/* Stock is informational here — the purchase decision happens on save. */}
              {!ro && draft.color_name.trim() !== "" && (
                <p className="mm-ow-stockinfo">
                  {!availKnown(draft) ? (
                    <>Checking stock…</>
                  ) : shortageOf(draft) > 0 ? (
                    <>In stock <strong>{(availByKey[itemKey(draft)] ?? 0).toLocaleString()}</strong> kg ·{" "}
                      <span className="mm-var-over">short {shortageOf(draft).toLocaleString()} kg</span>
                      {" "}— you'll be asked about a purchase order when you save.</>
                  ) : (
                    <>In stock <strong>{(availByKey[itemKey(draft)] ?? 0).toLocaleString()}</strong> kg — covered, no purchase needed.</>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Queued items for a NEW order — each one becomes its own order, so this is a
              simple read-only list, not an editor. (When editing there is nothing here:
              the order's single item lives in the form above.) */}
          {items.length > 0 && (
            <div className="mm-ow-items mm-table-scroll">
              <table className="mm-table mm-table-dense mm-ow-items-table">
                <thead>
                  <tr>
                    <th>Color</th>
                    <th>Size</th>
                    <th>Delivery</th>
                    <th className="mm-num">Wt</th>
                    <th className="mm-num">Box</th>
                    <th className="mm-num">Rate</th>
                    <th className="mm-num">Short</th>
                    {!ro && <th />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const short = shortageOf(it);
                    return (
                      <tr key={i}>
                        <td>{it.color_name}</td>
                        <td>{it.cut || "—"}</td>
                        <td>{it.delivery_date || "—"}</td>
                        <td className="mm-num">{Number(it.qty_weight) || 0}</td>
                        <td className="mm-num">{Number(it.qty_box) || 0}</td>
                        <td className="mm-num">{Number(it.sale_rate) || 0}</td>
                        <td className="mm-num">
                          {!availKnown(it) ? "…" : short > 0 ? <span className="mm-var-over">{short.toLocaleString()}</span> : "—"}
                        </td>
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
                    <td colSpan={3}><strong>{selected ? "Extra lines" : `${items.length} separate order${items.length > 1 ? "s" : ""}`}</strong></td>
                    <td className="mm-num"><strong>{itemsTotal.toLocaleString()}</strong></td>
                    <td colSpan={ro ? 3 : 4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Shortage is shown per line in the items table above; the purchase entry itself
              lives in the pre-save dialog, so no PO is ever raised without a decision. */}
          {/* Purchase data — the three details, at the end, editable in place. */}
          {selected && purchaseLines.length > 0 && (
            <div className="mm-ow-po">
              <div className="mm-ow-po-head">
                <span className="mm-field-label" style={{ margin: 0 }}>Purchase order</span>
                <span className="mm-muted" style={{ fontSize: "0.78rem" }}>
                  {ro ? "Locked." : "Edit and save; set weight to 0 to remove."}
                </span>
              </div>
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense mm-ow-items-table">
                  <thead>
                    <tr><th className="mm-num">Purchase weight</th><th className="mm-num">Purchase rate</th><th>Supplier</th></tr>
                  </thead>
                  <tbody>
                    {purchaseLines.map((r) => {
                      const e = poEdit[r.idx] ?? { weight: "" as number | "", rate: "" as number | "", vendor: "" };
                      const setPo = (patch: Partial<{ weight: number | ""; rate: number | ""; vendor: string }>) =>
                        setPoEdit((p) => ({ ...p, [r.idx]: { ...e, ...patch } }));
                      // A submitted PO is part of an approved order — never editable here.
                      const poRo = ro || Number(r.po?.docstatus) === 1;
                      return (
                        <tr key={r.idx}>
                          <td className="mm-num">
                            {poRo ? Number(e.weight || 0).toLocaleString() : (
                              <input className="mm-input mm-input-compact mm-iw-num" type="number" value={e.weight}
                                placeholder={String(shortageOf(r.item) || "")}
                                onChange={(ev) => setPo({ weight: ev.target.value === "" ? "" : Number(ev.target.value) })} />
                            )}
                          </td>
                          <td className="mm-num">
                            {poRo ? Number(e.rate || 0).toLocaleString() : (
                              <input className="mm-input mm-input-compact mm-iw-num" type="number" value={e.rate}
                                onChange={(ev) => setPo({ rate: ev.target.value === "" ? "" : Number(ev.target.value) })} />
                            )}
                          </td>
                          <td>
                            {poRo ? (e.vendor || "—") : <VendorSelect value={e.vendor} onChange={(v) => setPo({ vendor: v })} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!ro && !purchaseLines.every((r) => Number(r.po?.docstatus) === 1) && (
                <button type="button" className="mm-btn-secondary mm-ow-po-save" disabled={savingPo} onClick={() => void savePurchase()}>
                  {savingPo ? "Saving…" : orderPos.length ? "Save purchase details" : "Create purchase order"}
                </button>
              )}
            </div>
          )}

          {selected && <div className="mm-ow-prod">Production: <strong>{prodPct}%</strong></div>}

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

      {/* Pre-save purchase dialog — the ONLY place a shortage PO is raised. */}
      {poSheet && (
        <div className="mm-modal-scrim mm-scrim-right" style={{ zIndex: 70 }} onClick={() => setPoSheet(null)}>
          <div className="mm-modal mm-sheet mm-sheet-narrow" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Purchase order">
            <div className="mm-modal-head">
              <span className="mm-modal-title">Short on stock</span>
              <button className="mm-chat-overlay-close" onClick={() => setPoSheet(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="mm-modal-body">
              <p className="mm-muted" style={{ fontSize: "0.84rem", marginTop: 0 }}>
                {poSheet.filter((it) => shortageOf(it) > 0 && !poForItem(it, poSheet)).length} line(s) can't be covered from stock.
                Enter the supplier, rate and weight to raise a purchase order along with the sales
                order — or save the sales order on its own and buy later.
              </p>
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense">
                  <thead>
                    <tr><th>Color</th><th className="mm-num">Short</th><th className="mm-num">Purchase weight</th><th className="mm-num">Purchase rate</th><th>Supplier</th></tr>
                  </thead>
                  <tbody>
                    {poSheet.map((it, i) => {
                      const short = shortageOf(it);
                      // Covered lines are handled by the purchase table on the form.
                      if (short <= 0 || poForItem(it, poSheet)) return null;
                      const po = poDraft[i] ?? {};
                      const wt = po.weight === undefined || po.weight === "" ? short : po.weight;
                      const setPo = (patch: Partial<{ weight: number | ""; rate: number | ""; vendor: string }>) =>
                        setPoDraft((p) => ({ ...p, [i]: { weight: wt, rate: po.rate ?? "", vendor: po.vendor ?? "", ...patch } }));
                      return (
                        <tr key={i}>
                          <td>{it.color_name}{it.cut ? ` · ${it.cut}` : ""}</td>
                          <td className="mm-num"><span className="mm-var-over">{short.toLocaleString()}</span></td>
                          <td className="mm-num">
                            <input className="mm-input mm-input-compact mm-iw-num" type="number" value={wt} autoFocus={i === 0}
                              onChange={(e) => setPo({ weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                          </td>
                          <td className="mm-num">
                            <input className="mm-input mm-input-compact mm-iw-num" type="number" value={po.rate ?? ""}
                              onChange={(e) => setPo({ rate: e.target.value === "" ? "" : Number(e.target.value) })} />
                          </td>
                          <td><VendorSelect value={po.vendor ?? ""} onChange={(v) => setPo({ vendor: v })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mm-ow-po-actions">
                <button type="button" className="mm-btn-primary" disabled={busy}
                  onClick={() => void doSave(poSheet, true)}>
                  {busy ? "Saving…" : "Create purchase order + save"}
                </button>
                <button type="button" className="mm-btn-secondary" disabled={busy}
                  onClick={() => void doSave(poSheet, false)}>
                  Save sales order only
                </button>
                <button type="button" className="mm-btn-ghost" disabled={busy} onClick={() => setPoSheet(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
    <SearchSelect
      compact
      value={value}
      onChange={onChange}
      placeholder="— vendor —"
      options={rows.map((v) => ({ value: v.name, label: v.vendor_name || v.name }))}
    />
  );
}
