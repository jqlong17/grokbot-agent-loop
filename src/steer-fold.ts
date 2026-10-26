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

import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'steer-fold-hint': { kind: 'steer-fold-hint' } & ContextFormed
  }
}

/** Stable marker so tests / UI / trajectory tooling can detect the injected notice. */
export const STEER_FOLD_HINT_MARKER = '[grokbot-steer-fold]'

/** Default max characters for the embedded MAIN resume anchor. */
export const DEFAULT_RESUME_ANCHOR_MAX = 1200

/** Fold notice verbosity after a preempting steer. */
export type SteerFoldMode = 'bot-like' | 'minimal'

/** Options for building fold notice / claim batch (0.1.5+). */
export interface SteerFoldBuildOptions {
  mode?: SteerFoldMode
  /** Truncated unfinished MAIN user text; omitted/null → 0.1.4-style notice. */
  resumeAnchor?: string | null
  /** RPWU P0: bound MAIN unit id embedded in fold notice. */
  unitId?: string | null
  /** RPWU P0: bound MAIN goal summary embedded in fold notice. */
  unitGoalSummary?: string | null
  /** Optional prebuilt unit-fold block (includes marker). */
  unitFoldBlock?: string | null
}

/**
 * Bot-like (default): explicit two-phase contract matching grok.com Bot
 * measurement — complete newest interrupt first, then finish prior task
 * without omission, preferring visible chat dual delivery over workspace-only.
 * Must never imply the prior task may be dropped.
 */
export const STEER_FOLD_HINT_TEXT_BOT_LIKE =
  `${STEER_FOLD_HINT_MARKER} Busy-steer fold (bot-like): ` +
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
  `clearly cancelled it.`

/**
 * Minimal: shorter companion notice for cost-sensitive profiles. Same
 * ordering + chat-inline dual-delivery contract; less instructional detail.
 */
export const STEER_FOLD_HINT_TEXT_MINIMAL =
  `${STEER_FOLD_HINT_MARKER} Busy-steer fold: answer the newest interrupt ` +
  `completely first in visible chat, then finish the prior unfinished user task ` +
  `in the same conversation reply without omission. Prefer chat dual delivery ` +
  `over workspace-only completion. Do not drop the earlier deliverable.`

/**
 * Default / back-compat alias = bot-like text (no anchor block).
 * Prefer {@link resolveSteerFoldHintText} / {@link buildSteerFoldHintMessage} when mode is known.
 */
export const STEER_FOLD_HINT_TEXT = STEER_FOLD_HINT_TEXT_BOT_LIKE

/** Resolve base fold notice text for a mode (without MAIN anchor block). */
export function resolveSteerFoldHintText(mode: SteerFoldMode = 'bot-like'): string {
  return mode === 'minimal' ? STEER_FOLD_HINT_TEXT_MINIMAL : STEER_FOLD_HINT_TEXT_BOT_LIKE
}

/** Join text blocks from a user message; empty → null. */
export function userMessagePlainText(message: UserMessage): string | null {
  const parts = message.content.flatMap(b => (b.type === 'text' && b.text ? [b.text] : []))
  if (parts.length === 0) return null
  return parts.join('\n')
}

/**
 * Truncate MAIN resume anchor for fold notice embedding.
 * Over-length text keeps a head slice and appends an explicit truncated marker.
 */
