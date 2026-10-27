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
/** Default: pass through proposed action (no-op DecisionLayer). */
export class PassthroughDecisionLayer {
    decide(input) {
        return {
            action: input.proposed,
            reason: 'passthrough',
        };
    }
}
//# sourceMappingURL=decision-layer.js.map