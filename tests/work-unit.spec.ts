/**
 * Unit tests for RPWU P0/P1 WorkUnit registry, checkpoints, DeliveryGate,
 * fold|fork, peer handoff, and deliverySpec.
 */
import { describe, expect, it } from 'vitest'
import {
  WorkUnitRegistry,
  UNIT_FOLD_MARKER,
  UNIT_FORK_MARKER,
  UNIT_FOLD_BACK_MARKER,
  PEER_HANDOFF_MARKER,
  DELIVERY_GATE_MARKER,
  buildDeliveryGateNotice,
  buildUnitFoldBlock,
  buildUnitForkBlock,
  buildUnitFoldBackNotice,
  canMarkCompleted,
  defaultPeerDeliverySpec,
  inferDeliveryFromBlocks,
  isDeliverySpecMet,
  isPeerHandoffNotice,
  isSubstantiveAssistantText,
  shouldRunDeliveryGate,
  simpleTextHash,
  summarizeGoal,
  verifyDeliverySpec,
  isDeliveryGateNotice,
  DEFAULT_DELIVERY_GATE_MAX,
} from '../src/work-unit.ts'

describe('WorkUnitRegistry', () => {
  it('create / get / list / bindActive / markStatus', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.create({ goalSummary: 'write a todo CLI', createdAtTurn: 1, createdAtStep: 1 })
    expect(u.id).toBe('wu-1')
    expect(u.status).toBe('pending')
    expect(u.parentId).toBeNull()
    expect(u.deliverySpec).toBeNull()
    expect(u.goalSummary).toContain('todo CLI')
    expect(reg.get(u.id)).toBe(u)
    expect(reg.list()).toHaveLength(1)
    reg.bindActive(u.id)
    expect(reg.active()?.id).toBe(u.id)
    reg.markStatus(u.id, 'running')
    expect(reg.active()?.status).toBe('running')
  })

  it('ensureMainUnit reuses active open unit', () => {
    const reg = new WorkUnitRegistry()
    const a = reg.ensureMainUnit({ goalSummary: 'MAIN A', turn: 1, step: 1 })
    expect(a.status).toBe('running')
    const b = reg.ensureMainUnit({ goalSummary: 'MAIN B ignored', turn: 1, step: 2, status: 'paused' })
    expect(b.id).toBe(a.id)
    expect(b.status).toBe('paused')
    expect(reg.list()).toHaveLength(1)
  })

  it('foldOther + appendCheckpoint updates delivery and lastCheckpoint', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'long CLI', turn: 1, step: 1 })
    reg.foldOther(u.id, 'packing list please')
    expect(u.foldedOtherSummaries[0]).toMatch(/packing/i)
    const cp = reg.appendCheckpoint({
      unitId: u.id,
      stepIndex: 1,
      turn: 1,
      assistantPrefixCursor: 42,
      assistantPrefixHash: simpleTextHash('partial'),
      toolResultRefs: [{ id: 'tc-1', summary: 'write' }],
      status: 'paused',
      delivery: { chatPosted: false, workspaceOnly: true },
      reason: 'preempt',
    })
    expect(reg.lastCheckpoint).toBe(cp)
    expect(u.checkpoints).toHaveLength(1)
    expect(u.delivery.workspaceOnly).toBe(true)
    expect(u.status).toBe('paused')
  })

  it('tryComplete respects DeliveryGate chatPosted requirement', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 1 })
    expect(canMarkCompleted(u, { deliveryGate: true })).toBe(false)
    expect(reg.tryComplete(u.id, { deliveryGate: true })).toBe(false)
    expect(u.status).toBe('running')
    reg.updateDelivery(u.id, { chatPosted: true, workspaceOnly: false })
    expect(reg.tryComplete(u.id, { deliveryGate: true })).toBe(true)
    expect(u.status).toBe('completed')
  })

  it('snapshot is a deep-enough copy of unit list', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'x', turn: 0, step: 0 })
    const snap = reg.snapshot()
    expect(snap.activeId).toBe(u.id)
    expect(snap.units[0]?.id).toBe(u.id)
    snap.units[0]!.foldedOtherSummaries.push('mut')
    expect(u.foldedOtherSummaries).toHaveLength(0)
  })
})

