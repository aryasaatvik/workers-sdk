type PhaseEvent = { phase: string; at: number; aborted?: boolean };

function initialState() {
	const events: PhaseEvent[] = [];
	return {
		started: false,
		evaluated: false,
		settled: "pending",
		aborted: false,
		events,
	};
}

export const phases = {
	early: initialState(),
	abort: initialState(),
	reject: initialState(),
};
export type Arm = keyof typeof phases;

export function recordPhase(arm: Arm, phase: string, aborted?: boolean) {
	phases[arm].events.push({
		phase,
		at: Date.now(),
		...(aborted === undefined ? {} : { aborted }),
	});
}
