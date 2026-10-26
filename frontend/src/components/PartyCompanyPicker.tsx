import { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import SearchSelect, { type SelectOption } from "./SearchSelect";

/**
 * ONE PICKER FOR PARTY AND COMPANY, everywhere (Hetvi: "merge the company/party names
 * everywhere … the only purpose is that party should be searchable company wise as well and
 * vice versa"). Operators know some customers by the person and some by the firm, and a box
 * that only searched one of the two made them remember which.
 *
 * Every row is a company with the party it is filed under beneath it, and typing either name
 * finds it. What a screen SAVES is unchanged: it still gets a party and a company back and
 * keeps whichever it kept before — a screen that stores only the party ignores the company.
 *
 * Rows come from api.party.all_companies, which lists a party with no company on file under
 * its own name (`is_party`); choosing that row gives back the party and no company, so the
 * party's name is never saved as a firm.
 */
export type CompanyRow = { company_name: string; party: string; party_name: string; is_party?: number };

const API = "mahaveermetalic.mahaveer_metallic.api.party.all_companies";
const SEP = "\u001f";
/** The "all of this party's companies" row on a report filter. */
const WHOLE = "\u0000all";
const keyOf = (party: string, company: string) => `${party}${SEP}${company}`;

/** The shared company list — one fetch, cached under one key for every screen. */
export function useCompanyRows() {
  const call = useFrappeGetCall<{ message: CompanyRow[] }>(API, undefined, "mm-all-companies");
  return { rows: call.data?.message ?? [], loading: call.isLoading, refresh: call.mutate };
}

type Props = {
  party: string;
  /** Leave undefined on a screen that stores only the party. */
  company?: string;
  onChange: (party: string, company: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  compact?: boolean;
  placeholder?: string;
  emptyText?: string;
  menuMinWidth?: number;
  /** Report filters: a party trading as several firms also gets a row meaning all of them. */
  wholeParty?: boolean;
  /** Offer "+" to create a new party. */
  allowCreate?: boolean;
  /** The bare picker, for a screen that draws its own label. */
  bare?: boolean;
  className?: string;
};

export default function PartyCompanyPicker({
  party, company, onChange, label = "Party / Company", required, disabled, compact, placeholder,
  emptyText, menuMinWidth = 300, wholeParty, allowCreate, bare, className,
}: Props) {
  const { rows, loading, refresh } = useCompanyRows();
  // On a party-only screen the company is not kept, so remember which row was picked to
  // keep showing the firm the operator chose rather than falling back to the party's name.
  const [picked, setPicked] = useState("");

  const byParty = useMemo(() => {
    const m = new Map<string, CompanyRow[]>();
    for (const r of rows) m.set(r.party, [...(m.get(r.party) ?? []), r]);
    return m;
  }, [rows]);
  const partyName = (p: string) => byParty.get(p)?.[0]?.party_name || p;

  const options = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = rows.map((r) => ({
      value: keyOf(r.party, r.company_name),
      label: r.company_name,
      // The party underneath — what makes a firm findable by its owner's name.
      meta: r.party_name && r.party_name !== r.company_name ? r.party_name : undefined,
    }));
    if (wholeParty) {
      for (const [p, own] of byParty) {
        if (own.length > 1) out.push({ value: keyOf(p, WHOLE), label: own[0].party_name || p, meta: `all ${own.length} companies` });
      }
      out.sort((a, b) => a.label.localeCompare(b.label));
    }
    return out;
  }, [rows, byParty, wholeParty]);

  // Which row the current party / company stands for.
  let value = "";
  if (party && company) value = keyOf(party, company);
  else if (party) {
    const own = byParty.get(party) ?? [];
    if (company === undefined && picked && picked.startsWith(`${party}${SEP}`)) value = picked;
    else value = own.length === 1 ? keyOf(party, own[0].company_name) : keyOf(party, WHOLE);
  } else if (company) {
    const hit = rows.find((r) => r.company_name === company);
    value = keyOf(hit?.party ?? "", company);
  }
  // A value the list does not carry (a firm since removed, a party's "all" row on an entry
  // screen) still shows itself rather than going blank.
  const shown = value && !options.some((o) => o.value === value)
    ? [{ value, label: value.endsWith(WHOLE) ? partyName(party) : company || partyName(party), meta: undefined }, ...options]
    : options;

  const choose = (v: string) => {
    setPicked(v);
    if (!v) return onChange("", "");
    const [p, c] = v.split(SEP);
    if (c === WHOLE) return onChange(p, "");
    const row = rows.find((r) => r.party === p && r.company_name === c);
    onChange(p, row?.is_party ? "" : c);
  };

  const picker = (
    <SearchSelect
      value={value}
      onChange={choose}
      options={shown}
      required={required}
      disabled={disabled}
      compact={compact}
      className={className}
      menuMinWidth={menuMinWidth}
      placeholder={loading ? "Loading…" : placeholder ?? "Search party or company"}
      emptyText={emptyText ?? "No party or company matches."}
      createDoctype={allowCreate ? "MM Party Master" : undefined}
      onCreated={allowCreate ? async (newParty) => {
        // A company is a row on its party, so "new" means a new party. Pick it up with its
        // own company when it was given exactly one.
        const fresh = await refresh();
        const own = ((fresh as { message?: CompanyRow[] } | undefined)?.message ?? []).filter((r) => r.party === newParty);
        onChange(newParty, own.length === 1 && !own[0].is_party ? own[0].company_name : "");
      } : undefined}
    />
  );
  if (bare) return picker;
  return (
    <label className="mm-field">
      <span className="mm-field-label">{label}{required ? " *" : ""}</span>
      {picker}
    </label>
  );
}
