import { useSearch } from "frappe-react-sdk";
import { useEffect, useRef, useState } from "react";

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
	const { data, isLoading } = useSearch(linkDoctype, text.length >= 2 ? text : "", undefined, 12, 200);

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

	const suggestions = data?.message ?? [];

	return (
		<label className="mm-field">
			<span className="mm-field-label">
				{label}
				{required ? " *" : ""}
			</span>
			<div className="mm-link-wrap" ref={wrap}>
				<input
					className="mm-input"
					value={text}
					disabled={disabled}
					required={required}
					onChange={(e) => {
						setText(e.target.value);
						onChange(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					autoComplete="off"
				/>
				{open && text.length >= 2 && (
					<ul className="mm-suggest">
						{isLoading && <li className="mm-suggest-muted">Searching…</li>}
						{!isLoading &&
							suggestions.map((s) => (
								<li
									key={s.value}
									className="mm-suggest-item"
									onMouseDown={(e) => {
										e.preventDefault();
										setText(s.value);
										onChange(s.value);
										setOpen(false);
									}}
								>
									<strong>{s.value}</strong>
									{s.description ? <span className="mm-suggest-desc">{s.description}</span> : null}
								</li>
							))}
						{!isLoading && suggestions.length === 0 && <li className="mm-suggest-muted">No matches</li>}
					</ul>
				)}
			</div>
		</label>
	);
}
