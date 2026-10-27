/**
 * TurnRunShell — stitches inner loop steps for one admitted turn (v1.1).
 * @module @harness-plugins/grokbot-agent-loop/turn/turn-run-shell
 */
import type { CheckpointStore } from '../checkpoint/store.ts';
import type { AgentEventBus } from '../events.ts';
import { type AfterStepCheckpoint, type CheckpointChain, type Turn } from '../turn-step.ts';
import type { StepCheckpoint, WorkUnit, WorkUnitRegistry } from '../unit/work-unit.ts';
import { type TurnSettleResult } from '../settle.ts';
export interface TurnRunShellOptions {
    readonly registry: WorkUnitRegistry;
    readonly store: CheckpointStore;
    readonly events?: AgentEventBus | null;
}
/**
 * Outer shell around one admitted turn: afterStepCheckpoint + settle.
 * Does not run the LLM (inner harness owns ReAct).
 */
export declare class TurnRunShell {
    private readonly options;
    private readonly steps;
    readonly turn: Turn;
    constructor(options: TurnRunShellOptions, unit: WorkUnit, turnIndex: number);
    /** Record checkpoint after an inner step; sync to store + event bus. */
    afterStepCheckpoint(cp: StepCheckpoint): AfterStepCheckpoint;
    /** Ordered checkpoint chain for this turn's unit. */
    checkpointChain(): CheckpointChain;
    /** Drain checkpoints then produce transcript hint (turn-settle). */
    settle(): TurnSettleResult;
}
//# sourceMappingURL=turn-run-shell.d.ts.map