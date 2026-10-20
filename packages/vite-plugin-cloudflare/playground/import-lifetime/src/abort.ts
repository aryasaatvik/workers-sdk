import { phases, recordPhase } from "./state";

await new Promise((resolve) => setTimeout(resolve, 12_000));
phases.abort.evaluated = true;
recordPhase("abort", "module-evaluated");
export const value = "12";
