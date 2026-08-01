import { useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ChevronDown } from "lucide-react";

export type SOOption = {
  sales_order: string;
  party?: string;
  party_name?: string;
  delivery_date?: string | null;
  transaction_date?: string | null;
  ordered_weight?: number;
  required_weight?: number;
  colours?: string[];
  cuts?: string[];
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
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const selected = options.find((o) => o.sales_order === value);
  const display = selected
    ? `${selected.sales_order} · ${selected.party_name || selected.party || ""}`
    : value;

  const [partyFilter, setPartyFilter] = useState("");
  const parties = useMemo(
    () => Array.from(new Set(options.map((o) => o.party_name || o.party).filter(Boolean))).sort() as string[],
    [options],
  );

  const q = text.trim().toLowerCase();
  const filtered = useMemo(() => {
    return options.filter((o) => {
      if (partyFilter && (o.party_name || o.party) !== partyFilter) return false;
      if (!q) return true;
      return [o.sales_order, o.party_name, o.party, (o.colours || []).join(" "), (o.cuts || []).join(" "), o.delivery_date]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [options, q, partyFilter]);

  return (
    <label className={`mm-field${wide ? " mm-so-field-wide" : ""}`}>
      <span className="mm-field-label">
        {label}
        {required ? " *" : ""}
      </span>
      <div className="mm-link-wrap" ref={wrap}>
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
          onFocus={() => {
            setText("");
            setOpen(true);
          }}
          autoComplete="off"
        />
        <ChevronDown size={15} className="mm-link-caret" aria-hidden />
        {open && (
          <ul className="mm-suggest mm-suggest-rich">
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
              filtered.map((o) => {
                const total = Number(o.ordered_weight || 0);
                const remaining = Number(o.required_weight || 0);
                const received = Math.round((total - remaining) * 1000) / 1000;
                return (
                  <li
                    key={o.sales_order}
                    className="mm-suggest-item mm-so-opt"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(o.sales_order, o);
                      setText("");
                      setOpen(false);
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
          </ul>
        )}
      </div>
    </label>
  );
}
