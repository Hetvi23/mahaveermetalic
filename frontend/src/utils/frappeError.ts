/** Pull a readable message from Frappe / frappe-react-sdk errors.
 *
 * frappe.throw() messages arrive in `_server_messages` (a JSON list of JSON
 * strings); the SDK only sets the top-level `message` to the literal
 * "There was an error." when the response has no plain message — so we must
 * prefer `_server_messages` over that generic fallback. */

const GENERIC = "There was an error.";

function stripHtml(s: string): string {
	return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function fromServerMessages(raw?: string): string | null {
	if (!raw) return null;
	try {
		const outer = JSON.parse(raw);
		if (!Array.isArray(outer)) return null;
		const msgs = outer
			.map((x) => {
				if (typeof x !== "string") return (x as { message?: string })?.message ?? "";
				try {
					return (JSON.parse(x) as { message?: string })?.message ?? x;
				} catch {
					return x;
				}
			})
			.map((m) => stripHtml(String(m)))
			.filter(Boolean);
		return msgs.length ? msgs.join(" ") : null;
	} catch {
		return null;
	}
}

export function extractErrorMessage(e: unknown): string {
	const err = e as {
		message?: string;
		_server_messages?: string;
		exception?: string;
		httpStatus?: number;
	};

	// 1. The real frappe.throw() message(s).
	const server = fromServerMessages(err?._server_messages);
	if (server) return server;

	// 2. A meaningful top-level message (ignore the SDK's generic placeholder).
	const msg = err?.message?.trim();
	if (msg && msg !== GENERIC) return stripHtml(msg);

	// 3. The raw exception string, minus the "frappe.exceptions.X:" prefix.
	if (err?.exception) {
		const ex = err.exception.replace(/^[\w.]*(?:Error|Exception):\s*/, "").trim();
		if (ex) return stripHtml(ex);
	}

	// 4. Last resort — at least say something other than nothing.
	if (err?.httpStatus) return `Request failed (${err.httpStatus}). Please try again.`;
	return "Could not complete the request. Please try again.";
}