describe('RPWU P1-a fold|fork', () => {
  it('fork creates a separate sibling unit that is independently queryable', () => {
    const reg = new WorkUnitRegistry()
    const main = reg.ensureMainUnit({ goalSummary: 'write long todo CLI', turn: 1, step: 1 })
    main.status = 'paused'
    const sibling = reg.forkSibling({
      parentId: main.id,
      goalSummary: 'packing list please',
      lane: 'user',
      createdAtTurn: 1,
      createdAtStep: 2,
      bindActive: false,
    })
    expect(sibling.id).not.toBe(main.id)
    expect(sibling.parentId).toBe(main.id)
    expect(reg.list()).toHaveLength(2)
    expect(reg.siblingsOf(main.id).map(u => u.id)).toEqual([sibling.id])

    reg.appendCheckpoint({
      unitId: sibling.id,
      stepIndex: 2,
      turn: 1,
      assistantPrefixCursor: 10,
      assistantPrefixHash: simpleTextHash('other'),
      toolResultRefs: [],
      status: 'running',
      delivery: { chatPosted: false, workspaceOnly: false },
      reason: 'preempt',
    })

    const mainQ = reg.query(main.id)!
    const sibQ = reg.query(sibling.id)!
    expect(mainQ.status).toBe('paused')
    expect(mainQ.lane).toBe('user')
    expect(mainQ.checkpointCount).toBe(0)
    expect(sibQ.status).toBe('running')
    expect(sibQ.lane).toBe('user')
    expect(sibQ.parentId).toBe(main.id)
    expect(sibQ.checkpointCount).toBe(1)
    expect(sibQ.lastCheckpoint?.reason).toBe('preempt')
    // MAIN stays active control-plane when bindActive:false
    expect(reg.active()?.id).toBe(main.id)

    const block = buildUnitForkBlock(main, sibling)
    expect(block).toContain(UNIT_FORK_MARKER)
    expect(block).toContain(sibling.id)
    expect(block).toContain(main.id)
  })

  it('fold path still works: foldOther stays on MAIN without sibling', () => {
    const reg = new WorkUnitRegistry()
    const main = reg.ensureMainUnit({ goalSummary: 'MAIN trip', turn: 1, step: 1 })
    reg.foldOther(main.id, 'packing list')
    expect(reg.list()).toHaveLength(1)
    expect(reg.siblingsOf(main.id)).toHaveLength(0)
    expect(main.foldedOtherSummaries[0]).toMatch(/packing/i)
    expect(buildUnitFoldBlock(main)).toContain(UNIT_FOLD_MARKER)
  })

  it('foldSiblingIntoMain folds completed sibling result back into MAIN', () => {
    const reg = new WorkUnitRegistry()
    const main = reg.ensureMainUnit({ goalSummary: 'MAIN CLI', turn: 1, step: 1 })
    main.status = 'paused'
    const sibling = reg.forkSibling({
      parentId: main.id,
      goalSummary: 'OTHER packing',
      bindActive: true,
    })
    expect(reg.active()?.id).toBe(sibling.id)
    reg.updateDelivery(sibling.id, { chatPosted: true, workspaceOnly: false })
    const { main: foldedMain, sibling: done, notice } = reg.foldSiblingIntoMain({
      siblingId: sibling.id,
      deliveryGate: true,
    })
    expect(done.status).toBe('completed')
    expect(foldedMain.id).toBe(main.id)
    expect(reg.active()?.id).toBe(main.id)
    expect(main.status).toBe('running')
    expect(main.foldedOtherSummaries.some(s => /fold-back|OTHER packing/i.test(s))).toBe(true)
    const text = notice.content[0]?.type === 'text' ? notice.content[0].text : ''
    expect(text).toContain(UNIT_FOLD_BACK_MARKER)
    expect(text).toContain(sibling.id)
    expect(text).toContain(main.id)
  })
})

