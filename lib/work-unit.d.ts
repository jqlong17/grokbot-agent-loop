/**
 * RPWU P0/P1/P1.5 — Recoverable Parallel Work Units (session-local, in-memory).
 *
 * WorkUnit registry + step checkpoints + delivery gate + fold|fork OTHER
 * admission + peer/agent-lane handoff packets. P1.5 links fork siblings to a
 * host subagent child Session via `childSessionId` / activation ref — true
 * multi-model parallel still belongs to `ctx.subagents`, not this registry.
 *
 * Community homage; not affiliated with xAI.
 *
 * @module @harness-plugins/grokbot-agent-loop/work-unit
 */
import { type ContextFormed } from '@deepseek-ai/dsh-llm';
import type { UserMessage } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'delivery-gate': {
            kind: 'delivery-gate';
        } & ContextFormed;
        'unit-fold-hint': {
            kind: 'unit-fold-hint';
        } & ContextFormed;
        'peer-handoff': {
            kind: 'peer-handoff';
        } & ContextFormed;
    }
}
/** Visible marker for unit-aware fold notices (tests / trajectory). */
export declare const UNIT_FOLD_MARKER = "[grokbot-unit-fold]";
/** Visible marker when OTHER is forked as a sibling WorkUnit (P1-a). */
export declare const UNIT_FORK_MARKER = "[grokbot-unit-fork]";
/**
 * Visible marker when fork wanted a host subagent but `ctx.subagents` was
 * missing — falls back to 0.1.8 registry-only + single-Agent cancel-then-claim.
 */
export declare const UNIT_FORK_DEGRADED_MARKER = "[grokbot-unit-fork-degraded]";
/** Visible marker when a completed sibling/peer result folds back into MAIN. */
export declare const UNIT_FOLD_BACK_MARKER = "[grokbot-unit-fold-back]";
/** Visible marker for peer/agent-lane structured handoff notices (P1-b). */
export declare const PEER_HANDOFF_MARKER = "[grokbot-peer-handoff]";
/** Visible marker for DeliveryGate continuation notices. */
export declare const DELIVERY_GATE_MARKER = "[grokbot-delivery-gate]";
/** P0/P0.1: default gate-driven continuations per unit (0.1.7+). */
export declare const DEFAULT_DELIVERY_GATE_MAX = 2;
/** Default minimum plain-text length to count as substantive chat delivery. */
export declare const DEFAULT_SUBSTANTIVE_MIN_CHARS = 400;
/** Default goalSummary truncation. */
export declare const DEFAULT_GOAL_SUMMARY_MAX = 240;
/** Default peer handoff delivery shape (living-handoff inspired). */
export declare const DEFAULT_PEER_DELIVERY_SHAPE: readonly ["theme", "keyPoints", "todos"];
export type WorkUnitStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';
/**
 * Work-unit lane.
 * - `user`: user-facing MAIN / OTHER claimed on user lane
 * - `agent`: tool-continue / peer return path (P1-b)
 * - `background`: reserved background unit (state machine; host owns real routines)
 */
export type WorkUnitLane = 'user' | 'agent' | 'background';
/**
 * How a preempting OTHER workstream joins the registry (P1-a / P1.5).
 * - `fold` (default): 0.1.7 short-protocol behavior — fold into MAIN
 * - `fork` / `subagent`: try host `ctx.subagents.startActivation` for a real
 *   child Session; degrade to registry-only sibling when the seam is absent
 */
export type RpwuOtherMode = 'fold' | 'fork' | 'subagent';
/** Normalize config aliases: `subagent` → fork-path semantics. */
export declare function normalizeRpwuOtherMode(mode: string | undefined): 'fold' | 'fork';
/** Where a deliverySpec requires the result to land. */
export type DeliverySink = 'chat' | 'notice' | 'workspace';
/**
 * Optional per-unit delivery contract (P1-c).
 * When present, DeliveryGate verifies shape fields + sink — not only chatPosted.
 */
