/** Dual-session + summary carrier — Ideal Topology v1.1 layout. */
export { dualSessionPair, StubSummarySession, MemorySummarySession, SUMMARY_CARRIER_MARKER, buildSummaryCarrierMessage, parseSummaryCarrierText, isSummaryCarrierMessage, type DualSessionHandle, type DualSessionPair, type SessionRole, type SummarySession, type SummaryCarrier, type SummaryRecord, } from '../sessions.ts';
/** Alias: MainSession is the live inference half. */
export interface MainSession {
    readonly sessionId: string;
    readonly role: 'main';
}
export declare function asMainSession(sessionId: string): MainSession;
/**
 * Inject summary carrier into a MAIN-bound message list (testable contract).
 * Does not own UI — just prepends/appends the user-role carrier.
 */
export declare function injectSummaryCarrierIntoMain(mainMessages: readonly import('@deepseek-ai/dsh-session').UserMessage[], carrierMessage: import('@deepseek-ai/dsh-session').UserMessage | null, position?: 'prepend' | 'append'): import('@deepseek-ai/dsh-session').UserMessage[];
//# sourceMappingURL=main-summary.d.ts.map