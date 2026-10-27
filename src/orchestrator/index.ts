/**
 * Orchestrator barrel — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/orchestrator
 */

export { Orchestrator } from './orchestrator.ts'
export type { OrchestratorOptions } from './orchestrator.ts'
export { classifyAdmit } from './classify.ts'
export type {
  AdmitEvent,
  AdmitResult,
  ClassifyResult,
  OrchestratorAction,
} from './types.ts'
