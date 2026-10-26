/**
 * Unit tests for RPWU P0 WorkUnit registry, checkpoints, and DeliveryGate.
 */
import { describe, expect, it } from 'vitest'
import {
  WorkUnitRegistry,
  UNIT_FOLD_MARKER,
  DELIVERY_GATE_MARKER,
  buildDeliveryGateNotice,
  buildUnitFoldBlock,
  canMarkCompleted,
  inferDeliveryFromBlocks,
  isSubstantiveAssistantText,
  shouldRunDeliveryGate,
  simpleTextHash,
  summarizeGoal,
  isDeliveryGateNotice,
  DEFAULT_DELIVERY_GATE_MAX,
} from '../src/work-unit.ts'

describe('WorkUnitRegistry', () => {
  it('create / get / list / bindActive / markStatus', () => {
    const reg = new WorkUnitRegistry()
    const u = reg.create({ goalSummary: 'write a todo CLI', createdAtTurn: 1, createdAtStep: 1 })
    expect(u.id).toBe('wu-1')
    expect(u.status).toBe('pending')
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
