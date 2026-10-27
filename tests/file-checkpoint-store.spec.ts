/**
 * Slice E — File CheckpointStore hydrate smoke (0.2.3).
 * Durable axis only: put → process-restart simulation → hydrate.
 * Do NOT assert interrupt behavior here (see interruptible.spec.ts).
 * NOT Temporal — opt-in file evidence; Memory remains default.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileCheckpointStore,
  FileDurableWorkflow,
  createDurableWorkflow,
  MemoryCheckpointStore,
  Orchestrator,
  WorkUnitRegistry,
  isCompletedStepCheckpoint,
} from '../src/index.ts'

describe('File CheckpointStore hydrate smoke (⊥ interruptible)', () => {
  it('put → new process FileCheckpointStore → hydrate rebuilds unit + checkpoints + workId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grokbot-cp-'))
    const path = join(dir, 'store.json')
    try {
      const store1 = new FileCheckpointStore({ path })
      const orch = new Orchestrator({ checkpointStore: store1 })
      const main = orch.registry.create({
        goalSummary: 'cross-process CLI',
        workId: 'work-stable-file',
        createdAtTurn: 1,
        createdAtStep: 0,
      })
      orch.registry.markStatus(main.id, 'running')
      orch.registry.bindActive(main.id)
      expect(main.workId).toBe('work-stable-file')

      orch.recordCheckpoint({
        unitId: main.id,
        stepIndex: 1,
        turn: 1,
        assistantPrefixCursor: 42,
        assistantPrefixHash: 'filebeef01',
        toolResultRefs: [{ id: 'tc-file-1', summary: 'write' }],
        status: 'running',
        delivery: { chatPosted: false, workspaceOnly: true },
        reason: 'step-end',
      })
      orch.recordCheckpoint({
        unitId: main.id,
        stepIndex: 2,
        turn: 1,
        assistantPrefixCursor: 80,
        assistantPrefixHash: 'filebeef02',
        toolResultRefs: [],
        status: 'running',
        delivery: { chatPosted: true, workspaceOnly: false },
        reason: 'step-end',
      })
      store1.setActiveId(main.id)

      // Process-restart simulation: brand-new store instance reading same path.
      const store2 = new FileCheckpointStore({ path })
      expect(store2.path).toBe(path)
      const fresh = new WorkUnitRegistry()
      store2.hydrate(fresh)

      const restored = fresh.get(main.id)
      expect(restored).toBeTruthy()
      expect(restored!.workId).toBe('work-stable-file')
      expect(restored!.goalSummary).toMatch(/cross-process CLI/i)
      expect(restored!.checkpoints.filter(isCompletedStepCheckpoint)).toHaveLength(2)
      expect(restored!.checkpoints.map(c => c.assistantPrefixHash)).toEqual([
        'filebeef01',
        'filebeef02',
      ])
      expect(store2.list(main.id)).toHaveLength(2)
      expect(store2.latest(main.id)?.assistantPrefixHash).toBe('filebeef02')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('hydrate is idempotent (no duplicate checkpoints on re-hydrate)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grokbot-cp-idem-'))
    const path = join(dir, 'store.json')
    try {
      const store = new FileCheckpointStore({ path })
      const reg = new WorkUnitRegistry()
      const unit = reg.create({ goalSummary: 'idem', workId: 'work-idem' })
      store.saveUnit(unit)
      store.put({
        unitId: unit.id,
        stepIndex: 0,
        turn: 0,
        assistantPrefixCursor: 1,
        assistantPrefixHash: 'aaaa1111',
        toolResultRefs: [],
        status: 'running',
        delivery: { chatPosted: false, workspaceOnly: false },
        reason: 'step-end',
        at: Date.now(),
      })

      const a = new WorkUnitRegistry()
      store.hydrate(a)
      const b = new WorkUnitRegistry()
      store.hydrate(b)
      expect(a.get(unit.id)!.checkpoints).toHaveLength(1)
      expect(b.get(unit.id)!.checkpoints).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('corrupt / missing file → empty hydrate, never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grokbot-cp-empty-'))
    const path = join(dir, 'missing.json')
    try {
      expect(() => {
        const store = new FileCheckpointStore({ path })
        const fresh = new WorkUnitRegistry()
        store.hydrate(fresh)
        expect(fresh.list()).toHaveLength(0)
      }).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('FileDurableWorkflow factory round-trips; Memory remains default', () => {
    expect(createDurableWorkflow('memory').kind).toBe('memory')
    expect(createDurableWorkflow('memory').store).toBeInstanceOf(MemoryCheckpointStore)

    const dir = mkdtempSync(join(tmpdir(), 'grokbot-cp-wf-'))
    const path = join(dir, 'wf.json')
    try {
      const wf = createDurableWorkflow('file', path)
      expect(wf.kind).toBe('file')
      expect(wf).toBeInstanceOf(FileDurableWorkflow)
      const reg = new WorkUnitRegistry()
      const u = reg.create({ goalSummary: 'wf', workId: 'work-wf' })
      wf.store.saveUnit(u)
      wf.store.put({
        unitId: u.id,
        stepIndex: 0,
        turn: 0,
        assistantPrefixCursor: 0,
        assistantPrefixHash: 'bbbb2222',
        toolResultRefs: [],
        status: 'completed',
        delivery: { chatPosted: true, workspaceOnly: false },
        reason: 'step-end',
        at: Date.now(),
      })

      const restarted = new FileDurableWorkflow(path)
      const fresh = new WorkUnitRegistry()
      restarted.hydrate(fresh)
      expect(fresh.get(u.id)?.workId).toBe('work-wf')
      expect(fresh.get(u.id)?.checkpoints).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
