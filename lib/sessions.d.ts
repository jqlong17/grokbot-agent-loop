/**
 * Dual-session model — Ideal Topology v1.
 *
 * Main inference session = live model+tools work.
 * Summary session = carrier that compresses completed turns into next context.
 * Summary path may be a stub; interfaces are first-class in 0.2.0.
 *
 * @module @harness-plugins/grokbot-agent-loop/sessions
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
/** Role of a session in the dual-session topology. */
export type SessionRole = 'main' | 'summary';
/** Handle describing one half of the dual-session pair. */
export interface DualSessionHandle {
    readonly role: SessionRole;
    readonly sessionId: SessionId | string;
}
/**
 * Main + Summary session pair.
 * `summary` may be null when the summary carrier is not mounted (stub OK).
 */
export interface DualSessionPair {
    readonly main: DualSessionHandle;
    readonly summary: DualSessionHandle | null;
}
/** Summary carrier interface — stub implementations return empty summary. */
export interface SummarySession {
    readonly sessionId: SessionId | string;
    /** Produce a summary carrier string for the next main-context injection. */
    summarize(input: {
        readonly completedTurn: number;
        readonly transcriptHint?: string;
    }): Promise<string> | string;
}
/** No-op summary carrier (default until a real summary session is wired). */
export declare class StubSummarySession implements SummarySession {
    readonly sessionId: SessionId | string;
    constructor(sessionId?: SessionId | string);
    summarize(): string;
}
/** Build a dual-session pair from a live main session id. */
export declare function dualSessionPair(mainSessionId: SessionId | string, summary?: SummarySession | null): DualSessionPair;
//# sourceMappingURL=sessions.d.ts.map