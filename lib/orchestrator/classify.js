/**
 * Orchestrator classify — absorb | spawn | cancel (Ideal Topology v1).
 * Pure decision; no registry mutation.
 *
 * @module @harness-plugins/grokbot-agent-loop/orchestrator/classify
 */
import { normalizeRpwuOtherMode } from "../unit/work-unit.js";
/**
 * Classify an inbox event into absorb | spawn | cancel | queue.
 *
 * | Event | Action |
 * | short OTHER / same deliverable / fold mode | absorb |
 * | independent parallel (spawn mode) | spawn |
 * | explicit cancelUnitId | cancel |
 * | continuous steer on same work (queueSteer) | queue |
 */
export function classifyAdmit(event) {
    if (event.cancelUnitId) {
        return { action: 'cancel', reason: `cancel unit ${event.cancelUnitId}` };
    }
    if (event.rpwuEnabled === false) {
        return { action: 'absorb', reason: 'rpwu disabled — single-Agent absorb' };
    }
    const mode = normalizeRpwuOtherMode(typeof event.otherMode === 'string' ? event.otherMode : undefined);
    if (!event.scheduler.busy || event.scheduler.aborting) {
        return { action: 'absorb', reason: 'not busy — no parallel OTHER' };
    }
    if (event.kind !== 'steer') {
        return { action: 'absorb', reason: `${event.kind} is not OTHER preempt` };
    }
    // Foundry-style: same-work continuous steer queues after active turn.
    if (event.queueSteer) {
        return { action: 'queue', reason: 'queue(steer) — same work, no dual race' };
    }
    if (mode === 'fold') {
        return { action: 'absorb', reason: 'rpwuOtherMode=fold (compat)' };
    }
    if (event.hasSubagentSeam) {
        return { action: 'spawn', reason: 'spawn + host subagent seam' };
    }
    return { action: 'spawn', reason: 'spawn without seam → degrade' };
}
//# sourceMappingURL=classify.js.map