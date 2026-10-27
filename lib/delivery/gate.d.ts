/**
 * DeliveryGate — Ideal Topology v1 completion gate.
 * @module @harness-plugins/grokbot-agent-loop/delivery/gate
 */
import { DELIVERY_GATE_MARKER, DEFAULT_DELIVERY_GATE_MAX, DEFAULT_SUBSTANTIVE_MIN_CHARS, buildDeliveryGateMeta, buildDeliveryGateNotice, canMarkCompleted, inferDeliveryFromBlocks, isDeliveryGateNotice, isDeliverySpecMet, isSubstantiveAssistantText, shouldRunDeliveryGate, verifyDeliverySpec, type DeliveryGateMeta, type DeliverySink, type DeliverySpec, type InferDeliveryOptions, type WorkUnit } from '../unit/work-unit.ts';
export { DELIVERY_GATE_MARKER, DEFAULT_DELIVERY_GATE_MAX, DEFAULT_SUBSTANTIVE_MIN_CHARS, buildDeliveryGateMeta, buildDeliveryGateNotice, canMarkCompleted, inferDeliveryFromBlocks, isDeliveryGateNotice, isDeliverySpecMet, isSubstantiveAssistantText, shouldRunDeliveryGate, verifyDeliverySpec, type DeliveryGateMeta, type DeliverySink, type DeliverySpec, type InferDeliveryOptions, };
/**
 * Thin gate façade used by MergeBus / Orchestrator after fold-back.
 * Keeps DeliveryGate as a first-class Ideal Topology object.
 */
export declare class DeliveryGate {
    private readonly options;
    constructor(options?: {
        enabled: boolean;
        maxRetries?: number;
    });
    shouldContinue(unit: WorkUnit): boolean;
    canComplete(unit: WorkUnit): boolean;
}
//# sourceMappingURL=gate.d.ts.map