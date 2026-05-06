import { DOC_REGISTRY } from "@/config/registry";
import { useFrappeAuth, useFrappeGetDocCount } from "frappe-react-sdk";

function StatCard({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
	return (
		<div className="mm-stat">
			<div className="mm-stat-val">{loading ? "…" : value ?? 0}</div>
			<div className="mm-stat-lab">{label}</div>
		</div>
	);
}

export default function Dashboard() {
	const { currentUser, isLoading } = useFrappeAuth();

	if (isLoading) {
		return (
			<div className="mm-page">
				<div className="mm-card mm-card-pad">Loading session…</div>
			</div>
		);
	}

	return (
		<div className="mm-page">
			<header className="mm-page-head">
				<div>
					<h1 className="mm-page-title">Dashboard</h1>
					<p className="mm-page-sub">
						Signed in as <strong>{currentUser}</strong> — all masters and transactions run in this app (no Desk
						required).
					</p>
				</div>
			</header>

			<div className="mm-card mm-card-pad">
				<p className="mm-muted" style={{ marginTop: 0 }}>
					Use the left navigation to open a module. Record counts below respect your role permissions.
				</p>
				<div className="mm-dash-grid">
					{DOC_REGISTRY.map((d) => (
						<DashCount key={d.slug} doctype={d.doctype} title={d.title} />
					))}
				</div>
			</div>
		</div>
	);
}

function DashCount({ doctype, title }: { doctype: string; title: string }) {
	const { data, isLoading } = useFrappeGetDocCount(doctype);
	return <StatCard label={title} value={data} loading={isLoading} />;
}
