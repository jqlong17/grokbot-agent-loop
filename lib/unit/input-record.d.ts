/**
 * Work identity ≠ Input identity — Ideal Topology v1.1.
 * @module @harness-plugins/grokbot-agent-loop/unit/input-record
 */
/** Stable logical work identity (survives hydrate). */
export type WorkId = string;
/** One admitted user/peer input identity. */
export type InputId = string;
/** Single input relative to a work. */
export interface InputRecord {
    readonly inputId: InputId;
    readonly workId: WorkId;
    /** Dedup / double-submit guard (process-local in 0.2.0). */
    readonly nonce: string;
    readonly text: string;
    readonly at: number;
    /** Sequence within the work (0-based). */
    readonly seq: number;
}
/** Mint a fresh workId. */
export declare function createWorkId(prefix?: string): WorkId;
/** Mint an InputRecord bound to a work. */
export declare function createInputRecord(options: {
    workId: WorkId;
    text: string;
    nonce?: string;
    at?: number;
    seq?: number;
}): InputRecord;
//# sourceMappingURL=input-record.d.ts.map