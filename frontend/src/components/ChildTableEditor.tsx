import type { ChildTableSchema, FieldSchema } from "@/config/registry";
import { FieldInput } from "./FieldInputs";

export type ChildRow = Record<string, unknown>;

type Props = {
	schema: ChildTableSchema;
	rows: ChildRow[];
	onChange: (rows: ChildRow[]) => void;
	disabled?: boolean;
	/** When the parent already renders a section title (e.g. form panel). */
	hideTitle?: boolean;
};

function emptyRow(columns: FieldSchema[]): ChildRow {
	const r: ChildRow = {};
	for (const c of columns) {
		if (c.fieldtype === "Check") r[c.fieldname] = 0;
		else if (c.fieldtype === "Float" || c.fieldtype === "Currency") r[c.fieldname] = 0;
		else r[c.fieldname] = "";
	}
	return r;
}

export default function ChildTableEditor({ schema, rows, onChange, disabled, hideTitle }: Props) {
	function updateRow(i: number, fieldname: string, v: unknown) {
		const next = rows.map((row, j) => (j === i ? { ...row, [fieldname]: v } : row));
		onChange(next);
	}

	function addRow() {
		onChange([...rows, emptyRow(schema.columns)]);
	}

	function removeRow(i: number) {
		onChange(rows.filter((_, j) => j !== i));
	}

	return (
		<div className="mm-child-table">
			{!hideTitle && <div className="mm-section-title">{schema.label}</div>}
			<div className="mm-table-scroll">
				<table className="mm-table mm-table-dense">
					<thead>
						<tr>
							{schema.columns.map((c) => (
								<th key={c.fieldname}>{c.label}</th>
							))}
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((row, i) => (
							<tr key={i}>
								{schema.columns.map((col) => (
									<td key={col.fieldname}>
										<FieldInput
											field={col}
											value={row[col.fieldname]}
											onChange={(v) => updateRow(i, col.fieldname, v)}
											disabled={disabled}
											compact
										/>
									</td>
								))}
								<td>
									<button type="button" className="mm-btn-ghost" disabled={disabled} onClick={() => removeRow(i)}>
										Remove
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<button type="button" className="mm-btn-secondary mm-mt-sm" disabled={disabled} onClick={addRow}>
				Add row
			</button>
		</div>
	);
}
