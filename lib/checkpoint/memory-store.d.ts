/**
 * In-memory CheckpointStore (default) — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/memory-store
 */
import type { StepCheckpoint, WorkUnit } from '../unit/work-unit.ts';
import type { WorkUnitRegistry } from '../unit/registry.ts';
import type { CheckpointStore } from './store.ts';
/** Default session-local store; survives preempt within process lifetime. */
export declare class MemoryCheckpointStore implements CheckpointStore {
    private readonly units;
    private readonly checkpoints;
    private activeId;
    put(cp: StepCheckpoint): void;
    saveUnit(unit: WorkUnit): void;
    list(unitId?: string): StepCheckpoint[];
    latest(unitId: string): StepCheckpoint | null;
    setActiveId(activeId: string | null): void;
    /** Export a serializable snapshot (file store / tests). */
    exportSnapshot(): {
        activeId: string | null;
        units: WorkUnit[];
        checkpoints: StepCheckpoint[];
    };
    hydrate(registry: WorkUnitRegistry): void;
}
//# sourceMappingURL=memory-store.d.ts.map