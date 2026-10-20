import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { Plugin } from "vite";

type Event = {
	phase: string;
	at: number;
	[field: string]: string | number | boolean;
};

export function transportDiagnostic(): Plugin {
	const events: Event[] = [];
	const requests = new WeakMap<object, number>();
	let sequence = 0;
	const record = (
		phase: string,
		fields: Record<string, string | number | boolean> = {}
	) => {
		events.push({ phase, at: Date.now(), ...fields });
	};
	const subscriptions = ["create", "error", "headers"].map((phase) => {
		const name = `undici:request:${phase}`;
		const observe = (message: unknown) => {
			if (
				typeof message !== "object" ||
				message === null ||
				!("request" in message)
			) {
				return;
			}
			const request = message.request;
			if (typeof request !== "object" || request === null) {
				return;
			}
			if (
				phase === "create" &&
				"path" in request &&
				request.path === "/render?arm=abort" &&
				"headers" in request &&
				Array.isArray(request.headers)
			) {
				const headers: unknown[] = request.headers;
				for (let index = 0; index < headers.length; index += 2) {
					const headerName = headers[index];
					if (
						typeof headerName === "string" &&
						headerName.toLowerCase() === "x-import-lifetime-call" &&
						headers[index + 1] === "first"
					) {
						requests.set(request, ++sequence);
						break;
					}
				}
			}
			const requestId = requests.get(request);
			if (requestId === undefined) {
				return;
			}
			const error = "error" in message ? message.error : undefined;
			const errorClass =
				error instanceof Error &&
				["AbortError", "RequestAbortedError", "Error"].includes(error.name)
					? error.name
					: "other";
			const abortError =
				error instanceof Error &&
				(error.name === "AbortError" ||
					("code" in error && error.code === "UND_ERR_ABORTED"));
			record(`runtime-dispatch-${phase}`, {
				request_id: requestId,
				...(phase === "error"
					? { abort_error: abortError, error_class: errorClass }
					: {}),
			});
		};
		return { name, observe };
	});
	return {
		name: "import-lifetime-transport-diagnostic",
		apply: "serve",
		configureServer(server) {
			for (const { name, observe } of subscriptions) {
				subscribe(name, observe);
			}
			const pending = new Set<() => void>();
			server.httpServer?.once("close", () => {
				for (const { name, observe } of subscriptions) {
					unsubscribe(name, observe);
				}
				for (const cleanup of pending) {
					cleanup();
				}
				pending.clear();
			});
			server.middlewares.use((request, response, next) => {
				if (request.url === "/__import-lifetime-transport") {
					response.writeHead(200, { "content-type": "application/json" });
					response.end(JSON.stringify({ events }));
					return;
				}
				if (
					request.url === "/render?arm=abort" &&
					request.headers["x-import-lifetime-call"] === "first"
				) {
					record("server-request-enter");
					const onResponseClose = () =>
						record("server-response-close", {
							writable_ended: response.writableEnded,
							writable_finished: response.writableFinished,
						});
					const onSocketClose = () => record("server-socket-close");
					const onResponseFinish = () => record("server-response-finish");
					response.once("close", onResponseClose);
					request.socket.once("close", onSocketClose);
					response.once("finish", onResponseFinish);
					pending.add(() => {
						response.off("close", onResponseClose);
						request.socket.off("close", onSocketClose);
						response.off("finish", onResponseFinish);
					});
				}
				next();
			});
		},
	};
}
