/**
 * Turn ≠ Step — Ideal Topology v1.
 *
 * Turn  = accepted work unit (goal admitted by Orchestrator).
 * Step  = one model + tools cycle inside a turn.
 * Checkpoint after every step (`afterStepCheckpoint` / checkpointChain).
 *
 * Interruptible ≠ Durable:
 * - interrupt cuts the current turn/step stream (cancel-then-claim)
 * - durable means completed step checkpoints are never redone
 *
 * @module @harness-plugins/grokbot-agent-loop/turn-step
 */
/** Build a checkpoint chain view from a WorkUnit. */
export function checkpointChain(unit) {
    return {
        unitId: unit.id,
        checkpoints: [...unit.checkpoints],
    };
}
/** True when `cp` looks like a completed step that must not be redone. */
export function isCompletedStepCheckpoint(cp) {
    return cp.reason === 'step-end' || cp.status === 'completed';
}
/**
 * Durability invariant helper: after preempt, every prior completed step
 * checkpoint for `unitId` is still present in `after`.
 */
export function completedStepsSurvivedPreempt(before, after) {
    const completed = before.filter(isCompletedStepCheckpoint);
    for (const cp of completed) {
        const found = after.some(a => a.unitId === cp.unitId
            && a.stepIndex === cp.stepIndex
            && a.turn === cp.turn
            && a.reason === cp.reason
            && a.assistantPrefixHash === cp.assistantPrefixHash);
        if (!found)
            return false;
    }
    return true;
}
//# sourceMappingURL=turn-step.js.map