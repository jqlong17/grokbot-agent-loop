/**
 * RPWU P1.5 — host subagent seam helpers (duck-typed; no hard dep on dsh-subagent).
 *
 * True parallel = parent Agent keeps its turn while `ctx.subagents.startActivation`
 * runs a child Agent + child Session. This module only starts activations and
 * maps results into registry fold-back packets.
 *
 * @module @harness-plugins/grokbot-agent-loop/work-unit-subagent
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  normalizePeerHandoffPacket,
  summarizeGoal,
  type PeerHandoffPacket,
  type WorkUnitActivationRef,
} from './work-unit.ts'

/** Minimal activation result shape we consume from the host seam. */
export interface SubagentResultLike {
  readonly output: readonly ContentBlock[]
  readonly structured?: unknown
  readonly diagnostic?: string
  readonly stopReason: string
}

/** Minimal activation handle returned by `startActivation`. */
export interface SubagentActivationLike {
  readonly childId: string
  readonly messageId?: string
  readonly result: Promise<SubagentResultLike>
  dispose(): Promise<void>
}

/** Duck-typed `ctx.subagents` surface used by this plugin. */
export interface SubagentsRuntimeLike {
  startActivation(spec: {
    readonly provider: string
    readonly label: string
    readonly request: {
      readonly parent: Agent
      readonly prompt: ContentBlock[]
      readonly agentOptions?: unknown
    }
    readonly signal: AbortSignal
    readonly delivery: 'parent' | 'caller'
  }): Promise<SubagentActivationLike>
}

export interface ResolveSubagentsOptions {
  /**
   * Cordis context that may expose `subagents` when the host mounts dsh-subagent.
   * Prefer `get('subagents')` — bare `.subagents` throws when the service is not injected.
   */
  readonly ctx: {
    subagents?: SubagentsRuntimeLike
    get?(name: string, strict?: boolean): unknown
  } | null | undefined
}

/** True when the host seam exposes a callable `startActivation`. */
export function resolveSubagentsRuntime(
  options: ResolveSubagentsOptions,
): SubagentsRuntimeLike | null {
  const ctx = options.ctx
  if (!ctx) return null
  let runtime: unknown
  // Prefer Cordis service lookup — bare `.subagents` throws when not injected.
  if (typeof ctx.get === 'function') {
    try {
      runtime = ctx.get('subagents')
    } catch {
      runtime = undefined
    }
  }
  if (runtime == null) {
    try {
      runtime = ctx.subagents
    } catch {
      // Cordis: "cannot get property … without inject"
      return null
    }
  }
  if (!runtime || typeof (runtime as SubagentsRuntimeLike).startActivation !== 'function') {
    return null
  }
  return runtime as SubagentsRuntimeLike
}

export interface StartWorkUnitSubagentOptions {
  readonly subagents: SubagentsRuntimeLike
  readonly parent: Agent
  readonly promptText: string
  readonly label?: string
  readonly provider?: string
  readonly delivery?: 'parent' | 'caller'
  readonly signal?: AbortSignal
}

export interface StartedWorkUnitSubagent {
  readonly activation: SubagentActivationLike
  readonly activationRef: WorkUnitActivationRef
}

/**
 * Start a host child for a forked OTHER WorkUnit.
 * Caller owns fold-back via `activation.result` (prefer `delivery: 'caller'`).
 */
export async function startWorkUnitSubagent(
  options: StartWorkUnitSubagentOptions,
): Promise<StartedWorkUnitSubagent> {
  const provider = options.provider?.trim() || 'spawn'
  const delivery = options.delivery === 'parent' ? 'parent' : 'caller'
  const signal = options.signal ?? new AbortController().signal
  const label = options.label?.trim() || summarizeGoal(options.promptText, 48) || 'OTHER'
  const promptText = options.promptText.trim() || 'OTHER'
  const activation = await options.subagents.startActivation({
    provider,
    label,
    request: {
      parent: options.parent,
      prompt: [{ type: 'text', text: promptText }],
    },
    signal,
    delivery,
  })
  return {
    activation,
    activationRef: {
      childSessionId: String(activation.childId),
      provider,
    },
  }
}

/** Prefer structured peer packet; else derive theme/keyPoints from assistant text. */
export function peerPacketFromSubagentResult(
  result: SubagentResultLike,
  goalSummary: string,
): PeerHandoffPacket {
  const structured = result.structured
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    const rec = structured as Record<string, unknown>
    if (
      typeof rec.theme === 'string'
      || Array.isArray(rec.keyPoints)
      || Array.isArray(rec.todos)
    ) {
      return normalizePeerHandoffPacket({
        theme: typeof rec.theme === 'string' ? rec.theme : summarizeGoal(goalSummary, 80),
        keyPoints: Array.isArray(rec.keyPoints)
          ? rec.keyPoints.map(v => String(v))
          : [],
        todos: Array.isArray(rec.todos) ? rec.todos.map(v => String(v)) : [],
        ...(typeof rec.summary === 'string' ? { summary: rec.summary } : {}),
      })
    }
  }

  const textParts: string[] = []
  for (const block of result.output ?? []) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      textParts.push(block.text.trim())
    }
  }
  const text = textParts.join('\n').trim()
  const theme = summarizeGoal(goalSummary, 80) || 'subagent OTHER'
  const diagnostic = result.diagnostic?.trim()
  const summary = text
    || (diagnostic
      ? `stopReason=${result.stopReason}; ${diagnostic}`
      : `stopReason=${result.stopReason}`)
  return normalizePeerHandoffPacket({
    theme,
    keyPoints: text ? [summarizeGoal(text, 200)] : (diagnostic ? [diagnostic] : []),
    todos: [],
    summary,
  })
}
