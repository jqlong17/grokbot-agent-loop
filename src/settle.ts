/**
 * Per-agent queue + turn-settle — Ideal Topology v1.
 *
 * Settle drain: flush pending checkpoints into CheckpointStore, then expose
 * a transcript hint for MergeBus / summary carrier. Documented + cheap drain.
 *
 * @module @harness-plugins/grokbot-agent-loop/settle
 */

import type { CheckpointStore } from './checkpoint/store.ts'
import type { WorkUnitRegistry } from './unit/work-unit.ts'
import type { AgentEventBus } from './events.ts'

export interface TurnSettleResult {
  readonly unitId: string | null
  readonly flushedCheckpoints: number
  readonly transcriptHint: string
}

/**
 * Drain unit checkpoints into the store, emit settle, return transcript hint.
 */
export function settleTurn(options: {
  readonly registry: WorkUnitRegistry
  readonly store: CheckpointStore
  readonly unitId?: string | null
  readonly events?: AgentEventBus | null
}): TurnSettleResult {
  const unit = options.unitId
    ? options.registry.get(options.unitId)
    : options.registry.active()
  if (!unit) {
    return { unitId: null, flushedCheckpoints: 0, transcriptHint: '' }
  }
  let flushed = 0
  for (const cp of unit.checkpoints) {
    options.store.put(cp)
    flushed += 1
  }
  options.store.saveUnit(unit)
  options.store.setActiveId(options.registry.active()?.id ?? unit.id)
  options.events?.emit({ type: 'settle', unitId: unit.id, at: Date.now() })
  const hint = [
    `unit=${unit.id}`,
    `goal=${unit.goalSummary}`,
    `checkpoints=${unit.checkpoints.length}`,
    `status=${unit.status}`,
  ].join('; ')
  return {
    unitId: unit.id,
    flushedCheckpoints: flushed,
    transcriptHint: hint,
  }
}
