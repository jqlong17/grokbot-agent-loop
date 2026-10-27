/**
 * MergeBus — fold-back + peer handoff into MAIN + DeliveryGate.
 * @module @harness-plugins/grokbot-agent-loop/merge/bus
 */
import type { UserMessage } from '@deepseek-ai/dsh-session';
import { WorkUnitRegistry, type PeerHandoffPacket, type WorkUnit } from '../unit/work-unit.ts';
import { DeliveryGate } from '../delivery/gate.ts';
export interface MergePacket {
    readonly siblingId: string;
    readonly packet?: PeerHandoffPacket | null;
}
export interface MergePublishResult {
    readonly main: WorkUnit;
    readonly sibling: WorkUnit;
    readonly notice: UserMessage;
    readonly gatePending: boolean;
}
export interface MergeBusOptions {
    readonly deliveryGate?: boolean;
    readonly maxRetries?: number;
}
export declare class MergeBus {
    private readonly registry;
    private readonly options;
    readonly gate: DeliveryGate;
    constructor(registry: WorkUnitRegistry, options?: MergeBusOptions);
    publish(packet: MergePacket): MergePublishResult;
    static readonly FOLD_BACK_MARKER = "[grokbot-unit-fold-back]";
}
//# sourceMappingURL=bus.d.ts.map