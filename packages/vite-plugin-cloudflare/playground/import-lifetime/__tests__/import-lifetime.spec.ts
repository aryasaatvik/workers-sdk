import { request, type IncomingMessage } from "node:http";
import { describe, test, vi } from "vitest";
import { isBuild, viteTestUrl, WAIT_FOR_OPTIONS } from "../../__test-utils__";
import type { Arm } from "../src/state";

async function state(arm: Arm) {
	return (await fetch(`${viteTestUrl}/state?arm=${arm}`)).json();
}

async function abortSnapshot() {
	const [worker, transport, reset] = await Promise.all([
		state("abort"),
		fetch(`${viteTestUrl}/__import-lifetime-transport`).then((response) =>
			response.json()
		),
		fetch(`${viteTestUrl}/__import-lifetime-reset`).then((response) =>
			response.json()
		),
	]);
	return { worker, transport, reset, observed_at: Date.now() };
}

async function releaseAbortGate() {
	const response = await fetch(`${viteTestUrl}/release?arm=abort`, {
		method: "POST",
		signal: AbortSignal.timeout(5_000),
	});
	if (response.status !== 200 || (await response.text()) !== "released") {
		throw new Error("Abort module gate release failed");
	}
}

async function render(arm: Arm) {
	try {
		const response = await fetch(`${viteTestUrl}/render?arm=${arm}`, {
			signal: AbortSignal.timeout(5_000),
		});
		return { status: response.status, body: await response.text() };
	} catch {
		return { status: null, body: null };
	}
}

describe.runIf(!isBuild)("deferred import caller lifetime", () => {
	test(
		"settles a cached import after its first response completes",
		{ retry: 0 },
		async ({ expect }) => {
			const response = await fetch(`${viteTestUrl}/kick?arm=early`);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("kicked");
			await vi.waitFor(async () => {
				expect(await state("early")).toMatchObject({ evaluated: true });
			}, WAIT_FOR_OPTIONS);
			expect(await render("early")).toEqual({ status: 200, body: "12" });
			expect(await state("early")).toMatchObject({ settled: "fulfilled" });
		}
	);

	test(
		"settles a cached import when an abrupt runtime TCP reset aborts an incomplete upload",
		{ retry: 0 },
		async ({ expect }) => {
			try {
				// Own a dedicated connection so disconnection does not depend on fetch pooling.
				const clientEvents = [{ phase: "request-create", at: Date.now() }];
				const first = request(`${viteTestUrl}/render?arm=abort`, {
					agent: false,
					method: "POST",
					headers: { "x-import-lifetime-call": "first", "content-length": "2" },
				});
				let responseReceived = false;
				let disconnecting = false;
				let unexpectedError: Error | undefined;
				const onResponse = (response: IncomingMessage) => {
					responseReceived = true;
					clientEvents.push({ phase: "response-received", at: Date.now() });
					response.resume();
				};
				const onError = (error: Error) => {
					if (!disconnecting) {
						unexpectedError = error;
					}
				};
				first.once("response", onResponse);
				first.on("error", onError);
				const closed = new Promise<void>((resolve) =>
					first.once("close", resolve)
				);
				try {
					// Send only one of two declared bytes; keep the native body read outstanding.
					first.write("x");
					await vi.waitFor(async () => {
						const snapshot = await abortSnapshot();
						expect(
							snapshot.worker,
							JSON.stringify({
								phase: "before-disconnect",
								...snapshot,
								clientEvents,
							})
						).toMatchObject({
							started: true,
							evaluated: false,
							settled: "pending",
							gate: { entered: true, released: false },
							body_read: {
								pending: true,
								received_bytes: 1,
								complete: false,
								failed: false,
							},
						});
					}, WAIT_FOR_OPTIONS);
				} finally {
					disconnecting = true;
					clientEvents.push({ phase: "disconnect-requested", at: Date.now() });
					first.destroy();
					await closed;
					clientEvents.push({ phase: "request-closed", at: Date.now() });
					first.off("response", onResponse);
					first.off("error", onError);
				}
				expect(unexpectedError === undefined).toBe(true);
				expect(responseReceived).toBe(false);
				expect(first.destroyed).toBe(true);
				await vi.waitFor(async () => {
					const snapshot = await abortSnapshot();
					expect(
						snapshot.reset,
						JSON.stringify({ phase: "runtime-reset-ownership", ...snapshot })
					).toMatchObject({
						target_count: 1,
						reset_issued: true,
						ownership_confirmed: true,
						foreign_overlap: false,
						failure: "",
					});
					expect(
						snapshot.worker,
						JSON.stringify({
							phase: "await-worker-abort",
							...snapshot,
							client: {
								destroyed: first.destroyed,
								responseReceived,
								unexpected_error: unexpectedError !== undefined,
								events: clientEvents,
							},
						})
					).toMatchObject({
						aborted: true,
						evaluated: false,
						settled: "pending",
						gate: { entered: true, released: false },
					});
				}, WAIT_FOR_OPTIONS);
				await releaseAbortGate();
				await vi.waitFor(async () => {
					const snapshot = await abortSnapshot();
					expect(
						snapshot.worker,
						JSON.stringify({
							phase: "await-module-evaluation",
							...snapshot,
							clientEvents,
						})
					).toMatchObject({ evaluated: true });
				}, WAIT_FOR_OPTIONS);
				const cached = await render("abort");
				expect(
					cached,
					JSON.stringify({ phase: "cached-render", ...(await abortSnapshot()) })
				).toEqual({ status: 200, body: "12" });
				expect(await state("abort")).toMatchObject({
					settled: "fulfilled",
					aborted: true,
				});
				const snapshot = await abortSnapshot();
				console.debug(
					"IMPORT_LIFETIME_DIAGNOSTIC " +
						JSON.stringify({ ...snapshot, clientEvents })
				);
				expect(snapshot.transport).toMatchObject({
					events: expect.arrayContaining([
						expect.objectContaining({ phase: "runtime-dispatch-create" }),
					]),
				});
			} finally {
				await releaseAbortGate();
			}
		}
	);

	test("preserves an import rejection", { retry: 0 }, async ({ expect }) => {
		expect(await render("reject")).toEqual({
			status: 500,
			body: "import-lifetime-rejection",
		});
		expect(await state("reject")).toMatchObject({
			evaluated: true,
			settled: "rejected",
		});
	});
});
