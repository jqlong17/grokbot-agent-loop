/**
 * Dual-session model — Ideal Topology v1.1.
 *
 * Main inference session = live model+tools work.
 * Summary session = compresses completed turns; injects back as **user-role
 * carrier** into the MAIN path (no second product UI).
 *
 * @module @harness-plugins/grokbot-agent-loop/sessions
 */

import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Role of a session in the dual-session topology. */
export type SessionRole = 'main' | 'summary'

/** Handle describing one half of the dual-session pair. */
export interface DualSessionHandle {
  readonly role: SessionRole
  readonly sessionId: SessionId | string
}

/**
 * Main + Summary session pair.
 * `summary` may be null when the summary carrier is not mounted.
 */
export interface DualSessionPair {
  readonly main: DualSessionHandle
  readonly summary: DualSessionHandle | null
}

/** Marker prefix for user-role summary carrier text injected into MAIN. */
export const SUMMARY_CARRIER_MARKER = '[grokbot-summary-carrier]'

/** One recorded summary fragment inside a SummarySession. */
export interface SummaryRecord {
  readonly completedTurn: number
  readonly text: string
  readonly at: number
}

/**
 * User-role carrier payload ready for MAIN inbox / context injection.
 * Contract: role is always `user`; never assistant — summary is a carrier.
 */
export interface SummaryCarrier {
  readonly marker: typeof SUMMARY_CARRIER_MARKER
  readonly role: 'user'
  readonly text: string
  readonly body: string
  readonly completedTurn: number
  readonly summarySessionId: string
}

/** Summary carrier interface. */
export interface SummarySession {
  readonly sessionId: SessionId | string
  /** Produce a summary string for the next main-context injection. */
  summarize(input: {
    readonly completedTurn: number
    readonly transcriptHint?: string
  }): Promise<string> | string
  /** Build the user-role carrier object (may be empty when nothing to inject). */
  toCarrier?(input: {
    readonly completedTurn: number
    readonly transcriptHint?: string
  }): SummaryCarrier | null
}

/** No-op summary carrier (compat / opt-out). */
export class StubSummarySession implements SummarySession {
  constructor(readonly sessionId: SessionId | string = 'summary-stub') {}

  summarize(): string {
    return ''
  }

  toCarrier(): null {
    return null
  }
}

/**
 * Minimal in-memory SummarySession (0.2.3).
 * Accumulates turn hints and emits a user-role carrier for MAIN.
 */
export class MemorySummarySession implements SummarySession {
  private readonly records: SummaryRecord[] = []

  constructor(readonly sessionId: SessionId | string = 'summary-memory') {}

  /** Append a turn fragment into the summary session. */
  record(input: {
    readonly completedTurn: number
    readonly transcriptHint?: string
    readonly notes?: string
  }): SummaryRecord {
    const parts = [
      input.transcriptHint?.trim(),
      input.notes?.trim(),
    ].filter((p): p is string => Boolean(p && p.length > 0))
    const text = parts.join(' | ') || `turn=${input.completedTurn}`
    const record: SummaryRecord = {
      completedTurn: input.completedTurn,
      text,
      at: Date.now(),
    }
    this.records.push(record)
    return record
  }

  /** All recorded fragments (tests / trajectory). */
  get history(): readonly SummaryRecord[] {
    return this.records
  }

  summarize(input: {
    readonly completedTurn: number
    readonly transcriptHint?: string
  }): string {
    if (input.transcriptHint?.trim()) {
      this.record({
        completedTurn: input.completedTurn,
        transcriptHint: input.transcriptHint,
      })
    }
    const relevant = this.records.filter(r => r.completedTurn <= input.completedTurn)
    if (relevant.length === 0) return ''
    // Cheap compress: last N fragments joined (no LLM).
    const window = relevant.slice(-8)
    return window.map(r => `t${r.completedTurn}:${r.text}`).join('; ')
  }

  toCarrier(input: {
    readonly completedTurn: number
    readonly transcriptHint?: string
  }): SummaryCarrier | null {
    const body = this.summarize(input).trim()
    if (!body) return null
    return {
      marker: SUMMARY_CARRIER_MARKER,
      role: 'user',
      text: `${SUMMARY_CARRIER_MARKER} ${body}`,
      body,
      completedTurn: input.completedTurn,
      summarySessionId: String(this.sessionId),
    }
  }

  /**
   * Build a UserMessage for MAIN next-step / context injection.
   * Returns null when there is nothing to carry.
   */
  toUserMessage(input: {
    readonly completedTurn: number
    readonly transcriptHint?: string
  }): UserMessage | null {
    const carrier = this.toCarrier(input)
    if (!carrier) return null
    return buildSummaryCarrierMessage(carrier)
  }
}

/** Build a user-role UserMessage from a SummaryCarrier. */
export function buildSummaryCarrierMessage(carrier: SummaryCarrier): UserMessage {
  // Reuse unit-fold-hint producer shape (dsh source.kind closed union); marker identifies carrier.
  return createUserMessage({
    content: [{ type: 'text', text: carrier.text }],
    source: {
      kind: 'unit-fold-hint',
      form: 'notice',
      summary: `SummarySession carrier → MAIN (turn ${carrier.completedTurn})`,
    },
  })
}

/** Extract carrier body if `text` is a summary-carrier notice; else null. */
export function parseSummaryCarrierText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(SUMMARY_CARRIER_MARKER)) return null
  const body = trimmed.slice(SUMMARY_CARRIER_MARKER.length).trim()
  return body.length > 0 ? body : null
}

/** True when a UserMessage looks like a summary carrier injection. */
export function isSummaryCarrierMessage(message: UserMessage): boolean {
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      if (parseSummaryCarrierText(block.text) !== null) return true
    }
  }
  const summary = (message.source as { summary?: string } | undefined)?.summary
  return typeof summary === 'string' && /SummarySession carrier/i.test(summary)
}

/** Build a dual-session pair from a live main session id. */
export function dualSessionPair(
  mainSessionId: SessionId | string,
  summary: SummarySession | null = null,
): DualSessionPair {
  return {
    main: { role: 'main', sessionId: mainSessionId },
    summary: summary
      ? { role: 'summary', sessionId: summary.sessionId }
      : null,
  }
}
