/**
 * RPWU P0 — Recoverable Parallel Work Units (session-local, in-memory).
 *
 * WorkUnit registry + step checkpoints + delivery gate helpers. Pure plugin
 * layer on top of 0.1.x cancel-then-claim; not Temporal, not multi-background.
 *
 * Community homage; not affiliated with xAI.
 *
 * @module @harness-plugins/grokbot-agent-loop/work-unit
 */

import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'delivery-gate': { kind: 'delivery-gate' } & ContextFormed
    'unit-fold-hint': { kind: 'unit-fold-hint' } & ContextFormed
  }
}

/** Visible marker for unit-aware fold notices (tests / trajectory). */
export const UNIT_FOLD_MARKER = '[grokbot-unit-fold]'

/** Visible marker for DeliveryGate continuation notices. */
export const DELIVERY_GATE_MARKER = '[grokbot-delivery-gate]'

/** P0/P0.1: default gate-driven continuations per unit (0.1.7+). */
export const DEFAULT_DELIVERY_GATE_MAX = 2

/** Default minimum plain-text length to count as substantive chat delivery. */
export const DEFAULT_SUBSTANTIVE_MIN_CHARS = 400

/** Default goalSummary truncation. */
export const DEFAULT_GOAL_SUMMARY_MAX = 240

export type WorkUnitStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled'
export type WorkUnitLane = 'user' | 'agent'

export interface WorkUnitDelivery {
  chatPosted: boolean
  workspaceOnly: boolean
}

export interface ToolResultRef {
  id: string
  summary?: string
}

export type CheckpointReason = 'step-end' | 'preempt' | 'gate' | 'manual'

export interface StepCheckpoint {
  unitId: string
  stepIndex: number
  turn: number
  assistantPrefixCursor: number
  assistantPrefixHash: string
  toolResultRefs: readonly ToolResultRef[]
  status: WorkUnitStatus
  delivery: WorkUnitDelivery
  at: number
  reason: CheckpointReason
}

export interface WorkUnit {
  id: string
  goalSummary: string
  status: WorkUnitStatus
  lane: WorkUnitLane
  createdAtStep: number
  createdAtTurn: number
  checkpoints: StepCheckpoint[]
  delivery: WorkUnitDelivery
  /** Short summaries of OTHER interrupts folded into this unit (P0: no fork). */
  foldedOtherSummaries: string[]
  /** How many DeliveryGate continuation steps have already been injected. */
  gateRetries: number
}

export interface CreateWorkUnitInput {
  goalSummary: string
  lane?: WorkUnitLane
  createdAtStep?: number
  createdAtTurn?: number
  id?: string
}

export interface WorkUnitSnapshot {
  activeId: string | null
  units: readonly Readonly<WorkUnit>[]
}

/** Compact FNV-1a style hash for assistant prefix observability (not crypto). */
export function simpleTextHash(text: string): string {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Truncate a goal for registry / fold display. */
export function summarizeGoal(text: string, maxLen: number = DEFAULT_GOAL_SUMMARY_MAX): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen)}…`
}

export interface InferDeliveryOptions {
  /** Min text length for substantive delivery when no code fence / list structure. */
  minSubstantiveChars?: number
}

/**
 * Whether assistant text counts as a real chat deliverable (not tool narration).
 * Substantive if: fenced code; length ≥ threshold; or a short structured list.
 */
export function isSubstantiveAssistantText(
  text: string,
  options: InferDeliveryOptions = {},
): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Fenced code (``` or ~~~) — MAIN CLI / snippets pasted into chat.
  if (/```[\s\S]*```/.test(trimmed) || /~~~[\s\S]*~~~/.test(trimmed)) return true
  const minChars = options.minSubstantiveChars ?? DEFAULT_SUBSTANTIVE_MIN_CHARS
  if (trimmed.length >= minChars) return true
  // Light OTHER-list heuristic: several bullet/numbered lines, enough body.
  const listLines = trimmed.split(/\n/).filter(line =>
    /^\s*[-*•]\s+\S/.test(line)
    || /^\s*\d+[.)]\s+\S/.test(line)
    || /^\s*\d+、\s*\S/.test(line)
    || /^\s*[（(]?[一二三四五六七八九十\d]+[）)、.]\s*\S/.test(line),
  )
  if (listLines.length >= 3 && trimmed.length >= 120) return true
  return false
}

/**
 * Delivery inference for one assistant step (0.1.7 substantive rule):
 * - tool + non-substantive text (progress / "下面开始写…") → workspaceOnly, chatPosted false
 * - substantive text (fence / long / list) → chatPosted (tools optional)
 * - pure short text, no tools → chatPosted (short answers stay valid)
 * - tool-only → workspaceOnly
 */
