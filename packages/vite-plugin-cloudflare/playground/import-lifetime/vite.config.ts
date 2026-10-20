import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { installRuntimeReset } from "./runtime-reset";

export default defineConfig({
	plugins: [
		{
			name: "import-lifetime-runtime-reset",
			apply: "serve",
			configureServer(server) {
				const reset = installRuntimeReset();
				server.httpServer?.once("close", reset.dispose);
				server.middlewares.use((request, response, next) => {
					if (request.url !== "/__import-lifetime-reset") {
						next();
						return;
					}
					response.writeHead(200, { "content-type": "application/json" });
					response.end(JSON.stringify(reset.state));
				});
			},
		},
		cloudflare({ inspectorPort: false, persistState: false }),
	],
});
