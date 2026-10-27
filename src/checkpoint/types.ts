/**
 * CheckpointStore records — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/types
 */

import type {
  StepCheckpoint,
  WorkUnit,
  WorkUnitSnapshot,
} from '../unit/types.ts'

/** Serializable unit row stored alongside step checkpoints. */
export interface StoredUnitRecord {
  readonly unit: WorkUnit
}

/** Full durable snapshot used by hydrate(). */
export interface CheckpointStoreSnapshot {
  readonly activeId: string | null
  readonly units: readonly WorkUnit[]
  readonly checkpoints: readonly StepCheckpoint[]
}

/** Options when constructing a file-backed store (skeleton). */
export interface FileCheckpointStoreOptions {
  /** Directory or file path for persistence. */
  readonly path: string
}

export type { StepCheckpoint, WorkUnit, WorkUnitSnapshot }
