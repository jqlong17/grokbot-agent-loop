/**
 * Optional DecisionLayer (JEV-like) — Ideal Topology v1.
 *
 * Cheap pre-spawn hook: Orchestrator may consult this before committing spawn.
 * Interface-only in 0.2.0; default always allows spawn.
 *
 * Deterministic admission remains owned by Orchestrator — the model does not
 * route absorb|spawn|cancel.
 *
 * @module @harness-plugins/grokbot-agent-loop/decision-layer
 */
import type { AdmitEvent, OrchestratorAction } from './orchestrator/types.ts';
export interface DecisionLayerInput {
    readonly event: AdmitEvent;
    readonly proposed: OrchestratorAction;
}
export interface DecisionLayerResult {
    readonly action: OrchestratorAction;
    readonly reason: string;
}
/** Optional cheap decision hook consulted before spawn. */
export interface DecisionLayer {
    decide(input: DecisionLayerInput): DecisionLayerResult | Promise<DecisionLayerResult>;
}
/** Default: pass through proposed action (no-op DecisionLayer). */
export declare class PassthroughDecisionLayer implements DecisionLayer {
    decide(input: DecisionLayerInput): DecisionLayerResult;
}
//# sourceMappingURL=decision-layer.d.ts.map