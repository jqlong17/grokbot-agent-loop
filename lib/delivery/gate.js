/**
 * DeliveryGate — Ideal Topology v1 completion gate.
 * @module @harness-plugins/grokbot-agent-loop/delivery/gate
 */
import { DELIVERY_GATE_MARKER, DEFAULT_DELIVERY_GATE_MAX, DEFAULT_SUBSTANTIVE_MIN_CHARS, buildDeliveryGateMeta, buildDeliveryGateNotice, canMarkCompleted, inferDeliveryFromBlocks, isDeliveryGateNotice, isDeliverySpecMet, isSubstantiveAssistantText, shouldRunDeliveryGate, verifyDeliverySpec, } from "../unit/work-unit.js";
export { DELIVERY_GATE_MARKER, DEFAULT_DELIVERY_GATE_MAX, DEFAULT_SUBSTANTIVE_MIN_CHARS, buildDeliveryGateMeta, buildDeliveryGateNotice, canMarkCompleted, inferDeliveryFromBlocks, isDeliveryGateNotice, isDeliverySpecMet, isSubstantiveAssistantText, shouldRunDeliveryGate, verifyDeliverySpec, };
/**
 * Thin gate façade used by MergeBus / Orchestrator after fold-back.
 * Keeps DeliveryGate as a first-class Ideal Topology object.
 */
export class DeliveryGate {
    options;
    constructor(options = { enabled: true }) {
        this.options = options;
    }
    shouldContinue(unit) {
        return shouldRunDeliveryGate(unit, {
            enabled: this.options.enabled,
            maxRetries: this.options.maxRetries,
        });
    }
    canComplete(unit) {
        return canMarkCompleted(unit, {
            deliveryGate: this.options.enabled,
            maxRetries: this.options.maxRetries,
        });
    }
}
//# sourceMappingURL=gate.js.map