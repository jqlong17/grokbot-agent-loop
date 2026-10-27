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
import { type SteerPreemptMeta } from './steer-fold.ts';
import { type DeliveryGateMeta, type StepCheckpoint } from './unit/work-unit.ts';
import { ActivationManager } from './unit/activation-manager.ts';
import { Orchestrator } from './orchestrator/orchestrator.ts';
import { MergeBus } from './merge/bus.ts';
import type { CheckpointStore } from './checkpoint/store.ts';
import { AgentEventBus } from './events.ts';
import { TurnRunShell } from './turn/turn-run-shell.ts';
import { type DualSessionPair, type SummarySession } from './sessions.ts';
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
    /**
     * Last busy-steer preempt observability snapshot (tests / trajectory).
     * Not a user-visible chat event; fold notice remains the prompt hook.
     */
    lastSteerPreempt: SteerPreemptMeta | null;
    /**
     * Ideal Topology v1.1: Orchestrator owns admit/classify + registry + store.
     * Agent is Cordis host glue — TurnRunShell + ActivationManager are the live path.
     */
    readonly orchestrator: Orchestrator;
    /** Session-local WorkUnit registry (owned by Orchestrator). */
    get workUnits(): import("./unit/work-unit.ts").WorkUnitRegistry;
    /** CheckpointStore (default memory; file when configured). */
    get checkpointStore(): CheckpointStore;
    /** MergeBus for fold-back + peer handoff. */
    get mergeBus(): MergeBus;
    /** Last step checkpoint written (tests / trajectory). */
    lastCheckpoint: StepCheckpoint | null;
    /** Last DeliveryGate injection meta (tests / trajectory). */
    lastDeliveryGate: DeliveryGateMeta | null;
    /** Whether Orchestrator store was rebound from loop config (once). */
    private checkpointStoreConfigured;
    /** Outer-harness trajectory event bus (tests / tooling). */
    readonly events: AgentEventBus;
    /**
     * Live TurnRunShell for the current admitted turn (checkpointChain + settle).
     * Null between turns; created lazily on first step checkpoint.
     */
    private activeTurnShell;
    /** Last settled turn shell (tests / trajectory) — proves main path wiring. */
    lastSettledShell: TurnRunShell | null;
    /**
     * Host-parallel façade (start/wait/cancel/degraded). Created lazily;
     * cancelAll on dispose.
     */
    private activationManager;
    /**
     * SummarySession carrier (0.2.3 MemorySummarySession).
     * Injects user-role carrier into MAIN — no second product UI.
     * Lazy: constructor param `id` is not yet assigned during field init.
     */
    private _summarySession;
    get summarySession(): SummarySession;
    /** Dual-session pair (main live + summary carrier). */
    get dualSessions(): DualSessionPair;
    /** Whether interruptible busy-steer is enabled on the mounted loop config. */
    private interruptOnSteerEnabled;
    /** Whether to inject the continue-prior fold notice after a preempting steer. */
    private steerFoldHintEnabled;
    /** Fold notice verbosity: bot-like (default) or minimal. */
    private steerFoldMode;
    /** Whether to embed unfinished MAIN text into the fold notice (0.1.5+). */
    private steerResumeAnchorEnabled;
    /** RPWU P0 master switch (default on). When false, behavior ≈0.1.5. */
    private rpwuEnabled;
    /**
     * Ideal Topology: how OTHER joins on preempt.
     * Default `spawn` (0.2.0); `fold` is explicit compat.
     */
    private rpwuOtherMode;
    /** Ensure CheckpointStore matches loop config (memory default / file skeleton). */
    private ensureCheckpointStore;
    /** P1.5: host provider name for fork activations (default `spawn`). */
    private rpwuSubagentProvider;
    /** P1.5: activation delivery policy (default `caller` so we fold ourselves). */
    private rpwuSubagentDelivery;
    /** Host ActivationManager (spawn path); never throws on missing seam. */
    private activations;
    /**
     * Live ActivationManager for spawn (tests / trajectory).
     * `starts` records parentId ≠ childSessionId when seam is present.
     */
    get hostActivations(): ActivationManager;
    /**
     * Ensure a TurnRunShell for the active unit + turn index.
     * Main path: step checkpoints and turn-settle go through this shell.
     */
    private ensureTurnShell;
    /** DeliveryGate (default on when RPWU is on). */
    private deliveryGateEnabled;
    /** Max DeliveryGate continuation injections per unit (default 2). */
    private deliveryGateMaxRetries;
    /**
     * Resolve truncated MAIN resume anchor from session history for a preempting
     * steer. Excludes producer notices and the OTHER text about to be claimed.
     */
    private resolveSteerResumeAnchor;
    /** Messages to claim on next-step after a preempting steer (human OTHER, then fold). */
    private steerClaimBatch;
    /** Latest assistant text prefix stats from session events (for checkpoints). */
    private latestAssistantPrefixStats;
    /** Collect recent tool result refs from the current step window (best-effort). */
    private recentToolResultRefs;
    /**
     * RPWU: write a step-end checkpoint via TurnRunShell (live main path) and
     * optionally inject one DeliveryGate continuation when chat delivery is missing.
     */
    private recordStepCheckpointAndMaybeGate;
    /** Snapshot used by the pure dual-lane scheduler. */
    private schedulerState;
    /**
     * Outer harness admission: Orchestrator.admit is the only routing brain
     * (absorb|spawn|cancel|queue). Agent executes physical cancel / claim /
     * ActivationManager — never re-implements classify.
     */
    private admit;
    /**
     * Spawn path via ActivationManager: start → wait → fold.
     * Missing seam or start failure → visible degrade, never throws.
     */
    private launchActivationSpawn;
    /** Map child result → MergeBus.publish + DeliveryGate + TurnRunShell settle. */
    private foldSubagentSiblingIntoMain;
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