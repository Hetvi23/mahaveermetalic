import { useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ChevronDown, X } from "lucide-react";
import AnchoredMenu, { isInsideMenu } from "./AnchoredMenu";
import { useMenuKeys } from "@/utils/menuKeys";

export type SOOption = {
  sales_order: string;
  party?: string;
  party_name?: string;
  delivery_date?: string | null;
  transaction_date?: string | null;
  company_name?: string;
  ordered_weight?: number;
  required_weight?: number;
  /** Boxes ordered, and how many of them are still to arrive — what an inward is about
   *  to cover, so picking an order can fill the roll line instead of being re-read. */
  ordered_box?: number;
  required_box?: number;
  colours?: string[];
  cuts?: string[];
  /** The purchase orders raised for this sale — what was bought, from whom, and how much
   *  of it has arrived. 900 kg sold against 1,200 kg bought means 300 kg comes in that no
   *  sales order is waiting for, so the Inward grid reads the supplier and the outstanding
   *  purchase off here. */
  purchase?: POLine[];
  purchase_remaining?: number;
  /** 1 when the sale itself is settled and only the purchase surplus is still to come —
   *  the order is pickable, but everything received on it is Stock Only. */
  stock_only?: number;
  /** 1 when the order is still open for inward. Always 1 in the default list, which only
   *  carries open orders; 0 appears once Inward's "Orders: all" asks for the closed ones
   *  too, so they can be grouped apart rather than mixed into the queue. */
  open?: number;
};

/** One MM Purchase Order line behind a sales order. */
export type POLine = {
  purchase_order: string;
  supplier?: string;
  supplier_name?: string;
  color?: string;
  cut?: string;
  qty_kg?: number;
  qty_box?: number;
  received_kg?: number;
  remaining_kg?: number;
};

type Props = {
  label: string;
  value: string;
  onChange: (v: string, opt?: SOOption) => void;
  required?: boolean;
  disabled?: boolean;
  /** Span the full width of the parent grid. */
  wide?: boolean;
};

/**
 * Searchable Sales Order dropdown for the Inward screen. Unlike a plain Link field it
 * shows customer name, colours and the order date on every row and filters across all
 * of them, so shop-floor users can find an order by any of those, not just its number.
 */
export default function SalesOrderPicker({ label, value, onChange, required, disabled, wide }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useFrappeGetCall<{ message: SOOption[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.sales_order_options",
    undefined,
    "mm-inward-so-options",
  );
  const options = useMemo(() => data?.message ?? [], [data]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      // The menu is portalled onto <body>, so it isn't inside `wrap` — check it too,
      // otherwise using the party filter inside the list closes the list.
      if (isInsideMenu(e.target)) return;
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const selected = options.find((o) => o.sales_order === value);
  // Colour is what the operator recognises an order by on the floor, so it belongs in
  // the closed field too — not only inside the open dropdown.
  const display = selected
    ? [selected.sales_order, selected.party_name || selected.party, (selected.colours || []).join(", ")]
        .filter(Boolean)
        .join(" · ")
    : value;

  const [partyFilter, setPartyFilter] = useState("");
  const parties = useMemo(
    () => Array.from(new Set(options.map((o) => o.party_name || o.party).filter(Boolean))).sort() as string[],
    [options],
  );

  /** The order is optional — clearing it sends the material to inventory instead. The
   *  input alone can't clear it (it only edits the local search text), so this is the
   *  only way back to "no order" once one is picked. */
  function clear() {
    onChange("", undefined);
    setText("");
    setPartyFilter("");
    setOpen(false);
  }

  const q = text.trim().toLowerCase();
  function pickOrder(o: SOOption) {
    onChange(o.sales_order, o);
    setText("");
    setOpen(false);
  }

  const filtered = useMemo(() => {
    return options.filter((o) => {
      if (partyFilter && (o.party_name || o.party) !== partyFilter) return false;
      if (!q) return true;
      return [o.sales_order, o.party_name, o.party, (o.colours || []).join(" "), (o.cuts || []).join(" "), o.delivery_date]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [options, q, partyFilter]);
  const keys = useMenuKeys({
    open, setOpen, items: filtered,
    onPick: pickOrder,
    getValue: (o) => o.sales_order,
  });

  return (
    <label className={`mm-field${wide ? " mm-so-field-wide" : ""}`}>
      <span className="mm-field-label">
        {label}
        {required ? " *" : ""}
      </span>
      <div className={`mm-link-wrap${value && !disabled ? " mm-link-wrap-clearable" : ""}`} ref={wrap}>
        <input
          className="mm-input mm-link-input"
          value={open ? text : display}
          disabled={disabled}
          required={required}
          placeholder="Search order, customer, colour…"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          // Blank the search text on open so an already-picked order still shows the OTHER
          // options; onClick as well as onFocus so a second click re-opens the list.
          onFocus={() => {
            setText("");
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            // Backspacing an already-empty search box clears the picked order.
            if ((e.key === "Backspace" || e.key === "Delete") && !text && value) { clear(); return; }
            keys.onKeyDown(e);
          }}
          autoComplete="off"
        />
        {value && !disabled && (
          <button type="button" className="mm-link-clear" title="Clear order" aria-label="Clear order"
            onMouseDown={(e) => e.preventDefault()} onClick={clear}>
            <X size={14} />
          </button>
        )}
        <ChevronDown size={15} className="mm-link-caret" aria-hidden />
        <AnchoredMenu anchor={wrap} open={open} className="mm-suggest-rich">
          <>
            {value && (
              <li className="mm-suggest-item mm-suggest-none"
                onMouseDown={(e) => { e.preventDefault(); clear(); }}>
                <strong>— No order —</strong>
                <span className="mm-suggest-meta">Material goes to inventory</span>
              </li>
            )}
            {parties.length > 1 && (
              <li className="mm-suggest-filter" onMouseDown={(e) => e.preventDefault()}>
                <select className="mm-input mm-input-compact" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)}>
                  <option value="">All parties ({parties.length})</option>
                  {parties.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </li>
            )}
            {isLoading && <li className="mm-suggest-muted">Loading…</li>}
            {!isLoading && filtered.length === 0 && <li className="mm-suggest-muted">No matching orders</li>}
            {!isLoading &&
              filtered.map((o, i) => {
                const total = Number(o.ordered_weight || 0);
                const remaining = Number(o.required_weight || 0);
                const received = Math.round((total - remaining) * 1000) / 1000;
                return (
                  <li
                    key={o.sales_order}
                    {...keys.rowProps(i)}
                    className={`mm-suggest-item mm-so-opt${keys.active === i ? " is-active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickOrder(o);
                    }}
                  >
                    <span className="mm-so-opt-top">
                      <strong>{o.sales_order}</strong>
                      <span className="mm-so-opt-party">{o.party_name || o.party || "—"}</span>
                      {o.colours?.length ? <span className="mm-so-opt-color">{o.colours.join(", ")}</span> : null}
                    </span>
                    <span className="mm-so-opt-nums">
                      <span>Total <strong>{total.toLocaleString()}</strong></span>
                      <span>Received <strong>{received.toLocaleString()}</strong></span>
                      <span className={remaining > 0 ? "mm-so-opt-rem" : undefined}>Remaining <strong>{remaining.toLocaleString()}</strong></span>
                    </span>
                  </li>
                );
              })}
          </>
        </AnchoredMenu>
      </div>
    </label>
  );
}
