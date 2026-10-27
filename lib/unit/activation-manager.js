/**
 * ActivationManager — host subagent façade (Ideal Topology v1.1).
 * Wraps startWorkUnitSubagent; missing seam → degraded, never throws.
 *
 * Live main path for spawn / host parallel: start → wait → cancel / degrade.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/activation-manager
 */
import { resolveSubagentsRuntime, startWorkUnitSubagent, } from "./subagent.js";
/** Unified façade over host startActivation / wait / cancel / degrade. */
export class ActivationManager {
    options;
    aborts = new Map();
    started = new Map();
    _starts = [];
    constructor(options) {
        this.options = options;
    }
    /** True when host seam exposes startActivation. */
    get available() {
        return resolveSubagentsRuntime({ ctx: this.options.ctx }) !== null;
    }
    /** Successful startActivation records (parent ≠ child Session evidence). */
    get starts() {
        return this._starts;
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
            this.started.set(options.unitId, started);
            this._starts.push({
                unitId: options.unitId,
                childSessionId: started.activationRef.childSessionId,
                parentId: String(this.options.parent.id),
                provider: started.activationRef.provider,
                at: Date.now(),
            });
            return { kind: 'started', started };
        }
        catch (err) {
            this.aborts.delete(options.unitId);
            return {
                kind: 'degraded',
                reason: err instanceof Error ? err.message : String(err),
            };
        }
        finally {
            options.signal?.removeEventListener('abort', onOuter);
        }
    }
    /** Await a previously started activation result (never throws). */
    async wait(unitId) {
        const handle = this.started.get(unitId);
        if (!handle) {
            return { kind: 'missing', reason: `no started activation for ${unitId}` };
        }
        try {
            const result = await handle.activation.result;
            return { kind: 'settled', result };
        }
        catch (err) {
            return {
                kind: 'error',
                reason: err instanceof Error ? err.message : String(err),
            };
        }
        finally {
            this.started.delete(unitId);
            this.aborts.delete(unitId);
        }
    }
    cancel(unitId) {
        const abort = this.aborts.get(unitId);
        if (abort) {
            abort.abort();
            this.aborts.delete(unitId);
        }
        const handle = this.started.get(unitId);
        if (handle) {
            void handle.activation.dispose().catch(() => { });
            this.started.delete(unitId);
        }
    }
    cancelAll() {
        for (const id of [...this.aborts.keys(), ...this.started.keys()]) {
            this.cancel(id);
        }
    }
    static refOf(started) {
        return started.activationRef;
    }
}
//# sourceMappingURL=activation-manager.js.map