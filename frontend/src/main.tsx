import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Apply the saved theme before first paint so there's no light→dark flash.
try {
	const saved = localStorage.getItem("mm-theme");
	if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
} catch { /* ignore */ }

// Same for the sidebar: restore it before paint, or a collapsed rail flashes open and
// the whole page shifts 168px sideways on every reload.
try {
	const rail = localStorage.getItem("mm-rail");
	if (rail === "collapsed" || rail === "expanded") document.documentElement.setAttribute("data-rail", rail);
} catch { /* ignore */ }

function initApp() {
	const win = window as Window & { frappe?: Record<string, unknown> };
	if (!win.frappe) win.frappe = {};
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

if (import.meta.env.DEV) {
	fetch("/api/method/mahaveermetalic.www.mahaveermetalic.get_context_for_dev", { method: "POST" })
		.then((r) => r.json())
		.then((body) => {
			const win = window as Window & { frappe?: Record<string, unknown> };
			if (!win.frappe) win.frappe = {};
			const v = JSON.parse(body.message as string);
			win.frappe.boot = v;
			win.frappe._messages = (v as { __messages?: Record<string, string> }).__messages || {};
			initApp();
		})
		.catch((e) => {
			console.error(e);
			initApp();
		});
} else if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initApp);
} else {
	initApp();
}
