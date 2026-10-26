/**
 * Prompt-layer fold policy for interruptible busy-steer.
 *
 * Grok Bot product behavior (our grok.com Bot measurement): mid-stream OTHER
 * is absorbed into the same Working turn; the model addresses OTHER then
 * continues the incomplete prior task — without Chat-style Interrupted hard-cut.
 *
 * Our loop's harness half is cancel-then-claim (keep streamed prefix). The
 * remaining gap is product/prompt: after preempt, tell the model to finish
 * OTHER first and resume the prior unfinished delivery **inline in chat**,
 * with an explicit MAIN text anchor when available (0.1.5).
 * This module is that minimal hook — not Temporal durability, not SendToUser/end_turn.
 *
 * @module @harness-plugins/grokbot-agent-loop/steer-fold
 */
import { type ContextFormed } from '@deepseek-ai/dsh-llm';
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'steer-fold-hint': {
            kind: 'steer-fold-hint';
        } & ContextFormed;
    }
}
/** Stable marker so tests / UI / trajectory tooling can detect the injected notice. */
export declare const STEER_FOLD_HINT_MARKER = "[grokbot-steer-fold]";
/** Default max characters for the embedded MAIN resume anchor. */
export declare const DEFAULT_RESUME_ANCHOR_MAX = 1200;
/** Fold notice verbosity after a preempting steer. */
export type SteerFoldMode = 'bot-like' | 'minimal';
/** Options for building fold notice / claim batch (0.1.5+). */
export interface SteerFoldBuildOptions {
    mode?: SteerFoldMode;
    /** Truncated unfinished MAIN user text; omitted/null → 0.1.4-style notice. */
    resumeAnchor?: string | null;
    /** RPWU P0: bound MAIN unit id embedded in fold notice. */
    unitId?: string | null;
    /** RPWU P0: bound MAIN goal summary embedded in fold notice. */
    unitGoalSummary?: string | null;
    /**
     * Optional prebuilt unit-fold or unit-fork block (includes marker).
     * Prefer this over synthesizing from unitId when RPWU P1 fork is active.
     */
    unitFoldBlock?: string | null;
}
/**
 * Bot-like (default): explicit two-phase contract matching grok.com Bot
 * measurement — complete newest interrupt first, then finish prior task
 * without omission, preferring visible chat dual delivery over workspace-only.
 * Must never imply the prior task may be dropped.
 */
export declare const STEER_FOLD_HINT_TEXT_BOT_LIKE: string;
/**
 * Minimal: shorter companion notice for cost-sensitive profiles. Same
 * ordering + chat-inline dual-delivery contract; less instructional detail.
 */
export declare const STEER_FOLD_HINT_TEXT_MINIMAL: string;
/**
 * Default / back-compat alias = bot-like text (no anchor block).
 * Prefer {@link resolveSteerFoldHintText} / {@link buildSteerFoldHintMessage} when mode is known.
 */
export declare const STEER_FOLD_HINT_TEXT: string;
/** Resolve base fold notice text for a mode (without MAIN anchor block). */
export declare function resolveSteerFoldHintText(mode?: SteerFoldMode): string;
/** Join text blocks from a user message; empty → null. */
export declare function userMessagePlainText(message: UserMessage): string | null;
/**
 * Truncate MAIN resume anchor for fold notice embedding.
 * Over-length text keeps a head slice and appends an explicit truncated marker.
 */
export declare function truncateAnchor(text: string, maxLen?: number): string;
export declare function extractLatestHumanUserText(source: {
    snapshotEvents: (...args: never[]) => readonly SessionEvent[];
} | readonly SessionEvent[], options?: {
    excludeText?: string | null;
}): string | null;
/** Append MAIN resume-anchor block when present. */
export declare function appendResumeAnchorBlock(baseText: string, resumeAnchor?: string | null): string;
/** Append RPWU unit-fold block when present (0.1.6+). */
export declare function appendUnitFoldBlock(baseText: string, unitFoldBlock?: string | null): string;
/** Resolve full fold notice text including optional MAIN anchor. */
export declare function resolveSteerFoldHintTextWithAnchor(mode?: SteerFoldMode, resumeAnchor?: string | null, unitFoldBlock?: string | null): string;
/**
 * Build the next-step companion notice for a preempting steer.
 * Accepts either a mode string (0.1.4 back-compat) or {@link SteerFoldBuildOptions}.
 */
export declare function buildSteerFoldHintMessage(modeOrOptions?: SteerFoldMode | SteerFoldBuildOptions): UserMessage;
/**
 * Fixed claim batch after a preempting steer.
 * Order is intentional and tested: **human OTHER first**, fold notice
 * immediately after, so the model always sees the interrupt before the policy.
 */
export declare function buildSteerClaimBatch(input: UserMessage, options?: {
    foldEnabled: boolean;
    mode?: SteerFoldMode;
    resumeAnchor?: string | null;
    unitId?: string | null;
    unitGoalSummary?: string | null;
    unitFoldBlock?: string | null;
}): UserMessage[];
/** True when a message is our fold-hint notice (not a human utterance). */
export declare function isSteerFoldHint(message: UserMessage): boolean;
/** Count fold-hint notices in a message list (inbox / request messages). */
export declare function countSteerFoldHints(messages: readonly UserMessage[]): number;
/**
 * Compact preempt observability snapshot for tests / trajectory tooling.
 * Not shown as a user chat bubble; fold notice itself remains the
 * producer-owned prompt hook. Does **not** embed the full MAIN text.
 */
export interface SteerPreemptMeta {
    readonly kind: 'steer-preempt';
    readonly foldInjected: boolean;
    readonly mode: SteerFoldMode | null;
    readonly claimOrder: readonly ('human' | 'fold-hint')[];
    readonly marker: typeof STEER_FOLD_HINT_MARKER | null;
    /** Whether a MAIN resume anchor was embedded in the fold notice (0.1.5+). */
    readonly resumeAnchorPresent: boolean;
    /** RPWU P0: bound MAIN unit id when fold-into-unit ran (0.1.6+). */
    readonly unitId: string | null;
    /** RPWU P0: whether a unit-fold / unit-fork marker was embedded. */
    readonly unitFoldPresent: boolean;
    /**
     * RPWU P1-a: how OTHER joined the registry (`fold` default / `fork` sibling).
     * Null when RPWU did not run on this preempt.
     */
    readonly otherMode: 'fold' | 'fork' | null;
    /** RPWU P1-a: forked sibling unit id when otherMode is `fork`. */
    readonly siblingUnitId: string | null;
}
/** Build a trajectory-friendly preempt meta record. */
export declare function buildSteerPreemptMeta(options: {
    foldInjected: boolean;
    mode: SteerFoldMode | null;
    resumeAnchorPresent?: boolean;
    unitId?: string | null;
    unitFoldPresent?: boolean;
    otherMode?: 'fold' | 'fork' | null;
    siblingUnitId?: string | null;
}): SteerPreemptMeta;
//# sourceMappingURL=steer-fold.d.ts.map