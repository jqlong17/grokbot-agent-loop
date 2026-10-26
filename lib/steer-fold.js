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
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** Stable marker so tests / UI / trajectory tooling can detect the injected notice. */
export const STEER_FOLD_HINT_MARKER = '[grokbot-steer-fold]';
/** Default max characters for the embedded MAIN resume anchor. */
export const DEFAULT_RESUME_ANCHOR_MAX = 1200;
/**
 * Bot-like (default): explicit two-phase contract matching grok.com Bot
 * measurement — complete newest interrupt first, then finish prior task
 * without omission, preferring visible chat dual delivery over workspace-only.
 * Must never imply the prior task may be dropped.
 */
export const STEER_FOLD_HINT_TEXT_BOT_LIKE = `${STEER_FOLD_HINT_MARKER} Busy-steer fold (bot-like): ` +
    `First, fully answer the newest user interrupt with a complete deliverable ` +
    `(for example a packing list if that is what they just asked) in visible chat. ` +
    `Second, without omitting sections or collapsing into a summary, resume and ` +
    `finish the prior unfinished user task (MAIN) in the **same visible assistant ` +
    `reply stream**. ` +
    `Prefer dual delivery in the same visible chat / conversation reply: put the ` +
    `complete OTHER answer first, then continue the unfinished MAIN in that same ` +
    `assistant reply stream — do not treat writing only to the workspace or tools ` +
    `as done unless the user explicitly asked to save files. Even if you also write ` +
    `files or use tools, you must still paste the full MAIN deliverable into the ` +
    `visible conversation (full code / full itinerary / etc.). ` +
    `Keep useful work already streamed. ` +
    `Never abandon, skip, or replace the earlier deliverable unless the user ` +
    `clearly cancelled it.`;
/**
 * Minimal: shorter companion notice for cost-sensitive profiles. Same
 * ordering + chat-inline dual-delivery contract; less instructional detail.
 */
export const STEER_FOLD_HINT_TEXT_MINIMAL = `${STEER_FOLD_HINT_MARKER} Busy-steer fold: answer the newest interrupt ` +
    `completely first in visible chat, then finish the prior unfinished user task ` +
    `in the same conversation reply without omission. Prefer chat dual delivery ` +
    `over workspace-only completion. Do not drop the earlier deliverable.`;
/**
 * Default / back-compat alias = bot-like text (no anchor block).
 * Prefer {@link resolveSteerFoldHintText} / {@link buildSteerFoldHintMessage} when mode is known.
 */
export const STEER_FOLD_HINT_TEXT = STEER_FOLD_HINT_TEXT_BOT_LIKE;
/** Resolve base fold notice text for a mode (without MAIN anchor block). */
export function resolveSteerFoldHintText(mode = 'bot-like') {
    return mode === 'minimal' ? STEER_FOLD_HINT_TEXT_MINIMAL : STEER_FOLD_HINT_TEXT_BOT_LIKE;
}
/** Join text blocks from a user message; empty → null. */
export function userMessagePlainText(message) {
    const parts = message.content.flatMap(b => (b.type === 'text' && b.text ? [b.text] : []));
    if (parts.length === 0)
        return null;
    return parts.join('\n');
}
/**
 * Truncate MAIN resume anchor for fold notice embedding.
 * Over-length text keeps a head slice and appends an explicit truncated marker.
 */
export function truncateAnchor(text, maxLen = DEFAULT_RESUME_ANCHOR_MAX) {
    if (maxLen <= 0)
        return '… [truncated]';
    if (text.length <= maxLen)
        return text;
    return `${text.slice(0, maxLen)}\n… [truncated]`;
}
/**
 * Extract the latest human user utterance from session events.
 * Skips producer-owned sources (steer-fold-hint, runtime-context, …) and
 * optionally skips a text equal to the OTHER about to be claimed.
 */
function isEventList(source) {
    return Array.isArray(source);
}
export function extractLatestHumanUserText(source, options = {}) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = isEventList(source) ? source : source.snapshotEvents();
    const exclude = options.excludeText ?? null;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event?.type !== 'user/message')
            continue;
        const message = event.data;
        if (message.source.kind !== 'user')
            continue;
        const text = userMessagePlainText(message);
        if (text === null)
            continue;
        if (exclude !== null && text === exclude)
            continue;
        return text;
    }
    return null;
}
/** Append MAIN resume-anchor block when present. */
export function appendResumeAnchorBlock(baseText, resumeAnchor) {
    if (resumeAnchor === undefined || resumeAnchor === null || resumeAnchor.length === 0) {
        return baseText;
    }
    return (`${baseText} ` +
        `Anchored unfinished MAIN (resume exactly in the same visible chat reply; ` +
        `paste the full deliverable into the conversation — workspace-only is not enough):\n` +
        `"""\n${resumeAnchor}\n"""`);
}
/** Append RPWU unit-fold block when present (0.1.6+). */
export function appendUnitFoldBlock(baseText, unitFoldBlock) {
    if (unitFoldBlock === undefined || unitFoldBlock === null || unitFoldBlock.length === 0) {
        return baseText;
    }
    return `${baseText} ${unitFoldBlock}`;
}
/** Resolve full fold notice text including optional MAIN anchor. */
export function resolveSteerFoldHintTextWithAnchor(mode = 'bot-like', resumeAnchor, unitFoldBlock) {
    return appendUnitFoldBlock(appendResumeAnchorBlock(resolveSteerFoldHintText(mode), resumeAnchor), unitFoldBlock);
}
/**
 * Build the next-step companion notice for a preempting steer.
 * Accepts either a mode string (0.1.4 back-compat) or {@link SteerFoldBuildOptions}.
 */
