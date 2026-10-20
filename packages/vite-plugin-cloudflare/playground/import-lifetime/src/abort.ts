import { abortGate, phases } from "./state";

abortGate.entered = true;
// The timer and its continuation stay in the module runner's Durable Object context.
// The release request only changes shared state; it never resolves this promise.
while (!abortGate.released) {
	await new Promise((resolve) => setTimeout(resolve, 25));
}
phases.abort.evaluated = true;
export const value = "12";
