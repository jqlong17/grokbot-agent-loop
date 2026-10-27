/**
 * MergeBus — fold-back + peer handoff into MAIN + DeliveryGate.
 * @module @harness-plugins/grokbot-agent-loop/merge/bus
 */
import { UNIT_FOLD_BACK_MARKER, } from "../unit/work-unit.js";
import { DeliveryGate } from "../delivery/gate.js";
export class MergeBus {
    registry;
    options;
    gate;
    constructor(registry, options = {}) {
        this.registry = registry;
        this.options = options;
        this.gate = new DeliveryGate({
            enabled: options.deliveryGate !== false,
            maxRetries: options.maxRetries,
        });
    }
    publish(packet) {
        const { main, sibling, notice } = this.registry.foldSiblingIntoMain({
            siblingId: packet.siblingId,
            packet: packet.packet ?? null,
            deliveryGate: this.options.deliveryGate !== false,
            maxRetries: this.options.maxRetries,
        });
        return {
            main,
            sibling,
            notice,
            gatePending: this.gate.shouldContinue(main),
        };
    }
    static FOLD_BACK_MARKER = UNIT_FOLD_BACK_MARKER;
}
//# sourceMappingURL=bus.js.map