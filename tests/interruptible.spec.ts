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
import AgentLoop from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, config: { interruptOnSteer?: boolean } = {}) {
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
})
