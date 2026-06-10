import ChildTableEditor, { type ChildRow } from "@/components/ChildTableEditor";
import SalesOrderStockPanel from "@/components/SalesOrderStockPanel";
import { FieldInput } from "@/components/FieldInputs";
import { isFieldVisible, resolveFormSections, type DocRegistryEntry } from "@/config/registry";
import { extractErrorMessage } from "@/utils/frappeError";
import {
	useFrappeCreateDoc,
	useFrappeGetCall,
	useFrappeGetDoc,
	useFrappePostCall,
	useFrappeUpdateDoc,
} from "frappe-react-sdk";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

function isMmAdmin(): boolean {
	const boot = (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot;
	const roles = boot?.user?.roles ?? [];
	return roles.includes("Administrator") || roles.includes("MM Admin");
}

export default function DocFormPage({ meta }: { meta: DocRegistryEntry }) {
	const { name: nameParam } = useParams();
	const isNew = !nameParam || nameParam === "new";
	const docname = isNew ? undefined : decodeURIComponent(nameParam);
	if (isNew) {
		return <DocFormNew meta={meta} />;
	}
	return <DocFormEdit meta={meta} docname={docname!} />;
}

function DocFormNew({ meta }: { meta: DocRegistryEntry }) {
	const nav = useNavigate();
	const [searchParams] = useSearchParams();
	const { createDoc, loading: creating } = useFrappeCreateDoc();
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
		if (meta.doctype === "MM Task Reminder") {
			if (init.reminder_interval_hours === "" || init.reminder_interval_hours == null) init.reminder_interval_hours = 1;
		}
		if (meta.doctype === "MM Sales Order") {
			init.naming_series = "MM-SO-.YYYY.-";
			init.transaction_date = new Date().toISOString().slice(0, 10);
		}
		if (meta.doctype === "MM Purchase Order") {
			init.transaction_date = new Date().toISOString().slice(0, 10);
		}
		if (meta.doctype === "MM Inward") {
			init.posting_date = new Date().toISOString().slice(0, 10);
		}
		if (meta.doctype === "MM Cutting") {
			init.posting_date = new Date().toISOString().slice(0, 10);
		}
		if (meta.doctype === "MM Bobbin Box Tracking") {
			init.chalan_date = new Date().toISOString().slice(0, 10);
		}
		// Seed any header field passed via query string (e.g. cutting worklist → form).
		for (const f of meta.fields) {
			const qv = searchParams.get(f.fieldname);
			if (qv !== null) init[f.fieldname] = qv;
		}
		const cinit: Record<string, ChildRow[]> = {};
		for (const t of meta.childTables || []) {
			cinit[t.fieldname] = [emptyChildRow(t.columns)];
		}
		setValues(init);
		setChildren(cinit);
	}, [meta, searchParams]);

	function setField(fn: string, v: unknown) {
		setValues((prev) => ({ ...prev, [fn]: v }));
	}

	// Auto-fill branch / location from the logged-in user's employee profile (editable).
	const hasBranch = meta.fields.some((f) => f.fieldname === "branch");
	const hasLocation = meta.fields.some((f) => f.fieldname === "location");
	const { data: defaults } = useFrappeGetCall<{ message: { branch: string | null; location: string | null } }>(
		"mahaveermetalic.api.session.get_branch_location",
		undefined,
		"mm-session-branch-location", // cached once per session across all forms
	);
	useEffect(() => {
		const d = defaults?.message;
		if (!d) return;
		setValues((prev) => {
			const next = { ...prev };
			if (hasBranch && d.branch && !prev.branch) next.branch = d.branch;
			if (hasLocation && d.location && !prev.location) next.location = d.location;
			return next;
		});
	}, [defaults, hasBranch, hasLocation]);

	const payload = useMemo(() => buildPayload(meta, values, children, undefined), [meta, values, children]);

	useEffect(() => {
		if (meta.doctype !== "MM Purchase Order") return;
		const so = values.sales_order;
		if (so) setValues((v) => ({ ...v, po_number: so }));
	}, [values.sales_order, meta.doctype]);

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
			if (n) nav(`${meta.routeBase}/${encodeURIComponent(n)}`, { replace: true });
		} catch (e) {
			setFormError(extractErrorMessage(e));
		}
	}

	return (
		<DocFormShell
			meta={meta}
			isNew={true}
			docname={undefined}
			onSave={() => void onSave()}
			saving={creating}
			formError={formError}
			content={
			<DocFields
				meta={meta}
				values={values}
				setField={setField}
				childRows={children}
				setChildRows={setChildren}
				readOnlyForm={false}
				docstatus={0}
			/>
			}
		/>
	);
}

