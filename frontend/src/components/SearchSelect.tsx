import { ChevronDown, Plus, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getMasterByDoctype } from "@/config/registry";
import AnchoredMenu, { isInsideMenu } from "./AnchoredMenu";
import QuickCreateMaster from "./QuickCreateMaster";

export type SelectOption = {
	value: string;
	label: string;
	/** Second line in the list — e.g. a party name or colour under an order number. */
	meta?: string;
	/** Heading the option sits under. Options carrying one are expected to arrive already
	 *  ordered by group; a heading is drawn each time the group changes. */
	group?: string;
};

type Props = {
	value: string;
	onChange: (v: string) => void;
	options: SelectOption[];
	/** Shown when nothing is picked, and as the "clear" row's label. */
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
	compact?: boolean;
	/** Hide the "— none —" row when the field must always hold a value. */
	noClear?: boolean;
	/** What an empty list means here. "No matches" is right while typing, but it reads as
	 *  a failed search when the list was empty to begin with. */
	emptyText?: string;
	className?: string;
	/** Offer an inline "+ New <master>" for this doctype, the way LinkField does. Needed
	 *  where a fixed option list replaced a link field but creating the master in place
	 *  must not be lost. */
	createDoctype?: string;
};

/**
 * A drop-in replacement for a native <select> that you can type into.
 *
 * Native selects can't be searched, which hurts on this app's long lists (orders,
 * colours, parties, bobbins). This keeps select semantics — a fixed option list, a
 * value that must come from it — but filters as you type, on both the label and the
 * meta line. Uses the same portalled menu as the link fields, so it can't be clipped
 * by a scrolling ancestor.
 */
export default function SearchSelect({
	value,
	onChange,
	options,
	placeholder = "Select…",
	disabled,
	required,
	compact,
	noClear,
	emptyText,
	className,
	createDoctype,
}: Props) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [dirty, setDirty] = useState(false);
	const [quickCreate, setQuickCreate] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);
	const master = createDoctype ? getMasterByDoctype(createDoctype) : undefined;

	useEffect(() => {
		function onDoc(e: MouseEvent) {
			if (isInsideMenu(e.target)) return;
			if (wrap.current && !wrap.current.contains(e.target as Node)) {
				setOpen(false);
				setDirty(false);
			}
		}
		document.addEventListener("click", onDoc);
		return () => document.removeEventListener("click", onDoc);
	}, []);

	const selected = options.find((o) => o.value === value);
	// An unknown value still shows itself, so a stale/hand-set value is never hidden.
	const display = selected?.label ?? value ?? "";

	// Filter only once the user actually types: clicking a filled field must still offer
	// all the other options, not just the one already chosen.
	const q = dirty ? text.trim().toLowerCase() : "";
	const shown = useMemo(
		() => (q ? options.filter((o) => `${o.label} ${o.meta ?? ""}`.toLowerCase().includes(q)) : options),
		[options, q],
	);

	function pick(v: string) {
		onChange(v);
		setText("");
		setDirty(false);
		setOpen(false);
	}

	const body = (
		<div
			className={`mm-link-wrap${value && !disabled && !noClear ? " mm-link-wrap-clearable" : ""}${
				master && !disabled ? " mm-link-wrap-addable" : ""
			}${className ? ` ${className}` : ""}`}
			ref={wrap}
		>
			<input
				className={`mm-input mm-link-input${compact ? " mm-input-compact" : ""}`}
				value={dirty ? text : display}
				disabled={disabled}
				required={required && !value}
				placeholder={placeholder}
				onChange={(e) => {
					setText(e.target.value);
					setDirty(true);
					setOpen(true);
				}}
				onFocus={() => { setDirty(false); setOpen(true); }}
				onClick={() => setOpen(true)}
				onKeyDown={(e) => {
					if (e.key === "Escape") { setOpen(false); setDirty(false); }
					if (e.key === "Enter" && open && shown.length > 0) { e.preventDefault(); pick(shown[0].value); }
				}}
				autoComplete="off"
			/>
			{value && !disabled && !noClear && (
				<button type="button" className="mm-link-clear" title="Clear" aria-label="Clear"
					onMouseDown={(e) => e.preventDefault()} onClick={() => pick("")}>
					<X size={14} />
				</button>
			)}
			<ChevronDown size={15} className="mm-link-caret" aria-hidden />
			{master && !disabled && (
				<button type="button" className="mm-link-add"
					title={`Create new ${master.title}`} aria-label={`Create new ${master.title}`}
					onClick={() => setQuickCreate(true)}>
					<Plus size={15} />
				</button>
			)}
			<AnchoredMenu anchor={wrap} open={open} className={options.some((o) => o.meta) ? "mm-suggest-rich" : undefined}>
				<>
					{!noClear && (
						<li className="mm-suggest-item mm-suggest-muted"
							onMouseDown={(e) => { e.preventDefault(); pick(""); }}>
							{placeholder}
						</li>
					)}
					{shown.map((o, i) => (
						<Fragment key={o.value}>
							{/* Heading only when this option opens a new group — and only against
							    what is actually visible, so filtering can't leave one stranded.
							    preventDefault or clicking a heading blurs the field it sits in,
							    leaving an open menu over a dead input. */}
							{o.group && o.group !== shown[i - 1]?.group && (
								<li className="mm-suggest-group" onMouseDown={(e) => e.preventDefault()}>{o.group}</li>
							)}
							<li className="mm-suggest-item"
								onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}>
								<strong>{o.label}</strong>
								{o.meta && <span className="mm-suggest-meta">{o.meta}</span>}
							</li>
						</Fragment>
					))}
					{shown.length === 0 && (
						<li className="mm-suggest-muted">{options.length === 0 && emptyText ? emptyText : "No matches"}</li>
					)}
				</>
			</AnchoredMenu>
		</div>
	);

	return (
		<>
			{body}
			{quickCreate && master && (
				<QuickCreateMaster
					meta={master}
					seed={dirty ? text.trim() : ""}
					onClose={() => setQuickCreate(false)}
					onCreated={(name) => { pick(name); setQuickCreate(false); }}
				/>
			)}
		</>
	);
}
