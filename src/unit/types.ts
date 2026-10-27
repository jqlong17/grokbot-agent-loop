/**
 * WorkUnit model types — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/unit/types
 */

export type {
  CheckpointReason,
  CreateWorkUnitInput,
  DeliveryGateMeta,
  DeliverySink,
  DeliverySpec,
  InferDeliveryOptions,
  PeerHandoffPacket,
  RpwuOtherMode,
  StepCheckpoint,
  ToolResultRef,
  WorkUnit,
  WorkUnitActivationRef,
  WorkUnitDelivery,
  WorkUnitLane,
  WorkUnitQuery,
  WorkUnitSnapshot,
  WorkUnitStatus,
} from './work-unit.ts'

export {
  DEFAULT_DELIVERY_GATE_MAX,
  DEFAULT_GOAL_SUMMARY_MAX,
  DEFAULT_PEER_DELIVERY_SHAPE,
  DEFAULT_SUBSTANTIVE_MIN_CHARS,
  normalizeRpwuOtherMode,
  summarizeGoal,
  simpleTextHash,
} from './work-unit.ts'
