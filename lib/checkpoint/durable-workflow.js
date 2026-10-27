/**
 * DurableWorkflow seam — Ideal Topology v1.1.
 * Memory default; file skeleton; Temporal NOT required in 0.2.0.
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/durable-workflow
 */
import { MemoryCheckpointStore } from "./memory-store.js";
import { FileCheckpointStore } from "./file-store.js";
/** Default in-process durable seam. */
export class MemoryDurableWorkflow {
    kind = 'memory';
    store;
    constructor(store) {
        this.store = store ?? new MemoryCheckpointStore();
    }
    hydrate(registry) {
        this.store.hydrate(registry);
    }
}
/** File-backed durable seam skeleton. */
export class FileDurableWorkflow {
    kind = 'file';
    store;
    constructor(path) {
        this.store = new FileCheckpointStore({ path });
    }
    hydrate(registry) {
        this.store.hydrate(registry);
    }
}
/** Factory for config `rpwuCheckpointStore`. */
export function createDurableWorkflow(kind = 'memory', path) {
    if (kind === 'file') {
        return new FileDurableWorkflow(path || '/tmp/grokbot-checkpoints/default.json');
    }
    return new MemoryDurableWorkflow();
}
//# sourceMappingURL=durable-workflow.js.map