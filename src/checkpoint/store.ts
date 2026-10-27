/**
 * CheckpointStore interface — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/store
 */

import type { StepCheckpoint } from '../unit/types.ts'
import type { WorkUnitRegistry } from '../unit/registry.ts'
import type { WorkUnit } from '../unit/work-unit.ts'

/**
 * Durable (or session-local) store for step checkpoints + unit rows.
 * `hydrate(registry)` rebuilds registry units and checkpoints from the store.
 */
export interface CheckpointStore {
  /** Persist one step checkpoint (and sync unit delivery/status from it). */
  put(cp: StepCheckpoint): void | Promise<void>

  /** Persist / upsert a full unit row (for hydrate fidelity). */
  saveUnit(unit: WorkUnit): void | Promise<void>

  /** List checkpoints, optionally filtered by unitId (insertion order). */
  list(unitId?: string): StepCheckpoint[] | Promise<StepCheckpoint[]>

  /** Latest checkpoint for a unit, or null. */
  latest(unitId: string): StepCheckpoint | null | Promise<StepCheckpoint | null>

  /** Bind which unit is active (control-plane pointer). */
  setActiveId(activeId: string | null): void | Promise<void>

  /** Rebuild `registry` from stored units + checkpoints. */
  hydrate(registry: WorkUnitRegistry): void | Promise<void>
}
