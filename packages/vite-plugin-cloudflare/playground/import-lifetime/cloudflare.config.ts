import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "import-lifetime",
		entrypoint,
		compatibilityDate: "2026-04-01",
		compatibilityFlags: ["enable_request_signal", "request_signal_passthrough"],
	},
});
