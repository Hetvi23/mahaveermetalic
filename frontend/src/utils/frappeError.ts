/** Pull a readable message from Frappe / frappe-react-sdk errors. */
export function extractErrorMessage(e: unknown): string {
	const msg = (e as { message?: string })?.message;
	if (msg && msg.trim()) return msg;
	const serverMessages = (e as { _server_messages?: string })?._server_messages;
	if (serverMessages) {
		try {
			const outer = JSON.parse(serverMessages);
			if (Array.isArray(outer) && outer.length) {
				const first = outer[0];
				if (typeof first === "string") {
					const parsed = JSON.parse(first) as { message?: string };
					if (parsed?.message) return parsed.message;
				}
			}
		} catch {
			/* ignore */
		}
	}
	return "Could not save. Please check required fields and try again.";
}