export function buildSteerFoldHintMessage(modeOrOptions = 'bot-like') {
    const options = typeof modeOrOptions === 'string' ? { mode: modeOrOptions } : modeOrOptions;
    const mode = options.mode ?? 'bot-like';
    const unitFoldBlock = options.unitFoldBlock
        ?? (options.unitId
            ? `[grokbot-unit-fold] Bound MAIN work unit ${options.unitId}`
                + (options.unitGoalSummary ? ` (goal: ${options.unitGoalSummary})` : '')
                + `. Fold OTHER into this unit; keep step checkpoints; resume from the last completed step. `
                + `Visible chat delivery is required before this unit can complete.`
            : null);
    const text = resolveSteerFoldHintTextWithAnchor(mode, options.resumeAnchor, unitFoldBlock);
    const hasAnchor = Boolean(options.resumeAnchor && options.resumeAnchor.length > 0);
    const hasUnit = Boolean(unitFoldBlock && unitFoldBlock.length > 0);
    const forked = Boolean(unitFoldBlock && unitFoldBlock.includes('[grokbot-unit-fork]'));
    const summary = hasUnit
        ? (forked
            ? (hasAnchor
                ? mode === 'minimal'
                    ? 'Steer fold (minimal+anchor+fork): OTHER on sibling unit, then anchored MAIN'
                    : 'Steer fold (bot-like+anchor+fork): sibling OTHER then anchored MAIN dual delivery'
                : mode === 'minimal'
                    ? 'Steer fold (minimal+fork): OTHER on sibling unit, then prior MAIN'
                    : 'Steer fold (bot-like+fork): sibling OTHER then MAIN dual delivery')
            : (hasAnchor
                ? mode === 'minimal'
                    ? 'Steer fold (minimal+anchor+unit): OTHER then anchored MAIN on bound unit'
                    : 'Steer fold (bot-like+anchor+unit): chat dual delivery on bound MAIN unit'
                : mode === 'minimal'
                    ? 'Steer fold (minimal+unit): OTHER then prior task on bound unit'
                    : 'Steer fold (bot-like+unit): chat dual delivery on bound MAIN unit'))
        : hasAnchor
            ? mode === 'minimal'
                ? 'Steer fold (minimal+anchor): OTHER in chat, then anchored MAIN dual delivery'
                : 'Steer fold (bot-like+anchor): chat-inline dual delivery — OTHER then anchored MAIN'
            : mode === 'minimal'
                ? 'Steer fold (minimal): complete newest interrupt in chat, then finish prior task'
                : 'Steer fold (bot-like): chat-inline dual delivery — OTHER then MAIN without omission';
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'steer-fold-hint',
            form: 'notice',
            summary,
        },
    });
}
/**
 * Fixed claim batch after a preempting steer.
 * Order is intentional and tested: **human OTHER first**, fold notice
 * immediately after, so the model always sees the interrupt before the policy.
 */
export function buildSteerClaimBatch(input, options = { foldEnabled: true }) {
    if (!options.foldEnabled)
        return [input];
    return [
        input,
        buildSteerFoldHintMessage({
            mode: options.mode ?? 'bot-like',
            resumeAnchor: options.resumeAnchor,
            unitId: options.unitId,
            unitGoalSummary: options.unitGoalSummary,
            unitFoldBlock: options.unitFoldBlock,
        }),
    ];
}
/** True when a message is our fold-hint notice (not a human utterance). */
export function isSteerFoldHint(message) {
    return message.source.kind === 'steer-fold-hint';
}
/** Count fold-hint notices in a message list (inbox / request messages). */
export function countSteerFoldHints(messages) {
    return messages.reduce((n, m) => n + (isSteerFoldHint(m) ? 1 : 0), 0);
}
/** Build a trajectory-friendly preempt meta record. */
export function buildSteerPreemptMeta(options) {
    const claimOrder = options.foldInjected
        ? ['human', 'fold-hint']
        : ['human'];
    const otherMode = options.otherMode ?? null;
    return {
        kind: 'steer-preempt',
        foldInjected: options.foldInjected,
        mode: options.foldInjected ? options.mode : null,
        claimOrder,
        marker: options.foldInjected ? STEER_FOLD_HINT_MARKER : null,
        resumeAnchorPresent: options.foldInjected ? Boolean(options.resumeAnchorPresent) : false,
        unitId: options.foldInjected ? (options.unitId ?? null) : null,
        unitFoldPresent: options.foldInjected ? Boolean(options.unitFoldPresent) : false,
        otherMode,
        siblingUnitId: options.siblingUnitId ?? null,
        forkDegraded: otherMode === 'fork'
            ? (options.forkDegraded ?? null)
            : null,
        childSessionId: otherMode === 'fork'
            ? (options.childSessionId ?? null)
            : null,
    };
}
//# sourceMappingURL=steer-fold.js.map