export interface DeliverySpec {
    /** Required payload keys (e.g. theme / keyPoints / todos). */
    shape: readonly string[];
    /** Required sink; default treated as `chat` when omitted by callers. */
    sink: DeliverySink;
    /** Optional human-readable contract note. */
    description?: string;
}
/**
 * Structured peer/background return packet (P1-b).
 * Inspired by living handoff: theme / key points / TODOs — not free text alone.
 */
export interface PeerHandoffPacket {
    theme: string;
    keyPoints: readonly string[];
    todos: readonly string[];
    /** Optional prose for chat fold-back. */
    summary?: string;
}
export interface WorkUnitDelivery {
    chatPosted: boolean;
    workspaceOnly: boolean;
}
export interface ToolResultRef {
    id: string;
    summary?: string;
}
export type CheckpointReason = 'step-end' | 'preempt' | 'gate' | 'manual' | 'fold-back' | 'peer-handoff';
export interface StepCheckpoint {
    unitId: string;
    stepIndex: number;
    turn: number;
    assistantPrefixCursor: number;
    assistantPrefixHash: string;
    toolResultRefs: readonly ToolResultRef[];
    status: WorkUnitStatus;
    delivery: WorkUnitDelivery;
    at: number;
    reason: CheckpointReason;
}
/** P1.5: opaque handle for a live host activation (plugin does not own backends). */
export interface WorkUnitActivationRef {
    /** Host child Session id returned by `startActivation`. */
    childSessionId: string;
    /** Provider name (`spawn` / `fork` / …). */
    provider: string;
    /** Optional run id when observed via `subagent/start`. */
    runId?: string;
}
export interface WorkUnit {
    id: string;
    goalSummary: string;
    status: WorkUnitStatus;
    lane: WorkUnitLane;
    /** Parent MAIN (or control-plane) unit when this is a forked sibling / peer return. */
    parentId: string | null;
    createdAtStep: number;
    createdAtTurn: number;
    checkpoints: StepCheckpoint[];
    delivery: WorkUnitDelivery;
    /** Short summaries of OTHER interrupts folded into this unit (fold mode). */
    foldedOtherSummaries: string[];
    /** How many DeliveryGate continuation steps have already been injected. */
    gateRetries: number;
    /** Optional delivery contract (P1-c). */
    deliverySpec: DeliverySpec | null;
    /** Structured payload satisfying deliverySpec / peer handoff. */
    deliveryPayload: Record<string, unknown> | null;
    /** Last peer packet folded into this (MAIN) unit. */
    lastPeerPacket: PeerHandoffPacket | null;
    /**
     * P1.5: host child Session id when this sibling is backed by
     * `ctx.subagents.startActivation` (null for registry-only / degraded fork).
     */
    childSessionId: string | null;
    /** P1.5: activation metadata for fold-back correlation. */
    activationRef: WorkUnitActivationRef | null;
}
/** Queryable unit view (status / checkpoint / lane) for sibling inspection. */
export interface WorkUnitQuery {
    id: string;
    status: WorkUnitStatus;
    lane: WorkUnitLane;
    parentId: string | null;
    goalSummary: string;
    checkpointCount: number;
    lastCheckpoint: StepCheckpoint | null;
    delivery: WorkUnitDelivery;
    deliverySpec: DeliverySpec | null;
    deliverySpecMet: boolean;
    /** P1.5: host child Session id when subagent-backed. */
    childSessionId: string | null;
    activationRef: WorkUnitActivationRef | null;
}
export interface CreateWorkUnitInput {
    goalSummary: string;
    lane?: WorkUnitLane;
    parentId?: string | null;
    createdAtStep?: number;
    createdAtTurn?: number;
    id?: string;
    deliverySpec?: DeliverySpec | null;
}
export interface WorkUnitSnapshot {
    activeId: string | null;
    units: readonly Readonly<WorkUnit>[];
}
/** Compact FNV-1a style hash for assistant prefix observability (not crypto). */
export declare function simpleTextHash(text: string): string;
/** Truncate a goal for registry / fold display. */
export declare function summarizeGoal(text: string, maxLen?: number): string;
export interface InferDeliveryOptions {
    /** Min text length for substantive delivery when no code fence / list structure. */
    minSubstantiveChars?: number;
}
/**
 * Whether assistant text counts as a real chat deliverable (not tool narration).
 * Substantive if: fenced code; length ≥ threshold; or a short structured list.
 */
