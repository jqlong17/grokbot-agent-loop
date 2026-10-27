/**
 * File-backed CheckpointStore skeleton — Ideal Topology v1.
 *
 * Persists a JSON snapshot under `path`. Suitable for smoke / future P2;
 * production durability still belongs to host session persistence.
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/file-store
 */
import type { StepCheckpoint, WorkUnit } from '../unit/work-unit.ts';
import type { WorkUnitRegistry } from '../unit/registry.ts';
import type { CheckpointStore } from './store.ts';
import type { FileCheckpointStoreOptions } from './types.ts';
/**
 * Skeleton file store: mirrors MemoryCheckpointStore and flushes to disk.
 * Missing / corrupt files start empty (visible degrade, never throws on hydrate).
 */
export declare class FileCheckpointStore implements CheckpointStore {
    private readonly memory;
    private readonly filePath;
    constructor(options: FileCheckpointStoreOptions);
    put(cp: StepCheckpoint): void;
    saveUnit(unit: WorkUnit): void;
    list(unitId?: string): StepCheckpoint[];
    latest(unitId: string): StepCheckpoint | null;
    setActiveId(activeId: string | null): void;
    hydrate(registry: WorkUnitRegistry): void;
    /** Best-effort load; corrupt / missing → empty store. */
    private loadQuiet;
    private flushQuiet;
}
//# sourceMappingURL=file-store.d.ts.map