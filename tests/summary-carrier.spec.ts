/**
 * Slice D — SummarySession minimal user-role carrier (0.2.3).
 * Summary content injects back into MAIN as user-role; no second UI.
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  MemorySummarySession,
  StubSummarySession,
  SUMMARY_CARRIER_MARKER,
  buildSummaryCarrierMessage,
  parseSummaryCarrierText,
  isSummaryCarrierMessage,
  injectSummaryCarrierIntoMain,
  dualSessionPair,
  asMainSession,
} from '../src/index.ts'

describe('SummarySession carrier contract', () => {
  it('StubSummarySession returns empty / null carrier', () => {
    const stub = new StubSummarySession('sum-stub')
    expect(stub.summarize({ completedTurn: 1 })).toBe('')
    expect(stub.toCarrier?.({ completedTurn: 1 }) ?? null).toBeNull()
  })

  it('MemorySummarySession records and summarizes without LLM', () => {
    const session = new MemorySummarySession('sum-1')
    session.record({
      completedTurn: 1,
      transcriptHint: 'unit=wu-1; goal=CLI; checkpoints=2',
    })
    session.record({
      completedTurn: 2,
      transcriptHint: 'unit=wu-1; goal=CLI; checkpoints=3',
    })
    const text = session.summarize({ completedTurn: 2 })
    expect(text).toContain('t1:')
    expect(text).toContain('t2:')
    expect(session.history).toHaveLength(2)
  })

  it('toCarrier is user-role with marker; buildSummaryCarrierMessage injects', () => {
    const session = new MemorySummarySession('sum-carrier')
    const carrier = session.toCarrier({
      completedTurn: 3,
      transcriptHint: 'goal=write CLI; status=running',
    })
    expect(carrier).not.toBeNull()
    expect(carrier!.role).toBe('user')
    expect(carrier!.marker).toBe(SUMMARY_CARRIER_MARKER)
    expect(carrier!.text.startsWith(SUMMARY_CARRIER_MARKER)).toBe(true)
    expect(carrier!.body).toContain('write CLI')
    expect(carrier!.summarySessionId).toBe('sum-carrier')

    const msg = buildSummaryCarrierMessage(carrier!)
    expect(isSummaryCarrierMessage(msg)).toBe(true)
    expect(msg.source).toMatchObject({
      kind: 'unit-fold-hint',
      summary: expect.stringMatching(/SummarySession carrier/i),
    })
    const block = msg.content.find(b => b.type === 'text')
    expect(block && 'text' in block ? parseSummaryCarrierText(block.text) : null)
      .toContain('write CLI')
  })

  it('toUserMessage returns null when empty', () => {
    const session = new MemorySummarySession()
    expect(session.toUserMessage({ completedTurn: 0 })).toBeNull()
  })

  it('injectSummaryCarrierIntoMain appends user-role carrier into MAIN path', () => {
    const session = new MemorySummarySession('sum-main')
    const carrierMsg = session.toUserMessage({
      completedTurn: 1,
      transcriptHint: 'settled MAIN after step-end',
    })
    expect(carrierMsg).not.toBeNull()

    const human = createUserMessage({
      content: [{ type: 'text', text: 'continue the CLI' }],
      source: { kind: 'user' },
    })
    const batch = injectSummaryCarrierIntoMain([human], carrierMsg, 'prepend')
    expect(batch).toHaveLength(2)
    expect(isSummaryCarrierMessage(batch[0]!)).toBe(true)
    expect(isSummaryCarrierMessage(batch[1]!)).toBe(false)
    // Carrier is user-role injection (marker), not assistant output.
    expect(isSummaryCarrierMessage(batch[0]!)).toBe(true)
    expect(batch[0]!.source).toMatchObject({ kind: 'unit-fold-hint' })
  })

  it('dualSessionPair exposes main + summary roles', () => {
    const summary = new MemorySummarySession('s-pair')
    const pair = dualSessionPair('main-1', summary)
    expect(pair.main.role).toBe('main')
    expect(pair.summary?.role).toBe('summary')
    expect(pair.summary?.sessionId).toBe('s-pair')
    expect(asMainSession('main-1').role).toBe('main')
  })

  it('parseSummaryCarrierText rejects non-carrier text', () => {
    expect(parseSummaryCarrierText('hello')).toBeNull()
    expect(parseSummaryCarrierText(`${SUMMARY_CARRIER_MARKER}   `)).toBeNull()
    expect(parseSummaryCarrierText(`${SUMMARY_CARRIER_MARKER} body`)).toBe('body')
  })
})