describe('RPWU P1-b peer/agent-lane handoff', () => {
  it('acceptPeerHandoff creates agent-lane unit and folds structured packet into MAIN', () => {
    const reg = new WorkUnitRegistry()
    const main = reg.ensureMainUnit({ goalSummary: 'progress wiki', turn: 1, step: 1 })
    const { peer, main: after, notice } = reg.acceptPeerHandoff({
      parentId: main.id,
      packet: {
        theme: '周会纪要',
        keyPoints: ['蓝信纠错', 'CloudAgent PR#18'],
        todos: ['更新 Wiki 入口', '归档 routine'],
        summary: 'notta 会后回报',
      },
    })
    expect(peer.lane).toBe('agent')
    expect(peer.parentId).toBe(main.id)
    expect(peer.status).toBe('completed')
    expect(peer.deliverySpec?.shape).toEqual(['theme', 'keyPoints', 'todos'])
    expect(isDeliverySpecMet(peer)).toBe(true)
    expect(after.lastPeerPacket?.theme).toBe('周会纪要')
    expect(after.lastPeerPacket?.keyPoints).toHaveLength(2)
    expect(after.lastPeerPacket?.todos).toHaveLength(2)
    expect(reg.byLane('agent').some(u => u.id === peer.id)).toBe(true)
    expect(isPeerHandoffNotice(notice)).toBe(true)
    const text = notice.content[0]?.type === 'text' ? notice.content[0].text : ''
    expect(text).toContain(PEER_HANDOFF_MARKER)
    expect(text).toContain('周会纪要')
    expect(text).toContain('蓝信纠错')
    expect(buildUnitFoldBackNotice(main, peer, after.lastPeerPacket).content[0]).toMatchObject({
      type: 'text',
    })
  })
})

describe('RPWU P1-c deliverySpec + DeliveryGate', () => {
  it('deliverySpec failure blocks gate / completion until payload satisfies shape', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'peer return', turn: 1, step: 1 })
    reg.setDeliverySpec(u.id, defaultPeerDeliverySpec('chat'))
    reg.updateDelivery(u.id, { chatPosted: true, workspaceOnly: false })
    // Missing theme/keyPoints/todos → not complete, gate should run.
    expect(verifyDeliverySpec(u).ok).toBe(false)
    expect(verifyDeliverySpec(u).missing).toEqual(['theme', 'keyPoints', 'todos'])
    expect(isDeliverySpecMet(u)).toBe(false)
    expect(shouldRunDeliveryGate(u, { enabled: true, maxRetries: 2 })).toBe(true)
    expect(canMarkCompleted(u, { deliveryGate: true, maxRetries: 2 })).toBe(false)
    expect(reg.tryComplete(u.id, { deliveryGate: true })).toBe(false)

    const notice = buildDeliveryGateNotice(u)
    const text = notice.content[0]?.type === 'text' ? notice.content[0].text : ''
    expect(text).toContain(DELIVERY_GATE_MARKER)
    expect(text).toMatch(/missing=\[theme,keyPoints,todos\]/)

    // Satisfy contract → gate clears, complete allowed.
    reg.setDeliveryPayload(u.id, {
      theme: 'done',
      keyPoints: ['a'],
      todos: ['b'],
    })
    expect(isDeliverySpecMet(u)).toBe(true)
    expect(shouldRunDeliveryGate(u, { enabled: true })).toBe(false)
    expect(reg.tryComplete(u.id, { deliveryGate: true })).toBe(true)
    expect(u.status).toBe('completed')
  })

  it('short path without deliverySpec does not regress: pure text still completes', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'say hello', turn: 1, step: 1 })
    expect(u.deliverySpec).toBeNull()
    const delivery = inferDeliveryFromBlocks([{ type: 'text', text: 'hello' }])
    expect(delivery).toEqual({ chatPosted: true, workspaceOnly: false })
    reg.updateDelivery(u.id, delivery)
    expect(shouldRunDeliveryGate(u, { enabled: true })).toBe(false)
    expect(reg.tryComplete(u.id, { deliveryGate: true })).toBe(true)
  })
})

