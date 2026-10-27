/**
 * RPWU P1.5 — mocked ctx.subagents: startActivation + fold-back + degrade path.
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
  PEER_HANDOFF_MARKER,
  UNIT_FORK_DEGRADED_MARKER,
  UNIT_FORK_MARKER,
  peerPacketFromSubagentResult,
  resolveSubagentsRuntime,
  startWorkUnitSubagent,
} from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import type { SubagentActivationLike, SubagentsRuntimeLike } from '../src/work-unit-subagent.ts'

async function harness(adapter: MockAdapter, config: {
  rpwuOtherMode?: 'fold' | 'fork' | 'subagent'
  rpwuSubagentProvider?: string
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
    rpwuOtherMode: config.rpwuOtherMode ?? 'fork',
    rpwuSubagentProvider: config.rpwuSubagentProvider ?? 'spawn',
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

function installMockSubagents(
  ctx: Context,
  opts: {
    childId?: string
    resultText?: string
    rejectStart?: Error
    delayMs?: number
  } = {},
): {
  startActivation: ReturnType<typeof vi.fn>
  activation: SubagentActivationLike
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
    childId: opts.childId ?? 'child-session-1',
    messageId: 'msg-1' as never,
    result: resultPromise,
    dispose: vi.fn(async () => {}),
  }
  const startActivation = vi.fn(async () => {
    if (opts.rejectStart) throw opts.rejectStart
    if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
    queueMicrotask(() => {
      resolveResult({
        output: [{ type: 'text', text: opts.resultText ?? 'packed: socks, charger' }],
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
  // Cordis resolve path prefers ctx.get('subagents').
  const originalGet = ctx.get.bind(ctx)
  ctx.get = ((name: string, strict?: boolean) => {
    if (name === 'subagents') return runtime
    return originalGet(name, strict)
  }) as typeof ctx.get
  return { startActivation, activation }
}

describe('work-unit-subagent helpers', () => {
  it('resolveSubagentsRuntime returns null when seam missing', () => {
    expect(resolveSubagentsRuntime({ ctx: {} })).toBeNull()
    expect(resolveSubagentsRuntime({ ctx: { subagents: {} as never } })).toBeNull()
  })

  it('peerPacketFromSubagentResult maps text output', () => {
    const packet = peerPacketFromSubagentResult(
      { output: [{ type: 'text', text: 'alpha\nbeta' }], stopReason: 'completed' },
      'packing list',
    )
    expect(packet.theme).toContain('packing')
    expect(packet.keyPoints.length).toBeGreaterThan(0)
    expect(packet.summary).toContain('alpha')
  })

  it('startWorkUnitSubagent forwards provider/prompt/parent', async () => {
    const startActivation = vi.fn(async () => ({
      childId: 'c1',
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: async () => {},
    }))
    const parent = { id: 'parent-1' } as Agent
    const started = await startWorkUnitSubagent({
      subagents: { startActivation },
      parent,
      promptText: 'do OTHER',
      provider: 'spawn',
      delivery: 'caller',
    })
    expect(startActivation).toHaveBeenCalledOnce()
    const spec = startActivation.mock.calls[0]![0]
    expect(spec.provider).toBe('spawn')
    expect(spec.delivery).toBe('caller')
    expect(spec.request.parent).toBe(parent)
    expect(spec.request.prompt[0]).toMatchObject({ type: 'text', text: 'do OTHER' })
    expect(started.activationRef.childSessionId).toBe('c1')
  })
})

describe('RPWU P1.5 subagent-backed fork', () => {
  it('calls startActivation and folds child result into MAIN', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('MAIN continues after child fold'),
    ])
    const ctx = await harness(adapter, { rpwuOtherMode: 'subagent' })
    const { startActivation } = installMockSubagents(ctx, {
      childId: 'child-pack-1',
      resultText: 'packing: passport, meds',
    })

    const agent = await ctx.agentLoop.create(SessionId('p15-parallel'), {
      provider: 'mock',
      model: 'mock',
    })

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'write long todo CLI' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))
    expect(agent.status).toBe('running')

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'packing list please' }],
      source: { kind: 'user' },
    }))

    // True parallel: parent was NOT cancelled for OTHER claim.
    expect(agent.status).toBe('running')

    const loopAgent = agent as typeof agent & {
      workUnits: {
        list: () => Array<{
          id: string
          parentId: string | null
          lane: string
          childSessionId: string | null
          status: string
        }>
        query: (id: string) => {
          childSessionId: string | null
          lane: string
          parentId: string | null
        } | undefined
        siblingsOf: (id: string) => Array<{ id: string; childSessionId: string | null }>
        active: () => { id: string; lastPeerPacket: { theme: string } | null; foldedOtherSummaries: string[] } | null
      }
      lastSteerPreempt: {
        otherMode: 'fold' | 'fork' | 'spawn' | null
        siblingUnitId: string | null
        forkDegraded: boolean | null
        childSessionId: string | null
        unitId: string | null
      } | null
    }

    expect(loopAgent.lastSteerPreempt?.otherMode).toBe('spawn')
    expect(loopAgent.lastSteerPreempt?.forkDegraded).toBe(false)
    expect(loopAgent.lastSteerPreempt?.siblingUnitId).toBeTruthy()

    // startActivation eventually called
    await vi.waitFor(() => {
      expect(startActivation).toHaveBeenCalled()
    })
    const spec = startActivation.mock.calls[0]![0]
    expect(spec.provider).toBe('spawn')
    expect(spec.request.parent).toBe(agent)
    expect(spec.request.prompt[0]).toMatchObject({
      type: 'text',
      text: 'packing list please',
    })

    await vi.waitFor(() => {
      expect(loopAgent.lastSteerPreempt?.childSessionId).toBe('child-pack-1')
    })

    const mainId = loopAgent.lastSteerPreempt!.unitId!
    const siblingId = loopAgent.lastSteerPreempt!.siblingUnitId!
    const sibQ = loopAgent.workUnits.query(siblingId)!
    expect(sibQ.parentId).toBe(mainId)
    expect(sibQ.childSessionId).toBe('child-pack-1')
    expect(sibQ.lane).toBe('background')

    // Fold-back after child result
    await vi.waitFor(() => {
      const active = loopAgent.workUnits.active()
      expect(active?.id).toBe(mainId)
      expect(active?.lastPeerPacket?.theme).toBeTruthy()
      expect(active?.foldedOtherSummaries.length).toBeGreaterThan(0)
    })

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    const joined = stepTexts.join('\n')
    expect(joined).toContain(PEER_HANDOFF_MARKER)
    expect(joined).not.toContain(UNIT_FORK_DEGRADED_MARKER)

    // Hang was still live at steer; finish it so the driver can drain.
    adapter.resolveHang(textResponse('MAIN still writing CLI'))
    await agent.whenIdle()
  })

  it('degrades without crash when ctx.subagents is missing', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('degraded single-agent reply'),
    ])
    const ctx = await harness(adapter, { rpwuOtherMode: 'fork' })
    // No subagents installed on ctx.
    expect(resolveSubagentsRuntime({
      ctx: ctx as unknown as { subagents?: SubagentsRuntimeLike },
    })).toBeNull()

    const agent = await ctx.agentLoop.create(SessionId('p15-degrade'), {
      provider: 'mock',
      model: 'mock',
    })

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'write long todo CLI' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'packing list please' }],
      source: { kind: 'user' },
    }))

    const loopAgent = agent as typeof agent & {
      lastSteerPreempt: {
        otherMode: 'fold' | 'fork' | 'spawn' | null
        forkDegraded: boolean | null
        siblingUnitId: string | null
        childSessionId: string | null
      } | null
      workUnits: {
        query: (id: string) => { childSessionId: string | null } | undefined
      }
    }

    expect(loopAgent.lastSteerPreempt?.otherMode).toBe('spawn')
    expect(loopAgent.lastSteerPreempt?.forkDegraded).toBe(true)
    expect(loopAgent.lastSteerPreempt?.childSessionId).toBeNull()
    expect(loopAgent.workUnits.query(loopAgent.lastSteerPreempt!.siblingUnitId!)?.childSessionId).toBeNull()

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    expect(stepTexts.some(t => t.includes(UNIT_FORK_DEGRADED_MARKER))).toBe(true)
    expect(stepTexts.some(t => t.includes(UNIT_FORK_MARKER))).toBe(false)

    await agent.whenIdle()
  })

  it('default fold path does not call startActivation even when seam exists', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('fold reply'),
    ])
    const ctx = await harness(adapter, { rpwuOtherMode: 'fold' })
    const { startActivation } = installMockSubagents(ctx)

    const agent = await ctx.agentLoop.create(SessionId('p15-fold'), {
      provider: 'mock',
      model: 'mock',
    })
    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'MAIN task' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'OTHER interrupt' }],
      source: { kind: 'user' },
    }))

    await agent.whenIdle()
    expect(startActivation).not.toHaveBeenCalled()
  })
})
