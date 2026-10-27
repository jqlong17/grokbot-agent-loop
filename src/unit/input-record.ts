/**
 * Work identity ≠ Input identity — Ideal Topology v1.1.
 * @module @harness-plugins/grokbot-agent-loop/unit/input-record
 */

import { randomUUID } from 'node:crypto'

/** Stable logical work identity (survives hydrate). */
export type WorkId = string

/** One admitted user/peer input identity. */
export type InputId = string

/** Single input relative to a work. */
export interface InputRecord {
  readonly inputId: InputId
  readonly workId: WorkId
  /** Dedup / double-submit guard (process-local in 0.2.0). */
  readonly nonce: string
  readonly text: string
  readonly at: number
  /** Sequence within the work (0-based). */
  readonly seq: number
}

let inputSeq = 0

/** Mint a fresh workId. */
export function createWorkId(prefix = 'work'): WorkId {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

/** Mint an InputRecord bound to a work. */
export function createInputRecord(options: {
  workId: WorkId
  text: string
  nonce?: string
  at?: number
  seq?: number
}): InputRecord {
  inputSeq += 1
  return {
    inputId: `in-${randomUUID().slice(0, 8)}`,
    workId: options.workId,
    nonce: options.nonce ?? `n-${randomUUID().slice(0, 8)}`,
    text: options.text,
    at: options.at ?? Date.now(),
    seq: options.seq ?? inputSeq,
  }
}
