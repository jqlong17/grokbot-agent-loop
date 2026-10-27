/**
 * File-backed CheckpointStore — Ideal Topology v1.1 (0.2.3 hydrate smoke).
 *
 * Persists a JSON snapshot under `path`. Memory remains the default;
 * File is opt-in evidence for cross-process durability (NOT Temporal).
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/file-store
 */
import type { StepCheckpoint, WorkUnit } from '../unit/work-unit.ts';
import type { WorkUnitRegistry } from '../unit/registry.ts';
import type { CheckpointStore } from './store.ts';
import type { FileCheckpointStoreOptions } from './types.ts';
/**
 * File store: mirrors MemoryCheckpointStore and flushes to disk.
 * `loadQuiet` replaces in-memory state from disk (process-restart safe).
 * Missing / corrupt files start empty (visible degrade, never throws on hydrate).
 */
export declare class FileCheckpointStore implements CheckpointStore {
    private memory;
    private readonly filePath;
    constructor(options: FileCheckpointStoreOptions);
    /** Absolute path used for persistence (tests / smoke). */
    get path(): string;
    put(cp: StepCheckpoint): void;
    saveUnit(unit: WorkUnit): void;
    list(unitId?: string): StepCheckpoint[];
    latest(unitId: string): StepCheckpoint | null;
    setActiveId(activeId: string | null): void;
    /** Reload from disk into a fresh memory, then rebuild `registry`. */
    hydrate(registry: WorkUnitRegistry): void;
    /**
     * Best-effort load; corrupt / missing → empty store.
     * Always replaces `memory` so repeated hydrate / new-process simulation
     * does not duplicate checkpoints.
     */
    private loadQuiet;
    private flushQuiet;
}
//# sourceMappingURL=file-store.d.ts.map