export declare function isSubstantiveAssistantText(text: string, options?: InferDeliveryOptions): boolean;
/**
 * Delivery inference for one assistant step (0.1.7 substantive rule):
 * - tool + non-substantive text (progress / "下面开始写…") → workspaceOnly, chatPosted false
 * - substantive text (fence / long / list) → chatPosted (tools optional)
 * - pure short text, no tools → chatPosted (short answers stay valid)
 * - tool-only → workspaceOnly
 */
export declare function inferDeliveryFromBlocks(blocks: readonly {
    type: string;
    text?: string;
}[], options?: InferDeliveryOptions): WorkUnitDelivery;
/** Extract plain assistant text length + hash from content blocks. */
export declare function assistantPrefixStats(blocks: readonly {
    type: string;
    text?: string;
}[]): {
    cursor: number;
    hash: string;
    text: string;
};
/** Normalize a peer handoff packet (trim + copy arrays). */
export declare function normalizePeerHandoffPacket(packet: PeerHandoffPacket): PeerHandoffPacket;
/** Default deliverySpec for peer/agent-lane returns. */
export declare function defaultPeerDeliverySpec(sink?: DeliverySink): DeliverySpec;
/**
 * Verify deliverySpec against unit.deliveryPayload.
 * No spec → satisfied (gate falls back to chatPosted / workspaceOnly).
 */
export declare function verifyDeliverySpec(unit: WorkUnit): {
    ok: boolean;
    missing: string[];
};
/** True when deliverySpec (if any) is fully satisfied. */
export declare function isDeliverySpecMet(unit: WorkUnit): boolean;
/**
 * Whether DeliveryGate should inject a continuation.
 * Fires when retries remain and either chatPosted is false, workspaceOnly sticky,
 * or an attached deliverySpec is unsatisfied (P1-c).
 */
export declare function shouldRunDeliveryGate(unit: WorkUnit, options?: {
    enabled: boolean;
    maxRetries?: number;
}): boolean;
/** True when tryComplete is allowed under DeliveryGate rules. */
export declare function canMarkCompleted(unit: WorkUnit, options: {
    deliveryGate: boolean;
    maxRetries?: number;
}): boolean;
/** Build fold-notice suffix referencing the bound MAIN unit (fold mode). */
export declare function buildUnitFoldBlock(unit: WorkUnit): string;
/** Build fork-notice suffix for a MAIN + sibling pair (fork mode). */
export declare function buildUnitForkBlock(main: WorkUnit, sibling: WorkUnit): string;
/**
 * Build degraded-fork notice when host `ctx.subagents` is unavailable (P1.5).
 * Keeps 0.1.8 registry sibling + single-Agent cancel-then-claim semantics.
 */
