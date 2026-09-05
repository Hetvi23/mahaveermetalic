import type { FieldSchema } from "@/config/registry";
import { useState, type ReactNode } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import LinkField from "./LinkField";
import SearchSelect from "./SearchSelect";

type JobOutOption = {
	name: string; challan_no: string; date?: string | null;
	party?: string; party_name?: string; colours?: string; cuts?: string; total_weight?: number;
};

/**
 * "Against Job Out" — a Job Out is chosen by its challan number, the party it went to and
 * what is on it, not by its document id.
 *
 * Its own widget rather than the generic Link because a plain get_list on MM Sales Challan
 * cannot answer either half of the problem: it offers every dispatch challan (the field
 * only ever means a Job Out), and colour and cut live on the challan's CHILD table, so
 * they are not fetchable as columns of the parent.
 */
function JobOutField({ field, value, onChange, disabled, compact, party }: {
	field: FieldSchema; value: string; onChange: (v: string) => void;
	disabled?: boolean; compact?: boolean; party?: string;
}) {
	const { data } = useFrappeGetCall<{ message: JobOutOption[] }>(
		"mahaveermetalic.mahaveer_metallic.api.challan.job_out_options",
		{ party: party || undefined },
		`job-out-opts-${party || "all"}`,
	);
	const rows = data?.message ?? [];
	const control = (
		<SearchSelect
			compact={compact}
			value={value}
			disabled={disabled}
			placeholder="Select job out…"
			emptyText={party ? "No job out for this party" : "No job out challans"}
			options={rows.map((r) => ({
				value: r.name,
				// The challan number leads — that is the number written on the paper.
				label: r.challan_no,
				meta: [r.party_name, r.colours, r.cuts ? `cut ${r.cuts}` : null, r.date]
					.filter(Boolean)
					.join(" · "),
			}))}
			onChange={onChange}
		/>
	);
	return compact ? (
		<div className="mm-field-compact">{control}</div>
	) : (
		<label className="mm-field">
			<span className="mm-field-label">{field.label}{field.reqd ? " *" : ""}</span>
			{control}
		</label>
	);
}

type Props = {
	field: FieldSchema;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
	compact?: boolean;
	/** Full record/row — lets Link fields with `linkFilters` filter by a sibling value. */
	record?: Record<string, unknown>;
};

