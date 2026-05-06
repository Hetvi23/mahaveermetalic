import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

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
