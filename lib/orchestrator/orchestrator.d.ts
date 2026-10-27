/**
 * Orchestrator — unique admit / classify / schedule entry (Ideal Topology v1).
 *
 * Does not run the LLM. Agent remains a thin Cordis host that owns this
 * Orchestrator + UnitRunners and executes physical cancel / claim / activation.
 *
 * @module @harness-plugins/grokbot-agent-loop/orchestrator/orchestrator
 */
import { WorkUnitRegistry, summarizeGoal, type StepCheckpoint } from '../unit/work-unit.ts';
import type { CheckpointStore } from '../checkpoint/store.ts';
import { MergeBus } from '../merge/bus.ts';
import { DeliveryGate } from '../delivery/gate.ts';
import { classifyAdmit } from './classify.ts';
import type { AdmitEvent, AdmitResult, OrchestratorAction } from './types.ts';
export interface OrchestratorOptions {
    readonly registry?: WorkUnitRegistry;
    readonly checkpointStore?: CheckpointStore;
    readonly deliveryGate?: boolean;
    readonly deliveryGateMaxRetries?: number;
    /** Default OTHER mode when event omits otherMode (0.2.0 default: spawn). */
    readonly defaultOtherMode?: 'fold' | 'spawn' | 'fork' | 'subagent';
}
/**
 * Single admission brain: absorb | spawn | cancel.
 * Completed step checkpoints are synced to CheckpointStore so preempt cannot
 * erase them (hard invariant).
 */
export declare class Orchestrator {
    readonly registry: WorkUnitRegistry;
    readonly checkpointStore: CheckpointStore;
    readonly mergeBus: MergeBus;
    readonly deliveryGate: DeliveryGate;
    private readonly defaultOtherMode;
    constructor(options?: OrchestratorOptions);
    /** Hydrate registry from the attached CheckpointStore. */
    hydrate(): void;
    /**
     * Admit one inbox event.
     * Mutates registry for absorb/spawn/cancel; returns action + unitIds for the host.
     */
    admit(event: AdmitEvent): AdmitResult;
    /** Persist a checkpoint into both registry and store (preempt-safe). */
    recordCheckpoint(cp: Omit<StepCheckpoint, 'at'> & {
        at?: number;
    }): StepCheckpoint;
    private admitAbsorb;
    private admitSpawn;
    private syncUnit;
}
export type { OrchestratorAction, AdmitEvent, AdmitResult };
export { classifyAdmit, summarizeGoal };
//# sourceMappingURL=orchestrator.d.ts.map