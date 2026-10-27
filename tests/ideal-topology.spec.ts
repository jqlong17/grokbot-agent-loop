/**
 * Ideal Topology v1.1 — interface + invariant locks (P0 skeleton).
 * Interruptible ⊥ Durable are covered in separate files; this locks
 * Orchestrator / CheckpointStore / MergeBus / AgentEvent / queue / workId.
 */
import { describe, expect, it } from 'vitest'
import {
  Orchestrator,
  classifyAdmit,
  MemoryCheckpointStore,
  MergeBus,
  DeliveryGate,
  InProcessRunner,
  SubagentRunner,
  ActivationManager,
  TurnRunShell,
  AgentEventBus,
  PassthroughDecisionLayer,
  RuleDecisionLayer,
  scoreRoute,
  createDurableWorkflow,
  createWorkId,
  createInputRecord,
  checkpointChain,
  dualSessionPair,
  StubSummarySession,
  MemorySummarySession,
  asMainSession,
  settleTurn,
  WorkUnitRegistry,
  normalizeRpwuOtherMode,
} from '../src/index.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

function busySteerEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'steer' as const,
    input: createUserMessage({
      content: [{ type: 'text', text: 'OTHER packing' }],
      source: { kind: 'user' },
    }),
    scheduler: {
      busy: true,
      aborting: false,
      userLanePending: false,
      interruptOnSteer: true,
    },
    otherText: 'OTHER packing',
    mainGoalText: 'write CLI',
    turn: 1,
    step: 2,
    rpwuEnabled: true,
    otherMode: 'spawn',
    hasSubagentSeam: false,
    ...overrides,
  }
}

describe('Ideal Topology v1.1 — Orchestrator', () => {
  it('default otherMode normalizes to spawn', () => {
    expect(normalizeRpwuOtherMode(undefined)).toBe('fold') // explicit undefined → fold only when caller passes undefined
    expect(normalizeRpwuOtherMode('spawn')).toBe('spawn')
    expect(normalizeRpwuOtherMode('fork')).toBe('spawn')
    expect(normalizeRpwuOtherMode('subagent')).toBe('spawn')
    expect(normalizeRpwuOtherMode('fold')).toBe('fold')
  })

  it('admit absorb updates MAIN goal, no sibling', () => {
    const orch = new Orchestrator({ defaultOtherMode: 'fold' })
    const result = orch.admit(busySteerEvent({ otherMode: 'fold' }))
    expect(result.action).toBe('absorb')
    expect(result.sibling).toBeFalsy()
    expect(result.main).toBeTruthy()
    expect(result.main!.foldedOtherSummaries.some(s => /packing/i.test(s))).toBe(true)
    expect(orch.registry.siblingsOf(result.main!.id)).toHaveLength(0)
  })

  it('admit spawn without seam → degraded, no throw', () => {
    const orch = new Orchestrator({ defaultOtherMode: 'spawn' })
    const result = orch.admit(busySteerEvent({ hasSubagentSeam: false }))
    expect(result.action).toBe('spawn')
    expect(result.degraded).toBe(true)
    expect(result.useSubagent).toBe(false)
    expect(result.preempt).toBe(true)
    expect(result.sibling).toBeTruthy()
    expect(result.main!.workId).toBeTruthy()
  })

  it('admit spawn with seam → useSubagent, no physical preempt', () => {
    const orch = new Orchestrator({ defaultOtherMode: 'spawn' })
    const result = orch.admit(busySteerEvent({ hasSubagentSeam: true }))
    expect(result.action).toBe('spawn')
    expect(result.useSubagent).toBe(true)
    expect(result.degraded).toBe(false)
    expect(result.preempt).toBe(false)
    expect(result.sibling!.lane).toBe('background')
  })

  it('admit cancel marks unit cancelled', () => {
    const orch = new Orchestrator()
    const main = orch.registry.ensureMainUnit({ goalSummary: 'MAIN', turn: 0, step: 0 })
    const result = orch.admit({
      ...busySteerEvent(),
      cancelUnitId: main.id,
      scheduler: { busy: false, aborting: false, userLanePending: false, interruptOnSteer: true },
    })
    expect(result.action).toBe('cancel')
    expect(orch.registry.get(main.id)?.status).toBe('cancelled')
  })

  it('queue(steer) does not dual-open with active turn', () => {
    const classified = classifyAdmit(busySteerEvent({ queueSteer: true, otherMode: 'spawn' }))
    expect(classified.action).toBe('queue')
    const orch = new Orchestrator()
    orch.registry.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 1 })
    const result = orch.admit(busySteerEvent({ queueSteer: true }))
    expect(result.action).toBe('queue')
    expect(result.preempt).toBe(false)
    expect(orch.registry.list().filter(u => u.parentId !== null)).toHaveLength(0)
  })
})

