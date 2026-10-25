/**
 * Pure dual-lane admission strategy for the GrokBot interruptible loop.
 *
 * User lane (followup / steer / human) always outranks the agent lane
 * (tool-continue / silent inject). Busy Enter prefers steer with cooperative
 * cancel; Cmd/Ctrl+Enter remains followup → next-turn Queue.
 *
 * @module @harness-plugins/grokbot-agent-loop/scheduler
 */
/** Which inbox boundary should receive the message. */
export type InboxLaneTarget = 'next-step' | 'next-turn';
/** Logical priority lane. */
export type PriorityLane = 'user' | 'agent';
/** How the host asked to deliver the message. */
export type AdmissionKind = 'steer' | 'followup' | 'inject' | 'tool-continue';
/** Snapshot of driver + inbox state the strategy needs. */
export interface SchedulerState {
    /** True while a turn/step is actively running and not yet aborted. */
    readonly busy: boolean;
    /** True when the active activity's abort signal has already fired. */
    readonly aborting: boolean;
    /** True when the user lane (next-step human/steer work) already has pending items. */
    readonly userLanePending: boolean;
    /** When false, busy steer falls back to stock next-step wait (no preempt). */
    readonly interruptOnSteer: boolean;
}
/** Immutable decision produced by {@link decideAdmission}. */
export interface AdmissionDecision {
    readonly lane: PriorityLane;
    readonly target: InboxLaneTarget;
    /** Abort the active step cooperatively, keeping streamed prefix + inbox. */
    readonly preempt: boolean;
    /** Wake / latch the driver after enqueue. */
    readonly wakeup: boolean;
    /**
     * When true, bypass stock post-abort remap-to-next-turn so the message
     * stays on `target` (used by interruptible steer).
     */
    readonly claimAfterCancel: boolean;
}
/**
 * Decide how to admit one message under dual-lane priority.
 *
 * Ordering guarantees (unit-tested):
 * 1. User-lane steer while busy → preempt then claim on next-step.
 * 2. Followup always parks on next-turn (QueueDock complementary path).
 * 3. Agent-lane inject never preempts; wakeup stays false.
 * 4. Empty lanes / idle steer open a normal next-step wake without preempt.
 */
export declare function decideAdmission(kind: AdmissionKind, state: SchedulerState): AdmissionDecision;
/**
 * Whether the agent lane may start new silent work given pending user-lane items.
 * Claim order in the driver still prefers next-step (user steer) before next-turn.
 */
export declare function agentLaneAllowed(state: Pick<SchedulerState, 'userLanePending'>): boolean;
/**
 * Describe the cancel-then-claim sequence for a preempting user-lane admission.
 * Useful for tests and diagnostics; the driver executes these steps in order.
 */
export declare function cancelThenClaimOrder(): readonly [
    'cooperative-cancel',
    'enqueue-next-step',
    'latch-wake'
];
//# sourceMappingURL=scheduler.d.ts.map