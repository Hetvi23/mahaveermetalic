import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import proxyOptions from "./proxyOptions";

export default defineConfig(({ command }) => {
	const isDev = command === "serve";
	return {
		plugins: [react()],
		base: isDev ? "/mahaveermetalic/" : "/assets/mahaveermetalic/mahaveermetalic/",
		server: {
			port: 8092,
			host: "0.0.0.0",
			proxy: proxyOptions,
		},
		resolve: {
			alias: { "@": path.resolve(__dirname, "./src") },
		},
		build: {
			outDir: "../mahaveermetalic/public/mahaveermetalic",
			emptyOutDir: true,
			rollupOptions: {
				output: {
					entryFileNames: "assets/index.js",
					chunkFileNames: "assets/[name].js",
					assetFileNames: "assets/[name][extname]",
				},
			},
		},
	};
});
