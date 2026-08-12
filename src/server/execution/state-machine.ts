export const EXECUTION_STATES = [
  "draft",
  "validated",
  "pending_approval",
  "approved",
  "simulating",
  "submitted",
  "confirming",
  "completed",
  "validation_failed",
  "simulation_failed",
  "execution_failed",
  "retrying",
  "cancelled",
  "execution_unknown",
  "partially_completed",
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  "completed",
  "cancelled",
  "partially_completed",
]);

export const FAILURE_TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  "validation_failed",
  "simulation_failed",
  "execution_failed",
]);

export const TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  draft: ["validated", "validation_failed", "cancelled"],
  validated: ["pending_approval", "approved", "validation_failed", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["simulating", "cancelled"],
  simulating: ["submitted", "simulation_failed"],
  submitted: ["confirming", "execution_failed", "execution_unknown", "retrying", "completed", "partially_completed"],
  confirming: ["completed", "execution_failed", "execution_unknown", "retrying", "partially_completed"],
  completed: [],
  validation_failed: ["validated", "cancelled"],
  simulation_failed: ["simulating", "cancelled"],
  execution_failed: ["retrying", "execution_unknown", "simulating", "cancelled"],
  retrying: ["simulating", "execution_unknown", "cancelled"],
  cancelled: [],
  execution_unknown: ["completed", "execution_failed", "retrying", "simulating"],
  partially_completed: [],
};

export class StateTransitionError extends Error {
  readonly from: ExecutionState;
  readonly to: ExecutionState;

  constructor(from: ExecutionState, to: ExecutionState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = "StateTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ExecutionState, to: ExecutionState): void {
  if (!canTransition(from, to)) {
    throw new StateTransitionError(from, to);
  }
}

export function isTerminal(state: ExecutionState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isFailureTerminal(state: ExecutionState): boolean {
  return FAILURE_TERMINAL_STATES.has(state);
}

export function isExecutionState(value: string): value is ExecutionState {
  return (EXECUTION_STATES as readonly string[]).includes(value);
}
