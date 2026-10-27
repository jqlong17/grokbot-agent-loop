/**
 * CheckpointStore barrel — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/checkpoint
 */

export type { CheckpointStore } from './store.ts'
export { MemoryCheckpointStore } from './memory-store.ts'
export { FileCheckpointStore } from './file-store.ts'
export type {
  CheckpointStoreSnapshot,
  FileCheckpointStoreOptions,
  StoredUnitRecord,
} from './types.ts'
