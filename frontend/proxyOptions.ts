import fs from "fs";
import path from "path";

function getWebPort(): number {
	try {
		const p = path.resolve(__dirname, "../../../sites/common_site_config.json");
		const j = JSON.parse(fs.readFileSync(p, "utf8")) as { webserver_port?: number };
		return j.webserver_port || 8000;
	} catch {
		return 8000;
	}
}

const port = getWebPort();

export default {
	"^/(app|api|assets|files|private)": {
		target: `http://127.0.0.1:${port}`,
		changeOrigin: true,
		ws: true,
		router(req: { headers?: { host?: string } }) {
			const site_name = req.headers?.host?.split(":")[0] || "localhost";
			return `http://${site_name}:${port}`;
		},
	},
};
