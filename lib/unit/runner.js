/**
 * UnitRunner — advance one WorkUnit one step (Ideal Topology v1).
 *
 * InProcessRunner: same-Agent cancel-then-claim path (fold / degraded spawn).
 * SubagentRunner: wraps startWorkUnitSubagent / host startActivation.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/runner
 */
import { resolveSubagentsRuntime, startWorkUnitSubagent, } from "./subagent.js";
/** Same-Agent in-process path (fold / degraded spawn). No second LLM. */
export class InProcessRunner {
    step(unit) {
        return { kind: 'in-process', unitId: unit.id };
    }
}
/**
 * Host-backed runner: wraps existing `startWorkUnitSubagent`.
 * Missing `ctx.subagents` → degraded result (never throws).
 */
export class SubagentRunner {
    options;
    constructor(options) {
        this.options = options;
    }
    async step(unit) {
        const runtime = this.options.subagents
            ?? resolveSubagentsRuntime({ ctx: this.options.ctx });
        if (!runtime) {
            return {
                kind: 'subagent-degraded',
                unitId: unit.id,
                reason: 'ctx.subagents.startActivation unavailable',
            };
        }
        try {
            const started = await startWorkUnitSubagent({
                subagents: runtime,
                parent: this.options.parent,
                promptText: this.options.promptText || unit.goalSummary,
                label: this.options.label,
                provider: this.options.provider,
                delivery: this.options.delivery,
                signal: this.options.signal,
            });
            return {
                kind: 'subagent-started',
                unitId: unit.id,
                activationRef: started.activationRef,
                activation: started.activation,
            };
        }
        catch (err) {
            return {
                kind: 'subagent-degraded',
                unitId: unit.id,
                reason: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=runner.js.map