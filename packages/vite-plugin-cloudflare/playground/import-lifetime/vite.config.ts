import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { transportDiagnostic } from "./transport-diagnostic";

export default defineConfig({
	plugins: [
		transportDiagnostic(),
		cloudflare({ inspectorPort: false, persistState: false }),
	],
});
