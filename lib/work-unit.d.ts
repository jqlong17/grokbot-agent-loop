/**
 * RPWU P0 — Recoverable Parallel Work Units (session-local, in-memory).
 *
 * WorkUnit registry + step checkpoints + delivery gate helpers. Pure plugin
 * layer on top of 0.1.x cancel-then-claim; not Temporal, not multi-background.
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
    }
}
/** Visible marker for unit-aware fold notices (tests / trajectory). */
export declare const UNIT_FOLD_MARKER = "[grokbot-unit-fold]";
/** Visible marker for DeliveryGate continuation notices. */
export declare const DELIVERY_GATE_MARKER = "[grokbot-delivery-gate]";
/** P0/P0.1: default gate-driven continuations per unit (0.1.7+). */
export declare const DEFAULT_DELIVERY_GATE_MAX = 2;
/** Default minimum plain-text length to count as substantive chat delivery. */
export declare const DEFAULT_SUBSTANTIVE_MIN_CHARS = 400;
/** Default goalSummary truncation. */
export declare const DEFAULT_GOAL_SUMMARY_MAX = 240;
export type WorkUnitStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';
export type WorkUnitLane = 'user' | 'agent';
export interface WorkUnitDelivery {
    chatPosted: boolean;
    workspaceOnly: boolean;
}
export interface ToolResultRef {
    id: string;
    summary?: string;
}
export type CheckpointReason = 'step-end' | 'preempt' | 'gate' | 'manual';
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
export interface WorkUnit {
    id: string;
    goalSummary: string;
    status: WorkUnitStatus;
    lane: WorkUnitLane;
    createdAtStep: number;
    createdAtTurn: number;
    checkpoints: StepCheckpoint[];
    delivery: WorkUnitDelivery;
    /** Short summaries of OTHER interrupts folded into this unit (P0: no fork). */
    foldedOtherSummaries: string[];
    /** How many DeliveryGate continuation steps have already been injected. */
    gateRetries: number;
}
export interface CreateWorkUnitInput {
    goalSummary: string;
    lane?: WorkUnitLane;
    createdAtStep?: number;
    createdAtTurn?: number;
    id?: string;
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
/**
 * Whether DeliveryGate should inject a continuation.
 * Fires when retries remain and either chatPosted is false, or the unit is still
 * marked workspaceOnly (sticky chat from OTHER + later tool dump of MAIN).
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
/** Build fold-notice suffix referencing the bound MAIN unit. */
export declare function buildUnitFoldBlock(unit: WorkUnit): string;
/** DeliveryGate continuation notice (producer-owned). */
export declare function buildDeliveryGateNotice(unit: WorkUnit): UserMessage;
export declare function isDeliveryGateNotice(message: UserMessage): boolean;
/** Session-local WorkUnit table (P0: in-memory, Agent lifetime). */
export declare class WorkUnitRegistry {
    private readonly units;
    private activeId;
    private seq;
    lastCheckpoint: StepCheckpoint | null;
    create(input: CreateWorkUnitInput): WorkUnit;
    get(id: string): WorkUnit | undefined;
    list(): WorkUnit[];
    bindActive(id: string | null): void;
    active(): WorkUnit | null;
    markStatus(id: string, status: WorkUnitStatus): void;
    foldOther(unitId: string, otherSummary: string): void;
    updateDelivery(id: string, flags: Partial<WorkUnitDelivery>): void;
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
}
export declare function buildDeliveryGateMeta(unit: WorkUnit, injected: boolean): DeliveryGateMeta;
//# sourceMappingURL=work-unit.d.ts.map