/**
 * Orchestrator types — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/orchestrator/types
 */
import type { UserMessage } from '@deepseek-ai/dsh-session';
import type { AdmissionKind, SchedulerState } from '../scheduler.ts';
import type { RpwuOtherMode, WorkUnit } from '../unit/work-unit.ts';
/** Final admit action (Ideal Topology v1.1). */
export type OrchestratorAction = 'absorb' | 'spawn' | 'cancel' | 'queue';
/** Inbox / steer event presented to Orchestrator.admit(). */
export interface AdmitEvent {
    readonly kind: AdmissionKind;
    readonly input: UserMessage;
    readonly scheduler: SchedulerState;
    /**
     * Explicit cancel intent (user asked to cancel a unit).
     * When set with `cancelUnitId`, classify → cancel.
     */
    readonly cancelUnitId?: string | null;
    /** Current turn / step for checkpoint binding. */
    readonly turn?: number;
    readonly step?: number;
    /** Unfinished MAIN text (resume anchor), if known. */
    readonly mainGoalText?: string | null;
    /** OTHER plain text. */
    readonly otherText?: string | null;
    /** Whether host `ctx.subagents.startActivation` is available. */
    readonly hasSubagentSeam?: boolean;
    /** Configured OTHER mode (spawn default; fold = compat). */
    readonly otherMode?: RpwuOtherMode | string;
    /** RPWU master switch. */
    readonly rpwuEnabled?: boolean;
    /** Live assistant prefix stats for preempt checkpoints. */
    readonly assistantPrefixCursor?: number;
    readonly assistantPrefixHash?: string;
    /**
     * When true, classify continuous same-work steer as `queue`
     * (Foundry-style pending_input — no dual race with active turn).
     */
    readonly queueSteer?: boolean;
}
/** Result of Orchestrator.admit — single admission brain. */
export interface AdmitResult {
    readonly action: OrchestratorAction;
    readonly unitIds: string[];
    /** Physical preempt (cancel-then-claim) required on the host Agent. */
    readonly preempt: boolean;
    /** Try host startActivation (true parallel); false → in-process / degrade. */
    readonly useSubagent: boolean;
    /** Visible degrade when spawn wanted but seam missing. */
    readonly degraded: boolean;
    /** Bound / created MAIN unit when RPWU ran. */
    readonly main?: WorkUnit | null;
    /** Spawned sibling when action is spawn. */
    readonly sibling?: WorkUnit | null;
    /** Pass-through scheduler decision fields for the host. */
    readonly target: 'next-step' | 'next-turn';
    readonly wakeup: boolean;
    readonly claimAfterCancel: boolean;
}
/** Classify-only decision (no registry mutation). */
export interface ClassifyResult {
    readonly action: OrchestratorAction;
    readonly reason: string;
}
//# sourceMappingURL=types.d.ts.map