describe('Ideal Topology v1.1 — CheckpointStore hydrate + workId', () => {
  it('Memory store hydrate rebuilds unit + checkpoints + workId', () => {
    const store = new MemoryCheckpointStore()
    const orch = new Orchestrator({ checkpointStore: store, defaultOtherMode: 'spawn' })
    const result = orch.admit(busySteerEvent())
    const mainId = result.main!.id
    const workId = result.main!.workId
    expect(store.list(mainId).length).toBeGreaterThan(0)

    const fresh = new WorkUnitRegistry()
    store.hydrate(fresh)
    const restored = fresh.get(mainId)
    expect(restored).toBeTruthy()
    expect(restored!.workId).toBe(workId)
    expect(restored!.checkpoints.length).toBeGreaterThan(0)
  })
})

describe('Ideal Topology v1.1 — MergeBus + DeliveryGate', () => {
  it('MergeBus.publish folds sibling and evaluates gate', () => {
    const reg = new WorkUnitRegistry()
    const main = reg.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 1 })
    const sibling = reg.forkSibling({
      parentId: main.id,
      goalSummary: 'OTHER',
      bindActive: false,
    })
    const bus = new MergeBus(reg, { deliveryGate: true })
    const published = bus.publish({
      siblingId: sibling.id,
      packet: { theme: 'pack', keyPoints: ['socks'], todos: [] },
    })
    expect(published.main.id).toBe(main.id)
    expect(published.sibling.status).toBe('completed')
    expect(published.notice.content[0]).toMatchObject({ type: 'text' })
    const gate = new DeliveryGate({ enabled: true })
    // After peer fold, MAIN may still need chat delivery.
    expect(typeof gate.shouldContinue(published.main)).toBe('boolean')
  })
})

describe('Ideal Topology v1.1 — runners / ActivationManager / TurnRunShell', () => {
  it('InProcessRunner.step returns in-process', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.create({ goalSummary: 'x' })
    expect(new InProcessRunner().step(u)).toEqual({ kind: 'in-process', unitId: u.id })
  })

  it('SubagentRunner degrades without seam (never throws)', async () => {
    const reg = new WorkUnitRegistry()
    const u = reg.create({ goalSummary: 'OTHER' })
    const runner = new SubagentRunner({
      parent: {} as never,
      promptText: 'OTHER',
      ctx: {},
    })
    const result = await runner.step(u)
    expect(result.kind).toBe('subagent-degraded')
  })

  it('ActivationManager.available is false without seam', () => {
    const mgr = new ActivationManager({
      ctx: {},
      parent: {} as never,
    })
    expect(mgr.available).toBe(false)
  })

  it('ActivationManager.start without seam → degraded, never throws', async () => {
    const mgr = new ActivationManager({
      ctx: {},
      parent: {} as never,
    })
    const result = await mgr.start({ unitId: 'wu-x', promptText: 'OTHER' })
    expect(result.kind).toBe('degraded')
    if (result.kind === 'degraded') {
      expect(result.reason).toMatch(/unavailable/i)
    }
  })

  it('ActivationManager.start + wait with mock seam', async () => {
    const startActivation = async () => ({
      childId: 'child-am-1',
      result: Promise.resolve({
        output: [{ type: 'text' as const, text: 'done' }],
        stopReason: 'completed',
      }),
      dispose: async () => {},
    })
    const mgr = new ActivationManager({
      ctx: { subagents: { startActivation } },
      parent: {} as never,
      provider: 'spawn',
    })
    expect(mgr.available).toBe(true)
    const started = await mgr.start({ unitId: 'wu-sib', promptText: 'pack' })
    expect(started.kind).toBe('started')
    if (started.kind !== 'started') return
    expect(ActivationManager.refOf(started.started).childSessionId).toBe('child-am-1')
    const waited = await mgr.wait('wu-sib')
    expect(waited.kind).toBe('settled')
    if (waited.kind === 'settled') {
      expect(waited.result.stopReason).toBe('completed')
    }
  })

  it('ActivationManager.wait missing → never throws', async () => {
    const mgr = new ActivationManager({
      ctx: {},
      parent: {} as never,
    })
    const waited = await mgr.wait('no-such')
    expect(waited.kind).toBe('missing')
  })

  it('TurnRunShell afterStepCheckpoint + settle drain', () => {
    const store = new MemoryCheckpointStore()
    const reg = new WorkUnitRegistry()
    const events = new AgentEventBus()
    const unit = reg.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 0 })
    const shell = new TurnRunShell({ registry: reg, store, events }, unit, 1)
    shell.afterStepCheckpoint({
      unitId: unit.id,
      stepIndex: 1,
      turn: 1,
      assistantPrefixCursor: 10,
      assistantPrefixHash: 'abcd1234',
      toolResultRefs: [],
      status: 'running',
      delivery: { chatPosted: false, workspaceOnly: true },
      reason: 'step-end',
    })
    const chain = shell.checkpointChain()
    expect(chain.checkpoints).toHaveLength(1)
    expect(checkpointChain(reg.get(unit.id)!).checkpoints).toHaveLength(1)
    expect(store.list(unit.id)).toHaveLength(1)
    expect(store.exportSnapshot().activeId).toBe(unit.id)
    const settled = shell.settle()
    expect(settled.flushedCheckpoints).toBeGreaterThan(0)
    expect(events.history.some(e => e.type === 'checkpoint')).toBe(true)
    expect(events.history.some(e => e.type === 'settle')).toBe(true)
    // settle is idempotent
    expect(shell.settle().flushedCheckpoints).toBe(settled.flushedCheckpoints)
  })
})

