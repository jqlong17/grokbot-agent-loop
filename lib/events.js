/**
 * AgentEvent / trajectory stream — Ideal Topology v1.
 *
 * Outer harness emits structured control events; inner dsh loop owns ReAct I/O.
 * Minimal emitter for tests / trajectory tooling.
 *
 * @module @harness-plugins/grokbot-agent-loop/events
 */
/** Minimal synchronous event emitter (tests + trajectory). */
export class AgentEventBus {
    listeners = new Set();
    history = [];
    on(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    emit(event) {
        this.history.push(event);
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch { /* never break harness on listener failure */ }
        }
    }
    clear() {
        this.history.length = 0;
    }
}
//# sourceMappingURL=events.js.map