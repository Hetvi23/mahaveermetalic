import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import { Plus, Search, Trash2 } from "lucide-react";
import type { DocRegistryEntry } from "@/config/registry";
import { extractErrorMessage } from "@/utils/frappeError";
import { DocFields, buildPayload, validatePayload, emptyChildRow } from "./DocFormPage";
import type { ChildRow } from "@/components/ChildTableEditor";

function blankValues(meta: DocRegistryEntry): Record<string, unknown> {
  const init: Record<string, unknown> = {};
  for (const f of meta.fields) {
    if (f.default !== undefined) init[f.fieldname] = f.default;
    else if (f.fieldtype === "Check") init[f.fieldname] = 0;
    else init[f.fieldname] = "";
  }
  return init;
}
function blankChildren(meta: DocRegistryEntry): Record<string, ChildRow[]> {
  const c: Record<string, ChildRow[]> = {};
  for (const t of meta.childTables || []) c[t.fieldname] = [emptyChildRow(t.columns)];
  return c;
}

/**
 * Combined master screen: entry form (left) + live list (right) on one full-width
 * page. Selecting a row edits it in place — no redirect to a separate form route.
 */
export default function MasterWorkspace({ meta }: { meta: DocRegistryEntry }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>(() => blankValues(meta));
  const [children, setChildren] = useState<Record<string, ChildRow[]>>(() => blankChildren(meta));
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const hydrated = useRef<string | null>(null);

  const listFields = useMemo(() => {
    const cols = meta.listColumns.map((c) => c.fieldname);
    return cols.includes("name") ? cols : [...cols, "name"];
  }, [meta.listColumns]);

  const filters = useMemo(() => {
    if (!q.trim() || !meta.searchField) return undefined;
    return [[meta.searchField, "like", `%${q.trim()}%`]] as unknown as undefined;
  }, [q, meta.searchField]);

  const { data: rows, isLoading, mutate } = useFrappeGetDocList<Record<string, unknown>>(meta.doctype, {
    fields: listFields,
    filters,
    limit: 200,
    orderBy: { field: "modified", order: "desc" },
  });

  const { data: doc } = useFrappeGetDoc<Record<string, unknown>>(meta.doctype, selected || undefined);
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();

  // Hydrate the form when a record is selected and its doc arrives.
  useEffect(() => {
    if (!selected) return;
    if (!doc || String(doc.name) !== selected) return;
    const stamp = `${String(doc.name)}:${String(doc.modified)}`;
    if (hydrated.current === stamp) return;
    hydrated.current = stamp;
    const next: Record<string, unknown> = {};
    for (const f of meta.fields) next[f.fieldname] = doc[f.fieldname] !== undefined ? doc[f.fieldname] : "";
    setValues(next);
    const cnext: Record<string, ChildRow[]> = {};
    for (const t of meta.childTables || []) {
      const arr = (doc[t.fieldname] as ChildRow[] | undefined) || [];
      cnext[t.fieldname] = arr.length ? arr.map((r) => ({ ...r })) : [emptyChildRow(t.columns)];
    }
    setChildren(cnext);
  }, [doc, selected, meta]);

  function setField(fn: string, v: unknown) {
    setValues((prev) => ({ ...prev, [fn]: v }));
  }

  function resetToNew() {
    setSelected(null);
    hydrated.current = null;
    setValues(blankValues(meta));
    setChildren(blankChildren(meta));
    setFormError(null);
  }

  async function onSave() {
    setFormError(null);
    setFlash(null);
    const payload = buildPayload(meta, values, children, selected || undefined);
    const err = validatePayload(meta, payload);
    if (err) {
      setFormError(err);
      return;
    }
    try {
      if (selected) {
        await updateDoc(meta.doctype, selected, payload);
        hydrated.current = null;
        setFlash("Saved.");
      } else {
        await createDoc(meta.doctype, payload);
        resetToNew();
        setFlash("Added.");
      }
      await mutate();
    } catch (e) {
      setFormError(extractErrorMessage(e));
    }
  }

  async function onDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected}? This cannot be undone.`)) return;
    setFormError(null);
    try {
      await deleteDoc(meta.doctype, selected);
      resetToNew();
      setFlash("Deleted.");
      await mutate();
    } catch (e) {
      setFormError(extractErrorMessage(e));
    }
  }

  const busy = creating || updating || deleting;
  const list = rows ?? [];

  return (
    <div className="mm-ws">
      <header className="mm-ws-head">
        <div>
          <h1 className="mm-page-title">{meta.title}</h1>
          {meta.listTagline && <p className="mm-page-sub">{meta.listTagline}</p>}
        </div>
      </header>

      <div className="mm-ws-grid">
        {/* LEFT — entry / edit form */}
        <section className="mm-card mm-ws-form">
          <div className="mm-ws-form-head">
            <h2 className="mm-panel-title">{selected ? "Edit" : "Add new"}</h2>
            {selected && (
              <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={resetToNew}>
                <Plus size={14} /> New
              </button>
            )}
          </div>

          {formError && <p className="mm-error">{formError}</p>}

          <DocFields
            meta={meta}
            values={values}
            setField={setField}
            childRows={children}
            setChildRows={setChildren}
            readOnlyForm={false}
            docstatus={0}
          />

          <div className="mm-ws-form-actions">
            <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onSave()}>
              {busy ? "Saving…" : selected ? "Save changes" : "Add"}
            </button>
            {selected && (
              <button type="button" className="mm-btn-danger" disabled={busy} onClick={() => void onDelete()}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            {flash && <span className="mm-ws-flash">{flash}</span>}
          </div>
        </section>

        {/* RIGHT — live list */}
        <section className="mm-card mm-ws-list">
          <div className="mm-ws-list-head">
            {meta.searchField ? (
              <div className="mm-search-wrap">
                <Search size={15} className="mm-search-icon" aria-hidden />
                <input
                  className="mm-input mm-search-pill"
                  placeholder={`Search ${meta.searchField.replace(/_/g, " ")}…`}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            ) : (
              <span className="mm-muted">All records</span>
            )}
            <span className="mm-pill mm-pill-muted">{isLoading ? "…" : `${list.length}`}</span>
          </div>

          <div className="mm-table-scroll mm-ws-table-scroll">
            <table className="mm-table mm-table-hover">
              <thead>
                <tr>
                  {meta.listColumns.map((c) => (
                    <th key={c.fieldname}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const name = String(row.name);
                  return (
                    <tr
                      key={name}
                      className={`mm-ws-row ${selected === name ? "mm-ws-row-active" : ""}`}
                      onClick={() => {
                        setSelected(name);
                        setFlash(null);
                        setFormError(null);
                      }}
                    >
                      {meta.listColumns.map((c) => (
                        <td key={c.fieldname}>{fmt(row[c.fieldname])}</td>
                      ))}
                    </tr>
                  );
                })}
                {!isLoading && list.length === 0 && (
                  <tr>
                    <td colSpan={meta.listColumns.length} className="mm-empty">
                      No records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function fmt(v: unknown) {
  if (v == null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
