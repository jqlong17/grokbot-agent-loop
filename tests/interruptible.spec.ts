/**
 * Integration / contract tests for interruptible busy-steer behavior.
 * Mounts this package as the AgentFactory the same way stock loop tests do.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop, { STEER_FOLD_HINT_MARKER } from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, config: {
  interruptOnSteer?: boolean
  steerFoldHint?: boolean
  steerFoldMode?: 'bot-like' | 'minimal'
  steerResumeAnchor?: boolean
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
    interruptOnSteer: config.interruptOnSteer ?? true,
    steerFoldHint: config.steerFoldHint ?? true,
    steerFoldMode: config.steerFoldMode ?? 'bot-like',
    steerResumeAnchor: config.steerResumeAnchor ?? true,
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

function userTexts(agent: Agent): string[] {
  return agent.session.snapshotEvents()
    .filter(e => e.type === 'user/message')
    .flatMap(e => e.type === 'user/message' ? e.data.content : [])
    .flatMap(b => b.type === 'text' ? [b.text] : [])
}

function assistantTexts(agent: Agent): string[] {
  return agent.session.snapshotEvents()
    .filter(e => e.type === 'assistant/message')
    .flatMap(e => e.type === 'assistant/message' ? e.data.message.content : [])
    .flatMap(b => b.type === 'text' ? [b.text] : [])
}

describe('GrokBot interruptible loop', () => {
  it('preempts mid-stream steer: cancels, keeps streamed prefix, claims on next step (not Queue)', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('reply after interrupt'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('interrupt-steer'), {
      provider: 'mock',
      model: 'mock',
    })

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'start long reply' }],
      source: { kind: 'user' },
    }))
    await running
    // Let the hang stream emit its prefix.
    await new Promise(r => setTimeout(r, 20))
    expect(agent.status).toBe('running')

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'interrupt please' }],
      source: { kind: 'user' },
    }))

    // Must not park the interrupt on next-turn Queue.
    expect(agent.inbox.nextTurn.some(m =>
      m.content.some(b => b.type === 'text' && b.text === 'interrupt please'),
    )).toBe(false)
    expect(agent.inbox.nextStep.some(m =>
      m.content.some(b => b.type === 'text' && b.text === 'interrupt please'),
    )).toBe(true)

    // whenIdle follows the aborted driver and the replacement turn it latches.
    await agent.whenIdle()

    const texts = userTexts(agent)
    expect(texts).toContain('start long reply')
    expect(texts).toContain('interrupt please')

    // Streamed prefix survived cooperative cancel.
    const assistants = assistantTexts(agent)
    expect(assistants.some(t => t.includes('partial-streamed-') || t.includes('prefix'))).toBe(true)

    // Second model call saw the steer content (new step after cancel).
    expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('interrupt please')

    // Turn ended aborted then a later turn completed.
    const endings = agent.session.snapshotEvents()
      .filter(e => e.type === 'turn/end')
      .map(e => e.type === 'turn/end' ? e.data.reason.kind : null)
    expect(endings[0]).toBe('aborted')
    expect(endings.at(-1)).toBe('completed')
  })

  it('followup while busy parks on next-turn (Cmd/Ctrl+Enter Queue path)', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('after queue'),
      textResponse('wake reply'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('queue-followup'), {
      provider: 'mock',
      model: 'mock',
    })

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'queued next turn' }],
      source: { kind: 'user' },
    }))

    // Complementary shortcut: park on next-turn Queue, do not preempt.
    expect(agent.inbox.nextTurn.some(m =>
      m.content.some(b => b.type === 'text' && b.text === 'queued next turn'),
    )).toBe(true)
    expect(agent.inbox.nextStep).toHaveLength(0)

    // Stock keepInbox parks queued work until a later wake (not auto-claimed).
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    await agent.whenIdle()
    expect(agent.inbox.nextTurn).toHaveLength(1)

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'wake it' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    expect(userTexts(agent)).toEqual(expect.arrayContaining(['queued next turn', 'wake it']))
  })

  it('idle steer still wakes a prompt turn on next-step', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('idle-steer'), {
      provider: 'mock',
      model: 'mock',
    })

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'steer idle' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(userTexts(agent)).toEqual(['steer idle'])
    expect(adapter.requests).toHaveLength(1)
  })

  it('interruptOnSteer=false keeps stock busy-steer wait (no mid-stream cancel)', async () => {
    const adapter = new MockAdapter([
      textResponse('finished first'),
      textResponse('after steer'),
    ])
    const ctx = await harness(adapter, { interruptOnSteer: false })
    const agent = await ctx.agentLoop.create(SessionId('stock-steer'), {
      provider: 'mock',
      model: 'mock',
    })

    let steered = false
    ctx.on('agent/assistant-stream', ({ agent: subject }) => {
      if (subject !== agent || steered) return
      steered = true
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: 'late steer' }],
        source: { kind: 'user' },
      }))
    })

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    const endings = agent.session.snapshotEvents()
      .filter(e => e.type === 'turn/end')
      .map(e => e.type === 'turn/end' ? e.data.reason.kind : null)
    // Without interrupt, first turn completes normally (steer waits for next step / turn).
    expect(endings).not.toContain('aborted')
    expect(userTexts(agent)).toContain('late steer')
  })

  it('preempting steer injects bot-like fold hint so next request resumes prior task (prompt contract)', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('packing then continue prior'),
    ])
    const ctx = await harness(adapter, {
      interruptOnSteer: true,
      steerFoldHint: true,
      steerFoldMode: 'bot-like',
    })
    const agent = await ctx.agentLoop.create(SessionId('fold-hint'), {
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

    // Claim order: human OTHER first, fold notice immediately after (not Queue).
    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    expect(stepTexts[0]).toBe('packing list please')
    expect(stepTexts[1]).toContain(STEER_FOLD_HINT_MARKER)
    expect(stepTexts[1]).toMatch(/fully answer the newest user interrupt/i)
    expect(stepTexts[1]).toMatch(/without omitting/i)
    expect(stepTexts[1]).toMatch(/Never abandon/i)
    expect(stepTexts[1]).toMatch(/visible chat|conversation reply/i)
    expect(stepTexts[1]).toMatch(/dual delivery/i)
    expect(stepTexts[1]).toMatch(/workspace/i)
    // 0.1.5: MAIN resume anchor from the unfinished prior user task.
    expect(stepTexts[1]).toContain('write long todo CLI')
    expect(stepTexts[1]).toContain('Anchored unfinished MAIN')
    expect(agent.inbox.nextTurn).toHaveLength(0)

    // Trajectory-friendly preempt meta (not a user chat bubble; no full MAIN text).
    const loopAgent = agent as typeof agent & {
      lastSteerPreempt?: {
        foldInjected: boolean
        mode: string | null
        claimOrder: string[]
        resumeAnchorPresent?: boolean
      } | null
    }
    expect(loopAgent.lastSteerPreempt).toMatchObject({
      kind: 'steer-preempt',
      foldInjected: true,
      mode: 'bot-like',
      claimOrder: ['human', 'fold-hint'],
      marker: STEER_FOLD_HINT_MARKER,
      resumeAnchorPresent: true,
    })

    await agent.whenIdle()

    // Streamed prefix kept; second request saw interrupt + fold hint + MAIN anchor.
    const assistants = assistantTexts(agent)
    expect(assistants.some(t => t.includes('partial-streamed-') || t.includes('prefix'))).toBe(true)
    const lastReq = JSON.stringify(adapter.requests.at(-1)?.messages ?? [])
    expect(lastReq).toContain('packing list please')
    expect(lastReq).toContain(STEER_FOLD_HINT_MARKER)
    expect(lastReq).toContain('write long todo CLI')
    expect(lastReq).toMatch(/fully answer the newest user interrupt|prior unfinished|without omitting/i)
    expect(lastReq).toMatch(/visible chat|dual delivery|conversation reply/i)
    expect(lastReq).toMatch(/Anchored unfinished MAIN/i)
    // Human OTHER appears before fold marker in the serialized request.
    expect(lastReq.indexOf('packing list please')).toBeLessThan(lastReq.indexOf(STEER_FOLD_HINT_MARKER))

    const endings = agent.session.snapshotEvents()
      .filter(e => e.type === 'turn/end')
      .map(e => e.type === 'turn/end' ? e.data.reason.kind : null)
    expect(endings[0]).toBe('aborted')
    expect(endings.at(-1)).toBe('completed')
  })

  it('steerFoldHint=false keeps bare cancel-then-claim without fold notice', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('interrupt only'),
    ])
    const ctx = await harness(adapter, { interruptOnSteer: true, steerFoldHint: false })
    const agent = await ctx.agentLoop.create(SessionId('no-fold'), {
      provider: 'mock',
      model: 'mock',
    })

    const running = waitUntilRunning(ctx, agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'start' }],
      source: { kind: 'user' },
    }))
    await running
    await new Promise(r => setTimeout(r, 20))

    agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'other' }],
      source: { kind: 'user' },
    }))

    expect(agent.inbox.nextStep.some(m =>
      m.content.some(b => b.type === 'text' && typeof b.text === 'string' && b.text.includes(STEER_FOLD_HINT_MARKER)),
    )).toBe(false)

    const loopAgent = agent as typeof agent & {
      lastSteerPreempt?: { foldInjected: boolean; marker: string | null } | null
    }
    expect(loopAgent.lastSteerPreempt).toMatchObject({
      foldInjected: false,
      marker: null,
      claimOrder: ['human'],
    })

    await agent.whenIdle()
    const lastReq = JSON.stringify(adapter.requests.at(-1)?.messages ?? [])
    expect(lastReq).toContain('other')
    expect(lastReq).not.toContain(STEER_FOLD_HINT_MARKER)
  })

  it('steerFoldMode=minimal injects a shorter fold notice with same claim order', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('short fold then prior'),
    ])
    const ctx = await harness(adapter, {
      interruptOnSteer: true,
      steerFoldHint: true,
      steerFoldMode: 'minimal',
    })
    const agent = await ctx.agentLoop.create(SessionId('fold-minimal'), {
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

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    expect(stepTexts[0]).toBe('packing list please')
    expect(stepTexts[1]).toContain(STEER_FOLD_HINT_MARKER)
    expect(stepTexts[1]).toMatch(/Do not drop the earlier deliverable/i)
    expect(stepTexts[1]).toMatch(/visible chat/i)
    expect(stepTexts[1]).toMatch(/dual delivery|conversation reply/i)
    expect(stepTexts[1]).not.toMatch(/bot-like/i)
    expect(stepTexts[1]).toContain('write long todo CLI')
    expect(stepTexts[1]).toContain('Anchored unfinished MAIN')
    // minimal+anchor is longer than bare minimal, but still shorter than bot-like+anchor base
    expect(stepTexts[1]!.length).toBeLessThan(900)

    const loopAgent = agent as typeof agent & {
      lastSteerPreempt?: { mode: string | null; resumeAnchorPresent?: boolean } | null
    }
    expect(loopAgent.lastSteerPreempt?.mode).toBe('minimal')
    expect(loopAgent.lastSteerPreempt?.resumeAnchorPresent).toBe(true)

    await agent.whenIdle()
    const lastReq = JSON.stringify(adapter.requests.at(-1)?.messages ?? [])
    expect(lastReq).toContain('packing list please')
    expect(lastReq).toContain(STEER_FOLD_HINT_MARKER)
    expect(lastReq).toContain('write long todo CLI')
    expect(lastReq).toMatch(/Do not drop the earlier deliverable/i)
  })

  it('steerResumeAnchor=false keeps fold notice without MAIN quote block', async () => {
    const adapter = new MockAdapter([
      'hang',
      textResponse('no anchor fold'),
    ])
    const ctx = await harness(adapter, {
      interruptOnSteer: true,
      steerFoldHint: true,
      steerFoldMode: 'bot-like',
      steerResumeAnchor: false,
    })
    const agent = await ctx.agentLoop.create(SessionId('no-anchor'), {
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

    const stepTexts = agent.inbox.nextStep.flatMap(m =>
      m.content.flatMap(b => b.type === 'text' ? [b.text] : []),
    )
    expect(stepTexts[0]).toBe('packing list please')
    expect(stepTexts[1]).toContain(STEER_FOLD_HINT_MARKER)
    expect(stepTexts[1]).not.toContain('Anchored unfinished MAIN')
    // MAIN may still appear earlier in session history of the request, but the
    // fold notice itself must not embed the quoted anchor block.
    expect(stepTexts[1]).not.toMatch(/Anchored unfinished MAIN[\s\S]*write long todo CLI/)

    const loopAgent = agent as typeof agent & {
      lastSteerPreempt?: { resumeAnchorPresent?: boolean } | null
    }
    expect(loopAgent.lastSteerPreempt?.resumeAnchorPresent).toBe(false)

    await agent.whenIdle()
    const lastReq = JSON.stringify(adapter.requests.at(-1)?.messages ?? [])
    expect(lastReq).toContain(STEER_FOLD_HINT_MARKER)
    expect(lastReq).not.toContain('Anchored unfinished MAIN')
  })

})
