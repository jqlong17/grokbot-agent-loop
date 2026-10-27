/**
 * Per-agent queue + turn-settle — Ideal Topology v1.
 *
 * Settle drain: flush pending checkpoints into CheckpointStore, then expose
 * a transcript hint for MergeBus / summary carrier. Documented + cheap drain.
 *
 * @module @harness-plugins/grokbot-agent-loop/settle
 */
import type { CheckpointStore } from './checkpoint/store.ts';
import type { WorkUnitRegistry } from './unit/work-unit.ts';
import type { AgentEventBus } from './events.ts';
export interface TurnSettleResult {
    readonly unitId: string | null;
    readonly flushedCheckpoints: number;
    readonly transcriptHint: string;
}
/**
 * Drain unit checkpoints into the store, emit settle, return transcript hint.
 */
export declare function settleTurn(options: {
    readonly registry: WorkUnitRegistry;
    readonly store: CheckpointStore;
    readonly unitId?: string | null;
    readonly events?: AgentEventBus | null;
}): TurnSettleResult;
//# sourceMappingURL=settle.d.ts.map