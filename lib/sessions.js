/**
 * Dual-session model — Ideal Topology v1.
 *
 * Main inference session = live model+tools work.
 * Summary session = carrier that compresses completed turns into next context.
 * Summary path may be a stub; interfaces are first-class in 0.2.0.
 *
 * @module @harness-plugins/grokbot-agent-loop/sessions
 */
/** No-op summary carrier (default until a real summary session is wired). */
export class StubSummarySession {
    sessionId;
    constructor(sessionId = 'summary-stub') {
        this.sessionId = sessionId;
    }
    summarize() {
        return '';
    }
}
/** Build a dual-session pair from a live main session id. */
export function dualSessionPair(mainSessionId, summary = null) {
    return {
        main: { role: 'main', sessionId: mainSessionId },
        summary: summary
            ? { role: 'summary', sessionId: summary.sessionId }
            : null,
    };
}
//# sourceMappingURL=sessions.js.map