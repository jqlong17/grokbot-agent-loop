/**
 * DecisionLayer — cheap deterministic score/route (slice C / 0.2.2).
 * Orchestrator remains the sole admit brain; LLM is not the OS.
 */
import { describe, expect, it } from 'vitest'
import {
  Orchestrator,
  RuleDecisionLayer,
  PassthroughDecisionLayer,
  scoreRoute,
  classifyAdmit,
} from '../src/index.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

function steerEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'steer' as const,
    input: createUserMessage({
      content: [{ type: 'text', text: 'OTHER packing list please' }],
      source: { kind: 'user' },
    }),
    scheduler: {
      busy: true,
      aborting: false,
      userLanePending: false,
      interruptOnSteer: true,
    },
    otherText: 'OTHER packing list please',
    mainGoalText: 'write a todo CLI',
    turn: 1,
    step: 2,
    rpwuEnabled: true,
    otherMode: 'spawn',
    hasSubagentSeam: false,
    ...overrides,
  }
}

describe('scoreRoute / RuleDecisionLayer', () => {
  it('cancel explicit → cancel score 1', () => {
    const result = scoreRoute({
      event: steerEvent({ cancelUnitId: 'wu-1' }),
      proposed: 'spawn',
    })
    expect(result).toMatchObject({ action: 'cancel', score: 1 })
  })

  it('queueSteer → queue', () => {
    const result = scoreRoute({
      event: steerEvent({ queueSteer: true }),
      proposed: 'spawn',
    })
    expect(result.action).toBe('queue')
    expect(result.score).toBeGreaterThan(0.9)
  })

  it('short OTHER / ack → absorb (skip expensive spawn)', () => {
    for (const otherText of ['ok', 'yes', '继续', 'go on', 'lgtm']) {
      const result = scoreRoute({
        event: steerEvent({ otherText }),
        proposed: 'spawn',
      })
      expect(result.action, otherText).toBe('absorb')
      expect(result.reason).toMatch(/short OTHER|ack/i)
    }
  })

  it('same deliverable → absorb', () => {
    const result = scoreRoute({
      event: steerEvent({
        mainGoalText: 'write a todo CLI tool for teams',
        // Long enough to skip short-ack, high token overlap with MAIN.
        otherText: 'todo CLI tool for teams please',
      }),
      proposed: 'spawn',
    })
    expect(result.action).toBe('absorb')
    expect(result.reason).toMatch(/same deliverable/i)
  })

  it('independent OTHER → spawn', () => {
    const result = scoreRoute({
      event: steerEvent({
        mainGoalText: 'write a todo CLI',
        otherText: 'packing list please fetch socks',
      }),
      proposed: 'spawn',
    })
    expect(result.action).toBe('spawn')
    expect(result.score).toBeGreaterThan(0.7)
  })

  it('respects classify absorb (fold) — does not upgrade to spawn', () => {
    const result = scoreRoute({
      event: steerEvent({ otherMode: 'fold', otherText: 'packing list please' }),
      proposed: 'absorb',
    })
    expect(result.action).toBe('absorb')
    expect(result.reason).toMatch(/respect classify/)
  })

  it('RuleDecisionLayer matches scoreRoute', () => {
    const layer = new RuleDecisionLayer()
    const input = { event: steerEvent(), proposed: 'spawn' as const }
    expect(layer.decide(input)).toEqual(scoreRoute(input))
  })

  it('PassthroughDecisionLayer keeps proposed', () => {
    const layer = new PassthroughDecisionLayer()
    expect(layer.decide({ event: steerEvent({ otherText: 'ok' }), proposed: 'spawn' }))
      .toMatchObject({ action: 'spawn', reason: 'passthrough', score: 1 })
  })
})

describe('Orchestrator + DecisionLayer wiring', () => {
  it('default RuleDecisionLayer absorbs short OTHER before spawn mutation', () => {
    const orch = new Orchestrator({ defaultOtherMode: 'spawn' })
    const result = orch.admit(steerEvent({ otherText: 'ok', hasSubagentSeam: true }))
    expect(result.action).toBe('absorb')
    expect(result.sibling).toBeFalsy()
    expect(result.decisionReason).toMatch(/short OTHER|ack/i)
    expect(result.decisionScore).toBeGreaterThan(0.5)
    expect(orch.registry.list().filter(u => u.parentId !== null)).toHaveLength(0)
  })

  it('default RuleDecisionLayer still spawns independent OTHER', () => {
    const orch = new Orchestrator({ defaultOtherMode: 'spawn' })
    const result = orch.admit(steerEvent({ hasSubagentSeam: true }))
    expect(result.action).toBe('spawn')
    expect(result.useSubagent).toBe(true)
    expect(result.sibling).toBeTruthy()
    expect(result.decisionReason).toBeTruthy()
  })

  it('PassthroughDecisionLayer opt-out keeps classify spawn for short OTHER', () => {
    const orch = new Orchestrator({
      defaultOtherMode: 'spawn',
      decisionLayer: new PassthroughDecisionLayer(),
    })
    const proposed = classifyAdmit(steerEvent({ otherText: 'ok' }))
    expect(proposed.action).toBe('spawn')
    const result = orch.admit(steerEvent({ otherText: 'ok', hasSubagentSeam: false }))
    expect(result.action).toBe('spawn')
    expect(result.degraded).toBe(true)
    expect(result.decisionReason).toBe('passthrough')
  })

  it('queue via DecisionLayer does not dual-open', () => {
    const orch = new Orchestrator()
    orch.registry.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 1 })
    const result = orch.admit(steerEvent({ queueSteer: true }))
    expect(result.action).toBe('queue')
    expect(result.preempt).toBe(false)
    expect(orch.registry.list().filter(u => u.parentId !== null)).toHaveLength(0)
  })
})