function DocFormEdit({ meta, docname }: { meta: DocRegistryEntry; docname: string }) {
	const { data, error, isLoading, mutate } = useFrappeGetDoc<Record<string, unknown>>(meta.doctype, docname, undefined, {
		revalidateOnFocus: false,
	});
	const { updateDoc, loading: updating } = useFrappeUpdateDoc();
	const { call: submitRemote, loading: submitting } = useFrappePostCall<Record<string, unknown>>("frappe.client.submit");

	const [values, setValues] = useState<Record<string, unknown>>({});
	const [children, setChildren] = useState<Record<string, ChildRow[]>>({});
	const [formError, setFormError] = useState<string | null>(null);
	const hydrated = useRef<string | null>(null);

	const docstatus = (data?.docstatus as number) ?? 0;
	const locked = Boolean(data?.order_locked) && meta.doctype === "MM Sales Order";
	const readOnlyForm = locked && !isMmAdmin();
	const reminderStatus = String((values.status as string | undefined) ?? (data?.status as string | undefined) ?? "");
	const taskReminderClosed =
		meta.doctype === "MM Task Reminder" && ["Completed", "Cancelled"].includes(reminderStatus);
	const frozen =
		readOnlyForm || (docstatus === 1 && Boolean(meta.isSubmittable)) || taskReminderClosed;

	useEffect(() => {
		if (!data) return;
		const stamp = `${String(data.name)}:${String(data.modified)}`;
		if (hydrated.current === stamp) return;
		hydrated.current = stamp;
		const next: Record<string, unknown> = {};
		for (const f of meta.fields) {
			next[f.fieldname] = data[f.fieldname] !== undefined ? data[f.fieldname] : "";
		}
		setValues(next);
		const cnext: Record<string, ChildRow[]> = {};
		for (const t of meta.childTables || []) {
			const arr = (data[t.fieldname] as ChildRow[] | undefined) || [];
			cnext[t.fieldname] = arr.length ? arr.map((r) => ({ ...r })) : [emptyChildRow(t.columns)];
		}
		setChildren(cnext);
	}, [data, meta]);

	function setField(fn: string, v: unknown) {
		setValues((prev) => ({ ...prev, [fn]: v }));
	}

	const payload = useMemo(() => buildPayload(meta, values, children, docname), [meta, values, children, docname]);

	useEffect(() => {
		if (meta.doctype !== "MM Purchase Order") return;
		const so = values.sales_order;
		if (so) setValues((v) => ({ ...v, po_number: so }));
	}, [values.sales_order, meta.doctype]);

	async function onSave(): Promise<boolean> {
		setFormError(null);
		const err = validatePayload(meta, payload);
		if (err) {
			setFormError(err);
			return false;
		}
		try {
			await updateDoc(meta.doctype, docname, payload);
			await mutate();
			return true;
		} catch (e) {
			setFormError(extractErrorMessage(e));
			return false;
		}
	}

	async function onSubmit() {
		setFormError(null);
		try {
			const ok = await onSave();
			if (!ok) return;
			await submitRemote({ doc: { doctype: meta.doctype, name: docname } });
			await mutate();
		} catch (e) {
			setFormError(extractErrorMessage(e));
		}
	}

	const recordTitle = useMemo(() => {
		const candidates = [
			values.title,
			values.party_name,
			values.item_name,
			values.vendor_name,
			values.employee_name,
			values.location_name,
			values.color_name,
			values.challan_number
		];
		for (const val of candidates) {
			if (typeof val === "string" && val.trim() !== "") {
				return val.trim();
			}
		}
		return undefined;
	}, [values]);

	const busy = updating || submitting;

	return (
		<DocFormShell
			meta={meta}
			isNew={false}
			docname={docname}
			recordTitle={recordTitle}
			onSave={() => {
				void onSave();
			}}
			onSubmit={meta.isSubmittable && docstatus === 0 ? () => void onSubmit() : undefined}
			saving={busy}
			submitting={submitting}
			formError={formError}
			bannerLocked={locked}
			bannerSubmitted={Boolean(meta.isSubmittable && docstatus === 1)}
			content={
				<>
					{isLoading && <p className="mm-muted">Loading…</p>}
					{error && <p className="mm-error">{(error as { message?: string }).message}</p>}
					<DocFields
						meta={meta}
						values={values}
						setField={setField}
						childRows={children}
						setChildRows={setChildren}
						readOnlyForm={frozen}
						docstatus={docstatus}
					/>
					{meta.doctype === "MM Sales Order" && data?.name && (
						<SalesOrderStockPanel docname={String(data.name)} />
					)}
				</>
			}
		/>
	);
}

