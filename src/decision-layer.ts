/**
 * DecisionLayer — cheap deterministic score/route (Ideal Topology v1.1).
 *
 * Orchestrator may consult this before committing an expensive spawn.
 * LLM is not the OS: rules only; Orchestrator remains the sole admit brain.
 *
 * @module @harness-plugins/grokbot-agent-loop/decision-layer
 */

import type { AdmitEvent, OrchestratorAction } from './orchestrator/types.ts'
import { userMessagePlainText } from './steer-fold.ts'

export interface DecisionLayerInput {
  readonly event: AdmitEvent
  readonly proposed: OrchestratorAction
}

export interface DecisionLayerResult {
  readonly action: OrchestratorAction
  readonly reason: string
  /** Cheap confidence in [0, 1]. */
  readonly score: number
}

/** Optional cheap decision hook consulted before spawn. */
export interface DecisionLayer {
  decide(input: DecisionLayerInput): DecisionLayerResult | Promise<DecisionLayerResult>
}

/** Default: pass through proposed action (opt-out / tests). */
export class PassthroughDecisionLayer implements DecisionLayer {
  decide(input: DecisionLayerInput): DecisionLayerResult {
    return {
      action: input.proposed,
      reason: 'passthrough',
      score: 1,
    }
  }
}

/** Explicit cancel / queue / short-OTHER absorb / independent spawn cues. */
const SHORT_ACK =
  /^(ok|okay|yes|yep|继续|好的|好|嗯|行|go on|continue|same|同上|got it|lgtm)\s*[.!！。]?$/iu

const TASKISH =
  /\b(write|build|pack|list|fix|create|fix|implement|fix|search|fetch|帮|写|列|打包|实现|搜索)\b/iu

/**
 * Pure score/route helper — unit-testable without Orchestrator.
 * Does not mutate state; Orchestrator applies the returned action.
 */
export function scoreRoute(input: DecisionLayerInput): DecisionLayerResult {
  const { event, proposed } = input
  const otherText = (
    event.otherText
    ?? (event.input ? userMessagePlainText(event.input) : null)
    ?? ''
  ).trim()
  const mainGoal = (event.mainGoalText ?? '').trim()

  // Hard: explicit cancel.
  if (event.cancelUnitId) {
    return {
      action: 'cancel',
      reason: `explicit cancel unit ${event.cancelUnitId}`,
      score: 1,
    }
  }

  // Hard: Foundry-style same-work continuous steer → queue.
  if (event.queueSteer) {
    return {
      action: 'queue',
      reason: 'queue(steer) — same work, no dual race',
      score: 0.95,
    }
  }

  // Respect fold / non-preempt absorb from classify — do not upgrade to spawn.
  if (proposed === 'absorb' || proposed === 'queue' || proposed === 'cancel') {
    return {
      action: proposed,
      reason: `respect classify:${proposed}`,
      score: 0.9,
    }
  }

  // proposed === 'spawn' — may cheaply downgrade short / same-deliverable OTHER.
  if (looksLikeShortAck(otherText)) {
    return {
      action: 'absorb',
      reason: 'short OTHER / ack → absorb (skip expensive spawn)',
      score: 0.85,
    }
  }

  if (mainGoal && sameDeliverable(mainGoal, otherText)) {
    return {
      action: 'absorb',
      reason: 'same deliverable as MAIN → absorb',
      score: 0.8,
    }
  }

  // Independent parallel work → keep spawn.
  if (looksIndependent(otherText, mainGoal)) {
    return {
      action: 'spawn',
      reason: 'independent OTHER → spawn',
      score: 0.88,
    }
  }

  // Default: keep proposed spawn (ideal path / degrade handled by Orchestrator).
  return {
    action: 'spawn',
    reason: 'default spawn (DecisionLayer)',
    score: 0.7,
  }
}

/** Rule-based DecisionLayer (0.2.2 default for Orchestrator). */
export class RuleDecisionLayer implements DecisionLayer {
  decide(input: DecisionLayerInput): DecisionLayerResult {
    return scoreRoute(input)
  }
}

function looksLikeShortAck(text: string): boolean {
  if (!text) return true
  if (SHORT_ACK.test(text)) return true
  // Very short and not task-like → absorb rather than open a second Session.
  if (text.length <= 12 && !TASKISH.test(text)) return true
  return false
}

function tokenize(text: string): Set<string> {
  const parts = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter(t => t.length >= 2)
  return new Set(parts)
}

/** High overlap / OTHER is a small continuation of MAIN → same deliverable. */
function sameDeliverable(mainGoal: string, otherText: string): boolean {
  if (!otherText || otherText.length > 80) return false
  const main = tokenize(mainGoal)
  const other = tokenize(otherText)
  if (other.size === 0 || main.size === 0) return false
  let hit = 0
  for (const t of other) {
    if (main.has(t)) hit += 1
  }
  const overlap = hit / other.size
  // OTHER mostly repeats MAIN tokens and is short → fold into MAIN.
  return overlap >= 0.6 && otherText.length <= 64
}

function looksIndependent(otherText: string, mainGoal: string): boolean {
  if (otherText.length >= 16 && TASKISH.test(otherText)) return true
  if (!mainGoal) return otherText.length >= 16
  const main = tokenize(mainGoal)
  const other = tokenize(otherText)
  if (other.size === 0) return false
  let hit = 0
  for (const t of other) {
    if (main.has(t)) hit += 1
  }
  return hit / other.size < 0.4
}
