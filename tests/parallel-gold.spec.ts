/**
 * Slice B gold — parent + child dual Session observability (fake seam).
 * Prefer deterministic vitest over live dsh; see scripts/live-parallel.mjs
 * for optional live smoke (skips without GROKBOT_LIVE_PARALLEL=1).
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
  ActivationManager,
  PEER_HANDOFF_MARKER,
  UNIT_FORK_DEGRADED_MARKER,
  UNIT_FORK_MARKER,
  resolveSubagentsRuntime,
} from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import type { SubagentActivationLike, SubagentsRuntimeLike } from '../src/unit/subagent.ts'

async function harness(adapter: MockAdapter) {
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
    rpwuOtherMode: 'spawn',
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

function installFakeSeam(ctx: Context, childId = 'child-gold-session') {
  let resolveResult!: (v: {
    output: { type: 'text'; text: string }[]
    stopReason: string
    structured?: { theme: string; keyPoints: string[]; todos: string[] }
  }) => void
  const resultPromise = new Promise<{
    output: { type: 'text'; text: string }[]
    stopReason: string
    structured?: { theme: string; keyPoints: string[]; todos: string[] }
  }>((resolve) => {
    resolveResult = resolve
  })
  const activation: SubagentActivationLike = {
    childId,
    messageId: 'msg-gold' as never,
    result: resultPromise,
    dispose: vi.fn(async () => {}),
  }
  const startActivation = vi.fn(async (spec: {
    request: { parent: Agent }
  }) => {
    queueMicrotask(() => {
      resolveResult({
        output: [{ type: 'text', text: 'helper packed socks' }],
        stopReason: 'completed',
        structured: {
          theme: 'packing',
          keyPoints: ['socks', 'charger'],
          todos: [],
        },
      })
    })
    // Dual-Session evidence: child id must differ from parent session id.
    expect(String(spec.request.parent.id)).not.toBe(childId)
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
  return { startActivation, childId }
}

type LoopAgent = Agent & {
  hostActivations: ActivationManager
  events: { history: Array<{ type: string }> }
  workUnits: {
    query: (id: string) => {
      childSessionId: string | null
      activationRef: { childSessionId: string; provider: string } | null
      lane: string
      parentId: string | null
      status: string
    } | undefined
    active: () => {
      id: string
      lastPeerPacket: { theme: string; keyPoints: string[] } | null
      gateRetries: number
      delivery: { chatPosted: boolean }
    } | null
  }
  lastSteerPreempt: {
    otherMode: string | null
    siblingUnitId: string | null
    unitId: string | null
    forkDegraded: boolean | null
    childSessionId: string | null
  } | null
  mergeBus: { registry: unknown }
}

describe('parallel gold — dual Session (fake seam)', () => {
  it('startActivation + activationRef + parent≠child + fold/merge/gate', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('MAIN after helper fold'),
    ])
    const ctx = await harness(adapter)
    const { startActivation, childId } = installFakeSeam(ctx)

    const agent = await ctx.agentLoop.create(SessionId('gold-parallel-parent'), {
      provider: 'mock',
      model: 'mock',
    }) as LoopAgent

    const parentSessionId = String(agent.id)
    expect(parentSessionId).toBe('gold-parallel-parent')

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'write long MAIN CLI' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))
    expect(agent.status).toBe('running')

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'packing list please fetch socks' }],
      source: { kind: 'user' },
    }))

    // Parent keeps flying (true parallel — no cancel-then-claim).
    expect(agent.status).toBe('running')
    expect(agent.lastSteerPreempt?.forkDegraded).toBe(false)
    expect(agent.lastSteerPreempt?.otherMode).toBe('spawn')

    await vi.waitFor(() => {
      expect(startActivation).toHaveBeenCalled()
    })
    const spec = startActivation.mock.calls[0]![0] as {
      request: { parent: Agent; prompt: Array<{ type: string; text?: string }> }
      provider: string
    }
    expect(spec.request.parent).toBe(agent)
    expect(spec.provider).toBe('spawn')

    await vi.waitFor(() => {
      expect(agent.lastSteerPreempt?.childSessionId).toBe(childId)
    })

    const siblingId = agent.lastSteerPreempt!.siblingUnitId!
    const mainId = agent.lastSteerPreempt!.unitId!
    const sib = agent.workUnits.query(siblingId)!
    expect(sib.parentId).toBe(mainId)
    expect(sib.childSessionId).toBe(childId)
    expect(sib.activationRef?.childSessionId).toBe(childId)
    expect(sib.activationRef?.provider).toBe('spawn')
    expect(sib.lane).toBe('background')

    // Dual Session: parent Session id ≠ child Session id
    expect(sib.childSessionId).not.toBe(parentSessionId)

    // ActivationManager start log records the same evidence
    await vi.waitFor(() => {
      expect(agent.hostActivations.starts.length).toBeGreaterThan(0)
    })
    const startRec = agent.hostActivations.starts[0]!
    expect(startRec.childSessionId).toBe(childId)
    expect(startRec.parentId).toBe(parentSessionId)
    expect(startRec.parentId).not.toBe(startRec.childSessionId)
    expect(startRec.unitId).toBe(siblingId)

    // Fold / merge / gate still apply
    await vi.waitFor(() => {
      expect(agent.events.history.some(e => e.type === 'merge')).toBe(true)
    })
    const active = agent.workUnits.active()
    expect(active?.id).toBe(mainId)
    expect(active?.lastPeerPacket?.theme).toBe('packing')
    expect(active?.lastPeerPacket?.keyPoints).toEqual(
      expect.arrayContaining(['socks', 'charger']),
    )

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    const joined = stepTexts.join('\n')
    expect(joined).toContain(PEER_HANDOFF_MARKER)
    expect(joined).toContain(UNIT_FORK_MARKER)
    expect(joined).not.toContain(UNIT_FORK_DEGRADED_MARKER)

    adapter.resolveHang(textResponse('MAIN still writing'))
    await agent.whenIdle()
  })

  it('missing seam → degraded visibly, never throws', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('degraded path'),
    ])
    const ctx = await harness(adapter)
    expect(resolveSubagentsRuntime({
      ctx: ctx as unknown as { subagents?: SubagentsRuntimeLike },
    })).toBeNull()

    const agent = await ctx.agentLoop.create(SessionId('gold-degrade'), {
      provider: 'mock',
      model: 'mock',
    }) as LoopAgent

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'MAIN work' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))

    expect(() => {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: 'packing list please fetch' }],
        source: { kind: 'user' },
      }))
    }).not.toThrow()

    expect(agent.lastSteerPreempt?.forkDegraded).toBe(true)
    expect(agent.lastSteerPreempt?.childSessionId).toBeNull()
    expect(agent.hostActivations.starts).toHaveLength(0)
    expect(agent.hostActivations.available).toBe(false)

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    expect(stepTexts.some(t => t.includes(UNIT_FORK_DEGRADED_MARKER))).toBe(true)

    await agent.whenIdle()
  })
})

describe('ActivationManager unit gold (fake seam, no Cordis loop)', () => {
  it('records parent≠child Session and wait settles', async () => {
    const parent = { id: 'parent-session-am' } as Agent
    const startActivation = vi.fn(async () => ({
      childId: 'child-session-am',
      result: Promise.resolve({
        output: [{ type: 'text' as const, text: 'done' }],
        stopReason: 'completed',
      }),
      dispose: async () => {},
    }))
    const mgr = new ActivationManager({
      ctx: { subagents: { startActivation } },
      parent,
      provider: 'spawn',
    })
    const started = await mgr.start({
      unitId: 'wu-sib',
      promptText: 'independent helper task',
    })
    expect(started.kind).toBe('started')
    expect(mgr.starts).toHaveLength(1)
    expect(mgr.starts[0]!.parentId).toBe('parent-session-am')
    expect(mgr.starts[0]!.childSessionId).toBe('child-session-am')
    expect(mgr.starts[0]!.parentId).not.toBe(mgr.starts[0]!.childSessionId)

    const waited = await mgr.wait('wu-sib')
    expect(waited.kind).toBe('settled')
  })

  it('cancelAll aborts without throw', async () => {
    const parent = { id: 'p' } as Agent
    let abortSeen = false
    const startActivation = vi.fn(async (spec: { signal: AbortSignal }) => {
      spec.signal.addEventListener('abort', () => { abortSeen = true })
      return {
        childId: 'c',
        result: new Promise(() => { /* hang */ }),
        dispose: async () => {},
      }
    })
    const mgr = new ActivationManager({
      ctx: { subagents: { startActivation } },
      parent,
    })
    await mgr.start({ unitId: 'wu-1', promptText: 'x' })
    expect(() => mgr.cancelAll()).not.toThrow()
    expect(abortSeen).toBe(true)
  })
})
