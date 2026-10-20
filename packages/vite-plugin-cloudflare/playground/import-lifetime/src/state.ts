function initialState() {
	return {
		started: false,
		evaluated: false,
		settled: "pending",
		aborted: false,
	};
}

export const abortGate = { entered: false, released: false };

export const phases = {
	early: initialState(),
	abort: initialState(),
	reject: initialState(),
};
export type Arm = keyof typeof phases;
