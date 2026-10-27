/**
 * DecisionLayer — cheap deterministic score/route (Ideal Topology v1.1).
 *
 * Orchestrator may consult this before committing an expensive spawn.
 * LLM is not the OS: rules only; Orchestrator remains the sole admit brain.
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
    /** Cheap confidence in [0, 1]. */
    readonly score: number;
}
/** Optional cheap decision hook consulted before spawn. */
export interface DecisionLayer {
    decide(input: DecisionLayerInput): DecisionLayerResult | Promise<DecisionLayerResult>;
}
/** Default: pass through proposed action (opt-out / tests). */
export declare class PassthroughDecisionLayer implements DecisionLayer {
    decide(input: DecisionLayerInput): DecisionLayerResult;
}
/**
 * Pure score/route helper — unit-testable without Orchestrator.
 * Does not mutate state; Orchestrator applies the returned action.
 */
export declare function scoreRoute(input: DecisionLayerInput): DecisionLayerResult;
/** Rule-based DecisionLayer (0.2.2 default for Orchestrator). */
export declare class RuleDecisionLayer implements DecisionLayer {
    decide(input: DecisionLayerInput): DecisionLayerResult;
}
//# sourceMappingURL=decision-layer.d.ts.map