/**
 * UnitRunner — advance one WorkUnit one step (Ideal Topology v1).
 *
 * InProcessRunner: same-Agent cancel-then-claim path (fold / degraded spawn).
 * SubagentRunner: wraps startWorkUnitSubagent / host startActivation.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/runner
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { WorkUnit, WorkUnitActivationRef } from './work-unit.ts';
import { type StartedWorkUnitSubagent, type SubagentResultLike, type SubagentsRuntimeLike } from './subagent.ts';
/** Outcome of one UnitRunner.step call. */
export type UnitStepResult = {
    kind: 'in-process';
    unitId: string;
} | {
    kind: 'subagent-started';
    unitId: string;
    activationRef: WorkUnitActivationRef;
    activation: StartedWorkUnitSubagent['activation'];
} | {
    kind: 'subagent-degraded';
    unitId: string;
    reason: string;
} | {
    kind: 'subagent-settled';
    unitId: string;
    result: SubagentResultLike;
};
export interface UnitRunner {
    /** Advance `unit` one scheduling step. */
    step(unit: WorkUnit): Promise<UnitStepResult> | UnitStepResult;
}
/** Same-Agent in-process path (fold / degraded spawn). No second LLM. */
export declare class InProcessRunner implements UnitRunner {
    step(unit: WorkUnit): UnitStepResult;
}
export interface SubagentRunnerOptions {
    readonly parent: Agent;
    readonly promptText: string;
    /** Cordis ctx that may expose `subagents`. */
    readonly ctx: {
        subagents?: SubagentsRuntimeLike;
        get?(name: string, strict?: boolean): unknown;
    } | null | undefined;
    readonly provider?: string;
    readonly delivery?: 'parent' | 'caller';
    readonly signal?: AbortSignal;
    readonly label?: string;
    /** Optional pre-resolved runtime (tests). */
    readonly subagents?: SubagentsRuntimeLike | null;
}
/**
 * Host-backed runner: wraps existing `startWorkUnitSubagent`.
 * Missing `ctx.subagents` → degraded result (never throws).
 */
export declare class SubagentRunner implements UnitRunner {
    private readonly options;
    constructor(options: SubagentRunnerOptions);
    step(unit: WorkUnit): Promise<UnitStepResult>;
}
export type { StartedWorkUnitSubagent, SubagentResultLike, SubagentsRuntimeLike, };
//# sourceMappingURL=runner.d.ts.map