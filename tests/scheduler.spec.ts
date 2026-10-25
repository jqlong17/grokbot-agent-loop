/**
 * Unit tests for the pure dual-lane scheduler.
 * @module tests/scheduler
 */

import { describe, expect, it } from 'vitest'
import {
  agentLaneAllowed,
  cancelThenClaimOrder,
  decideAdmission,
  type SchedulerState,
} from '../src/scheduler.ts'

const idle: SchedulerState = {
  busy: false,
  aborting: false,
  userLanePending: false,
  interruptOnSteer: true,
}

const busy: SchedulerState = {
  busy: true,
  aborting: false,
  userLanePending: false,
  interruptOnSteer: true,
}

const aborting: SchedulerState = {
  busy: false,
  aborting: true,
  userLanePending: false,
  interruptOnSteer: true,
}

describe('decideAdmission', () => {
  it('gives user-lane steer highest priority with preempt while busy', () => {
    const decision = decideAdmission('steer', busy)
    expect(decision).toEqual({
      lane: 'user',
      target: 'next-step',
      preempt: true,
      wakeup: true,
      claimAfterCancel: true,
    })
  })

  it('does not preempt idle steer; still claims next-step', () => {
    const decision = decideAdmission('steer', idle)
    expect(decision.preempt).toBe(false)
    expect(decision.target).toBe('next-step')
    expect(decision.lane).toBe('user')
    expect(decision.claimAfterCancel).toBe(true)
  })

  it('keeps claimAfterCancel while aborting so steer is not remapped to Queue', () => {
    const decision = decideAdmission('steer', aborting)
    expect(decision.preempt).toBe(false)
    expect(decision.target).toBe('next-step')
    expect(decision.claimAfterCancel).toBe(true)
  })

  it('disables preempt when interruptOnSteer is false (stock-like)', () => {
    const decision = decideAdmission('steer', { ...busy, interruptOnSteer: false })
    expect(decision.preempt).toBe(false)
    expect(decision.claimAfterCancel).toBe(false)
    expect(decision.target).toBe('next-step')
  })

  it('parks followup on next-turn without preempt (Cmd/Ctrl+Enter Queue)', () => {
    const decision = decideAdmission('followup', busy)
    expect(decision).toEqual({
      lane: 'user',
      target: 'next-turn',
      preempt: false,
      wakeup: true,
      claimAfterCancel: false,
    })
  })

  it('keeps agent-lane inject silent and non-preempting', () => {
    for (const kind of ['inject', 'tool-continue'] as const) {
      const decision = decideAdmission(kind, busy)
      expect(decision.lane).toBe('agent')
      expect(decision.target).toBe('next-step')
      expect(decision.preempt).toBe(false)
      expect(decision.wakeup).toBe(false)
    }
  })

  it('handles empty-lane idle followup', () => {
    const decision = decideAdmission('followup', idle)
    expect(decision.target).toBe('next-turn')
    expect(decision.preempt).toBe(false)
    expect(decision.wakeup).toBe(true)
  })
})

describe('agentLaneAllowed', () => {
  it('allows agent lane only when user lane is empty', () => {
    expect(agentLaneAllowed({ userLanePending: false })).toBe(true)
    expect(agentLaneAllowed({ userLanePending: true })).toBe(false)
  })
})

describe('cancelThenClaimOrder', () => {
  it('documents cancel-then-claim ordering for preempting steer', () => {
    expect(cancelThenClaimOrder()).toEqual([
      'cooperative-cancel',
      'enqueue-next-step',
      'latch-wake',
    ])
  })
})
