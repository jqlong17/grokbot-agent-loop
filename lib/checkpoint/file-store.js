/**
 * File-backed CheckpointStore skeleton — Ideal Topology v1.
 *
 * Persists a JSON snapshot under `path`. Suitable for smoke / future P2;
 * production durability still belongs to host session persistence.
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/file-store
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryCheckpointStore } from "./memory-store.js";
/**
 * Skeleton file store: mirrors MemoryCheckpointStore and flushes to disk.
 * Missing / corrupt files start empty (visible degrade, never throws on hydrate).
 */
export class FileCheckpointStore {
    memory = new MemoryCheckpointStore();
    filePath;
    constructor(options) {
        this.filePath = options.path;
        this.loadQuiet();
    }
    put(cp) {
        this.memory.put(cp);
        this.flushQuiet();
    }
    saveUnit(unit) {
        this.memory.saveUnit(unit);
        this.flushQuiet();
    }
    list(unitId) {
        return this.memory.list(unitId);
    }
    latest(unitId) {
        return this.memory.latest(unitId);
    }
    setActiveId(activeId) {
        this.memory.setActiveId(activeId);
        this.flushQuiet();
    }
    hydrate(registry) {
        this.loadQuiet();
        this.memory.hydrate(registry);
    }
    /** Best-effort load; corrupt / missing → empty store. */
    loadQuiet() {
        try {
            if (!existsSync(this.filePath))
                return;
            const raw = readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.units))
                return;
            for (const unit of parsed.units)
                this.memory.saveUnit(unit);
            if (Array.isArray(parsed.checkpoints)) {
                for (const cp of parsed.checkpoints)
                    this.memory.put(cp);
            }
            this.memory.setActiveId(parsed.activeId ?? null);
        }
        catch {
            // Skeleton: never throw on boot; callers see empty hydrate.
        }
    }
    flushQuiet() {
        try {
            const dir = dirname(this.filePath);
            mkdirSync(dir, { recursive: true });
            const snap = this.memory.exportSnapshot();
            const payload = {
                activeId: snap.activeId,
                units: snap.units,
                checkpoints: snap.checkpoints,
            };
            writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
        }
        catch {
            // Skeleton: disk errors are non-fatal.
        }
    }
}
//# sourceMappingURL=file-store.js.map