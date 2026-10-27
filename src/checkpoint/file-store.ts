/**
 * File-backed CheckpointStore skeleton — Ideal Topology v1.
 *
 * Persists a JSON snapshot under `path`. Suitable for smoke / future P2;
 * production durability still belongs to host session persistence.
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
 * Skeleton file store: mirrors MemoryCheckpointStore and flushes to disk.
 * Missing / corrupt files start empty (visible degrade, never throws on hydrate).
 */
export class FileCheckpointStore implements CheckpointStore {
  private readonly memory = new MemoryCheckpointStore()
  private readonly filePath: string

  constructor(options: FileCheckpointStoreOptions) {
    this.filePath = options.path
    this.loadQuiet()
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

  hydrate(registry: WorkUnitRegistry): void {
    this.loadQuiet()
    this.memory.hydrate(registry)
  }

  /** Best-effort load; corrupt / missing → empty store. */
  private loadQuiet(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as FilePayload
      if (!parsed || !Array.isArray(parsed.units)) return
      for (const unit of parsed.units) this.memory.saveUnit(unit)
      if (Array.isArray(parsed.checkpoints)) {
        for (const cp of parsed.checkpoints) this.memory.put(cp)
      }
      this.memory.setActiveId(parsed.activeId ?? null)
    } catch {
      // Skeleton: never throw on boot; callers see empty hydrate.
    }
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
