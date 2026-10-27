/**
 * ActivationManager — host subagent façade (Ideal Topology v1.1).
 * Wraps startWorkUnitSubagent; missing seam → degraded, never throws.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/activation-manager
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  resolveSubagentsRuntime,
  startWorkUnitSubagent,
  type StartedWorkUnitSubagent,
  type SubagentsRuntimeLike,
} from './subagent.ts'
import type { WorkUnitActivationRef } from './work-unit.ts'

export type ActivationStartResult =
  | { kind: 'started'; started: StartedWorkUnitSubagent }
  | { kind: 'degraded'; reason: string }

export interface ActivationManagerOptions {
  readonly ctx: {
    subagents?: SubagentsRuntimeLike
    get?(name: string, strict?: boolean): unknown
  } | null | undefined
  readonly parent: Agent
  readonly provider?: string
  readonly delivery?: 'parent' | 'caller'
}

/** Unified façade over host startActivation / wait / cancel / degrade. */
export class ActivationManager {
  private readonly aborts = new Map<string, AbortController>()

  constructor(private readonly options: ActivationManagerOptions) {}

  /** True when host seam exposes startActivation. */
  get available(): boolean {
    return resolveSubagentsRuntime({ ctx: this.options.ctx }) !== null
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
      return { kind: 'started', started }
    } catch (err) {
      return {
        kind: 'degraded',
        reason: err instanceof Error ? err.message : String(err),
      }
    } finally {
      options.signal?.removeEventListener('abort', onOuter)
    }
  }

  cancel(unitId: string): void {
    const abort = this.aborts.get(unitId)
    if (abort) {
      abort.abort()
      this.aborts.delete(unitId)
    }
  }

  cancelAll(): void {
    for (const [id, abort] of this.aborts) {
      abort.abort()
      this.aborts.delete(id)
    }
  }

  static refOf(started: StartedWorkUnitSubagent): WorkUnitActivationRef {
    return started.activationRef
  }
}
