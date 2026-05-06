import { FormEvent, useState } from "react";

type StockMsg = {
	total_weight?: number;
	total_box?: number;
	suggest_purchase_order?: boolean;
	lines?: unknown[];
};

export default function SalesOrderStock() {
	const [color, setColor] = useState("");
	const [cut, setCut] = useState("");
	const [location, setLocation] = useState("");
	const [msg, setMsg] = useState<StockMsg | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function onSearch(e: FormEvent) {
		e.preventDefault();
		setErr(null);
		setLoading(true);
		try {
			const q = new URLSearchParams();
			if (color) q.set("color_name", color);
			if (cut) q.set("cut", cut);
			if (location) q.set("location", location);
			const res = await fetch(
				`/api/method/mahaveermetalic.mahaveer_metallic.api.stock.get_stock_summary?${q.toString()}`,
				{ credentials: "include" },
			);
			const body = (await res.json()) as { message?: StockMsg; exc_type?: string };
			if (!res.ok) {
				setErr(body.exc_type || "Request failed");
				setMsg(null);
				return;
			}
			setMsg(body.message || null);
		} catch (e) {
			setErr(String(e));
			setMsg(null);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="mm-page">
			<header className="mm-page-head">
				<div>
					<h1 className="mm-page-title">Stock by color / cut / location</h1>
					<p className="mm-page-sub">Roll inventory totals — create a Purchase Order from Sales if stock is zero.</p>
				</div>
			</header>

			<div className="mm-card mm-card-pad">
				<form className="mm-form-grid" onSubmit={onSearch}>
					<label className="mm-field">
						<span className="mm-field-label">Color</span>
						<input className="mm-input" value={color} onChange={(e) => setColor(e.target.value)} />
					</label>
					<label className="mm-field">
						<span className="mm-field-label">Cut</span>
						<input className="mm-input" value={cut} onChange={(e) => setCut(e.target.value)} />
					</label>
					<label className="mm-field mm-span-2">
						<span className="mm-field-label">Location</span>
						<input className="mm-input" value={location} onChange={(e) => setLocation(e.target.value)} />
					</label>
					<div className="mm-span-2 mm-form-actions" style={{ marginTop: 0, paddingTop: 0, border: 0 }}>
						<button type="submit" className="mm-btn-primary" disabled={loading}>
							{loading ? "Checking…" : "Check stock"}
						</button>
					</div>
				</form>

				{err && <p className="mm-error">{err}</p>}
				{msg && (
					<div style={{ marginTop: "1rem" }}>
						<p>
							<strong>Total weight:</strong> {msg.total_weight ?? 0} kg · <strong>Total box:</strong>{" "}
							{msg.total_box ?? 0}
						</p>
						{msg.suggest_purchase_order && (
							<p className="mm-banner mm-banner-warn" style={{ display: "inline-block", marginTop: "0.5rem" }}>
								No stock — create a Purchase Order from the Purchase Orders screen.
							</p>
						)}
						<pre
							style={{
								fontSize: 12,
								overflow: "auto",
								background: "#f8fafc",
								padding: "0.75rem",
								borderRadius: 8,
								border: "1px solid var(--mm-border)",
							}}
						>
							{JSON.stringify(msg.lines, null, 2)}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}
