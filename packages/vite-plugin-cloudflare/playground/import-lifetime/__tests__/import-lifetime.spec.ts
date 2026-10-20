import { get, type IncomingMessage } from "node:http";
import { describe, test, vi } from "vitest";
import { isBuild, viteTestUrl, WAIT_FOR_OPTIONS } from "../../__test-utils__";
import type { Arm } from "../src/state";

async function state(arm: Arm) {
	return (await fetch(`${viteTestUrl}/state?arm=${arm}`)).json();
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
		"settles a cached import after the first Worker request actually aborts",
		{ retry: 0 },
		async ({ expect }) => {
			// Own a dedicated connection so disconnection does not depend on fetch pooling.
			const first = get(`${viteTestUrl}/render?arm=abort`, { agent: false });
			let responseReceived = false;
			let disconnecting = false;
			let unexpectedError: Error | undefined;
			const onResponse = (response: IncomingMessage) => {
				responseReceived = true;
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
				await vi.waitFor(async () => {
					expect(await state("abort")).toMatchObject({
						started: true,
						evaluated: false,
					});
				}, WAIT_FOR_OPTIONS);
			} finally {
				disconnecting = true;
				first.destroy();
				await closed;
				first.off("response", onResponse);
				first.off("error", onError);
			}
			expect(unexpectedError).toBeUndefined();
			expect(responseReceived).toBe(false);
			expect(first.destroyed).toBe(true);
			await vi.waitFor(async () => {
				expect(await state("abort")).toMatchObject({
					aborted: true,
					evaluated: false,
				});
			}, WAIT_FOR_OPTIONS);
			await vi.waitFor(async () => {
				expect(await state("abort")).toMatchObject({ evaluated: true });
			}, WAIT_FOR_OPTIONS);
			expect(await render("abort")).toEqual({ status: 200, body: "12" });
			expect(await state("abort")).toMatchObject({
				settled: "fulfilled",
				aborted: true,
			});
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
