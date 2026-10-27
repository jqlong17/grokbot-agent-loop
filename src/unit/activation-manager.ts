/**
 * ActivationManager — host subagent façade (Ideal Topology v1.1).
 * Wraps startWorkUnitSubagent; missing seam → degraded, never throws.
 *
 * Live main path for spawn / host parallel: start → wait → cancel / degrade.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/activation-manager
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  resolveSubagentsRuntime,
  startWorkUnitSubagent,
  type StartedWorkUnitSubagent,
  type SubagentResultLike,
  type SubagentsRuntimeLike,
} from './subagent.ts'
import type { WorkUnitActivationRef } from './work-unit.ts'

export type ActivationStartResult =
  | { kind: 'started'; started: StartedWorkUnitSubagent }
  | { kind: 'degraded'; reason: string }

export type ActivationWaitResult =
  | { kind: 'settled'; result: SubagentResultLike }
  | { kind: 'missing'; reason: string }
  | { kind: 'error'; reason: string }

export interface ActivationManagerOptions {
  readonly ctx: {
    subagents?: SubagentsRuntimeLike
    get?(name: string, strict?: boolean): unknown
  } | null | undefined
  readonly parent: Agent
  readonly provider?: string
  readonly delivery?: 'parent' | 'caller'
}

/** Observable start record for dual-Session gold / trajectory. */
export interface ActivationStartRecord {
  readonly unitId: string
  readonly childSessionId: string
  readonly parentId: string
  readonly provider: string
  readonly at: number
}

/** Unified façade over host startActivation / wait / cancel / degrade. */
export class ActivationManager {
  private readonly aborts = new Map<string, AbortController>()
  private readonly started = new Map<string, StartedWorkUnitSubagent>()
  private readonly _starts: ActivationStartRecord[] = []

  constructor(private readonly options: ActivationManagerOptions) {}

  /** True when host seam exposes startActivation. */
  get available(): boolean {
    return resolveSubagentsRuntime({ ctx: this.options.ctx }) !== null
  }

  /** Successful startActivation records (parent ≠ child Session evidence). */
  get starts(): readonly ActivationStartRecord[] {
    return this._starts
  }

  async start(options: {
    unitId: string
    promptText: string
    label?: string
    signal?: AbortSignal
  }): Promise<ActivationStartResult> {
    const runtime = resolveSubagentsRuntime({ ctx: this.options.ctx })
    if (!runtime) {
      return { kind: 'degraded', reason: 'ctx.subagents.startActivation unavailable' }
    }
    const abort = new AbortController()
    this.aborts.set(options.unitId, abort)
    const onOuter = (): void => { abort.abort() }
    options.signal?.addEventListener('abort', onOuter, { once: true })
    try {
      const started = await startWorkUnitSubagent({
        subagents: runtime,
        parent: this.options.parent,
        promptText: options.promptText,
        label: options.label,
        provider: this.options.provider,
        delivery: this.options.delivery,
        signal: abort.signal,
      })
      this.started.set(options.unitId, started)
      this._starts.push({
        unitId: options.unitId,
        childSessionId: started.activationRef.childSessionId,
        parentId: String(this.options.parent.id),
        provider: started.activationRef.provider,
        at: Date.now(),
      })
      return { kind: 'started', started }
    } catch (err) {
      this.aborts.delete(options.unitId)
      return {
        kind: 'degraded',
        reason: err instanceof Error ? err.message : String(err),
      }
    } finally {
      options.signal?.removeEventListener('abort', onOuter)
    }
  }

  /** Await a previously started activation result (never throws). */
  async wait(unitId: string): Promise<ActivationWaitResult> {
    const handle = this.started.get(unitId)
    if (!handle) {
      return { kind: 'missing', reason: `no started activation for ${unitId}` }
    }
    try {
      const result = await handle.activation.result
      return { kind: 'settled', result }
    } catch (err) {
      return {
        kind: 'error',
        reason: err instanceof Error ? err.message : String(err),
      }
    } finally {
      this.started.delete(unitId)
      this.aborts.delete(unitId)
    }
  }

  cancel(unitId: string): void {
    const abort = this.aborts.get(unitId)
    if (abort) {
      abort.abort()
      this.aborts.delete(unitId)
    }
    const handle = this.started.get(unitId)
    if (handle) {
      void handle.activation.dispose().catch(() => { /* ignore */ })
      this.started.delete(unitId)
    }
  }

  cancelAll(): void {
    for (const id of [...this.aborts.keys(), ...this.started.keys()]) {
      this.cancel(id)
    }
  }

  static refOf(started: StartedWorkUnitSubagent): WorkUnitActivationRef {
    return started.activationRef
  }
}
