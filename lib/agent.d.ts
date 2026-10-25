/**
 * Interruptible Agent driver (GrokBot Loop): dual-lane scheduling over the
 * stock session/turn/step protocol. Busy steer cooperatively cancels the
 * active step (keeping the streamed prefix) and claims user text on the next
 * step instead of parking it in the next-turn Queue.
 * @module @harness-plugins/grokbot-agent-loop/agent
 */
import type { Agent, AgentCancelCause, AgentOptions, AgentStatus, CancelOptions, InboxTarget } from '@deepseek-ai/dsh-agent';
import type { Scope } from '@deepseek-ai/dsh-scope';
import type { Session, SessionId, UserMessage } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import { ReactLoopInbox } from './inbox.ts';
/** Drives one session through turn and step boundaries. */
export declare class ReactLoopAgent implements Agent {
    private loopCtx;
    readonly id: SessionId;
    readonly options: AgentOptions;
    readonly session: Session;
    readonly inbox: ReactLoopInbox;
    private phase;
    private activityDone;
    /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
    readonly scope: Scope;
    readonly ctx: Context;
    /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
    private readonly dispatch;
    /** Whether this loop instance has appended its initial/resume request anchor. */
    private requestHeaderLogged;
    /** Surface generation at attachment or the preceding built request. */
    private requestSurfaceGeneration;
    private readonly runtimeContext;
    /** Process-local revision of assistant frames for this attached Session. */
    private assistantStreamRevision;
    private assistantAttemptCounter;
    private readonly systemPrompt;
    /** Identities fully frozen by this loop; weak references do not retain replaced history. */
    private readonly frozenMessages;
    constructor(loopCtx: Context, id: SessionId, options: AgentOptions, session: Session);
    get status(): AgentStatus;
    /** Commit a phase and publish its externally visible status transition. */
    private setPhase;
    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
    /** Cmd/Ctrl+Enter Queue path: park on next-turn (stock complementary shortcut). */
    followup(input: UserMessage): void;
    /**
     * Busy Enter / steer path: user lane. While a step is live, cooperatively
     * cancel (keep streamed prefix + inbox), enqueue on next-step, and latch a
     * wake so the next step claims the user text — never the default QueueDock path.
     */
    steer(input: UserMessage): void;
    /** Agent-lane silent inject: next-step, no wakeup, no preempt. */
    inject(input: UserMessage): void;
    /** Whether interruptible busy-steer is enabled on the mounted loop config. */
    private interruptOnSteerEnabled;
    /** Snapshot used by the pure dual-lane scheduler. */
    private schedulerState;
    /**
     * Apply {@link decideAdmission} and execute cancel-then-claim when required.
     * Stock `send()` remains available for callers that need the legacy remap.
     */
    private admit;
    cancel(cause: AgentCancelCause, options?: CancelOptions): void;
    runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T>;
    /**
     * Start one driver, or latch its wake behind maintenance or an aborted
     * activity. A wake sent while idle always opens its turn boundary, even
     * when its message was cleared; only a latched replay is suppressed when
     * the queue no longer holds the wake.
     * @param wakeAfterAbort - the {@link send} classification, captured before
     *   the inbox insertion so a reentrant cancel cannot reclassify it.
     */
    private wakeDriver;
    whenIdle(): Promise<void>;
    /** Report one failure at its live boundary, then preserve it for driver containment. */
    private throwError;
    private kick;
    private preStep;
    /** Whether the assembled tool schemas differ from the logged request header's. */
    private toolsChanged;
    /** Open one turn before claiming its first proposed step. */
    private turn;
    private step;
    /** Resolve request config and bind its adapter before admitting model-visible input. */
    private prepareRequest;
    /** Log the resolved envelope and derive a frozen request from the admitted surface. */
    private buildRequest;
}
//# sourceMappingURL=agent.d.ts.map