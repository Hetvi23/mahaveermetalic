import type { DocRegistryEntry } from "@/config/registry";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

export default function DocListPage({ meta }: { meta: DocRegistryEntry }) {
	const [searchParams] = useSearchParams();
	// Seed the search box from ?q= so the Home global search can deep-link here.
	const [q, setQ] = useState(() => searchParams.get("q") ?? "");
	const fields = useMemo(() => {
		const cols = meta.listColumns.map((c) => c.fieldname);
		if (!cols.includes("name")) {
			return [...cols, "name"];
		}
		return cols;
	}, [meta.listColumns]);
	const filters = useMemo(() => {
		if (!q.trim() || !meta.searchField) return undefined;
		return [[meta.searchField, "like", `%${q.trim()}%`]] as any;
	}, [q, meta.searchField]);

	const { data, error, isLoading, mutate } = useFrappeGetDocList(meta.doctype, {
		fields,
		filters,
		limit: 40,
		orderBy: { field: "modified", order: "desc" },
	});

	const rows = (data as Record<string, unknown>[] | undefined) ?? [];
	const count = rows.length;

	return (
		<div className="mm-page mm-page-enter">
			<header className="mm-list-hero">
				<div className="mm-list-hero-text">
					<h1 className="mm-page-title">{meta.title}</h1>
					{meta.listTagline ? <p className="mm-list-tagline">{meta.listTagline}</p> : <p className="mm-page-sub">{meta.doctype}</p>}
					<p className="mm-page-sub mm-list-doctype">{meta.doctype}</p>
					{meta.slug === "task-reminder" ? (
						<p className="mm-page-sub mm-task-reminder-chat-link">
							<Link to="/tools/reminders-chat" className="mm-link-pill">
								Open simple chat screen (step‑by‑step for shop floor)
							</Link>
						</p>
					) : null}
				</div>
				<Link className="mm-btn-primary mm-btn-glow" to={`${meta.routeBase}/new`}>
					+ New
				</Link>
			</header>

			<div className="mm-card mm-card-pad mm-list-card">
				<div className="mm-list-toolbar">
					{meta.searchField ? (
						<div className="mm-search-wrap">
							<span className="mm-search-icon" aria-hidden>
								⌕
							</span>
							<input
								className="mm-input mm-search mm-search-pill"
								placeholder={`Search by ${meta.searchField}…`}
								value={q}
								onChange={(e) => setQ(e.target.value)}
								aria-label={`Search by ${meta.searchField}`}
							/>
						</div>
					) : (
						<span className="mm-muted mm-list-toolbar-filler">Browse recent records.</span>
					)}
					<div className="mm-list-toolbar-right">
						<span className="mm-pill mm-pill-muted">{isLoading ? "…" : `${count} shown`}</span>
						<button type="button" className="mm-btn-secondary mm-btn-compact" disabled={isLoading} onClick={() => mutate()}>
							Refresh
						</button>
					</div>
				</div>

				{isLoading && (
					<div className="mm-skeleton" aria-busy aria-label="Loading list">
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} className="mm-skel-row">
								<div className="mm-skel-cell mm-skel-w40" />
								<div className="mm-skel-cell mm-skel-w25" />
								<div className="mm-skel-cell mm-skel-grow" />
							</div>
						))}
					</div>
				)}
				{error && (
					<p className="mm-error">
						{(error as { message?: string }).message || String(error)}
					</p>
				)}

				{!isLoading && data && data.length === 0 && <p className="mm-empty">No rows yet.</p>}

				{!isLoading && data && data.length > 0 && (
					<div className="mm-table-wrap mm-table-wrap-elevated">
						<div className="mm-table-scroll">
							<table className="mm-table mm-table-hover mm-table-rows">
								<thead>
									<tr>
										{meta.listColumns.map((c) => (
											<th key={c.fieldname}>{c.label}</th>
										))}
										<th />
									</tr>
								</thead>
								<tbody>
									{rows.map((row, ri) => (
										<tr key={String(row.name)} className="mm-tr-enter" style={{ animationDelay: `${ri * 28}ms` }}>
											{meta.listColumns.map((c) => (
												<td key={c.fieldname}>{formatCell(row[c.fieldname])}</td>
											))}
											<td className="mm-td-actions">
												<Link className="mm-link mm-link-pill" to={`${meta.routeBase}/${encodeURIComponent(String(row.name))}`}>
													Open
												</Link>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function formatCell(v: unknown) {
	if (v == null) return "—";
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}
