/** Dual-session + summary carrier — Ideal Topology v1.1 layout. */
export { dualSessionPair, StubSummarySession, MemorySummarySession, SUMMARY_CARRIER_MARKER, buildSummaryCarrierMessage, parseSummaryCarrierText, isSummaryCarrierMessage, } from "../sessions.js";
export function asMainSession(sessionId) {
    return { sessionId, role: 'main' };
}
/**
 * Inject summary carrier into a MAIN-bound message list (testable contract).
 * Does not own UI — just prepends/appends the user-role carrier.
 */
export function injectSummaryCarrierIntoMain(mainMessages, carrierMessage, position = 'append') {
    if (!carrierMessage)
        return [...mainMessages];
    return position === 'prepend'
        ? [carrierMessage, ...mainMessages]
        : [...mainMessages, carrierMessage];
}
//# sourceMappingURL=main-summary.js.map