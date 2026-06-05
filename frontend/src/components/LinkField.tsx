import { useFrappeGetDocList } from "frappe-react-sdk";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
	label: string;
	linkDoctype: string;
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
	required?: boolean;
};

export default function LinkField({ label, linkDoctype, value, onChange, disabled, required }: Props) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState(value || "");
	const wrap = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setText(value || "");
	}, [value]);

	useEffect(() => {
		function onDocClick(e: MouseEvent) {
			if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("click", onDocClick);
		return () => document.removeEventListener("click", onDocClick);
	}, []);

	// Show all options on focus; filter once the user actually types. Uses get_list
	// (search_link is unreliable on some sites and returns nothing).
	const typed = text.trim() !== "" && text.trim() !== (value || "");
	const { data, isLoading } = useFrappeGetDocList<{ name: string }>(
		linkDoctype,
		{
			fields: ["name"],
			filters: typed ? [["name", "like", `%${text.trim()}%`]] : undefined,
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

	return (
		<label className="mm-field">
			<span className="mm-field-label">
				{label}
				{required ? " *" : ""}
			</span>
			<div className="mm-link-wrap" ref={wrap}>
				<input
					className="mm-input mm-link-input"
					value={text}
					disabled={disabled}
					required={required}
					placeholder="Select…"
					onChange={(e) => {
						setText(e.target.value);
						onChange(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					autoComplete="off"
				/>
				<ChevronDown size={15} className="mm-link-caret" aria-hidden />
				{open && (
					<ul className="mm-suggest">
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
					</ul>
				)}
			</div>
		</label>
	);
}
