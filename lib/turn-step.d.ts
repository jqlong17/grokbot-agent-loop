/**
 * Turn ≠ Step — Ideal Topology v1.
 *
 * Turn  = accepted work unit (goal admitted by Orchestrator).
 * Step  = one model + tools cycle inside a turn.
 * Checkpoint after every step (`afterStepCheckpoint` / checkpointChain).
 *
 * Interruptible ≠ Durable:
 * - interrupt cuts the current turn/step stream (cancel-then-claim)
 * - durable means completed step checkpoints are never redone
 *
 * @module @harness-plugins/grokbot-agent-loop/turn-step
 */
import type { StepCheckpoint, WorkUnit } from './unit/work-unit.ts';
/** One accepted work unit (outer harness). */
export interface Turn {
    readonly turnIndex: number;
    readonly unitId: string;
    readonly goalSummary: string;
}
/** One model+tools cycle inside a turn. */
export interface Step {
    readonly turnIndex: number;
    readonly stepIndex: number;
    readonly unitId: string;
}
/** Checkpoint written after a step completes (or is preempted mid-turn). */
export interface AfterStepCheckpoint {
    readonly checkpoint: StepCheckpoint;
    readonly turn: Turn;
    readonly step: Step;
}
/**
 * Ordered chain of step checkpoints for a unit.
 * Invariant: completed entries must survive preempt / interrupt.
 */
export interface CheckpointChain {
    readonly unitId: string;
    readonly checkpoints: readonly StepCheckpoint[];
}
/** Build a checkpoint chain view from a WorkUnit. */
export declare function checkpointChain(unit: WorkUnit): CheckpointChain;
/** True when `cp` looks like a completed step that must not be redone. */
export declare function isCompletedStepCheckpoint(cp: StepCheckpoint): boolean;
/**
 * Durability invariant helper: after preempt, every prior completed step
 * checkpoint for `unitId` is still present in `after`.
 */
export declare function completedStepsSurvivedPreempt(before: readonly StepCheckpoint[], after: readonly StepCheckpoint[]): boolean;
//# sourceMappingURL=turn-step.d.ts.map