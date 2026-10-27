/**
 * File-backed CheckpointStore — Ideal Topology v1.1 (0.2.3 hydrate smoke).
 *
 * Persists a JSON snapshot under `path`. Memory remains the default;
 * File is opt-in evidence for cross-process durability (NOT Temporal).
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/file-store
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { StepCheckpoint, WorkUnit } from '../unit/work-unit.ts'
import type { WorkUnitRegistry } from '../unit/registry.ts'
import type { CheckpointStore } from './store.ts'
import type { FileCheckpointStoreOptions } from './types.ts'
import { MemoryCheckpointStore } from './memory-store.ts'

interface FilePayload {
  activeId: string | null
  units: WorkUnit[]
  checkpoints: StepCheckpoint[]
}

/**
 * File store: mirrors MemoryCheckpointStore and flushes to disk.
 * `loadQuiet` replaces in-memory state from disk (process-restart safe).
 * Missing / corrupt files start empty (visible degrade, never throws on hydrate).
 */
export class FileCheckpointStore implements CheckpointStore {
  private memory = new MemoryCheckpointStore()
  private readonly filePath: string

  constructor(options: FileCheckpointStoreOptions) {
    this.filePath = options.path
    this.loadQuiet()
  }

  /** Absolute path used for persistence (tests / smoke). */
  get path(): string {
    return this.filePath
  }

  put(cp: StepCheckpoint): void {
    this.memory.put(cp)
    this.flushQuiet()
  }

  saveUnit(unit: WorkUnit): void {
    this.memory.saveUnit(unit)
    this.flushQuiet()
  }

  list(unitId?: string): StepCheckpoint[] {
    return this.memory.list(unitId)
  }

  latest(unitId: string): StepCheckpoint | null {
    return this.memory.latest(unitId)
  }

  setActiveId(activeId: string | null): void {
    this.memory.setActiveId(activeId)
    this.flushQuiet()
  }

  /** Reload from disk into a fresh memory, then rebuild `registry`. */
  hydrate(registry: WorkUnitRegistry): void {
    this.loadQuiet()
    this.memory.hydrate(registry)
  }

  /**
   * Best-effort load; corrupt / missing → empty store.
   * Always replaces `memory` so repeated hydrate / new-process simulation
   * does not duplicate checkpoints.
   */
  private loadQuiet(): void {
    const next = new MemoryCheckpointStore()
    try {
      if (!existsSync(this.filePath)) {
        this.memory = next
        return
      }
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as FilePayload
      if (!parsed || !Array.isArray(parsed.units)) {
        this.memory = next
        return
      }
      // Unit rows embed checkpoints — restore from units only to avoid double-put.
      for (const unit of parsed.units) next.saveUnit(unit)
      // Orphan checkpoints (unit missing from snapshot) still apply.
      if (Array.isArray(parsed.checkpoints)) {
        for (const cp of parsed.checkpoints) {
          const existing = next.list(cp.unitId)
          const already = existing.some(e =>
            e.stepIndex === cp.stepIndex
            && e.turn === cp.turn
            && e.reason === cp.reason
            && e.assistantPrefixHash === cp.assistantPrefixHash
            && e.at === cp.at,
          )
          if (!already) next.put(cp)
        }
      }
      next.setActiveId(parsed.activeId ?? null)
    } catch {
      // Skeleton: never throw on boot; callers see empty hydrate.
    }
    this.memory = next
  }

  private flushQuiet(): void {
    try {
      const dir = dirname(this.filePath)
      mkdirSync(dir, { recursive: true })
      const snap = this.memory.exportSnapshot()
      const payload: FilePayload = {
        activeId: snap.activeId,
        units: snap.units,
        checkpoints: snap.checkpoints,
      }
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8')
    } catch {
      // Skeleton: disk errors are non-fatal.
    }
  }
}
