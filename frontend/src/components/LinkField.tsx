import { getMasterByDoctype } from "@/config/registry";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AnchoredMenu, { isInsideMenu } from "./AnchoredMenu";
import QuickCreateMaster from "./QuickCreateMaster";

type Props = {
	label: string;
	linkDoctype: string;
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
	required?: boolean;
	/** Extra get_list filters applied to the options, e.g. [["location", "=", "X"]]. */
	extraFilters?: [string, string, unknown][];
	/** Inline mode for table cells — no field label wrapper. */
	compact?: boolean;
	/** Pre-set fields on the quick-create dialog, e.g. { item_type: "Roll" }. */
	createDefaults?: Record<string, unknown>;
	placeholder?: string;
};

export default function LinkField({ label, linkDoctype, value, onChange, disabled, required, extraFilters, compact, createDefaults, placeholder }: Props) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState(value || "");
	const [quickCreate, setQuickCreate] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);

	// Offer inline "+ New" only for Link targets that are one of our masters.
	const master = getMasterByDoctype(linkDoctype);

	useEffect(() => {
		setText(value || "");
	}, [value]);

	useEffect(() => {
		function onDocClick(e: MouseEvent) {
			// The menu is portalled onto <body>, so it isn't inside `wrap` — check it too.
			if (isInsideMenu(e.target)) return;
			if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("click", onDocClick);
		return () => document.removeEventListener("click", onDocClick);
	}, []);

	// Show all options on focus; filter once the user actually types. Uses get_list
	// (search_link is unreliable on some sites and returns nothing).
	const typed = text.trim() !== "" && text.trim() !== (value || "");
	const filters = [
		...(extraFilters ?? []),
		...(typed ? ([["name", "like", `%${text.trim()}%`]] as [string, string, unknown][]) : []),
	];
	const { data, isLoading } = useFrappeGetDocList<{ name: string }>(
		linkDoctype,
		{
			fields: ["name"],
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			filters: filters.length ? (filters as any) : undefined,
			limit: 20,
			orderBy: { field: "modified", order: "desc" },
		},
		open ? undefined : null,
	);

	const suggestions = data ?? [];

	function pick(v: string) {
		setText(v);
		onChange(v);
		setOpen(false);
	}

	const body = (
		<div className={`mm-link-wrap${master && !disabled ? " mm-link-wrap-addable" : ""}`} ref={wrap}>
			<input
				className={`mm-input mm-link-input${compact ? " mm-input-compact" : ""}`}
				value={text}
				disabled={disabled}
				required={required}
				placeholder={placeholder || "Select…"}
				onChange={(e) => {
					setText(e.target.value);
					onChange(e.target.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				autoComplete="off"
			/>
			<ChevronDown size={15} className="mm-link-caret" aria-hidden />
			{master && !disabled && (
				<button
					type="button"
					className="mm-link-add"
					title={`Create new ${master.title}`}
					aria-label={`Create new ${master.title}`}
					onClick={() => setQuickCreate(true)}
				>
					<Plus size={15} />
				</button>
			)}
			<AnchoredMenu anchor={wrap} open={open}>
				{isLoading && <li className="mm-suggest-muted">Loading…</li>}
				{!isLoading &&
					suggestions.map((s) => (
						<li
							key={s.name}
							className="mm-suggest-item"
							onMouseDown={(e) => {
								e.preventDefault();
								pick(s.name);
							}}
						>
							<strong>{s.name}</strong>
						</li>
					))}
				{!isLoading && suggestions.length === 0 && <li className="mm-suggest-muted">No matches</li>}
			</AnchoredMenu>
		</div>
	);

	return (
		<>
			{compact ? (
				body
			) : (
				<label className="mm-field">
					<span className="mm-field-label">
						{label}
						{required ? " *" : ""}
					</span>
					{body}
				</label>
			)}
			{quickCreate && master && (
				<QuickCreateMaster
					meta={master}
					seed={text.trim()}
					defaults={createDefaults}
					onClose={() => setQuickCreate(false)}
					onCreated={(name) => {
						pick(name);
						setQuickCreate(false);
					}}
				/>
			)}
		</>
	);
}
