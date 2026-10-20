import { abortGate, phases, recordPhase } from "./state";

abortGate.entered = true;
recordPhase("abort", "module-gate-enter");
// The timer and its continuation stay in the module runner's Durable Object context.
// The release request only changes shared state; it never resolves this promise.
while (!abortGate.released) {
	await new Promise((resolve) => setTimeout(resolve, 25));
}
recordPhase("abort", "module-gate-release-observed");
phases.abort.evaluated = true;
recordPhase("abort", "module-evaluated");
export const value = "12";