function DocFormShell({
	meta,
	isNew,
	docname,
	content,
	onSave,
	onSubmit,
	saving,
	submitting,
	formError,
	bannerLocked,
	bannerSubmitted,
	recordTitle,
}: {
	meta: DocRegistryEntry;
	isNew: boolean;
	docname?: string;
	content: ReactNode;
	onSave: () => void;
	onSubmit?: () => void;
	saving: boolean;
	submitting?: boolean;
	formError: string | null;
	bannerLocked?: boolean;
	bannerSubmitted?: boolean;
	recordTitle?: string;
}) {
	const isHashId = docname && /^[a-z0-9]{10}$/.test(docname);
	const displaySub = isNew 
		? meta.doctype 
		: isHashId 
			? meta.title 
			: `${meta.title} • ${docname}`;

	const displayTitle = isNew 
		? `New ${meta.title}` 
		: recordTitle || docname || meta.title;

	return (
		<div className="mm-page mm-page-enter">
			<nav className="mm-breadcrumb" aria-label="Breadcrumb">
				<Link to="/">Dashboard</Link>
				<span className="mm-bc-sep" aria-hidden>
					/
				</span>
				<Link to={meta.routeBase}>{meta.title}</Link>
				{!isNew && docname && (
					<>
						<span className="mm-bc-sep" aria-hidden>
							/
						</span>
						<span className="mm-bc-current">{recordTitle || docname}</span>
					</>
				)}
				{isNew && (
					<>
						<span className="mm-bc-sep" aria-hidden>
							/
						</span>
						<span className="mm-bc-current">New</span>
					</>
				)}
			</nav>
			<header className="mm-page-head">
				<div>
					<h1 className="mm-page-title">{displayTitle}</h1>
					<p className="mm-page-sub">{displaySub}</p>
				</div>
				<div className="mm-page-actions">
					<Link className="mm-btn-secondary" to={meta.routeBase}>
						← Back to list
					</Link>
				</div>
			</header>

			{bannerLocked && (
				<div className="mm-banner mm-banner-warn">
					This order is production-locked. Only MM Admin may edit fields here.
				</div>
			)}
			{bannerSubmitted && <div className="mm-banner mm-banner-ok">Submitted document (read-only).</div>}

			<div className="mm-card mm-card-form-shell">
				<div className="mm-card-form-body mm-card-pad">
					{formError && <p className="mm-error">{formError}</p>}
					{content}
				</div>
				<div className="mm-form-actions mm-form-actions-sticky">
					<button type="button" className="mm-btn-primary" disabled={saving || bannerLocked || bannerSubmitted} onClick={onSave}>
						{saving ? "Saving…" : "Save"}
					</button>
					{onSubmit && (
						<button
							type="button"
							className="mm-btn-secondary"
							disabled={Boolean(saving || submitting || bannerLocked || bannerSubmitted)}
							onClick={() => void onSubmit()}
						>
							{submitting ? "Submitting…" : "Save & submit"}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

export function DocFields({
	meta,
	values,
	setField,
	childRows,
	setChildRows,
	readOnlyForm,
	docstatus,
	compact,
}: {
	meta: DocRegistryEntry;
	values: Record<string, unknown>;
	setField: (fn: string, v: unknown) => void;
	childRows: Record<string, ChildRow[]>;
	setChildRows: Dispatch<SetStateAction<Record<string, ChildRow[]>>>;
	readOnlyForm: boolean;
	docstatus: number;
	/** Tight layout for the side-by-side workspace: no bordered cards / descriptions. */
	compact?: boolean;
}) {
	const ro = readOnlyForm || (docstatus === 1 && Boolean(meta.isSubmittable));
	const sections = useMemo(() => resolveFormSections(meta), [meta]);
	const fieldMap = useMemo(() => Object.fromEntries(meta.fields.map((f) => [f.fieldname, f])), [meta.fields]);

	if (compact) {
		return (
			<>
				{sections.map((sec) => (
					<div key={sec.id} className="mm-cform-sec">
						{sections.length > 1 && <div className="mm-cform-sec-title">{sec.title}</div>}
						<div className="mm-form-grid mm-form-grid-tight">
							{sec.fieldnames.map((fn) => {
								const f = fieldMap[fn];
								if (!f || !isFieldVisible(f, values)) return null;
								return (
									<div key={fn} className={f.fieldtype === "Small Text" ? "mm-span-2" : undefined}>
										<FieldInput field={f} value={values[f.fieldname]} onChange={(v) => setField(f.fieldname, v)} disabled={ro} />
									</div>
								);
							})}
						</div>
					</div>
				))}
				{meta.childTables?.map((t) => (
					<div key={t.fieldname} className="mm-cform-sec">
						<div className="mm-cform-sec-title">{t.label}</div>
						<ChildTableEditor
							schema={t}
							rows={childRows[t.fieldname] || []}
							onChange={(rows) => setChildRows((c) => ({ ...c, [t.fieldname]: rows }))}
							disabled={ro}
							hideTitle
						/>
					</div>
				))}
			</>
		);
	}

	return (
		<>
			{sections.map((sec, si) => (
				<section
					key={sec.id}
					className="mm-panel mm-panel-enter"
					style={{ animationDelay: `${Math.min(si, 8) * 42}ms` }}
				>
					<header className="mm-panel-head">
						<h2 className="mm-panel-title">{sec.title}</h2>
						{sec.description ? <p className="mm-panel-desc">{sec.description}</p> : null}
					</header>
					<div className="mm-form-grid">
						{sec.fieldnames.map((fn) => {
							const f = fieldMap[fn];
							if (!f || !isFieldVisible(f, values)) return null;
							return (
								<div key={fn} className={f.fieldtype === "Small Text" ? "mm-span-2" : undefined}>
									<FieldInput field={f} value={values[f.fieldname]} onChange={(v) => setField(f.fieldname, v)} disabled={ro} />
								</div>
							);
						})}
					</div>
				</section>
			))}
			{meta.childTables?.map((t, ti) => (
				<section
					key={t.fieldname}
					className="mm-panel mm-panel-enter mm-panel-child"
					style={{ animationDelay: `${(sections.length + ti) * 42}ms` }}
				>
					<header className="mm-panel-head">
						<h2 className="mm-panel-title">{t.label}</h2>
						<p className="mm-panel-desc">Line items stored with this document.</p>
					</header>
					<ChildTableEditor
						schema={t}
						rows={childRows[t.fieldname] || []}
						onChange={(rows) => setChildRows((c) => ({ ...c, [t.fieldname]: rows }))}
						disabled={ro}
						hideTitle
					/>
				</section>
			))}
		</>
	);
}

export function buildPayload(
	meta: DocRegistryEntry,
	values: Record<string, unknown>,
	childState: Record<string, ChildRow[]>,
	docname: string | undefined,
): Record<string, unknown> {
	const d: Record<string, unknown> = { doctype: meta.doctype };
	if (docname) d.name = docname;
	for (const f of meta.fields) {
		if (f.readOnly && !docname) continue;
		d[f.fieldname] = values[f.fieldname];
	}
	for (const t of meta.childTables || []) {
		const rows = childState[t.fieldname] || [];
		const cleaned = rows
			.map((row) => {
				const o: Record<string, unknown> = {};
				for (const c of t.columns) {
					// Don't persist a value for a column hidden by its dependsOn rule.
					o[c.fieldname] = isFieldVisible(c, row) ? row[c.fieldname] : "";
				}
				if (row.name) o.name = row.name;
				return o;
			})
			.filter((row) =>
				Object.entries(row).some(([k, v]) => {
					if (k === "idx" || k === "name") return false;
					if (v === null || v === undefined || v === "") return false;
					return true;
				}),
			);
		d[t.fieldname] = cleaned.map((row, i) => ({ ...row, idx: i + 1 }));
	}
	return d;
}

export function validatePayload(meta: DocRegistryEntry, payload: Record<string, unknown>): string | null {
	for (const f of meta.fields) {
		if (f.reqd && !f.readOnly) {
			const v = payload[f.fieldname];
			if (v === "" || v === null || v === undefined) return `${f.label} is required.`;
		}
	}
	for (const t of meta.childTables || []) {
		if (!t.reqd) continue;
		const arr = payload[t.fieldname];
		if (!Array.isArray(arr) || arr.length === 0) {
			return `Add at least one row in “${t.label}”.`;
		}
	}
	return null;
}

export function emptyChildRow(columns: { fieldname: string; fieldtype: string }[]): ChildRow {
	const r: ChildRow = {};
	for (const c of columns) {
		if (c.fieldtype === "Check") r[c.fieldname] = 0;
		else if (c.fieldtype === "Float" || c.fieldtype === "Currency") r[c.fieldname] = 0;
		else r[c.fieldname] = "";
	}
	return r;
}
