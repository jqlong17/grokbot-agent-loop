/**
 * Work identity ≠ Input identity — Ideal Topology v1.1.
 * @module @harness-plugins/grokbot-agent-loop/unit/input-record
 */
import { randomUUID } from 'node:crypto';
let inputSeq = 0;
/** Mint a fresh workId. */
export function createWorkId(prefix = 'work') {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
}
/** Mint an InputRecord bound to a work. */
export function createInputRecord(options) {
    inputSeq += 1;
    return {
        inputId: `in-${randomUUID().slice(0, 8)}`,
        workId: options.workId,
        nonce: options.nonce ?? `n-${randomUUID().slice(0, 8)}`,
        text: options.text,
        at: options.at ?? Date.now(),
        seq: options.seq ?? inputSeq,
    };
}
//# sourceMappingURL=input-record.js.map