export function inferDeliveryFromBlocks(
  blocks: readonly { type: string; text?: string }[],
  options: InferDeliveryOptions = {},
): WorkUnitDelivery {
  let hasText = false
  let hasTool = false
  const textParts: string[] = []
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0) {
      hasText = true
      textParts.push(b.text)
    }
    if (b.type === 'tool-call') hasTool = true
  }
  const combined = textParts.join('\n')
  const substantive = hasText && isSubstantiveAssistantText(combined, options)

  // Progress narration beside tools is not chat delivery — gate should still run.
  if (hasTool && hasText && !substantive) {
    return { chatPosted: false, workspaceOnly: true }
  }
  if (substantive) return { chatPosted: true, workspaceOnly: false }
  if (hasText && !hasTool) return { chatPosted: true, workspaceOnly: false }
  if (hasTool) return { chatPosted: false, workspaceOnly: true }
  return { chatPosted: false, workspaceOnly: false }
}

/** Extract plain assistant text length + hash from content blocks. */
export function assistantPrefixStats(
  blocks: readonly { type: string; text?: string }[],
): { cursor: number; hash: string; text: string } {
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  const text = parts.join('')
  return { cursor: text.length, hash: simpleTextHash(text), text }
}

/**
 * Whether DeliveryGate should inject a continuation.
 * Fires when retries remain and either chatPosted is false, or the unit is still
 * marked workspaceOnly (sticky chat from OTHER + later tool dump of MAIN).
 */
export function shouldRunDeliveryGate(
  unit: WorkUnit,
  options: { enabled: boolean; maxRetries?: number } = { enabled: true },
): boolean {
  if (!options.enabled) return false
  const max = options.maxRetries ?? DEFAULT_DELIVERY_GATE_MAX
  if (unit.gateRetries >= max) return false
  if (unit.status === 'completed' || unit.status === 'cancelled') return false
  if (!unit.delivery.chatPosted) return true
  // Sticky chatPosted from an earlier OTHER answer must not skip MAIN tool dumps.
  if (unit.delivery.workspaceOnly) return true
  return false
}

/** True when tryComplete is allowed under DeliveryGate rules. */
export function canMarkCompleted(
  unit: WorkUnit,
  options: { deliveryGate: boolean; maxRetries?: number },
): boolean {
  if (unit.status === 'cancelled') return false
  if (!options.deliveryGate) return true
  if (!unit.delivery.chatPosted) return false
  const max = options.maxRetries ?? DEFAULT_DELIVERY_GATE_MAX
  // After gate budget is exhausted, allow complete even if still workspace-leaning.
  if (unit.delivery.workspaceOnly && unit.gateRetries < max) return false
  return true
}

/** Build fold-notice suffix referencing the bound MAIN unit. */
export function buildUnitFoldBlock(unit: WorkUnit): string {
  return (
    `${UNIT_FOLD_MARKER} Bound MAIN work unit ${unit.id} ` +
    `(goal: ${unit.goalSummary}). Fold OTHER into this unit; ` +
    `keep step checkpoints; resume from the last completed step. ` +
    `Visible chat delivery is required before this unit can complete.`
  )
}

/** DeliveryGate continuation notice (producer-owned). */
export function buildDeliveryGateNotice(unit: WorkUnit): UserMessage {
  const text =
    `${DELIVERY_GATE_MARKER} DeliveryGate for unit ${unit.id} ` +
    `(goal: ${unit.goalSummary}): prior step looked like tool/progress-only ` +
    `(chatPosted=${unit.delivery.chatPosted}, workspaceOnly=${unit.delivery.workspaceOnly}). ` +
    `Paste the MAIN code / CLI progress (fenced code block) and any still-missing ` +
    `OTHER answer into the visible assistant reply now — do not only write to disk.`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'delivery-gate',
      form: 'notice',
      summary: `DeliveryGate: require chat-visible MAIN/OTHER delivery for unit ${unit.id}`,
    },
  })
}

export function isDeliveryGateNotice(message: UserMessage): boolean {
  return message.source.kind === 'delivery-gate'
}

/** Session-local WorkUnit table (P0: in-memory, Agent lifetime). */
export class WorkUnitRegistry {
  private readonly units = new Map<string, WorkUnit>()
  private activeId: string | null = null
  private seq = 0
  lastCheckpoint: StepCheckpoint | null = null

