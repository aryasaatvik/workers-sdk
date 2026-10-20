import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { Socket } from "node:net";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function firstAbortRequest(request: object) {
	if (
		!("path" in request) ||
		request.path !== "/render?arm=abort" ||
		!("headers" in request) ||
		!Array.isArray(request.headers)
	) {
		return false;
	}
	const headers: unknown[] = request.headers;
	for (let index = 0; index < headers.length; index += 2) {
		const key = headers[index];
		if (
			typeof key === "string" &&
			key.toLowerCase() === "x-import-lifetime-call" &&
			headers[index + 1] === "first"
		) {
			return true;
		}
	}
	return false;
}

/**
 * Abruptly resets the marked runtime connection after Vite aborts its request,
 * provided the fixture can prove exclusive ownership of the socket.
 *
 * @returns Reset state for assertions and a `dispose()` function that removes
 * the shared diagnostics-channel listeners.
 */
export function installRuntimeReset() {
	const bornHere = new WeakSet<Socket>();
	const active = new WeakMap<Socket, Set<object>>();
	const sockets = new WeakMap<object, Socket>();
	let target: object | undefined;
	const state = {
		target_count: 0,
		reset_issued: false,
		ownership_confirmed: false,
		foreign_overlap: false,
		failure: "",
	};
	const handlers = {
		"undici:client:connected": (value: unknown) => {
			if (object(value) && value.socket instanceof Socket) {
				bornHere.add(value.socket);
			}
		},
		"undici:client:sendHeaders": (value: unknown) => {
			if (
				!object(value) ||
				!object(value.request) ||
				!(value.socket instanceof Socket)
			) {
				return;
			}
			const { request, socket } = value;
			let requests = active.get(socket);
			if (!requests) {
				requests = new Set();
				active.set(socket, requests);
			}
			requests.add(request);
			sockets.set(request, socket);
			if (firstAbortRequest(request)) {
				target = request;
				state.target_count++;
			}
			if (target && requests.has(target) && requests.size !== 1) {
				state.foreign_overlap = true;
			}
		},
		"undici:request:error": (value: unknown) => {
			if (!object(value) || !object(value.request)) {
				return;
			}
			const request = value.request;
			const socket = sockets.get(request);
			if (!socket) {
				return;
			}
			const requests = active.get(socket);
			if (request === target && !state.reset_issued) {
				const abort =
					value.error instanceof Error &&
					(value.error.name === "AbortError" ||
						("code" in value.error && value.error.code === "UND_ERR_ABORTED"));
				state.ownership_confirmed =
					state.target_count === 1 &&
					abort &&
					bornHere.has(socket) &&
					requests?.size === 1 &&
					requests.has(request) &&
					!state.foreign_overlap &&
					!socket.destroyed &&
					!socket.connecting &&
					typeof socket.remotePort === "number";
				if (state.ownership_confirmed) {
					state.reset_issued = true;
					try {
						socket.resetAndDestroy();
					} catch {
						state.reset_issued = false;
						state.failure = "runtime-reset-failed";
					}
				} else {
					state.failure = "runtime-socket-ownership-unproven";
				}
			}
			requests?.delete(request);
			sockets.delete(request);
		},
		"undici:request:trailers": (value: unknown) => {
			if (!object(value) || !object(value.request)) {
				return;
			}
			const socket = sockets.get(value.request);
			if (socket) {
				active.get(socket)?.delete(value.request);
			}
			sockets.delete(value.request);
		},
	};
	for (const [name, handler] of Object.entries(handlers)) {
		subscribe(name, handler);
	}
	return {
		state,
		dispose() {
			for (const [name, handler] of Object.entries(handlers)) {
				unsubscribe(name, handler);
			}
		},
	};
}