describe('delivery inference + gate', () => {
  it('infers chatPosted from non-empty pure text (short answers OK)', () => {
    expect(inferDeliveryFromBlocks([{ type: 'text', text: 'hello' }])).toEqual({
      chatPosted: true,
      workspaceOnly: false,
    })
  })

  it('infers workspaceOnly from tool-only blocks', () => {
    expect(inferDeliveryFromBlocks([{ type: 'tool-call' }])).toEqual({
      chatPosted: false,
      workspaceOnly: true,
    })
  })

  it('short progress text + tool → gate (non-substantive)', () => {
    expect(inferDeliveryFromBlocks([
      { type: 'text', text: '下面开始写 todo CLI…' },
      { type: 'tool-call' },
    ])).toEqual({ chatPosted: false, workspaceOnly: true })
    expect(isSubstantiveAssistantText('下面开始写 todo CLI…')).toBe(false)
  })

  it('substantive code fence + tool → chatPosted (no gate need)', () => {
    const code = '```python\ndef main():\n    print(1)\n```'
    expect(isSubstantiveAssistantText(code)).toBe(true)
    expect(inferDeliveryFromBlocks([
      { type: 'text', text: code },
      { type: 'tool-call' },
    ])).toEqual({ chatPosted: true, workspaceOnly: false })
  })

  it('long prose + tool → chatPosted via length threshold', () => {
    const long = '装箱清单：' + ('衣服充电证件行程安排 ').repeat(40)
    expect(long.length).toBeGreaterThanOrEqual(400)
    expect(inferDeliveryFromBlocks([
      { type: 'text', text: long },
      { type: 'tool-call' },
    ])).toEqual({ chatPosted: true, workspaceOnly: false })
  })

  it('shouldRunDeliveryGate caps retries; workspaceOnly still gates with sticky chat', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 1 })
    u.delivery = { chatPosted: false, workspaceOnly: true }
    expect(shouldRunDeliveryGate(u, { enabled: true, maxRetries: 2 })).toBe(true)
    reg.bumpGateRetry(u.id)
    expect(shouldRunDeliveryGate(u, { enabled: true, maxRetries: 2 })).toBe(true)
    reg.bumpGateRetry(u.id)
    expect(shouldRunDeliveryGate(u, { enabled: true, maxRetries: 2 })).toBe(false)
    expect(DEFAULT_DELIVERY_GATE_MAX).toBe(2)

    // Sticky chatPosted from OTHER + later MAIN tool dump → still gate.
    u.gateRetries = 0
    u.delivery = { chatPosted: true, workspaceOnly: true }
    expect(shouldRunDeliveryGate(u, { enabled: true, maxRetries: 2 })).toBe(true)
    u.delivery.workspaceOnly = false
    expect(shouldRunDeliveryGate(u, { enabled: true })).toBe(false)
  })

  it('canMarkCompleted blocks while workspaceOnly and retries remain', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'MAIN', turn: 1, step: 1 })
    u.delivery = { chatPosted: true, workspaceOnly: true }
    u.gateRetries = 0
    expect(canMarkCompleted(u, { deliveryGate: true, maxRetries: 2 })).toBe(false)
    u.gateRetries = 2
    expect(canMarkCompleted(u, { deliveryGate: true, maxRetries: 2 })).toBe(true)
  })

  it('buildUnitFoldBlock and DeliveryGate notice carry markers', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.ensureMainUnit({ goalSummary: 'write CLI', turn: 1, step: 1 })
    const block = buildUnitFoldBlock(u)
    expect(block).toContain(UNIT_FOLD_MARKER)
    expect(block).toContain(u.id)
    expect(block).toContain('write CLI')
    const notice = buildDeliveryGateNotice(u)
    expect(isDeliveryGateNotice(notice)).toBe(true)
    const text = notice.content[0]?.type === 'text' ? notice.content[0].text : ''
    expect(text).toContain(DELIVERY_GATE_MARKER)
    expect(text).toContain(u.id)
  })

  it('summarizeGoal truncates', () => {
    expect(summarizeGoal('abc')).toBe('abc')
    expect(summarizeGoal('x'.repeat(300), 10)).toMatch(/^x{10}…$/)
  })
})