  create(input: CreateWorkUnitInput): WorkUnit {
    this.seq += 1
    const id = input.id ?? `wu-${this.seq}`
    if (this.units.has(id)) {
      throw new Error(`WorkUnitRegistry: duplicate unit id "${id}"`)
    }
    const unit: WorkUnit = {
      id,
      goalSummary: summarizeGoal(input.goalSummary),
      status: 'pending',
      lane: input.lane ?? 'user',
      createdAtStep: input.createdAtStep ?? 0,
      createdAtTurn: input.createdAtTurn ?? 0,
      checkpoints: [],
      delivery: { chatPosted: false, workspaceOnly: false },
      foldedOtherSummaries: [],
      gateRetries: 0,
    }
    this.units.set(id, unit)
    return unit
  }

  get(id: string): WorkUnit | undefined {
    return this.units.get(id)
  }

  list(): WorkUnit[] {
    return [...this.units.values()]
  }

  bindActive(id: string | null): void {
    if (id !== null && !this.units.has(id)) {
      throw new Error(`WorkUnitRegistry: cannot bind unknown unit "${id}"`)
    }
    this.activeId = id
  }

  active(): WorkUnit | null {
    if (this.activeId === null) return null
    return this.units.get(this.activeId) ?? null
  }

  markStatus(id: string, status: WorkUnitStatus): void {
    const unit = this.units.get(id)
    if (!unit) throw new Error(`WorkUnitRegistry: unknown unit "${id}"`)
    unit.status = status
  }

  foldOther(unitId: string, otherSummary: string): void {
    const unit = this.units.get(unitId)
    if (!unit) throw new Error(`WorkUnitRegistry: unknown unit "${unitId}"`)
    const summary = summarizeGoal(otherSummary, 120)
    unit.foldedOtherSummaries.push(summary)
  }

  updateDelivery(id: string, flags: Partial<WorkUnitDelivery>): void {
    const unit = this.units.get(id)
    if (!unit) throw new Error(`WorkUnitRegistry: unknown unit "${id}"`)
    unit.delivery = { ...unit.delivery, ...flags }
  }

  appendCheckpoint(cp: Omit<StepCheckpoint, 'at'> & { at?: number }): StepCheckpoint {
    const unit = this.units.get(cp.unitId)
    if (!unit) throw new Error(`WorkUnitRegistry: unknown unit "${cp.unitId}"`)
    const full: StepCheckpoint = {
      ...cp,
      toolResultRefs: [...cp.toolResultRefs],
      delivery: { ...cp.delivery },
      at: cp.at ?? Date.now(),
    }
    unit.checkpoints.push(full)
    unit.delivery = { ...full.delivery }
    unit.status = full.status
    this.lastCheckpoint = full
    return full
  }

  /** Ensure a MAIN unit exists for the given goal; bind it active and mark running/paused. */
  ensureMainUnit(options: {
    goalSummary: string
    turn: number
    step: number
    status?: WorkUnitStatus
  }): WorkUnit {
    const existing = this.active()
    if (existing && (existing.status === 'running' || existing.status === 'paused' || existing.status === 'pending')) {
      if (options.status) existing.status = options.status
      return existing
    }
    const unit = this.create({
      goalSummary: options.goalSummary,
      lane: 'user',
      createdAtTurn: options.turn,
      createdAtStep: options.step,
    })
    unit.status = options.status ?? 'running'
    this.bindActive(unit.id)
    return unit
  }

  tryComplete(id: string, options: { deliveryGate: boolean; maxRetries?: number }): boolean {
    const unit = this.units.get(id)
    if (!unit) return false
    if (!canMarkCompleted(unit, options)) return false
    unit.status = 'completed'
    return true
  }

  bumpGateRetry(id: string): number {
    const unit = this.units.get(id)
    if (!unit) throw new Error(`WorkUnitRegistry: unknown unit "${id}"`)
    unit.gateRetries += 1
    return unit.gateRetries
  }

  snapshot(): WorkUnitSnapshot {
    return {
      activeId: this.activeId,
      units: this.list().map(u => ({
        ...u,
        checkpoints: [...u.checkpoints],
        foldedOtherSummaries: [...u.foldedOtherSummaries],
        delivery: { ...u.delivery },
      })),
    }
  }
}

/** Trajectory-friendly DeliveryGate meta (not a user chat bubble). */
export interface DeliveryGateMeta {
  readonly kind: 'delivery-gate'
  readonly unitId: string
  readonly gateRetries: number
  readonly injected: boolean
  readonly marker: typeof DELIVERY_GATE_MARKER
}

export function buildDeliveryGateMeta(unit: WorkUnit, injected: boolean): DeliveryGateMeta {
  return {
    kind: 'delivery-gate',
    unitId: unit.id,
    gateRetries: unit.gateRetries,
    injected,
    marker: DELIVERY_GATE_MARKER,
  }
}
