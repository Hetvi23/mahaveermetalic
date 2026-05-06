import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

export default function Login() {
	const loc = useLocation();
	const from = (loc.state as { from?: string } | null)?.from || "/";
	const [usr, setUsr] = useState("");
	const [pwd, setPwd] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const win = window as Window & { frappe?: { boot?: { user?: { name?: string } } } };
	const loggedIn = win.frappe?.boot?.user?.name && win.frappe.boot.user.name !== "Guest";
	if (loggedIn) {
		return <Navigate to={from} replace />;
	}

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setErr(null);
		setLoading(true);
		try {
			const form = new URLSearchParams();
			form.append("usr", usr);
			form.append("pwd", pwd);
			const res = await fetch("/api/method/login", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
				body: form.toString(),
			});
			if (res.ok) {
				window.location.href = "/mahaveermetalic";
				return;
			}
			const data = (await res.json().catch(() => ({}))) as { message?: string };
			setErr(data?.message || "Login failed");
		} catch {
			setErr("Login failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="mm-login-wrap">
			<div className="mm-login-card">
				<h2>Mahaveer Metallic</h2>
				<p className="mm-muted">Sign in with your Frappe user.</p>
				<form onSubmit={onSubmit}>
					<label className="mm-field">
						<span className="mm-field-label">Username</span>
						<input
							className="mm-input"
							value={usr}
							onChange={(e) => setUsr(e.target.value)}
							autoComplete="username"
							required
						/>
					</label>
					<label className="mm-field">
						<span className="mm-field-label">Password</span>
						<input
							className="mm-input"
							type="password"
							value={pwd}
							onChange={(e) => setPwd(e.target.value)}
							autoComplete="current-password"
							required
						/>
					</label>
					{err && <p className="mm-error">{err}</p>}
					<button type="submit" className="mm-btn-primary" style={{ width: "100%", marginTop: "0.75rem" }} disabled={loading}>
						{loading ? "Signing in…" : "Sign in"}
					</button>
				</form>
			</div>
		</div>
	);
}
