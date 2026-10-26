/**
 * Unit tests for the steer fold-hint prompt hook (V1-b+ / 0.1.5 MAIN anchor).
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESUME_ANCHOR_MAX,
  STEER_FOLD_HINT_MARKER,
  STEER_FOLD_HINT_TEXT,
  STEER_FOLD_HINT_TEXT_BOT_LIKE,
  STEER_FOLD_HINT_TEXT_MINIMAL,
  appendResumeAnchorBlock,
  buildSteerClaimBatch,
  buildSteerFoldHintMessage,
  buildSteerPreemptMeta,
  countSteerFoldHints,
  extractLatestHumanUserText,
  isSteerFoldHint,
  resolveSteerFoldHintText,
  resolveSteerFoldHintTextWithAnchor,
  truncateAnchor,
  userMessagePlainText,
} from '../src/steer-fold.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function userEvent(text: string, kind: 'user' | 'steer-fold-hint' | 'runtime-context' = 'user'): SessionEvent {
  const source =
    kind === 'user'
      ? { kind: 'user' as const }
      : kind === 'steer-fold-hint'
        ? {
            kind: 'steer-fold-hint' as const,
            form: 'notice' as const,
            summary: 'fold',
          }
        : {
            kind: 'runtime-context' as const,
            form: 'notice' as const,
            summary: 'runtime',
          }
  return {
    type: 'user/message',
    seq: 0,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source,
    }),
  } as SessionEvent
}

describe('steer-fold hint', () => {
  it('builds a producer-owned bot-like notice with stable marker', () => {
    const msg = buildSteerFoldHintMessage()
    expect(isSteerFoldHint(msg)).toBe(true)
    expect(msg.source.kind).toBe('steer-fold-hint')
    expect(msg.content[0]).toMatchObject({ type: 'text' })
    if (msg.content[0]?.type === 'text') {
      expect(msg.content[0].text).toContain(STEER_FOLD_HINT_MARKER)
      expect(msg.content[0].text).toBe(STEER_FOLD_HINT_TEXT_BOT_LIKE)
      expect(msg.content[0].text).toBe(STEER_FOLD_HINT_TEXT)
      expect(msg.content[0].text).toMatch(/fully answer the newest user interrupt/i)
      expect(msg.content[0].text).toMatch(/without omitting/i)
      expect(msg.content[0].text).toMatch(/Never abandon/i)
      // 0.1.4+: chat-inline dual delivery
      expect(msg.content[0].text).toMatch(/visible chat|conversation reply/i)
      expect(msg.content[0].text).toMatch(/dual delivery/i)
      expect(msg.content[0].text).toMatch(/workspace/i)
    }
  })

  it('minimal mode is shorter but keeps newest-then-prior + chat-inline contract', () => {
    const bot = resolveSteerFoldHintText('bot-like')
    const min = resolveSteerFoldHintText('minimal')
    expect(min).toBe(STEER_FOLD_HINT_TEXT_MINIMAL)
    expect(min.length).toBeLessThan(bot.length)
    expect(min).toContain(STEER_FOLD_HINT_MARKER)
    expect(min).toMatch(/newest interrupt/i)
    expect(min).toMatch(/prior unfinished/i)
    expect(min).toMatch(/Do not drop/i)
    expect(min).toMatch(/visible chat/i)
    expect(min).toMatch(/dual delivery|conversation reply/i)
    expect(min).toMatch(/workspace/i)

    const msg = buildSteerFoldHintMessage('minimal')
    if (msg.content[0]?.type === 'text') {
      expect(msg.content[0].text).toBe(min)
    }
    expect(String(msg.source.summary)).toMatch(/minimal/i)
  })

  it('claim batch order is human OTHER then fold notice', () => {
    const human = createUserMessage({
      content: [{ type: 'text', text: 'packing list please' }],
      source: { kind: 'user' },
    })
    const batch = buildSteerClaimBatch(human, { foldEnabled: true, mode: 'bot-like' })
    expect(batch).toHaveLength(2)
    expect(isSteerFoldHint(batch[0]!)).toBe(false)
    expect(isSteerFoldHint(batch[1]!)).toBe(true)
    if (batch[0]!.content[0]?.type === 'text') {
      expect(batch[0]!.content[0].text).toBe('packing list please')
    }
    expect(countSteerFoldHints(batch)).toBe(1)
  })

  it('foldEnabled=false returns only the human message', () => {
    const human = createUserMessage({
      content: [{ type: 'text', text: 'other' }],
      source: { kind: 'user' },
    })
    const batch = buildSteerClaimBatch(human, { foldEnabled: false })
    expect(batch).toEqual([human])
    expect(countSteerFoldHints(batch)).toBe(0)
  })

  it('preempt meta records fold inject + claim order + resumeAnchorPresent', () => {
    const withFold = buildSteerPreemptMeta({
      foldInjected: true,
      mode: 'bot-like',
      resumeAnchorPresent: true,
    })
    expect(withFold).toEqual({
      kind: 'steer-preempt',
      foldInjected: true,
      mode: 'bot-like',
      claimOrder: ['human', 'fold-hint'],
      marker: STEER_FOLD_HINT_MARKER,
      resumeAnchorPresent: true,
    })
    const bare = buildSteerPreemptMeta({ foldInjected: false, mode: 'bot-like' })
    expect(bare.foldInjected).toBe(false)
    expect(bare.mode).toBeNull()
    expect(bare.claimOrder).toEqual(['human'])
    expect(bare.marker).toBeNull()
    expect(bare.resumeAnchorPresent).toBe(false)
  })

  it('does not classify ordinary human messages as fold hints', () => {
    const human = createUserMessage({
      content: [{ type: 'text', text: 'packing list' }],
      source: { kind: 'user' },
    })
    expect(isSteerFoldHint(human)).toBe(false)
  })

  it('embeds truncated MAIN resume anchor in fold notice when provided', () => {
    const main = 'write a full Python todo CLI with argparse and tests'
    const msg = buildSteerFoldHintMessage({ mode: 'bot-like', resumeAnchor: main })
    expect(isSteerFoldHint(msg)).toBe(true)
    if (msg.content[0]?.type === 'text') {
      expect(msg.content[0].text).toContain(STEER_FOLD_HINT_MARKER)
      expect(msg.content[0].text).toContain('Anchored unfinished MAIN')
      expect(msg.content[0].text).toContain(main)
      expect(msg.content[0].text).toMatch(/same visible chat|visible chat/i)
      expect(msg.content[0].text).toMatch(/workspace/i)
    }
    expect(String(msg.source.summary)).toMatch(/anchor/i)

    const batch = buildSteerClaimBatch(
      createUserMessage({
        content: [{ type: 'text', text: 'packing list please' }],
        source: { kind: 'user' },
      }),
      { foldEnabled: true, mode: 'bot-like', resumeAnchor: main },
    )
    expect(batch).toHaveLength(2)
    expect(isSteerFoldHint(batch[0]!)).toBe(false)
    expect(isSteerFoldHint(batch[1]!)).toBe(true)
    if (batch[1]!.content[0]?.type === 'text') {
      expect(batch[1]!.content[0].text).toContain(main)
    }
  })

  it('minimal mode with anchor still shorter than bot-like+anchor but keeps MAIN quote', () => {
    const main = '北京三日游行程'
    const bot = resolveSteerFoldHintTextWithAnchor('bot-like', main)
    const min = resolveSteerFoldHintTextWithAnchor('minimal', main)
    expect(min.length).toBeLessThan(bot.length)
    expect(min).toContain(main)
    expect(min).toContain('Anchored unfinished MAIN')
    expect(min).toMatch(/visible chat/i)
  })

  it('truncateAnchor keeps short text and marks long text', () => {
    expect(truncateAnchor('short')).toBe('short')
    expect(truncateAnchor('abc', 3)).toBe('abc')
    const long = 'x'.repeat(DEFAULT_RESUME_ANCHOR_MAX + 50)
    const cut = truncateAnchor(long)
    expect(cut.endsWith('… [truncated]')).toBe(true)
    expect(cut.length).toBe(DEFAULT_RESUME_ANCHOR_MAX + '\n… [truncated]'.length)
    expect(cut.startsWith('x'.repeat(DEFAULT_RESUME_ANCHOR_MAX))).toBe(true)
  })

  it('extractLatestHumanUserText skips producers and excluded OTHER', () => {
    const events = [
      userEvent('older main'),
      userEvent('runtime noise', 'runtime-context'),
      userEvent('write long todo CLI'),
      userEvent('fold noise', 'steer-fold-hint'),
    ]
    expect(extractLatestHumanUserText(events)).toBe('write long todo CLI')
    expect(extractLatestHumanUserText(events, { excludeText: 'write long todo CLI' })).toBe('older main')
    expect(extractLatestHumanUserText([])).toBeNull()

    const sessionLike = { snapshotEvents: () => events }
    expect(extractLatestHumanUserText(sessionLike)).toBe('write long todo CLI')
  })

  it('userMessagePlainText joins text blocks', () => {
    const msg = createUserMessage({
      content: [
        { type: 'text', text: 'line1' },
        { type: 'text', text: 'line2' },
      ],
      source: { kind: 'user' },
    })
    expect(userMessagePlainText(msg)).toBe('line1\nline2')
  })

  it('appendResumeAnchorBlock is a no-op for empty/null', () => {
    expect(appendResumeAnchorBlock('base', null)).toBe('base')
    expect(appendResumeAnchorBlock('base', '')).toBe('base')
    expect(appendResumeAnchorBlock('base', 'MAIN')).toContain('MAIN')
  })
})
