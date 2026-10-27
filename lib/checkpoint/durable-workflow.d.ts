/**
 * DurableWorkflow seam — Ideal Topology v1.1.
 * Memory default; file skeleton; Temporal NOT required in 0.2.0.
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/durable-workflow
 */
import type { WorkUnitRegistry } from '../unit/work-unit.ts';
import type { CheckpointStore } from './store.ts';
import { FileCheckpointStore } from './file-store.ts';
export type DurableWorkflowKind = 'memory' | 'file';
export interface DurableWorkflow {
    readonly kind: DurableWorkflowKind;
    readonly store: CheckpointStore;
    hydrate(registry: WorkUnitRegistry): void | Promise<void>;
}
/** Default in-process durable seam. */
export declare class MemoryDurableWorkflow implements DurableWorkflow {
    readonly kind: "memory";
    readonly store: CheckpointStore;
    constructor(store?: CheckpointStore);
    hydrate(registry: WorkUnitRegistry): void;
}
/** File-backed durable seam skeleton. */
export declare class FileDurableWorkflow implements DurableWorkflow {
    readonly kind: "file";
    readonly store: FileCheckpointStore;
    constructor(path: string);
    hydrate(registry: WorkUnitRegistry): void;
}
/** Factory for config `rpwuCheckpointStore`. */
export declare function createDurableWorkflow(kind?: DurableWorkflowKind, path?: string): DurableWorkflow;
//# sourceMappingURL=durable-workflow.d.ts.map