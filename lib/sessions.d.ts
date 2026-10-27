/**
 * Dual-session model — Ideal Topology v1.1.
 *
 * Main inference session = live model+tools work.
 * Summary session = compresses completed turns; injects back as **user-role
 * carrier** into the MAIN path (no second product UI).
 *
 * @module @harness-plugins/grokbot-agent-loop/sessions
 */
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session';
/** Role of a session in the dual-session topology. */
export type SessionRole = 'main' | 'summary';
/** Handle describing one half of the dual-session pair. */
export interface DualSessionHandle {
    readonly role: SessionRole;
    readonly sessionId: SessionId | string;
}
/**
 * Main + Summary session pair.
 * `summary` may be null when the summary carrier is not mounted.
 */
export interface DualSessionPair {
    readonly main: DualSessionHandle;
    readonly summary: DualSessionHandle | null;
}
/** Marker prefix for user-role summary carrier text injected into MAIN. */
export declare const SUMMARY_CARRIER_MARKER = "[grokbot-summary-carrier]";
/** One recorded summary fragment inside a SummarySession. */
export interface SummaryRecord {
    readonly completedTurn: number;
    readonly text: string;
    readonly at: number;
}
/**
 * User-role carrier payload ready for MAIN inbox / context injection.
 * Contract: role is always `user`; never assistant — summary is a carrier.
 */
export interface SummaryCarrier {
    readonly marker: typeof SUMMARY_CARRIER_MARKER;
    readonly role: 'user';
    readonly text: string;
    readonly body: string;
    readonly completedTurn: number;
    readonly summarySessionId: string;
}
/** Summary carrier interface. */
export interface SummarySession {
    readonly sessionId: SessionId | string;
    /** Produce a summary string for the next main-context injection. */
    summarize(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
    }): Promise<string> | string;
    /** Build the user-role carrier object (may be empty when nothing to inject). */
    toCarrier?(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
    }): SummaryCarrier | null;
}
/** No-op summary carrier (compat / opt-out). */
export declare class StubSummarySession implements SummarySession {
    readonly sessionId: SessionId | string;
    constructor(sessionId?: SessionId | string);
    summarize(): string;
    toCarrier(): null;
}
/**
 * Minimal in-memory SummarySession (0.2.3).
 * Accumulates turn hints and emits a user-role carrier for MAIN.
 */
export declare class MemorySummarySession implements SummarySession {
    readonly sessionId: SessionId | string;
    private readonly records;
    constructor(sessionId?: SessionId | string);
    /** Append a turn fragment into the summary session. */
    record(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
        readonly notes?: string;
    }): SummaryRecord;
    /** All recorded fragments (tests / trajectory). */
    get history(): readonly SummaryRecord[];
    summarize(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
    }): string;
    toCarrier(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
    }): SummaryCarrier | null;
    /**
     * Build a UserMessage for MAIN next-step / context injection.
     * Returns null when there is nothing to carry.
     */
    toUserMessage(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
    }): UserMessage | null;
}
/** Build a user-role UserMessage from a SummaryCarrier. */
export declare function buildSummaryCarrierMessage(carrier: SummaryCarrier): UserMessage;
/** Extract carrier body if `text` is a summary-carrier notice; else null. */
export declare function parseSummaryCarrierText(text: string): string | null;
/** True when a UserMessage looks like a summary carrier injection. */
export declare function isSummaryCarrierMessage(message: UserMessage): boolean;
/** Build a dual-session pair from a live main session id. */
export declare function dualSessionPair(mainSessionId: SessionId | string, summary?: SummarySession | null): DualSessionPair;
//# sourceMappingURL=sessions.d.ts.map