export function truncateAnchor(text: string, maxLen: number = DEFAULT_RESUME_ANCHOR_MAX): string {
  if (maxLen <= 0) return '… [truncated]'
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}\n… [truncated]`
}

/**
 * Extract the latest human user utterance from session events.
 * Skips producer-owned sources (steer-fold-hint, runtime-context, …) and
 * optionally skips a text equal to the OTHER about to be claimed.
 */
function isEventList(source: unknown): source is readonly SessionEvent[] {
  return Array.isArray(source)
}

export function extractLatestHumanUserText(
  source:
    | { snapshotEvents: (...args: never[]) => readonly SessionEvent[] }
    | readonly SessionEvent[],
  options: { excludeText?: string | null } = {},
): string | null {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const events = isEventList(source) ? source : source.snapshotEvents()
  const exclude = options.excludeText ?? null

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type !== 'user/message') continue
    const message = event.data
    if (message.source.kind !== 'user') continue
    const text = userMessagePlainText(message)
    if (text === null) continue
    if (exclude !== null && text === exclude) continue
    return text
  }
  return null
}

/** Append MAIN resume-anchor block when present. */
export function appendResumeAnchorBlock(baseText: string, resumeAnchor?: string | null): string {
  if (resumeAnchor === undefined || resumeAnchor === null || resumeAnchor.length === 0) {
    return baseText
  }
  return (
    `${baseText} ` +
    `Anchored unfinished MAIN (resume exactly in the same visible chat reply; ` +
    `paste the full deliverable into the conversation — workspace-only is not enough):\n` +
    `"""\n${resumeAnchor}\n"""`
  )
}

/** Append RPWU unit-fold block when present (0.1.6+). */
export function appendUnitFoldBlock(baseText: string, unitFoldBlock?: string | null): string {
  if (unitFoldBlock === undefined || unitFoldBlock === null || unitFoldBlock.length === 0) {
    return baseText
  }
  return `${baseText} ${unitFoldBlock}`
}

/** Resolve full fold notice text including optional MAIN anchor. */
export function resolveSteerFoldHintTextWithAnchor(
  mode: SteerFoldMode = 'bot-like',
  resumeAnchor?: string | null,
  unitFoldBlock?: string | null,
): string {
  return appendUnitFoldBlock(
    appendResumeAnchorBlock(resolveSteerFoldHintText(mode), resumeAnchor),
    unitFoldBlock,
  )
}

/**
 * Build the next-step companion notice for a preempting steer.
 * Accepts either a mode string (0.1.4 back-compat) or {@link SteerFoldBuildOptions}.
 */
export function buildSteerFoldHintMessage(
  modeOrOptions: SteerFoldMode | SteerFoldBuildOptions = 'bot-like',
): UserMessage {
  const options: SteerFoldBuildOptions =
    typeof modeOrOptions === 'string' ? { mode: modeOrOptions } : modeOrOptions
  const mode = options.mode ?? 'bot-like'
  const unitFoldBlock = options.unitFoldBlock
    ?? (options.unitId
      ? `[grokbot-unit-fold] Bound MAIN work unit ${options.unitId}`
        + (options.unitGoalSummary ? ` (goal: ${options.unitGoalSummary})` : '')
        + `. Fold OTHER into this unit; keep step checkpoints; resume from the last completed step. `
        + `Visible chat delivery is required before this unit can complete.`
      : null)
  const text = resolveSteerFoldHintTextWithAnchor(mode, options.resumeAnchor, unitFoldBlock)
  const hasAnchor = Boolean(options.resumeAnchor && options.resumeAnchor.length > 0)
  const hasUnit = Boolean(unitFoldBlock && unitFoldBlock.length > 0)
  const summary = hasUnit
    ? (hasAnchor
      ? mode === 'minimal'
        ? 'Steer fold (minimal+anchor+unit): OTHER then anchored MAIN on bound unit'
        : 'Steer fold (bot-like+anchor+unit): chat dual delivery on bound MAIN unit'
      : mode === 'minimal'
        ? 'Steer fold (minimal+unit): OTHER then prior task on bound unit'
        : 'Steer fold (bot-like+unit): chat dual delivery on bound MAIN unit')
    : hasAnchor
      ? mode === 'minimal'
        ? 'Steer fold (minimal+anchor): OTHER in chat, then anchored MAIN dual delivery'
        : 'Steer fold (bot-like+anchor): chat-inline dual delivery — OTHER then anchored MAIN'
      : mode === 'minimal'
        ? 'Steer fold (minimal): complete newest interrupt in chat, then finish prior task'
        : 'Steer fold (bot-like): chat-inline dual delivery — OTHER then MAIN without omission'
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'steer-fold-hint',
      form: 'notice',
      summary,
    },
  })
}

/**
 * Fixed claim batch after a preempting steer.
 * Order is intentional and tested: **human OTHER first**, fold notice
 * immediately after, so the model always sees the interrupt before the policy.
 */
export function buildSteerClaimBatch(
  input: UserMessage,
  options: {
    foldEnabled: boolean
    mode?: SteerFoldMode
    resumeAnchor?: string | null
    unitId?: string | null
    unitGoalSummary?: string | null
    unitFoldBlock?: string | null
  } = { foldEnabled: true },
): UserMessage[] {
  if (!options.foldEnabled) return [input]
  return [
    input,
    buildSteerFoldHintMessage({
      mode: options.mode ?? 'bot-like',
      resumeAnchor: options.resumeAnchor,
      unitId: options.unitId,
      unitGoalSummary: options.unitGoalSummary,
      unitFoldBlock: options.unitFoldBlock,
    }),
  ]
}

/** True when a message is our fold-hint notice (not a human utterance). */
export function isSteerFoldHint(message: UserMessage): boolean {
  return message.source.kind === 'steer-fold-hint'
}

/** Count fold-hint notices in a message list (inbox / request messages). */
export function countSteerFoldHints(messages: readonly UserMessage[]): number {
  return messages.reduce((n, m) => n + (isSteerFoldHint(m) ? 1 : 0), 0)
}

/**
 * Compact preempt observability snapshot for tests / trajectory tooling.
 * Not shown as a user chat bubble; fold notice itself remains the
 * producer-owned prompt hook. Does **not** embed the full MAIN text.
 */
export interface SteerPreemptMeta {
  readonly kind: 'steer-preempt'
  readonly foldInjected: boolean
  readonly mode: SteerFoldMode | null
  readonly claimOrder: readonly ('human' | 'fold-hint')[]
  readonly marker: typeof STEER_FOLD_HINT_MARKER | null
  /** Whether a MAIN resume anchor was embedded in the fold notice (0.1.5+). */
  readonly resumeAnchorPresent: boolean
  /** RPWU P0: bound MAIN unit id when fold-into-unit ran (0.1.6+). */
  readonly unitId: string | null
  /** RPWU P0: whether a unit-fold marker was embedded. */
  readonly unitFoldPresent: boolean
}

/** Build a trajectory-friendly preempt meta record. */
export function buildSteerPreemptMeta(options: {
  foldInjected: boolean
  mode: SteerFoldMode | null
  resumeAnchorPresent?: boolean
  unitId?: string | null
  unitFoldPresent?: boolean
}): SteerPreemptMeta {
  const claimOrder: Array<'human' | 'fold-hint'> = options.foldInjected
    ? ['human', 'fold-hint']
    : ['human']
  return {
    kind: 'steer-preempt',
    foldInjected: options.foldInjected,
    mode: options.foldInjected ? options.mode : null,
    claimOrder,
    marker: options.foldInjected ? STEER_FOLD_HINT_MARKER : null,
    resumeAnchorPresent: options.foldInjected ? Boolean(options.resumeAnchorPresent) : false,
    unitId: options.foldInjected ? (options.unitId ?? null) : null,
    unitFoldPresent: options.foldInjected ? Boolean(options.unitFoldPresent) : false,
  }
}
