/**
 * Durable axis ONLY — Ideal Topology v1.1 §1.4 / §6.
 * Completed step checkpoints must survive preempt / hydrate.
 * Do NOT assert interrupt/preempt behavior here (see interruptible.spec.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  MemoryCheckpointStore,
  Orchestrator,
  WorkUnitRegistry,
  completedStepsSurvivedPreempt,
  isCompletedStepCheckpoint,
} from '../src/index.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

describe('Durable invariant (⊥ interruptible)', () => {
  it('completed step-end checkpoints survive preempt in registry + store', () => {
    const store = new MemoryCheckpointStore()
    const orch = new Orchestrator({ checkpointStore: store, defaultOtherMode: 'fold' })
    const main = orch.registry.ensureMainUnit({
      goalSummary: 'long CLI',
      turn: 1,
      step: 1,
    })
    const completed = orch.recordCheckpoint({
      unitId: main.id,
      stepIndex: 1,
      turn: 1,
      assistantPrefixCursor: 100,
      assistantPrefixHash: 'deadbeef',
      toolResultRefs: [{ id: 'tc-1' }],
      status: 'running',
      delivery: { chatPosted: false, workspaceOnly: true },
      reason: 'step-end',
    })
    expect(isCompletedStepCheckpoint(completed)).toBe(true)
    const before = [...main.checkpoints]

    orch.admit({
      kind: 'steer',
      input: createUserMessage({
        content: [{ type: 'text', text: 'OTHER' }],
        source: { kind: 'user' },
      }),
      scheduler: {
        busy: true,
        aborting: false,
        userLanePending: false,
        interruptOnSteer: true,
      },
      otherMode: 'fold',
      otherText: 'OTHER',
      mainGoalText: 'long CLI',
      turn: 1,
      step: 2,
      rpwuEnabled: true,
      assistantPrefixCursor: 100,
      assistantPrefixHash: 'deadbeef',
    })

    const afterUnit = orch.registry.get(main.id)!
    expect(completedStepsSurvivedPreempt(before, afterUnit.checkpoints)).toBe(true)
    expect(store.list(main.id).some(cp =>
      cp.reason === 'step-end' && cp.assistantPrefixHash === 'deadbeef',
    )).toBe(true)
  })

  it('hydrate restores completed checkpoints after process-local rebuild', () => {
    const store = new MemoryCheckpointStore()
    const orch = new Orchestrator({ checkpointStore: store })
    const main = orch.registry.ensureMainUnit({ goalSummary: 'MAIN', turn: 0, step: 0 })
    orch.recordCheckpoint({
      unitId: main.id,
      stepIndex: 0,
      turn: 0,
      assistantPrefixCursor: 5,
      assistantPrefixHash: 'cafebabe',
      toolResultRefs: [],
      status: 'running',
      delivery: { chatPosted: true, workspaceOnly: false },
      reason: 'step-end',
    })

    const fresh = new WorkUnitRegistry()
    store.hydrate(fresh)
    const restored = fresh.get(main.id)!
    expect(restored.checkpoints.filter(isCompletedStepCheckpoint)).toHaveLength(1)
    expect(restored.workId).toBe(main.workId)
  })
})