export declare function buildUnitForkDegradedBlock(main: WorkUnit, sibling: WorkUnit): string;
/** Build fold-back notice when a sibling/peer result rejoins MAIN. */
export declare function buildUnitFoldBackNotice(main: WorkUnit, sibling: WorkUnit, packet?: PeerHandoffPacket | null): UserMessage;
/** Build a peer-handoff notice carrying structured theme/keyPoints/todos. */
export declare function buildPeerHandoffNotice(main: WorkUnit, peer: WorkUnit, packet: PeerHandoffPacket): UserMessage;
/** DeliveryGate continuation notice (producer-owned). */
export declare function buildDeliveryGateNotice(unit: WorkUnit): UserMessage;
export declare function isDeliveryGateNotice(message: UserMessage): boolean;
export declare function isPeerHandoffNotice(message: UserMessage): boolean;
/** Payload object derived from a peer handoff packet. */
export declare function peerPacketToPayload(packet: PeerHandoffPacket): Record<string, unknown>;
/** Session-local WorkUnit table (P0/P1: in-memory, Agent lifetime). */
export declare class WorkUnitRegistry {
    private readonly units;
    private activeId;
    private seq;
    lastCheckpoint: StepCheckpoint | null;
    create(input: CreateWorkUnitInput): WorkUnit;
    get(id: string): WorkUnit | undefined;
    list(): WorkUnit[];
    /** Independently queryable unit view (status / checkpoint / lane). */
    query(id: string): WorkUnitQuery | undefined;
    /** List siblings (children) of a parent unit. */
    siblingsOf(parentId: string): WorkUnit[];
    /** P1.5: find the WorkUnit linked to a host child Session id. */
    byChildSessionId(childSessionId: string): WorkUnit | undefined;
    /**
     * P1.5: attach host activation identity to a sibling unit after
     * `startActivation` publishes a child.
     */
    linkChildActivation(unitId: string, ref: WorkUnitActivationRef): void;
    /** List units on a given lane. */
    byLane(lane: WorkUnitLane): WorkUnit[];
    bindActive(id: string | null): void;
    active(): WorkUnit | null;
    markStatus(id: string, status: WorkUnitStatus): void;
    foldOther(unitId: string, otherSummary: string): void;
    updateDelivery(id: string, flags: Partial<WorkUnitDelivery>): void;
    setDeliverySpec(id: string, spec: DeliverySpec | null): void;
    setDeliveryPayload(id: string, payload: Record<string, unknown> | null): void;
    appendCheckpoint(cp: Omit<StepCheckpoint, 'at'> & {
        at?: number;
    }): StepCheckpoint;
    /** Ensure a MAIN unit exists for the given goal; bind it active and mark running/paused. */
    ensureMainUnit(options: {
        goalSummary: string;
        turn: number;
        step: number;
        status?: WorkUnitStatus;
    }): WorkUnit;
    /**
     * P1-a: fork a sibling WorkUnit under MAIN.
     * Sibling is independently queryable; MAIN stays the control-plane parent.
     * By default binds the sibling active so subsequent checkpoints land there
     * until {@link foldSiblingIntoMain} rebinds MAIN.
     */
    forkSibling(options: {
        parentId: string;
        goalSummary: string;
        lane?: WorkUnitLane;
        createdAtTurn?: number;
        createdAtStep?: number;
        status?: WorkUnitStatus;
        deliverySpec?: DeliverySpec | null;
        bindActive?: boolean;
        /**
         * When true (default), pause a running parent — registry-only / degraded fork.
         * P1.5 subagent-backed parallel sets false so MAIN stays running beside the child.
         */
        pauseParent?: boolean;
    }): WorkUnit;
    /**
     * P1-a: complete a forked sibling and fold its result back into MAIN.
     * Does not invent Temporal — registry status + optional packet + rebind only.
     */
    foldSiblingIntoMain(options: {
        siblingId: string;
        packet?: PeerHandoffPacket | null;
        deliveryGate?: boolean;
        maxRetries?: number;
    }): {
        main: WorkUnit;
        sibling: WorkUnit;
        notice: UserMessage;
    };
    /**
     * P1-b: peer/background finished → structured packet → agent-lane unit → fold into MAIN.
     * Simulates the living-handoff return path inside the registry (tests / host hooks).
     */
    acceptPeerHandoff(options: {
        parentId: string;
        packet: PeerHandoffPacket;
        goalSummary?: string;
        lane?: WorkUnitLane;
        createdAtTurn?: number;
        createdAtStep?: number;
        sink?: DeliverySink;
    }): {
        peer: WorkUnit;
        main: WorkUnit;
        notice: UserMessage;
    };
    tryComplete(id: string, options: {
        deliveryGate: boolean;
        maxRetries?: number;
    }): boolean;
    bumpGateRetry(id: string): number;
    snapshot(): WorkUnitSnapshot;
}
/** Trajectory-friendly DeliveryGate meta (not a user chat bubble). */
export interface DeliveryGateMeta {
    readonly kind: 'delivery-gate';
    readonly unitId: string;
    readonly gateRetries: number;
    readonly injected: boolean;
    readonly marker: typeof DELIVERY_GATE_MARKER;
    /** Missing deliverySpec fields when contract was the gate reason. */
    readonly missingSpecFields: readonly string[];
}
export declare function buildDeliveryGateMeta(unit: WorkUnit, injected: boolean): DeliveryGateMeta;
//# sourceMappingURL=work-unit.d.ts.map