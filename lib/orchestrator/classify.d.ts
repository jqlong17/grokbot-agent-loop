/**
 * Orchestrator classify — absorb | spawn | cancel (Ideal Topology v1).
 * Pure decision; no registry mutation.
 *
 * @module @harness-plugins/grokbot-agent-loop/orchestrator/classify
 */
import type { AdmitEvent, ClassifyResult } from './types.ts';
/**
 * Classify an inbox event into absorb | spawn | cancel | queue.
 *
 * | Event | Action |
 * | short OTHER / same deliverable / fold mode | absorb |
 * | independent parallel (spawn mode) | spawn |
 * | explicit cancelUnitId | cancel |
 * | continuous steer on same work (queueSteer) | queue |
 */
export declare function classifyAdmit(event: AdmitEvent): ClassifyResult;
//# sourceMappingURL=classify.d.ts.map