/**
 * Interruptible Agent driver (GrokBot Loop): dual-lane scheduling over the
 * stock session/turn/step protocol. Busy steer cooperatively cancels the
 * active step (keeping the streamed prefix) and claims user text on the next
 * step instead of parking it in the next-turn Queue.
 * @module @harness-plugins/grokbot-agent-loop/agent
 */

import type {
  Agent,
  AgentCancelCause,
  AgentEventDispatch,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  InboxTarget,
  PreStepDecision,
  RequestErrorAction,
} from '@deepseek-ai/dsh-agent'
import { agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmCallConfig, Message, PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import {
  LlmError,
  createAssistantMessage,
  createDeveloperMessage,
  createUserMessage,
  errorChain,
  markAgentLoopRequest,
} from '@deepseek-ai/dsh-llm'
import { assertNever, deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { EpochHeader, RequestContext, Session, SessionId, SessionSeq, TurnEndReason, UserMessage } from '@deepseek-ai/dsh-session'
import { canonicalHeader, headerEquals, ToolCallRecovery } from '@deepseek-ai/dsh-session'
import { joinContextSections, renderContextSections, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { Context } from '@deepseek-ai/cordis'
import { ReactLoopInbox } from './inbox.ts'
import { RuntimeContextProjection } from './runtime-context.ts'
import { AssistantStreamAttempt } from './assistant-stream.ts'
import { SystemPromptProjection } from './runtime-context.ts'
import { executeToolCalls } from './tool-calls.ts'
import { decideAdmission, type AdmissionKind } from './scheduler.ts'
import {
  buildSteerClaimBatch,
  buildSteerPreemptMeta,
  extractLatestHumanUserText,
  truncateAnchor,
  userMessagePlainText,
  type SteerFoldMode,
  type SteerPreemptMeta,
} from './steer-fold.ts'
import {
  assistantPrefixStats,
  buildDeliveryGateMeta,
  buildDeliveryGateNotice,
  buildUnitFoldBlock,
  buildUnitForkBlock,
  buildUnitForkDegradedBlock,
  inferDeliveryFromBlocks,
  normalizeRpwuOtherMode,
  shouldRunDeliveryGate,
  summarizeGoal,
  type DeliveryGateMeta,
  type RpwuOtherMode,
  type StepCheckpoint,
  type WorkUnit,
} from './unit/work-unit.ts'
import {
  peerPacketFromSubagentResult,
  resolveSubagentsRuntime,
  type SubagentResultLike,
} from './unit/subagent.ts'
import { ActivationManager } from './unit/activation-manager.ts'
import { Orchestrator } from './orchestrator/orchestrator.ts'
import { MergeBus } from './merge/bus.ts'
import { MemoryCheckpointStore, FileCheckpointStore } from './checkpoint/index.ts'
import type { CheckpointStore } from './checkpoint/store.ts'
import { AgentEventBus } from './events.ts'
import { TurnRunShell } from './turn/turn-run-shell.ts'
import { dualSessionPair, StubSummarySession, type DualSessionPair } from './sessions.ts'

type Phase =
  | { kind: 'idle'; lastTurn: number }
  | {
    kind: 'maintenance'
    abort: AbortController
    lastTurn: number
    wakeRequested: boolean
  }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }

type StepEndReason = Extract<TurnEndReason, { kind: 'completed' | 'max-tokens' }>

type PreparedStep =
  | { kind: 'reject' }
  | {
    kind: 'enter'
    messages: UserMessage[]
    startsRequestSeries?: true
    assembly: PromptAssembly
  }

/** Remove adapter-derived values before plugins propose the next request config. */
function requestProposal(header: EpochHeader): LlmCallConfig {
  if (header.adapterDefaults === undefined) return header.config
  const proposal = { ...header.config }
  if (header.adapterDefaults.reasoningEffort === true) delete proposal.reasoningEffort
  if (header.adapterDefaults.maxTokens === true) delete proposal.maxTokens
  return proposal
}

/**
 * Read the cause `cancel()` passed when aborting a loop-owned signal, copying
 * only the fields `turn/end` records. The live reason stays the caller's
 * object, and Node's fetch assigns a `stack` onto it that `Session.append`
 * would either log or reject as data JSON cannot hold.
 * @param signal - a turn or maintenance signal this loop owns.
 * @returns the copied cause, or undefined while the signal is still live.
 */
function abortedCancelCause(signal: AbortSignal): AgentCancelCause | undefined {
  if (!signal.aborted) return undefined
  // `cancel()` is the only aborter of the signals this loop owns.
  const cause = signal.reason as AgentCancelCause
  switch (cause.kind) {
    case 'user':
    case 'parent':
    case 'disposed':
      return { kind: cause.kind }
    case 'hook':
      return { kind: 'hook', reason: cause.reason }
    /* v8 ignore next -- cancel accepts the closed AgentCancelCause union */
    default:
      return assertNever(cause)
  }
}

/** Drives one session through turn and step boundaries. */
export class ReactLoopAgent implements Agent {
  readonly inbox: ReactLoopInbox
  private phase: Phase
  private activityDone: Promise<void> = Promise.resolve()

  /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
  readonly scope: Scope
  readonly ctx: Context

  /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
  private readonly dispatch: AgentEventDispatch

  /** Whether this loop instance has appended its initial/resume request anchor. */
  private requestHeaderLogged = false
  /** Surface generation at attachment or the preceding built request. */
  private requestSurfaceGeneration: number
  private readonly runtimeContext: RuntimeContextProjection
  /** Process-local revision of assistant frames for this attached Session. */
  private assistantStreamRevision = 0
  private assistantAttemptCounter = 0
  private readonly systemPrompt: SystemPromptProjection
  /** Identities fully frozen by this loop; weak references do not retain replaced history. */
  private readonly frozenMessages = new WeakSet<Message>()

  constructor(
    private loopCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
  ) {
    this.requestSurfaceGeneration = session.surface.contentGeneration
    this.dispatch = agentEvents(loopCtx, this)
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx
    this.inbox = new ReactLoopInbox(this.ctx.sessionProjections, session, this.dispatch)
    /* v8 ignore next -- the loop registers its own turnBoundary unit, so the key is always present */
    const lastTurn = this.loopCtx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0
    this.phase = { kind: 'idle', lastTurn }
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
    this.systemPrompt = new SystemPromptProjection(session)
  }

  get status(): AgentStatus {
    return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
  }

  /** Commit a phase and publish its externally visible status transition. */
  private setPhase(next: Phase): void {
    const previousStatus = this.status
    this.phase = next
    const status = this.status
    if (status !== previousStatus) {
      this.dispatch.emit('agent/status', { status })
    }
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    // Waking input cannot join an aborted activity, so it starts the next turn.
    // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
    this.inbox.splice(resolvedTarget, Infinity, 0, [message])
    if (wakeup) this.wakeDriver(wakingAfterAbort)
  }

  /** Cmd/Ctrl+Enter Queue path: park on next-turn (stock complementary shortcut). */
  followup(input: UserMessage): void {
    this.admit('followup', input)
  }

  /**
   * Busy Enter / steer path: user lane. While a step is live, cooperatively
   * cancel (keep streamed prefix + inbox), enqueue on next-step, and latch a
   * wake so the next step claims the user text — never the default QueueDock path.
   */
  steer(input: UserMessage): void {
    this.admit('steer', input)
  }

  /** Agent-lane silent inject: next-step, no wakeup, no preempt. */
  inject(input: UserMessage): void {
    this.admit('inject', input)
  }

  /**
   * Last busy-steer preempt observability snapshot (tests / trajectory).
   * Not a user-visible chat event; fold notice remains the prompt hook.
   */
  lastSteerPreempt: SteerPreemptMeta | null = null

  /**
   * Ideal Topology v1.1: Orchestrator owns admit/classify + registry + store.
   * Agent is Cordis host glue — TurnRunShell + ActivationManager are the live path.
   */
  readonly orchestrator: Orchestrator = new Orchestrator({
    checkpointStore: new MemoryCheckpointStore(),
    defaultOtherMode: 'spawn',
  })

  /** Session-local WorkUnit registry (owned by Orchestrator). */
  get workUnits() {
    return this.orchestrator.registry
  }

  /** CheckpointStore (default memory; file when configured). */
  get checkpointStore(): CheckpointStore {
    return this.orchestrator.checkpointStore
  }

  /** MergeBus for fold-back + peer handoff. */
  get mergeBus(): MergeBus {
    return this.orchestrator.mergeBus
  }

  /** Last step checkpoint written (tests / trajectory). */
  lastCheckpoint: StepCheckpoint | null = null

  /** Last DeliveryGate injection meta (tests / trajectory). */
  lastDeliveryGate: DeliveryGateMeta | null = null

  /** Whether Orchestrator store was rebound from loop config (once). */
  private checkpointStoreConfigured = false

  /** Outer-harness trajectory event bus (tests / tooling). */
  readonly events = new AgentEventBus()

  /**
   * Live TurnRunShell for the current admitted turn (checkpointChain + settle).
   * Null between turns; created lazily on first step checkpoint.
   */
  private activeTurnShell: TurnRunShell | null = null

  /** Last settled turn shell (tests / trajectory) — proves main path wiring. */
  lastSettledShell: TurnRunShell | null = null

  /**
   * Host-parallel façade (start/wait/cancel/degraded). Created lazily;
   * cancelAll on dispose.
   */
  private activationManager: ActivationManager | null = null

  /** Dual-session pair (main live; summary stub until wired). */
  get dualSessions(): DualSessionPair {
    return dualSessionPair(this.id, new StubSummarySession(`${this.id}:summary`))
  }

  /** Whether interruptible busy-steer is enabled on the mounted loop config. */
  private interruptOnSteerEnabled(): boolean {
    const config = this.loopCtx.agentLoop?.config as { interruptOnSteer?: boolean } | undefined
    return config?.interruptOnSteer !== false
  }

  /** Whether to inject the continue-prior fold notice after a preempting steer. */
  private steerFoldHintEnabled(): boolean {
    const config = this.loopCtx.agentLoop?.config as { steerFoldHint?: boolean } | undefined
    // Default on when interruptOnSteer is on; explicit false disables.
    if (config?.steerFoldHint === false) return false
    return this.interruptOnSteerEnabled()
  }

  /** Fold notice verbosity: bot-like (default) or minimal. */
  private steerFoldMode(): SteerFoldMode {
    const config = this.loopCtx.agentLoop?.config as { steerFoldMode?: SteerFoldMode } | undefined
    return config?.steerFoldMode === 'minimal' ? 'minimal' : 'bot-like'
  }

  /** Whether to embed unfinished MAIN text into the fold notice (0.1.5+). */
  private steerResumeAnchorEnabled(): boolean {
    const config = this.loopCtx.agentLoop?.config as { steerResumeAnchor?: boolean } | undefined
    // Default on when fold hint is on; explicit false disables (≈0.1.4 notice).
    if (config?.steerResumeAnchor === false) return false
    return this.steerFoldHintEnabled()
  }

  /** RPWU P0 master switch (default on). When false, behavior ≈0.1.5. */
  private rpwuEnabled(): boolean {
    const config = this.loopCtx.agentLoop?.config as { rpwuEnabled?: boolean } | undefined
    return config?.rpwuEnabled !== false
  }

  /**
   * Ideal Topology: how OTHER joins on preempt.
   * Default `spawn` (0.2.0); `fold` is explicit compat.
   */
  private rpwuOtherMode(): 'fold' | 'spawn' {
    const config = this.loopCtx.agentLoop?.config as { rpwuOtherMode?: RpwuOtherMode } | undefined
    return normalizeRpwuOtherMode(config?.rpwuOtherMode ?? 'spawn')
  }

  /** Ensure CheckpointStore matches loop config (memory default / file skeleton). */
  private ensureCheckpointStore(): void {
    if (this.checkpointStoreConfigured) return
    this.checkpointStoreConfigured = true
    const config = this.loopCtx.agentLoop?.config as {
      rpwuCheckpointStore?: 'memory' | 'file'
      rpwuCheckpointPath?: string
    } | undefined
    if (config?.rpwuCheckpointStore === 'file') {
      const path = config.rpwuCheckpointPath?.trim() || `/tmp/grokbot-checkpoints/${this.id}.json`
      const store = new FileCheckpointStore({ path })
      // Rebind orchestrator store by hydrating into the same registry.
      ;(this.orchestrator as { checkpointStore: CheckpointStore }).checkpointStore = store
      store.hydrate(this.workUnits)
    }
  }

  /** P1.5: host provider name for fork activations (default `spawn`). */
  private rpwuSubagentProvider(): string {
    const config = this.loopCtx.agentLoop?.config as { rpwuSubagentProvider?: string } | undefined
    const name = config?.rpwuSubagentProvider?.trim()
    return name && name.length > 0 ? name : 'spawn'
  }

  /** P1.5: activation delivery policy (default `caller` so we fold ourselves). */
  private rpwuSubagentDelivery(): 'parent' | 'caller' {
    const config = this.loopCtx.agentLoop?.config as { rpwuSubagentDelivery?: 'parent' | 'caller' } | undefined
    return config?.rpwuSubagentDelivery === 'parent' ? 'parent' : 'caller'
  }

  /** Host ActivationManager (spawn path); never throws on missing seam. */
  private activations(): ActivationManager {
    if (!this.activationManager) {
      this.activationManager = new ActivationManager({
        ctx: this.loopCtx,
        parent: this,
        provider: this.rpwuSubagentProvider(),
        delivery: this.rpwuSubagentDelivery(),
      })
    }
    return this.activationManager
  }

  /**
   * Live ActivationManager for spawn (tests / trajectory).
   * `starts` records parentId ≠ childSessionId when seam is present.
   */
  get hostActivations(): ActivationManager {
    return this.activations()
  }

  /**
   * Ensure a TurnRunShell for the active unit + turn index.
   * Main path: step checkpoints and turn-settle go through this shell.
   */
  private ensureTurnShell(turn: number, unit: WorkUnit): TurnRunShell {
    if (
      this.activeTurnShell
      && this.activeTurnShell.turn.turnIndex === turn
      && this.activeTurnShell.turn.unitId === unit.id
    ) {
      return this.activeTurnShell
    }
    this.activeTurnShell = new TurnRunShell(
      {
        registry: this.workUnits,
        store: this.checkpointStore,
        events: this.events,
      },
      unit,
      turn,
    )
    return this.activeTurnShell
  }

  /** DeliveryGate (default on when RPWU is on). */
  private deliveryGateEnabled(): boolean {
    if (!this.rpwuEnabled()) return false
    const config = this.loopCtx.agentLoop?.config as { deliveryGate?: boolean } | undefined
    return config?.deliveryGate !== false
  }

  /** Max DeliveryGate continuation injections per unit (default 2). */
  private deliveryGateMaxRetries(): number {
    const config = this.loopCtx.agentLoop?.config as { deliveryGateMaxRetries?: number } | undefined
    const n = config?.deliveryGateMaxRetries
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n)
    return 2
  }

  /**
   * Resolve truncated MAIN resume anchor from session history for a preempting
   * steer. Excludes producer notices and the OTHER text about to be claimed.
   */
  private resolveSteerResumeAnchor(other: UserMessage): string | null {
    if (!this.steerResumeAnchorEnabled()) return null
    const excludeText = userMessagePlainText(other)
    const raw = extractLatestHumanUserText(this.session, { excludeText })
    if (raw === null) return null
    return truncateAnchor(raw)
  }

  /** Messages to claim on next-step after a preempting steer (human OTHER, then fold). */
  private steerClaimBatch(
    input: UserMessage,
    resumeAnchor?: string | null,
    unit?: WorkUnit | null,
    unitBlock?: string | null,
  ): UserMessage[] {
    return buildSteerClaimBatch(input, {
      foldEnabled: this.steerFoldHintEnabled(),
      mode: this.steerFoldMode(),
      resumeAnchor,
      unitId: unit?.id,
      unitGoalSummary: unit?.goalSummary,
      unitFoldBlock: unitBlock ?? (unit ? buildUnitFoldBlock(unit) : null),
    })
  }

  /** Latest assistant text prefix stats from session events (for checkpoints). */
  private latestAssistantPrefixStats(): { cursor: number; hash: string; text: string } {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = this.session.snapshotEvents()
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event?.type !== 'assistant/message') continue
      const content = event.data.message.content as readonly { type: string; text?: string }[]
      return assistantPrefixStats(content)
    }
    return { cursor: 0, hash: assistantPrefixStats([]).hash, text: '' }
  }

  /** Collect recent tool result refs from the current step window (best-effort). */
  private recentToolResultRefs(turn: number, step: number): { id: string; summary?: string }[] {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = this.session.snapshotEvents()
    const refs: { id: string; summary?: string }[] = []
    for (const event of events) {
      if (event.type !== 'tool/result') continue
      const data = event.data as { turn?: number; step?: number; toolCallId?: string; name?: string }
      if (data.turn !== undefined && data.turn !== turn) continue
      if (data.step !== undefined && data.step !== step) continue
      refs.push({
        id: data.toolCallId ?? `tool-${refs.length + 1}`,
        summary: data.name,
      })
    }
    return refs
  }

  /**
   * RPWU: write a step-end checkpoint via TurnRunShell (live main path) and
   * optionally inject one DeliveryGate continuation when chat delivery is missing.
   */
  private recordStepCheckpointAndMaybeGate(
    turn: number,
    step: number,
    blocks: readonly { type: string; text?: string }[],
    stepCompleted: boolean,
  ): void {
    if (!this.rpwuEnabled()) return
    let unit = this.workUnits.active()
    if (!unit) {
      // Lazy-bind MAIN from latest human if a turn is running without preempt yet.
      const goal = extractLatestHumanUserText(this.session) ?? 'unspecified MAIN'
      unit = this.workUnits.ensureMainUnit({
        goalSummary: goal,
        turn,
        step,
        status: 'running',
      })
    } else if (unit.status === 'paused' || unit.status === 'pending') {
      this.workUnits.markStatus(unit.id, 'running')
    }

    const delivery = inferDeliveryFromBlocks(blocks)
    // Sticky chatPosted: once true, stay true across later steps.
    // workspaceOnly: set when this step is tool/progress-only; clear on substantive chat.
    const merged = {
      chatPosted: unit.delivery.chatPosted || delivery.chatPosted,
      workspaceOnly: delivery.chatPosted
        ? false
        : (delivery.workspaceOnly || unit.delivery.workspaceOnly),
    }
    this.workUnits.updateDelivery(unit.id, merged)
    const prefix = assistantPrefixStats(blocks)
    // Prefer cumulative cursor when this step had little text but prior had more.
    const priorCursor = unit.checkpoints.at(-1)?.assistantPrefixCursor ?? 0
    const cursor = Math.max(prefix.cursor, priorCursor)
    const shell = this.ensureTurnShell(turn, unit)
    const recorded = shell.afterStepCheckpoint({
      unitId: unit.id,
      stepIndex: step,
      turn,
      assistantPrefixCursor: cursor,
      assistantPrefixHash: prefix.hash || unit.checkpoints.at(-1)?.assistantPrefixHash || '00000000',
      toolResultRefs: this.recentToolResultRefs(turn, step),
      status: 'running',
      delivery: merged,
      reason: 'step-end',
    })
    this.lastCheckpoint = recorded.checkpoint

    if (!stepCompleted) return

    // DeliveryGate: one continuation if still no chat-visible delivery.
    const fresh = this.workUnits.get(unit.id)!
    const gateOpts = {
      enabled: this.deliveryGateEnabled(),
      maxRetries: this.deliveryGateMaxRetries(),
    }
    if (shouldRunDeliveryGate(fresh, gateOpts)) {
      this.workUnits.bumpGateRetry(fresh.id)
      this.inbox.splice('next-step', Infinity, 0, [buildDeliveryGateNotice(fresh)])
      this.lastDeliveryGate = buildDeliveryGateMeta(fresh, true)
      const gateRecord = shell.afterStepCheckpoint({
        unitId: fresh.id,
        stepIndex: step,
        turn,
        assistantPrefixCursor: cursor,
        assistantPrefixHash: recorded.checkpoint.assistantPrefixHash,
        toolResultRefs: [],
        status: 'running',
        delivery: { ...fresh.delivery },
        reason: 'gate',
      })
      this.lastCheckpoint = gateRecord.checkpoint
      return
    }

    // Try complete only when gate allows and inbox is empty after this step.
    if (this.inbox.nextStep.length === 0) {
      this.workUnits.tryComplete(unit.id, {
        deliveryGate: this.deliveryGateEnabled(),
        maxRetries: this.deliveryGateMaxRetries(),
      })
    }
  }

  /** Snapshot used by the pure dual-lane scheduler. */
  private schedulerState() {
    const busy = this.phase.kind === 'running' && !this.phase.abort.signal.aborted
    const aborting = this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    return {
      busy,
      aborting,
      userLanePending: this.inbox.nextStep.length > 0,
      interruptOnSteer: this.interruptOnSteerEnabled(),
    }
  }

  /**
   * Outer harness admission: Orchestrator.admit is the only routing brain
   * (absorb|spawn|cancel|queue). Agent executes physical cancel / claim /
   * ActivationManager — never re-implements classify.
   */
  private admit(kind: AdmissionKind, input: UserMessage): void {
    this.ensureCheckpointStore()
    const scheduler = this.schedulerState()
    const decision = decideAdmission(kind, scheduler)

    if (!decision.preempt) {
      if (decision.claimAfterCancel && decision.target === 'next-step') {
        this.inbox.splice('next-step', Infinity, 0, [input])
        if (this.phase.kind === 'idle') this.wakeDriver(false)
        else if (decision.wakeup) this.phase.wakeRequested = true
        return
      }
      this.send(input, decision.target, decision.wakeup)
      return
    }

    const foldEnabled = this.steerFoldHintEnabled()
    const foldMode = foldEnabled ? this.steerFoldMode() : null
    const resumeAnchor = foldEnabled ? this.resolveSteerResumeAnchor(input) : null
    const turn = this.phase.kind === 'running' ? this.phase.turn : 0
    const step = this.phase.kind === 'running' ? this.phase.step : 0
    const otherText = userMessagePlainText(input) ?? 'OTHER'
    const goalText = resumeAnchor
      ?? extractLatestHumanUserText(this.session, { excludeText: otherText })
      ?? 'unspecified MAIN'
    const hasSubagentSeam = Boolean(resolveSubagentsRuntime({ ctx: this.loopCtx }))

    const prefix = this.latestAssistantPrefixStats()
    const result = this.orchestrator.admit({
      kind,
      input,
      scheduler,
      turn,
      step,
      mainGoalText: goalText,
      otherText,
      hasSubagentSeam,
      otherMode: this.rpwuOtherMode(),
      rpwuEnabled: this.rpwuEnabled(),
      assistantPrefixCursor: prefix.cursor,
      assistantPrefixHash: prefix.hash,
    })
    this.events.emit({
      type: 'admit',
      action: result.action,
      unitIds: result.unitIds,
      at: Date.now(),
    })
    if (result.decisionReason) {
      this.events.emit({
        type: 'decision',
        action: result.action,
        reason: result.decisionReason,
        at: Date.now(),
      })
    }

    // True-parallel spawn: ActivationManager owns host start/wait/cancel/degrade.
    if (result.action === 'spawn' && result.useSubagent && result.sibling && result.main) {
      this.events.emit({ type: 'spawn', unitId: result.sibling.id, parentId: result.main.id, at: Date.now() })
      this.lastCheckpoint = result.sibling.checkpoints.at(-1)
        ?? result.main.checkpoints.at(-1)
        ?? null
      this.lastSteerPreempt = buildSteerPreemptMeta({
        foldInjected: foldEnabled,
        mode: foldMode,
        resumeAnchorPresent: resumeAnchor !== null && resumeAnchor.length > 0,
        unitId: result.main.id,
        unitFoldPresent: true,
        otherMode: 'spawn',
        siblingUnitId: result.sibling.id,
        forkDegraded: false,
        childSessionId: null,
      })
      const noticeText = buildUnitForkBlock(result.main, result.sibling)
      this.inbox.splice('next-step', Infinity, 0, [
        createUserMessage({
          content: [{ type: 'text', text: noticeText }],
          source: {
            kind: 'unit-fold-hint',
            form: 'notice',
            summary: `Subagent spawn: ${result.sibling.id} under MAIN ${result.main.id}`,
          },
        }),
      ])
      void this.launchActivationSpawn({
        siblingId: result.sibling.id,
        mainId: result.main.id,
        otherText,
      })
      return
    }

    // Absorb or degraded spawn → cooperative cancel-then-claim on this Agent.
    this.cancel({ kind: 'user' }, { keepInbox: true })
    const boundUnit = result.main ?? null
    const siblingUnit = result.sibling ?? null
    let unitBlock: string | null = null
    if (boundUnit && result.action === 'spawn' && siblingUnit) {
      unitBlock = buildUnitForkDegradedBlock(boundUnit, siblingUnit)
      this.events.emit({
        type: 'spawn',
        unitId: siblingUnit.id,
        parentId: boundUnit.id,
        degraded: true,
        at: Date.now(),
      })
    } else if (boundUnit) {
      unitBlock = buildUnitFoldBlock(boundUnit)
      this.events.emit({ type: 'absorb', unitId: boundUnit.id, at: Date.now() })
    }
    this.lastCheckpoint = siblingUnit?.checkpoints.at(-1)
      ?? boundUnit?.checkpoints.at(-1)
      ?? null
    const batch = this.steerClaimBatch(input, resumeAnchor, boundUnit, unitBlock)
    this.inbox.splice('next-step', Infinity, 0, batch)
    this.lastSteerPreempt = buildSteerPreemptMeta({
      foldInjected: foldEnabled,
      mode: foldMode,
      resumeAnchorPresent: resumeAnchor !== null && resumeAnchor.length > 0,
      unitId: boundUnit?.id ?? null,
      unitFoldPresent: boundUnit !== null,
      otherMode: result.action === 'spawn' ? 'spawn' : (boundUnit ? 'fold' : null),
      siblingUnitId: siblingUnit?.id ?? null,
      forkDegraded: result.degraded,
      childSessionId: null,
    })
    if (this.phase.kind !== 'idle') this.phase.wakeRequested = true
  }

  /**
   * Spawn path via ActivationManager: start → wait → fold.
   * Missing seam or start failure → visible degrade, never throws.
   */
  private async launchActivationSpawn(options: {
    siblingId: string
    mainId: string
    otherText: string
  }): Promise<void> {
    const mgr = this.activations()
    const start = await mgr.start({
      unitId: options.siblingId,
      promptText: options.otherText,
      label: summarizeGoal(options.otherText, 48),
    })

    if (start.kind === 'degraded') {
      const sibling = this.workUnits.get(options.siblingId)
      const main = this.workUnits.get(options.mainId)
      if (sibling) this.workUnits.markStatus(sibling.id, 'cancelled')
      if (main && sibling) {
        const text =
          `${buildUnitForkDegradedBlock(main, sibling)} ` +
          `startActivation failed: ${summarizeGoal(start.reason, 160)}`
        this.inbox.splice('next-step', Infinity, 0, [
          createUserMessage({
            content: [{ type: 'text', text }],
            source: {
              kind: 'unit-fold-hint',
              form: 'notice',
              summary: `Subagent spawn degraded for ${sibling.id}`,
            },
          }),
        ])
        if (this.phase.kind === 'idle') this.wakeDriver(false)
        else this.phase.wakeRequested = true
      }
      if (this.lastSteerPreempt?.siblingUnitId === options.siblingId) {
        this.lastSteerPreempt = {
          ...this.lastSteerPreempt,
          forkDegraded: true,
          childSessionId: null,
        }
      }
      return
    }

    this.workUnits.linkChildActivation(
      options.siblingId,
      ActivationManager.refOf(start.started),
    )
    if (this.lastSteerPreempt?.siblingUnitId === options.siblingId) {
      this.lastSteerPreempt = {
        ...this.lastSteerPreempt,
        childSessionId: start.started.activationRef.childSessionId,
        forkDegraded: false,
      }
    }

    const waited = await mgr.wait(options.siblingId)
    if (waited.kind === 'settled') {
      this.foldSubagentSiblingIntoMain(options.siblingId, waited.result)
      return
    }
    // wait missing/error → fold empty diagnostic result (visible, never throw)
    this.foldSubagentSiblingIntoMain(options.siblingId, {
      output: [],
      stopReason: 'error',
      diagnostic: waited.reason,
    })
  }

  /** Map child result → MergeBus.publish + DeliveryGate + TurnRunShell settle. */
  private foldSubagentSiblingIntoMain(siblingId: string, result: SubagentResultLike): void {
    const sibling = this.workUnits.get(siblingId)
    if (!sibling || !sibling.parentId) return
    const packet = peerPacketFromSubagentResult(result, sibling.goalSummary)
    const { notice, main } = this.mergeBus.publish({ siblingId, packet })
    this.events.emit({
      type: 'merge',
      siblingId,
      mainId: main.id,
      at: Date.now(),
    })
    const turn = this.phase.kind === 'running' ? this.phase.turn : 0
    const shell = this.ensureTurnShell(turn, main)
    this.lastSettledShell = shell
    shell.settle()
    this.inbox.splice('next-step', Infinity, 0, [notice])
    if (this.phase.kind === 'idle') this.wakeDriver(false)
    else this.phase.wakeRequested = true
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) {
      this.inbox.clear()
      if (this.phase.kind !== 'idle') this.phase.wakeRequested = false
    }
    if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)
    // Drop in-flight host activations when the parent is disposed.
    if (cause.kind === 'disposed') {
      this.activationManager?.cancelAll()
    }
  }

  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: Phase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await job(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        const cause = abortedCancelCause(maintenance.abort.signal)
        if (cause?.kind !== 'disposed' && maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver()
        done.resolve()
      }
    })()
  }

  /**
   * Start one driver, or latch its wake behind maintenance or an aborted
   * activity. A wake sent while idle always opens its turn boundary, even
   * when its message was cleared; only a latched replay is suppressed when
   * the queue no longer holds the wake.
   * @param wakeAfterAbort - the {@link send} classification, captured before
   *   the inbox insertion so a reentrant cancel cannot reclassify it.
   */
  private wakeDriver(wakeAfterAbort = false): void {
    if (this.phase.kind !== 'idle') {
      // Maintenance and aborted drivers cannot deliver the wake: latch it for
      // replay at convergence. Live drivers claim queued work themselves;
      // disposal never latches, so teardown waits on no model turn.
      const reason = abortedCancelCause(this.phase.abort.signal)
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    const driver = Promise.withResolvers<void>()
    this.activityDone = driver.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      step: 0,
      wakeRequested: false,
    })
    this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  /** Report one failure at its live boundary, then preserve it for driver containment. */
  private throwError(error: unknown): never {
    const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn
    const step = this.phase.kind === 'running' ? this.phase.step : 0
    this.dispatch.emit('agent/error', { turn, step, error })
    throw error
  }

  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch (_error) {
      // Reported failures and cancellation are contained at the driver boundary.
    } finally {
      /* v8 ignore next -- kick owns a running phase until this driver boundary */
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
      }
    }
  }

  private async preStep(target: InboxTarget, position: { turn: number; step: number }): Promise<PreparedStep> {
    /* v8 ignore next -- private callers establish the running phase before proposing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": pre-step outside running phase`)
    const signal = this.phase.abort.signal
    const claimed = this.inbox.claim(target, position.turn)
    const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal))
    signal.throwIfAborted()
    const decision = await this.dispatch.waterfall(
      'agent/pre-step', { messages: claimed, ...position, signal },
      (): Promise<PreStepDecision> => {
        const sections = renderContextSections(assembly)
        const context = this.runtimeContext.project(joinContextSections(sections), sections)
        return Promise.resolve<PreStepDecision>({
          kind: 'enter',
          messages: context === undefined ? claimed : [...claimed, context],
        })
      },
    )
    signal.throwIfAborted()
    if (decision.kind === 'reject') return decision
    return { ...decision, assembly }
  }

  /** Whether the assembled tool schemas differ from the logged request header's. */
  private toolsChanged(tools: PromptAssembly['tools']): boolean {
    const baseline = this.session.requestHeader()
    if (baseline === undefined) return false
    return !headerEquals(baseline, canonicalHeader({ ...baseline, tools: [...tools] }))
  }

  /** Open one turn before claiming its first proposed step. */
  private async turn(): Promise<boolean> {
    if (this.phase.kind !== 'running') {
      this.throwError(new Error(`agent "${this.id}": turn without driver reservation`))
    }
    const phase = this.phase
    const { signal } = phase.abort
    signal.throwIfAborted()
    const turn = phase.turn + 1
    try {
      this.session.append('turn/start', { turn })
    } catch (error: unknown) {
      this.throwError(error)
    }
    phase.turn = turn
    let turnEnds: TurnEndReason | null = null
    let target: InboxTarget = 'next-turn'
    try {
      while (true) {
        signal.throwIfAborted()
        const step = phase.step + 1
        const decision = await this.preStep(target, { turn, step })
        if (decision.kind === 'reject') {
          turnEnds = { kind: 'blocked' }
          return false
        }
        if (turnEnds && decision.messages.length === 0) break
        // A removed waking message or an enter decision rewritten to empty
        // still owns the initial turn boundary, but it spends no model call.
        if (phase.step === 0 && decision.messages.length === 0) {
          turnEnds = { kind: 'completed' }
          return false
        }
        signal.throwIfAborted()
        this.session.append('step/start', { turn, step })
        phase.step = step
        const toolRecovery = new ToolCallRecovery()
        const stopRecovery = this.ctx.on('session/event', (session, event) => {
          if (session === this.session) toolRecovery.observe(event)
        })
        try {
          // max-tokens is sticky: once any step hits the ceiling, later steps
          // that complete normally must not downgrade the turn outcome.
          const stepEnd = await this.step(decision)
          // max-tokens stays sticky: a later completed step must not
          // downgrade the turn outcome.
          if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd
        } catch (error: unknown) {
          try {
            for (const event of toolRecovery.results()) {
              this.session.append('tool/result', event.data, {
                surfaceOp: 'append',
                ...event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs },
              })
            }
          } catch (recoveryError: unknown) {
            throw new AggregateError([error, recoveryError], 'Step failed and its pending tool results could not be recorded', { cause: error })
          }
          throw error
        } finally {
          stopRecovery()
          this.session.append('step/end', { turn, step })
        }
        signal.throwIfAborted()
        if (turnEnds && this.inbox.nextStep.length === 0) {
          await this.dispatch.serial('agent/turn-stopping', { turn, signal })
          signal.throwIfAborted()
        }
        if (turnEnds && this.inbox.nextStep.length === 0) break
        target = 'next-step'
      }
    } catch (error: unknown) {
      // A cause is present exactly while the signal is aborted.
      const cause = abortedCancelCause(signal)
      if (cause !== undefined) {
        turnEnds = { kind: 'aborted', reason: cause }
        throw error
      }
      // Every failure is structured: an `LlmError` keeps its facts, anything
      // else flattens to `errorChain` text under the `UNKNOWN` code.
      turnEnds = {
        kind: 'error',
        error: error instanceof LlmError
          ? error.failure
          : { message: errorChain(error), code: 'UNKNOWN' },
      }
      this.throwError(error)
    } finally {
      try {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
        this.session.append('turn/end', { turn, reason: turnEnds! })
      } catch (error: unknown) {
        this.throwError(error)
      }
      // Outer harness turn-settle: drain checkpointChain via TurnRunShell.
      if (this.activeTurnShell?.turn.turnIndex === turn) {
        this.lastSettledShell = this.activeTurnShell
        this.activeTurnShell.settle()
        this.activeTurnShell = null
      }
    }
    if (!this.inbox.hasPending) return false
    phase.abort = new AbortController()
    // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
    phase.wakeRequested = false
    phase.step = 0
    return true
  }

  private async step(decision: Extract<PreparedStep, { kind: 'enter' }>): Promise<StepEndReason | null> {
    /* v8 ignore next -- private callers establish the running phase before executing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": step outside running phase`)
    const { turn, step, abort: { signal } } = this.phase
    signal.throwIfAborted()

    const { assembly } = decision
    const renderedPrompt = renderPrompt(assembly)
    let firstAttempt = true
    while (true) {
      const { config, preparedCall } = await this.prepareRequest(turn, step, signal)
      const currentContext = this.loopCtx.systemPrompt.refreshContext(assembly, assembleContextFor(this, signal))
      const sections = renderContextSections(currentContext)
      const context = this.runtimeContext.project(joinContextSections(sections), sections)
      signal.throwIfAborted()
      const startsRequestSeries = firstAttempt && decision.startsRequestSeries === true
      const commits = this.systemPrompt.project(renderedPrompt, {
        inHistory: preparedCall?.systemPromptUpdate === 'in-history',
        startsSeries: startsRequestSeries
          || this.requestSurfaceGeneration !== this.session.surface.contentGeneration
          || (preparedCall?.toolUpdate === undefined && this.toolsChanged(assembly.tools)),
      })
      for (const { message, intent } of commits) {
        this.session.append('system/message', { turn, step, message }, intent)
      }
      let contextAdmitted = false
      if (firstAttempt) {
        for (const message of decision.messages) {
          if (message.source.kind === 'runtime-context') {
            if (context !== undefined && !contextAdmitted) {
              this.session.append('user/message', context, { surfaceOp: 'append' })
              contextAdmitted = true
            }
          } else {
            this.session.append('user/message', message, { surfaceOp: 'append' })
          }
        }
      }
      if (context !== undefined && !contextAdmitted) {
        this.session.append('user/message', context, { surfaceOp: 'append' })
      }
      firstAttempt = false
      const request = this.buildRequest(config, preparedCall, assembly.tools, { turn, step }, startsRequestSeries, signal)
      const live = new AssistantStreamAttempt(
        this.session.id,
        ++this.assistantAttemptCounter,
        () => ++this.assistantStreamRevision,
        turn,
        step,
        (frame) => { this.dispatch.emit('agent/assistant-stream', { frame }) },
      )
      let started = false
      try {
        const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
        signal.throwIfAborted()
        live.start()
        started = true
        for await (const chunk of stream) {
          signal.throwIfAborted()
          live.push(chunk)
        }
        signal.throwIfAborted()
      } catch (error: unknown) {
        if (!started) throw error
        try {
          if (signal.aborted) {
            const content = live.interruptedBlocks()
            if (content.length > 0) {
              live.settle('assistant/message', () => this.session.append('assistant/message', {
                turn,
                step,
                message: createAssistantMessage({
                  content,
                  source: {
                    provider: request.provider,
                    model: request.model,
                    ...live.replayState === undefined ? {} : { replayState: live.replayState },
                  },
                }),
                interrupted: true,
                ...live.usage === undefined ? {} : { usage: live.usage },
                stream: live.stream,
              }, { surfaceOp: 'append' }).seq)
            } else {
              live.settle(
                'assistant/attempt',
                () => this.session.append('assistant/attempt', { turn, step, stream: live.stream }).seq,
              )
            }
          } else {
            live.settle(
              'assistant/attempt',
              () => this.session.append('assistant/attempt', { turn, step, stream: live.stream }).seq,
            )
          }
        } catch (settlementError: unknown) {
          throw new AggregateError(
            [error, settlementError],
            'Assistant stream failed and its durable settlement was rejected',
            { cause: error },
          )
        }
        throw error
      }
      try {
        const finish = live.finish
        if (finish.kind === 'error' || finish.kind === 'aborted') {
          live.settle(
            'assistant/attempt',
            () => this.session.append('assistant/attempt', { turn, step, stream: live.stream }).seq,
          )
          const action = await this.dispatch.waterfall(
            'agent/request-error', {
              turn,
              step,
              provider: request.provider,
              failure: finish.failure,
              retryPolicy: preparedCall?.retryPolicy,
              signal,
            },
            () => Promise.resolve<RequestErrorAction>(undefined),
          )
          signal.throwIfAborted()
          if (action?.kind !== 'retry') {
            throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
          }
          continue
        }

        const message = createAssistantMessage({
          content: live.blocks(),
          source: {
            provider: request.provider,
            model: request.model,
            ...live.replayState !== undefined ? { replayState: live.replayState } : {},
          },
        })
        live.settle(
          'assistant/message',
          () => this.session.append('assistant/message', {
            turn,
            step,
            message,
            ...live.usage === undefined ? {} : { usage: live.usage },
            stream: live.stream,
          }, { surfaceOp: 'append' }).seq,
        )
        if (finish.kind === 'max-tokens') {
          this.recordStepCheckpointAndMaybeGate(
            turn,
            step,
            message.content as readonly { type: string; text?: string }[],
            true,
          )
          return { kind: 'max-tokens' }
        }

        const toolCalls = message.content.filter(block => block.type === 'tool-call')
        if (toolCalls.length === 0) {
          this.recordStepCheckpointAndMaybeGate(
            turn,
            step,
            message.content as readonly { type: string; text?: string }[],
            true,
          )
          return { kind: 'completed' }
        }
        const { concluded } = await executeToolCalls(
          this.loopCtx, turn, step, toolCalls, signal,
          context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context]),
        )
        this.recordStepCheckpointAndMaybeGate(
          turn,
          step,
          message.content as readonly { type: string; text?: string }[],
          concluded,
        )
        return concluded ? { kind: 'completed' } : null
      } catch (error: unknown) {
        if (!live.ended) live.abandon()
        throw error
      }
    }
  }

  /** Resolve request config and bind its adapter before admitting model-visible input. */
  private async prepareRequest(
    turn: number,
    step: number,
    signal: AbortSignal,
  ): Promise<{ config: LlmCallConfig; preparedCall?: PreparedLlmCall }> {
    const { session } = this

    // A loop instance starts from its declared route, restoring only an explicit
    // effort owned by that exact model. Later steps re-resolve marked defaults.
    const persistedHeader = session.requestHeader()
    const persistedConfig = persistedHeader?.config
    const route = { provider: this.options.provider ?? '', model: this.options.model ?? '' }
    const persistedReasoningEffort = persistedConfig?.provider === route.provider
      && persistedConfig.model === route.model
      && persistedHeader?.adapterDefaults?.reasoningEffort !== true
      ? persistedConfig.reasoningEffort
      : undefined
    const reasoningEffort = this.options.reasoningEffort ?? persistedReasoningEffort
    const maxTokens = this.options.maxTokens
    const seedConfig = deepFreeze(structuredClone(
      this.requestHeaderLogged
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the instance logged the header it now folds
        ? requestProposal(persistedHeader!)
        : {
          ...route,
          ...reasoningEffort === undefined ? {} : { reasoningEffort },
          ...maxTokens === undefined ? {} : { maxTokens },
        },
    ))
    const proposedConfig = await this.dispatch.waterfall(
      'agent/request', { turn, step, signal },
      () => Promise.resolve(seedConfig),
    )
    signal.throwIfAborted()
    if (!proposedConfig.provider || !proposedConfig.model) {
      throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or supply both via the agent/request waterfall`)
    }
    let config: LlmCallConfig
    let preparedCall: PreparedLlmCall | undefined
    try {
      preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)
      config = preparedCall.config
    } catch (error: unknown) {
      // Middleware may serve an unregistered route; terminal dispatch still requires an adapter.
      if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error
      config = proposedConfig
    }
    signal.throwIfAborted()
    return { config, ...preparedCall === undefined ? {} : { preparedCall } }
  }

  /** Log the resolved envelope and derive a frozen request from the admitted surface. */
  private buildRequest(
    config: LlmCallConfig,
    preparedCall: PreparedLlmCall | undefined,
    tools: GenerateOptions['tools'] & object,
    position: { turn: number; step: number },
    startsRequestSeries: boolean,
    signal: AbortSignal,
  ): GenerateOptions {
    const { session } = this
    const surfaceGeneration = session.surface.contentGeneration
    const header = canonicalHeader({
      config,
      ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
      ...tools.length > 0 ? { tools } : {},
    })
    const baseline = this.session.requestHeader()
    const startsSeries = startsRequestSeries
      || this.requestSurfaceGeneration !== surfaceGeneration
    let headerSeq: SessionSeq | undefined
    if (!this.requestHeaderLogged) {
      // Compaction during the first resumed pre-step must still mark a new series.
      headerSeq = this.session.append('request/header', {
        header,
        reason: baseline === undefined ? 'initial' : 'resume',
        ...startsSeries ? { startsSeries: true } : {},
      }).seq
      this.requestHeaderLogged = true
    } else if (baseline === undefined || !headerEquals(baseline, header)) {
      headerSeq = this.session.append('request/header', {
        header,
        reason: 'change',
        ...startsSeries ? { startsSeries: true } : {},
      }).seq
    } else if (startsSeries) {
      this.session.append('request/header', { header, reason: 'series' })
    }
    if (baseline !== undefined && headerSeq !== undefined) {
      const previousNames = new Set(baseline.tools?.map(tool => tool.name))
      const currentNames = new Set(tools.map(tool => tool.name))
      const additions = tools.filter(tool => !previousNames.has(tool.name))
        .map(tool => ({ type: 'tool-addition' as const, toolName: tool.name }))
      const removals = (baseline.tools ?? []).filter(tool => !currentNames.has(tool.name))
        .map(tool => ({ type: 'tool-removal' as const, toolName: tool.name }))
      if (additions.length > 0 || removals.length > 0) {
        session.append('developer/message', {
          ...position,
          message: createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [...additions, ...removals] }),
          ...additions.length > 0 ? { headerSeq } : {},
        }, { surfaceOp: 'append' })
      }
    }
    this.requestSurfaceGeneration = surfaceGeneration

    const contextWindow = preparedCall?.context?.contextWindow
    const systemPromptUpdate = preparedCall?.systemPromptUpdate
    const requestContext: RequestContext = {
      provider: config.provider,
      model: config.model,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...systemPromptUpdate === undefined ? {} : { systemPromptUpdate },
    }
    const previousContext = session.requestContext()
    if (previousContext?.provider !== requestContext.provider
      || previousContext.model !== requestContext.model
      || previousContext.contextWindow !== requestContext.contextWindow
      || previousContext.systemPromptUpdate !== requestContext.systemPromptUpdate) {
      session.append('request/context', requestContext)
    }
    signal.throwIfAborted()

    // canonicalHeader is shallow; append logs a detached snapshot, not these local values.
    deepFreeze(header)
    const boundaryMessages = session.deriveMessages()
    for (const message of boundaryMessages) {
      if (this.frozenMessages.has(message)) continue
      deepFreeze(message)
      this.frozenMessages.add(message)
    }
    Object.freeze(boundaryMessages)
    const request = markAgentLoopRequest(Object.freeze({
      ...header.config,
      messages: boundaryMessages,
      toolHistory: session.toolHistory(),
      ...header.tools !== undefined ? { tools: header.tools } : {},
      sessionId: this.session.id,
      signal,
    }))
    return request
  }
}
