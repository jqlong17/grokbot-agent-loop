/**
 * TurnRunShell — stitches inner loop steps for one admitted turn (v1.1).
 * @module @harness-plugins/grokbot-agent-loop/turn/turn-run-shell
 */
import { checkpointChain, } from "../turn-step.js";
import { settleTurn } from "../settle.js";
/**
 * Outer shell around one admitted turn: afterStepCheckpoint + settle.
 * Does not run the LLM (inner harness owns ReAct).
 */
export class TurnRunShell {
    options;
    steps = [];
    turn;
    constructor(options, unit, turnIndex) {
        this.options = options;
        this.turn = {
            turnIndex,
            unitId: unit.id,
            goalSummary: unit.goalSummary,
        };
    }
    /** Record checkpoint after an inner step; sync to store + event bus. */
    afterStepCheckpoint(cp) {
        const step = {
            turnIndex: this.turn.turnIndex,
            stepIndex: cp.stepIndex,
            unitId: cp.unitId,
        };
        const full = this.options.registry.appendCheckpoint(cp);
        this.options.store.put(full);
        const unit = this.options.registry.get(cp.unitId);
        if (unit)
            this.options.store.saveUnit(unit);
        const record = {
            checkpoint: full,
            turn: this.turn,
            step,
        };
        this.steps.push(record);
        this.options.events?.emit({
            type: 'checkpoint',
            unitId: cp.unitId,
            stepIndex: cp.stepIndex,
            reason: cp.reason,
            at: Date.now(),
        });
        return record;
    }
    /** Ordered checkpoint chain for this turn's unit. */
    checkpointChain() {
        const unit = this.options.registry.get(this.turn.unitId);
        return unit
            ? checkpointChain(unit)
            : { unitId: this.turn.unitId, checkpoints: this.steps.map(s => s.checkpoint) };
    }
    /** Drain checkpoints then produce transcript hint (turn-settle). */
    settle() {
        return settleTurn({
            registry: this.options.registry,
            store: this.options.store,
            unitId: this.turn.unitId,
            events: this.options.events,
        });
    }
}
//# sourceMappingURL=turn-run-shell.js.map