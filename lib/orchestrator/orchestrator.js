/**
 * Orchestrator — unique admit / classify / schedule entry (Ideal Topology v1).
 *
 * Does not run the LLM. Agent remains a thin Cordis host that owns this
 * Orchestrator + UnitRunners and executes physical cancel / claim / activation.
 *
 * @module @harness-plugins/grokbot-agent-loop/orchestrator/orchestrator
 */
import { decideAdmission } from "../scheduler.js";
import { WorkUnitRegistry, normalizeRpwuOtherMode, summarizeGoal, } from "../unit/work-unit.js";
import { MemoryCheckpointStore } from "../checkpoint/memory-store.js";
import { MergeBus } from "../merge/bus.js";
import { DeliveryGate } from "../delivery/gate.js";
import { classifyAdmit } from "./classify.js";
import { userMessagePlainText } from "../steer-fold.js";
/**
 * Single admission brain: absorb | spawn | cancel.
 * Completed step checkpoints are synced to CheckpointStore so preempt cannot
 * erase them (hard invariant).
 */
export class Orchestrator {
    registry;
    checkpointStore;
    mergeBus;
    deliveryGate;
    defaultOtherMode;
    constructor(options = {}) {
        this.registry = options.registry ?? new WorkUnitRegistry();
        this.checkpointStore = options.checkpointStore ?? new MemoryCheckpointStore();
        this.defaultOtherMode = normalizeRpwuOtherMode(options.defaultOtherMode ?? 'spawn');
        const gateEnabled = options.deliveryGate !== false;
        const maxRetries = options.deliveryGateMaxRetries;
        this.deliveryGate = new DeliveryGate({ enabled: gateEnabled, maxRetries });
        this.mergeBus = new MergeBus(this.registry, {
            deliveryGate: gateEnabled,
            maxRetries,
        });
    }
    /** Hydrate registry from the attached CheckpointStore. */
    hydrate() {
        this.checkpointStore.hydrate(this.registry);
    }
    /**
     * Admit one inbox event.
     * Mutates registry for absorb/spawn/cancel; returns action + unitIds for the host.
     */
    admit(event) {
        const decision = decideAdmission(event.kind, event.scheduler);
        const rpwuEnabled = event.rpwuEnabled !== false;
        const otherModeRaw = event.otherMode ?? this.defaultOtherMode;
        const mode = normalizeRpwuOtherMode(typeof otherModeRaw === 'string' ? otherModeRaw : undefined);
        const classified = classifyAdmit({
            ...event,
            rpwuEnabled,
            otherMode: otherModeRaw,
        });
        // Explicit cancel path (no preempt required).
        if (classified.action === 'cancel' && event.cancelUnitId) {
            const id = event.cancelUnitId;
            if (this.registry.get(id)) {
                this.registry.markStatus(id, 'cancelled');
                this.syncUnit(id);
            }
            return {
                action: 'cancel',
                unitIds: [id],
                preempt: false,
                useSubagent: false,
                degraded: false,
                target: decision.target,
                wakeup: decision.wakeup,
                claimAfterCancel: decision.claimAfterCancel,
            };
        }
        // queue(steer): do not preempt / dual-open; park on next-step after active turn.
        if (classified.action === 'queue') {
            const active = this.registry.active();
            return {
                action: 'queue',
                unitIds: active ? [active.id] : [],
                preempt: false,
                useSubagent: false,
                degraded: false,
                main: active,
                target: 'next-step',
                wakeup: true,
                claimAfterCancel: true,
            };
        }
        // Non-preempt: pass through scheduler; optionally ensure MAIN exists.
        if (!decision.preempt) {
            return {
                action: 'absorb',
                unitIds: this.registry.active() ? [this.registry.active().id] : [],
                preempt: false,
                useSubagent: false,
                degraded: false,
                main: this.registry.active(),
                target: decision.target,
                wakeup: decision.wakeup,
                claimAfterCancel: decision.claimAfterCancel,
            };
        }
        if (!rpwuEnabled) {
            return {
                action: 'absorb',
                unitIds: [],
                preempt: true,
                useSubagent: false,
                degraded: false,
                target: decision.target,
                wakeup: decision.wakeup,
                claimAfterCancel: decision.claimAfterCancel,
            };
        }
        const turn = event.turn ?? 0;
        const step = event.step ?? 0;
        const otherText = event.otherText
            ?? (event.input ? userMessagePlainText(event.input) : null)
            ?? 'OTHER';
        const goalText = event.mainGoalText ?? 'unspecified MAIN';
        const prefixCursor = event.assistantPrefixCursor;
        const prefixHash = event.assistantPrefixHash;
        if (classified.action === 'absorb' || mode === 'fold') {
            return this.admitAbsorb({
                goalText,
                otherText,
                turn,
                step,
                decision,
                prefixCursor,
                prefixHash,
            });
        }
        // spawn (ideal) — useSubagent when seam present; else degrade visibly.
        return this.admitSpawn({
            goalText,
            otherText,
            turn,
            step,
            decision,
            hasSubagentSeam: Boolean(event.hasSubagentSeam),
            prefixCursor,
            prefixHash,
        });
    }
    /** Persist a checkpoint into both registry and store (preempt-safe). */
    recordCheckpoint(cp) {
        const full = this.registry.appendCheckpoint(cp);
        this.checkpointStore.put(full);
        const unit = this.registry.get(full.unitId);
        if (unit)
            this.checkpointStore.saveUnit(unit);
        this.checkpointStore.setActiveId(this.registry.active()?.id ?? null);
        return full;
    }
    admitAbsorb(options) {
        const main = this.registry.ensureMainUnit({
            goalSummary: options.goalText,
            turn: options.turn,
            step: options.step,
            status: 'paused',
        });
        this.registry.foldOther(main.id, options.otherText);
        const cursor = options.prefixCursor
            ?? main.checkpoints.at(-1)?.assistantPrefixCursor
            ?? 0;
        const hash = options.prefixHash
            ?? main.checkpoints.at(-1)?.assistantPrefixHash
            ?? '00000000';
        // Preempt checkpoint — completed prior steps already in unit.checkpoints / store.
        this.recordCheckpoint({
            unitId: main.id,
            stepIndex: options.step,
            turn: options.turn,
            assistantPrefixCursor: cursor,
            assistantPrefixHash: hash,
            toolResultRefs: [],
            status: 'paused',
            delivery: { ...main.delivery },
            reason: 'preempt',
        });
        this.syncUnit(main.id);
        return {
            action: 'absorb',
            unitIds: [main.id],
            preempt: true,
            useSubagent: false,
            degraded: false,
            main,
            target: options.decision.target,
            wakeup: options.decision.wakeup,
            claimAfterCancel: options.decision.claimAfterCancel,
        };
    }
    admitSpawn(options) {
        const useSubagent = options.hasSubagentSeam;
        const main = this.registry.ensureMainUnit({
            goalSummary: options.goalText,
            turn: options.turn,
            step: options.step,
            // Subagent path: MAIN keeps running; degraded: pause for cancel-then-claim.
            status: useSubagent ? 'running' : 'paused',
        });
        const cursor = options.prefixCursor
            ?? main.checkpoints.at(-1)?.assistantPrefixCursor
            ?? 0;
        const hash = options.prefixHash
            ?? main.checkpoints.at(-1)?.assistantPrefixHash
            ?? '00000000';
        this.recordCheckpoint({
            unitId: main.id,
            stepIndex: options.step,
            turn: options.turn,
            assistantPrefixCursor: cursor,
            assistantPrefixHash: hash,
            status: useSubagent ? 'running' : 'paused',
            toolResultRefs: [],
            delivery: { ...main.delivery },
            reason: 'preempt',
        });
        const sibling = this.registry.forkSibling({
            parentId: main.id,
            goalSummary: options.otherText,
            lane: useSubagent ? 'background' : 'user',
            createdAtTurn: options.turn,
            createdAtStep: options.step,
            status: 'running',
            bindActive: false,
            pauseParent: !useSubagent,
        });
        this.recordCheckpoint({
            unitId: sibling.id,
            stepIndex: options.step,
            turn: options.turn,
            assistantPrefixCursor: 0,
            assistantPrefixHash: hash,
            toolResultRefs: [],
            status: 'running',
            delivery: { ...sibling.delivery },
            reason: 'preempt',
        });
        this.syncUnit(main.id);
        this.syncUnit(sibling.id);
        return {
            action: 'spawn',
            unitIds: [main.id, sibling.id],
            // Physical Agent cancel only when degraded (no second Session).
            preempt: !useSubagent,
            useSubagent,
            degraded: !useSubagent,
            main,
            sibling,
            target: options.decision.target,
            wakeup: options.decision.wakeup,
            claimAfterCancel: options.decision.claimAfterCancel,
        };
    }
    syncUnit(id) {
        const unit = this.registry.get(id);
        if (unit)
            this.checkpointStore.saveUnit(unit);
        this.checkpointStore.setActiveId(this.registry.active()?.id ?? null);
    }
}
export { classifyAdmit, summarizeGoal };
//# sourceMappingURL=orchestrator.js.map