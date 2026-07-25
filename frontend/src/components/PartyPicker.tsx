import { useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ChevronDown, Plus, UserPlus } from "lucide-react";
import { getMasterByDoctype } from "@/config/registry";
import QuickCreateMaster from "./QuickCreateMaster";

type Row = { party: string; party_name?: string; company_name?: string };

/**
 * Customer / party picker for the order screen. Unlike a plain Link field it searches by
 * the customer name AND any company name filed under them (via
 * party.search_party_with_company), and offers a one-click "New customer" (+) that opens
 * the full customer form seeded with whatever was typed.
 */
export default function PartyPicker({
  value,
  onChange,
  disabled,
  required,
  label = "Company / Party",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [quick, setQuick] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const master = getMasterByDoctype("MM Party Master");

  const { data, isLoading } = useFrappeGetCall<{ message: Row[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.search_party_with_company",
    { txt: text.trim(), limit: 30 },
    open ? `party-search-${text.trim()}` : null,
  );
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of data?.message ?? []) {
      if (!seen.has(r.party)) { seen.add(r.party); out.push(r); }
    }
    return out;
  }, [data]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  function pick(v: string) {
    onChange(v);
    setText("");
    setOpen(false);
  }

  return (
    <>
      <label className="mm-field">
        <span className="mm-field-label">{label}{required ? " *" : ""}</span>
        <div className="mm-link-wrap mm-link-wrap-addable" ref={wrap}>
          <input
            className="mm-input mm-link-input"
            value={open ? text : value}
            disabled={disabled}
            required={required}
            placeholder="Search customer or company…"
            onChange={(e) => { setText(e.target.value); setOpen(true); }}
            onFocus={() => { setText(""); setOpen(true); }}
            autoComplete="off"
          />
          <ChevronDown size={15} className="mm-link-caret" aria-hidden />
          {!disabled && (
            <button type="button" className="mm-link-add" title="New customer" aria-label="New customer" onClick={() => setQuick(true)}>
              <Plus size={15} />
            </button>
          )}
          {open && (
            <ul className="mm-suggest mm-suggest-rich">
              {isLoading && <li className="mm-suggest-muted">Searching…</li>}
              {!isLoading && rows.length === 0 && <li className="mm-suggest-muted">No customers match</li>}
              {!isLoading && rows.map((r) => (
                <li key={r.party} className="mm-suggest-item" onMouseDown={(e) => { e.preventDefault(); pick(r.party); }}>
                  <strong>{r.party_name || r.party}</strong>
                  {r.company_name && r.company_name !== (r.party_name || r.party) && (
                    <span className="mm-suggest-meta">{r.company_name}</span>
                  )}
                </li>
              ))}
              {master && !disabled && (
                <li className="mm-suggest-item mm-suggest-add" onMouseDown={(e) => { e.preventDefault(); setOpen(false); setQuick(true); }}>
                  <UserPlus size={14} /> New customer{text.trim() ? ` “${text.trim()}”` : ""}
                </li>
              )}
            </ul>
          )}
        </div>
      </label>
      {quick && master && (
        <QuickCreateMaster
          meta={master}
          seed={text.trim()}
          onClose={() => setQuick(false)}
          onCreated={(name) => { pick(name); setQuick(false); }}
        />
      )}
    </>
  );
}
