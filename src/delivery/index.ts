/**
 * Delivery barrel — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/delivery
 */

export {
  DeliveryGate,
  DELIVERY_GATE_MARKER,
  DEFAULT_DELIVERY_GATE_MAX,
  DEFAULT_SUBSTANTIVE_MIN_CHARS,
  buildDeliveryGateMeta,
  buildDeliveryGateNotice,
  canMarkCompleted,
  inferDeliveryFromBlocks,
  isDeliveryGateNotice,
  isDeliverySpecMet,
  isSubstantiveAssistantText,
  shouldRunDeliveryGate,
  verifyDeliverySpec,
  type DeliveryGateMeta,
  type DeliverySink,
  type DeliverySpec,
  type InferDeliveryOptions,
} from './gate.ts'
