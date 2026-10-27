/**
 * 0.2.1 main-path lock — TurnRunShell + ActivationManager are the live path.
 * Agent is Cordis glue; Orchestrator.admit remains the only routing brain.
 * Interruptible ⊥ Durable stay in their own files.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop, {
  TurnRunShell,
  ActivationManager,
  UNIT_FORK_MARKER,
  PEER_HANDOFF_MARKER,
} from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import type { SubagentActivationLike, SubagentsRuntimeLike } from '../src/unit/subagent.ts'

async function harness(adapter: MockAdapter, config: {
  rpwuOtherMode?: 'fold' | 'fork' | 'spawn' | 'subagent'
} = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, {
    agents: [],
    interruptOnSteer: true,
    steerFoldHint: true,
    rpwuEnabled: true,
    rpwuOtherMode: config.rpwuOtherMode ?? 'spawn',
    deliveryGate: true,
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitUntilRunning(ctx: Context, agent: Agent): Promise<void> {
  if (agent.status === 'running') return Promise.resolve()
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'running') {
        dispose()
        resolve()
      }
    })
  })
}

function installMockSubagents(ctx: Context): {
  startActivation: ReturnType<typeof vi.fn>
} {
  let resolveResult!: (v: {
    output: { type: 'text'; text: string }[]
    stopReason: string
  }) => void
  const resultPromise = new Promise<{
    output: { type: 'text'; text: string }[]
    stopReason: string
  }>((resolve) => {
    resolveResult = resolve
  })
  const activation: SubagentActivationLike = {
    childId: 'child-main-path-1',
    messageId: 'msg-1' as never,
    result: resultPromise,
    dispose: vi.fn(async () => {}),
  }
  const startActivation = vi.fn(async () => {
    queueMicrotask(() => {
      resolveResult({
        output: [{ type: 'text', text: 'helper done: socks' }],
        stopReason: 'completed',
      })
    })
    return activation
  })
  const runtime: SubagentsRuntimeLike = { startActivation }
  Object.defineProperty(ctx, 'subagents', {
    value: runtime,
    configurable: true,
    writable: true,
  })
  const originalGet = ctx.get.bind(ctx)
  ctx.get = ((name: string, strict?: boolean) => {
    if (name === 'subagents') return runtime
    return originalGet(name, strict)
  }) as typeof ctx.get
  return { startActivation }
}

type LoopAgent = Agent & {
  events: { history: Array<{ type: string }> }
  lastCheckpoint: { reason: string; unitId: string } | null
  lastSettledShell: TurnRunShell | null
  workUnits: {
    active: () => { id: string; checkpoints: unknown[] } | null
    list: () => Array<{ id: string; parentId: string | null }>
  }
  lastSteerPreempt: {
    otherMode: string | null
    siblingUnitId: string | null
    forkDegraded: boolean | null
    childSessionId: string | null
    unitId: string | null
  } | null
  checkpointStore: { list: (id: string) => unknown[] }
}

describe('0.2.1 main path — TurnRunShell + ActivationManager', () => {
  it('completed turn settles via TurnRunShell (checkpointChain + settle event)', async () => {
    const adapter = new MockAdapter([
      textResponse('hello from MAIN'),
    ])
    const ctx = await harness(adapter, { rpwuOtherMode: 'fold' })
    const agent = await ctx.agentLoop.create(SessionId('main-path-shell'), {
      provider: 'mock',
      model: 'mock',
    }) as LoopAgent

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'say hello' }],
      source: { kind: 'user' },
    }))
    await running
    await vi.waitFor(() => {
      expect(agent.status).toBe('idle')
    })

    expect(agent.lastCheckpoint?.reason).toBe('step-end')
    expect(agent.lastSettledShell).toBeInstanceOf(TurnRunShell)
    const shell = agent.lastSettledShell!
    expect(shell.checkpointChain().checkpoints.length).toBeGreaterThan(0)
    expect(agent.events.history.some(e => e.type === 'checkpoint')).toBe(true)
    expect(agent.events.history.some(e => e.type === 'settle')).toBe(true)
    const unitId = agent.lastCheckpoint!.unitId
    expect(agent.checkpointStore.list(unitId).length).toBeGreaterThan(0)
  })

  it('spawn with seam goes through ActivationManager (startActivation + fold)', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('MAIN after helper'),
    ])
    const ctx = await harness(adapter, { rpwuOtherMode: 'spawn' })
    const { startActivation } = installMockSubagents(ctx)

    const agent = await ctx.agentLoop.create(SessionId('main-path-am'), {
      provider: 'mock',
      model: 'mock',
    }) as LoopAgent

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'long MAIN work' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'quick OTHER pack' }],
      source: { kind: 'user' },
    }))

    expect(agent.status).toBe('running')
    expect(agent.lastSteerPreempt?.otherMode).toBe('spawn')
    expect(agent.lastSteerPreempt?.forkDegraded).toBe(false)

    await vi.waitFor(() => {
      expect(startActivation).toHaveBeenCalled()
    })
    expect(agent.events.history.some(e => e.type === 'admit')).toBe(true)
    expect(agent.events.history.some(e => e.type === 'spawn')).toBe(true)

    await vi.waitFor(() => {
      expect(agent.lastSteerPreempt?.childSessionId).toBe('child-main-path-1')
    })

    await vi.waitFor(() => {
      expect(agent.events.history.some(e => e.type === 'merge')).toBe(true)
    })

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    expect(stepTexts.some(t => t.includes(UNIT_FORK_MARKER) || t.includes(PEER_HANDOFF_MARKER))).toBe(true)
    // Settle after fold also goes through TurnRunShell
    expect(agent.lastSettledShell).toBeInstanceOf(TurnRunShell)
  })

  it('ActivationManager degrades without seam (Orchestrator still owns routing)', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('after degrade'),
    ])
    // No mock subagents → seam missing
    const ctx = await harness(adapter, { rpwuOtherMode: 'spawn' })
    const agent = await ctx.agentLoop.create(SessionId('main-path-degrade'), {
      provider: 'mock',
      model: 'mock',
    }) as LoopAgent

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'MAIN' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))

    agent.steer(createUserMessage({
      // Independent OTHER so DecisionLayer keeps spawn (not short-ack absorb).
      content: [{ type: 'text', text: 'packing list please fetch socks' }],
      source: { kind: 'user' },
    }))

    expect(agent.lastSteerPreempt?.otherMode).toBe('spawn')
    expect(agent.lastSteerPreempt?.forkDegraded).toBe(true)
    expect(agent.lastSteerPreempt?.siblingUnitId).toBeTruthy()
    expect(agent.events.history.some(e => e.type === 'admit')).toBe(true)
    expect(agent.events.history.some(e =>
      e.type === 'spawn',
    )).toBe(true)
    // Direct unit construction of ActivationManager still degrades cleanly
    const mgr = new ActivationManager({ ctx: {}, parent: agent })
    expect(mgr.available).toBe(false)
    const start = await mgr.start({ unitId: 'x', promptText: 'y' })
    expect(start.kind).toBe('degraded')
  })
})
