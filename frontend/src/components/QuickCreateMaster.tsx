import type { ChildRow } from "@/components/ChildTableEditor";
import type { DocRegistryEntry } from "@/config/registry";
import { DocFields, buildPayload, emptyChildRow, validatePayload } from "@/pages/DocFormPage";
import { extractErrorMessage } from "@/utils/frappeError";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/**
 * Lightweight inline "+ New <master>" dialog. Lets the user create a master
 * (party, item, vendor, …) without leaving the entry they're filling. On save
 * it returns the new record's name so the caller can select it straight away.
 */
export default function QuickCreateMaster({
	meta,
	seed,
	onCreated,
	onClose,
}: {
	meta: DocRegistryEntry;
	/** Text already typed in the link field — seeds the master's primary field. */
	seed?: string;
	onCreated: (name: string) => void;
	onClose: () => void;
}) {
	const { createDoc, loading } = useFrappeCreateDoc();
	const [values, setValues] = useState<Record<string, unknown>>({});
	const [children, setChildren] = useState<Record<string, ChildRow[]>>({});
	const [formError, setFormError] = useState<string | null>(null);

	useEffect(() => {
		const init: Record<string, unknown> = {};
		for (const f of meta.fields) {
			if (f.default !== undefined) init[f.fieldname] = f.default;
			else if (f.fieldtype === "Check") init[f.fieldname] = 0;
			else init[f.fieldname] = "";
		}
		// Pre-fill the master's primary/search field with whatever the user typed.
		const seedField = meta.searchField || meta.fields.find((f) => f.reqd)?.fieldname;
		if (seed && seedField && (init[seedField] === "" || init[seedField] == null)) {
			init[seedField] = seed;
		}
		const cinit: Record<string, ChildRow[]> = {};
		for (const t of meta.childTables || []) cinit[t.fieldname] = [emptyChildRow(t.columns)];
		setValues(init);
		setChildren(cinit);
	}, [meta, seed]);

	function setField(fn: string, v: unknown) {
		setValues((prev) => ({ ...prev, [fn]: v }));
	}

	const payload = useMemo(() => buildPayload(meta, values, children, undefined), [meta, values, children]);

	async function onSave() {
		setFormError(null);
		const err = validatePayload(meta, payload);
		if (err) {
			setFormError(err);
			return;
		}
		try {
			const res = await createDoc(meta.doctype, payload);
			const n = (res as { name?: string }).name;
			if (n) onCreated(n);
		} catch (e) {
			setFormError(extractErrorMessage(e));
		}
	}

	return (
		<div className="mm-modal-scrim" onMouseDown={onClose}>
			<div className="mm-modal" onMouseDown={(e) => e.stopPropagation()}>
				<header className="mm-modal-head">
					<span className="mm-modal-title">New {meta.title}</span>
					<button type="button" className="mm-modal-close" onClick={onClose} aria-label="Close">
						<X size={18} />
					</button>
				</header>
				<div className="mm-modal-body">
					{formError && <p className="mm-error">{formError}</p>}
					<DocFields
						meta={meta}
						values={values}
						setField={setField}
						childRows={children}
						setChildRows={setChildren}
						readOnlyForm={false}
						docstatus={0}
						compact
					/>
				</div>
				<footer className="mm-modal-foot">
					<button type="button" className="mm-btn-secondary" disabled={loading} onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="mm-btn-primary" disabled={loading} onClick={() => void onSave()}>
						{loading ? "Creating…" : "Create"}
					</button>
				</footer>
			</div>
		</div>
	);
}