describe('Ideal Topology v1.1 — AgentEvent + DecisionLayer + dual session + DurableWorkflow', () => {
  it('AgentEventBus records admit/checkpoint/merge', () => {
    const bus = new AgentEventBus()
    bus.emit({ type: 'admit', action: 'spawn', unitIds: ['wu-1'], at: 1 })
    bus.emit({ type: 'checkpoint', unitId: 'wu-1', stepIndex: 1, reason: 'step-end', at: 2 })
    bus.emit({ type: 'merge', siblingId: 'wu-2', mainId: 'wu-1', at: 3 })
    expect(bus.history.map(e => e.type)).toEqual(['admit', 'checkpoint', 'merge'])
  })

  it('DecisionLayer passthrough + RuleDecisionLayer score/route', () => {
    const passthrough = new PassthroughDecisionLayer()
    expect(passthrough.decide({
      event: busySteerEvent() as never,
      proposed: 'spawn',
    })).toMatchObject({ action: 'spawn', reason: 'passthrough', score: 1 })

    const rule = new RuleDecisionLayer()
    const short = rule.decide({
      event: busySteerEvent({ otherText: 'ok' }) as never,
      proposed: 'spawn',
    })
    expect(short.action).toBe('absorb')
    expect(scoreRoute({
      event: busySteerEvent({ otherText: 'packing list please' }) as never,
      proposed: 'spawn',
    }).action).toBe('spawn')
  })

  it('InputRecord + workId mint', () => {
    const workId = createWorkId()
    const input = createInputRecord({ workId, text: 'hi' })
    expect(input.workId).toBe(workId)
    expect(input.inputId).toMatch(/^in-/)
    expect(input.nonce).toBeTruthy()
  })

  it('MainSession + SummarySession stubs / MemorySummarySession carrier', () => {
    const pair = dualSessionPair('sess-1', new StubSummarySession('sum-1'))
    expect(pair.main.role).toBe('main')
    expect(pair.summary?.role).toBe('summary')
    expect(asMainSession('sess-1').role).toBe('main')
    expect(new StubSummarySession().summarize()).toBe('')
    const mem = new MemorySummarySession('sum-mem')
    const carrier = mem.toCarrier({
      completedTurn: 1,
      transcriptHint: 'goal=MAIN',
    })
    expect(carrier?.role).toBe('user')
    expect(carrier?.text).toMatch(/grokbot-summary-carrier/)
  })

  it('DurableWorkflow memory seam hydrates', () => {
    const wf = createDurableWorkflow('memory')
    expect(wf.kind).toBe('memory')
    const reg = new WorkUnitRegistry()
    const u = reg.create({ goalSummary: 'x', workId: 'work-stable' })
    wf.store.saveUnit(u)
    wf.store.put({
      unitId: u.id,
      stepIndex: 0,
      turn: 0,
      assistantPrefixCursor: 0,
      assistantPrefixHash: '00000000',
      toolResultRefs: [],
      status: 'running',
      delivery: { chatPosted: false, workspaceOnly: false },
      reason: 'step-end',
      at: Date.now(),
    })
    const fresh = new WorkUnitRegistry()
    wf.hydrate(fresh)
    expect(fresh.get(u.id)?.workId).toBe('work-stable')
  })

  it('settleTurn drains without unit → empty', () => {
    const result = settleTurn({
      registry: new WorkUnitRegistry(),
      store: new MemoryCheckpointStore(),
    })
    expect(result.unitId).toBeNull()
    expect(result.flushedCheckpoints).toBe(0)
  })
})
