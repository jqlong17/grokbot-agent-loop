/**
 * MergeBus — fold-back + peer handoff into MAIN + DeliveryGate.
 * @module @harness-plugins/grokbot-agent-loop/merge/bus
 */

import type { UserMessage } from '@deepseek-ai/dsh-session'
import {
  UNIT_FOLD_BACK_MARKER,
  WorkUnitRegistry,
  type PeerHandoffPacket,
  type WorkUnit,
} from '../unit/work-unit.ts'
import { DeliveryGate } from '../delivery/gate.ts'

export interface MergePacket {
  readonly siblingId: string
  readonly packet?: PeerHandoffPacket | null
}

export interface MergePublishResult {
  readonly main: WorkUnit
  readonly sibling: WorkUnit
  readonly notice: UserMessage
  readonly gatePending: boolean
}

export interface MergeBusOptions {
  readonly deliveryGate?: boolean
  readonly maxRetries?: number
}

export class MergeBus {
  readonly gate: DeliveryGate

  constructor(
    private readonly registry: WorkUnitRegistry,
    private readonly options: MergeBusOptions = {},
  ) {
    this.gate = new DeliveryGate({
      enabled: options.deliveryGate !== false,
      maxRetries: options.maxRetries,
    })
  }

  publish(packet: MergePacket): MergePublishResult {
    const { main, sibling, notice } = this.registry.foldSiblingIntoMain({
      siblingId: packet.siblingId,
      packet: packet.packet ?? null,
      deliveryGate: this.options.deliveryGate !== false,
      maxRetries: this.options.maxRetries,
    })
    return {
      main,
      sibling,
      notice,
      gatePending: this.gate.shouldContinue(main),
    }
  }

  static readonly FOLD_BACK_MARKER = UNIT_FOLD_BACK_MARKER
}