export function FieldInput({ field, value, onChange, disabled, compact, record }: Props) {
	const ro = disabled || field.readOnly;
	const ic = compact ? "mm-input mm-input-compact" : "mm-input";

	const lab = (children: ReactNode) =>
		compact ? (
			<div className="mm-field-compact">{children}</div>
		) : (
			<label className="mm-field">
				<span className="mm-field-label">
					{field.label}
					{field.reqd ? " *" : ""}
				</span>
				{children}
			</label>
		);

	if (field.fieldtype === "Check") {
		return lab(
			<label className="mm-field-inline">
				<input
					type="checkbox"
					checked={Boolean(value)}
					disabled={ro}
					onChange={(e) => onChange(e.target.checked ? 1 : 0)}
				/>
				{compact && <span className="mm-field-label-inline">{field.label}</span>}
			</label>,
		);
	}

	if (field.fieldtype === "Small Text") {
		return lab(
			<textarea
				className={`${ic} mm-textarea`}
				value={value == null ? "" : String(value)}
				disabled={ro}
				required={field.reqd}
				rows={compact ? 2 : 3}
				onChange={(e) => onChange(e.target.value)}
			/>,
		);
	}

	if (field.fieldtype === "Datetime") {
		const toLocal = (v: unknown) => {
			if (v == null || v === "") return "";
			const s = String(v).trim();
			const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?/);
			if (m) return `${m[1]}T${m[2]}`;
			return s.length >= 16 ? s.slice(0, 16).replace(" ", "T") : "";
		};
		const fromLocal = (s: string) => {
			if (!s) return "";
			return s.replace("T", " ").length === 16 ? `${s.replace("T", " ")}:00` : s.replace("T", " ");
		};
		return lab(
			<input
				className={ic}
				type="datetime-local"
				step={60}
				disabled={ro}
				required={field.reqd}
				value={toLocal(value)}
				onChange={(e) => onChange(fromLocal(e.target.value))}
			/>,
		);
	}

	if (field.fieldtype === "Select") {
		const opts = (field.options || "").split("\n").filter(Boolean);
		return lab(
			<SearchSelect
				value={value == null ? "" : String(value)}
				onChange={onChange}
				options={opts.map((o) => ({ value: o, label: o }))}
				disabled={ro}
				required={field.reqd}
				noClear={field.reqd}
				placeholder="—"
			/>,
		);
	}

	if (field.fieldname === "against_job_out") {
		return (
			<JobOutField
				field={field}
				value={value == null ? "" : String(value)}
				onChange={(v) => onChange(v)}
				disabled={ro}
				compact={compact}
				party={record?.party == null ? undefined : String(record.party)}
			/>
		);
	}

	if (field.fieldtype === "Link" && field.options) {
		if (compact) {
			return lab(
				<input
					className={ic}
					value={value == null ? "" : String(value)}
					disabled={ro}
					required={field.reqd}
					placeholder={field.options}
					onChange={(e) => onChange(e.target.value)}
				/>,
			);
		}
		const extraFilters = (field.linkFilters ?? [])
			.map((lf) => {
				const v = record?.[lf.fromField];
				return v ? ([lf.field, "=", v] as [string, string, unknown]) : null;
			})
			.filter((f): f is [string, string, unknown] => f !== null);
		return (
			<LinkField
				label={field.label}
				linkDoctype={field.options}
				value={value == null ? "" : String(value)}
				onChange={(v) => onChange(v)}
				disabled={ro}
				required={field.reqd}
				extraFilters={extraFilters}
			/>
		);
	}

	if (field.fieldname === "reminder_interval_hours") {
		const displayValue = value == null || value === "" ? "" : String(Number(Number(value).toFixed(3)));
		const mins = value == null || value === "" ? 0 : Math.round(Number(value) * 60);
		return lab(
			<div className="mm-interval-input-wrapper">
				<input
					className={ic}
					disabled={ro}
					type="number"
					step="any"
					value={displayValue}
					required={field.reqd}
					onChange={(e) => {
						const raw = e.target.value;
						onChange(raw === "" ? null : parseFloat(raw));
					}}
				/>
				{value != null && value !== "" && (
					<div className="mm-interval-helper">
						⏱️ Equivalent to: <strong>{mins} minutes</strong>
					</div>
				)}
			</div>
		);
	}

	const isDecimal =
		field.fieldtype === "Float" || field.fieldtype === "Currency" || field.fieldtype === "Percent";
	const inputType = field.fieldtype === "Int"
		? "number"
		// A DECIMAL FIELD IS A TEXT BOX, DELIBERATELY.
		//
		// `<input type="number">` runs a sanitisation step that empties the field whenever
		// its contents are not a valid floating-point number — and "0." is not one, because
		// the spec insists on digits after the point. So the instant somebody typed the dot
		// of "0.5" the browser handed us "", the value went to null, and the box cleared
		// under their fingers. A bobbin could not be given any weight below 1.
		//
		// Text keeps exactly what was typed; `inputMode="decimal"` still raises the numeric
		// keypad on the floor's tablets, and the parsing below is ours to control.
		: isDecimal ? "text" : field.fieldtype === "Date" ? "date" : "text";

	// What the operator is part-way through typing. "0." and "-" and "1." are all real
	// states on the road to a number, and none of them survives a round-trip through
	// parseFloat — so the keystrokes are held here and the PARSED value is what goes up.
	// Dropped on blur, so the field then shows the canonical number ("0.50" → 0.5).
	const [draft, setDraft] = useState<string | null>(null);
	const shown = draft != null ? draft : value == null ? "" : String(value);

	return lab(
		<input
			className={ic}
			disabled={ro}
			type={inputType}
			inputMode={isDecimal ? "decimal" : undefined}
			step={field.fieldtype === "Int" ? 1 : undefined}
			value={shown}
			required={field.reqd}
			onBlur={() => setDraft(null)}
			onChange={(e) => {
				const raw = e.target.value;
				if (field.fieldtype === "Int") return onChange(raw === "" ? null : parseInt(raw, 10));
				if (!isDecimal) return onChange(raw);
				// Refuse anything that is not on the way to a number, so the box cannot hold
				// letters — the one thing the number input was doing for us.
				if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
				setDraft(raw);
				const n = parseFloat(raw);
				onChange(raw === "" || Number.isNaN(n) ? null : n);
			}}
		/>,
	);
}
