/**
 * ActivationManager — host subagent façade (Ideal Topology v1.1).
 * Wraps startWorkUnitSubagent; missing seam → degraded, never throws.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/activation-manager
 */
import { resolveSubagentsRuntime, startWorkUnitSubagent, } from "./subagent.js";
/** Unified façade over host startActivation / wait / cancel / degrade. */
export class ActivationManager {
    options;
    aborts = new Map();
    constructor(options) {
        this.options = options;
    }
    /** True when host seam exposes startActivation. */
    get available() {
        return resolveSubagentsRuntime({ ctx: this.options.ctx }) !== null;
    }
    async start(options) {
        const runtime = resolveSubagentsRuntime({ ctx: this.options.ctx });
        if (!runtime) {
            return { kind: 'degraded', reason: 'ctx.subagents.startActivation unavailable' };
        }
        const abort = new AbortController();
        this.aborts.set(options.unitId, abort);
        const onOuter = () => { abort.abort(); };
        options.signal?.addEventListener('abort', onOuter, { once: true });
        try {
            const started = await startWorkUnitSubagent({
                subagents: runtime,
                parent: this.options.parent,
                promptText: options.promptText,
                label: options.label,
                provider: this.options.provider,
                delivery: this.options.delivery,
                signal: abort.signal,
            });
            return { kind: 'started', started };
        }
        catch (err) {
            return {
                kind: 'degraded',
                reason: err instanceof Error ? err.message : String(err),
            };
        }
        finally {
            options.signal?.removeEventListener('abort', onOuter);
        }
    }
    cancel(unitId) {
        const abort = this.aborts.get(unitId);
        if (abort) {
            abort.abort();
            this.aborts.delete(unitId);
        }
    }
    cancelAll() {
        for (const [id, abort] of this.aborts) {
            abort.abort();
            this.aborts.delete(id);
        }
    }
    static refOf(started) {
        return started.activationRef;
    }
}
//# sourceMappingURL=activation-manager.js.map