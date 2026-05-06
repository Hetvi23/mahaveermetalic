import type { FieldSchema } from "@/config/registry";
import type { ReactNode } from "react";
import LinkField from "./LinkField";

type Props = {
	field: FieldSchema;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled?: boolean;
	compact?: boolean;
};

export function FieldInput({ field, value, onChange, disabled, compact }: Props) {
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
			<select
				className={ic}
				value={value == null ? "" : String(value)}
				disabled={ro}
				required={field.reqd}
				onChange={(e) => onChange(e.target.value)}
			>
				{!field.reqd && <option value="">—</option>}
				{opts.map((o) => (
					<option key={o} value={o}>
						{o}
					</option>
				))}
			</select>,
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
		return (
			<LinkField
				label={field.label}
				linkDoctype={field.options}
				value={value == null ? "" : String(value)}
				onChange={(v) => onChange(v)}
				disabled={ro}
				required={field.reqd}
			/>
		);
	}

	const inputType =
		field.fieldtype === "Int"
			? "number"
			: field.fieldtype === "Float" || field.fieldtype === "Currency" || field.fieldtype === "Percent"
				? "text"
				: field.fieldtype === "Date"
					? "date"
					: "text";

	return lab(
		<input
			className={ic}
			disabled={ro}
			type={inputType}
			value={value == null ? "" : String(value)}
			required={field.reqd}
			onChange={(e) => {
				const raw = e.target.value;
				if (field.fieldtype === "Int") onChange(raw === "" ? null : parseInt(raw, 10));
				else if (field.fieldtype === "Float" || field.fieldtype === "Currency") onChange(raw === "" ? null : parseFloat(raw));
				else if (field.fieldtype === "Percent") onChange(raw === "" ? null : parseFloat(raw));
				else onChange(raw);
			}}
		/>,
	);
}
