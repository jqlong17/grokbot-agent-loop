/**
 * Unit barrel — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/unit
 */

export * from './work-unit.ts'
export { WorkUnitRegistry } from './registry.ts'
export {
  InProcessRunner,
  SubagentRunner,
  type UnitRunner,
  type UnitStepResult,
  type SubagentRunnerOptions,
} from './runner.ts'
export {
  peerPacketFromSubagentResult,
  resolveSubagentsRuntime,
  startWorkUnitSubagent,
  type StartedWorkUnitSubagent,
  type StartWorkUnitSubagentOptions,
  type SubagentActivationLike,
  type SubagentResultLike,
  type SubagentsRuntimeLike,
} from './subagent.ts'
