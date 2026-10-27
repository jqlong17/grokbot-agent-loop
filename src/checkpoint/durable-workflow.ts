/**
 * DurableWorkflow seam — Ideal Topology v1.1.
 * Memory default; file skeleton; Temporal NOT required in 0.2.0.
 *
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/durable-workflow
 */

import type { WorkUnitRegistry } from '../unit/work-unit.ts'
import type { CheckpointStore } from './store.ts'
import { MemoryCheckpointStore } from './memory-store.ts'
import { FileCheckpointStore } from './file-store.ts'

export type DurableWorkflowKind = 'memory' | 'file'

export interface DurableWorkflow {
  readonly kind: DurableWorkflowKind
  readonly store: CheckpointStore
  hydrate(registry: WorkUnitRegistry): void | Promise<void>
}

/** Default in-process durable seam. */
export class MemoryDurableWorkflow implements DurableWorkflow {
  readonly kind = 'memory' as const
  readonly store: CheckpointStore

  constructor(store?: CheckpointStore) {
    this.store = store ?? new MemoryCheckpointStore()
  }

  hydrate(registry: WorkUnitRegistry): void {
    this.store.hydrate(registry)
  }
}

/** File-backed durable seam skeleton. */
export class FileDurableWorkflow implements DurableWorkflow {
  readonly kind = 'file' as const
  readonly store: FileCheckpointStore

  constructor(path: string) {
    this.store = new FileCheckpointStore({ path })
  }

  hydrate(registry: WorkUnitRegistry): void {
    this.store.hydrate(registry)
  }
}

/** Factory for config `rpwuCheckpointStore`. */
export function createDurableWorkflow(
  kind: DurableWorkflowKind = 'memory',
  path?: string,
): DurableWorkflow {
  if (kind === 'file') {
    return new FileDurableWorkflow(path || '/tmp/grokbot-checkpoints/default.json')
  }
  return new MemoryDurableWorkflow()
}
