/**
 * ActivationManager — host subagent façade (Ideal Topology v1.1).
 * Wraps startWorkUnitSubagent; missing seam → degraded, never throws.
 *
 * Live main path for spawn / host parallel: start → wait → cancel / degrade.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/activation-manager
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type StartedWorkUnitSubagent, type SubagentResultLike, type SubagentsRuntimeLike } from './subagent.ts';
import type { WorkUnitActivationRef } from './work-unit.ts';
export type ActivationStartResult = {
    kind: 'started';
    started: StartedWorkUnitSubagent;
} | {
    kind: 'degraded';
    reason: string;
};
export type ActivationWaitResult = {
    kind: 'settled';
    result: SubagentResultLike;
} | {
    kind: 'missing';
    reason: string;
} | {
    kind: 'error';
    reason: string;
};
export interface ActivationManagerOptions {
    readonly ctx: {
        subagents?: SubagentsRuntimeLike;
        get?(name: string, strict?: boolean): unknown;
    } | null | undefined;
    readonly parent: Agent;
    readonly provider?: string;
    readonly delivery?: 'parent' | 'caller';
}
/** Unified façade over host startActivation / wait / cancel / degrade. */
export declare class ActivationManager {
    private readonly options;
    private readonly aborts;
    private readonly started;
    constructor(options: ActivationManagerOptions);
    /** True when host seam exposes startActivation. */
    get available(): boolean;
    start(options: {
        unitId: string;
        promptText: string;
        label?: string;
        signal?: AbortSignal;
    }): Promise<ActivationStartResult>;
    /** Await a previously started activation result (never throws). */
    wait(unitId: string): Promise<ActivationWaitResult>;
    cancel(unitId: string): void;
    cancelAll(): void;
    static refOf(started: StartedWorkUnitSubagent): WorkUnitActivationRef;
}
//# sourceMappingURL=activation-manager.d.ts.map