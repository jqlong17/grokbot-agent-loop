/**
 * Dual-session model — Ideal Topology v1.1.
 *
 * Main inference session = live model+tools work.
 * Summary session = compresses completed turns; injects back as **user-role
 * carrier** into the MAIN path (no second product UI).
 *
 * @module @harness-plugins/grokbot-agent-loop/sessions
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** Marker prefix for user-role summary carrier text injected into MAIN. */
export const SUMMARY_CARRIER_MARKER = '[grokbot-summary-carrier]';
/** No-op summary carrier (compat / opt-out). */
export class StubSummarySession {
    sessionId;
    constructor(sessionId = 'summary-stub') {
        this.sessionId = sessionId;
    }
    summarize() {
        return '';
    }
    toCarrier() {
        return null;
    }
}
/**
 * Minimal in-memory SummarySession (0.2.3).
 * Accumulates turn hints and emits a user-role carrier for MAIN.
 */
export class MemorySummarySession {
    sessionId;
    records = [];
    constructor(sessionId = 'summary-memory') {
        this.sessionId = sessionId;
    }
    /** Append a turn fragment into the summary session. */
    record(input) {
        const parts = [
            input.transcriptHint?.trim(),
            input.notes?.trim(),
        ].filter((p) => Boolean(p && p.length > 0));
        const text = parts.join(' | ') || `turn=${input.completedTurn}`;
        const record = {
            completedTurn: input.completedTurn,
            text,
            at: Date.now(),
        };
        this.records.push(record);
        return record;
    }
    /** All recorded fragments (tests / trajectory). */
    get history() {
        return this.records;
    }
    summarize(input) {
        if (input.transcriptHint?.trim()) {
            this.record({
                completedTurn: input.completedTurn,
                transcriptHint: input.transcriptHint,
            });
        }
        const relevant = this.records.filter(r => r.completedTurn <= input.completedTurn);
        if (relevant.length === 0)
            return '';
        // Cheap compress: last N fragments joined (no LLM).
        const window = relevant.slice(-8);
        return window.map(r => `t${r.completedTurn}:${r.text}`).join('; ');
    }
    toCarrier(input) {
        const body = this.summarize(input).trim();
        if (!body)
            return null;
        return {
            marker: SUMMARY_CARRIER_MARKER,
            role: 'user',
            text: `${SUMMARY_CARRIER_MARKER} ${body}`,
            body,
            completedTurn: input.completedTurn,
            summarySessionId: String(this.sessionId),
        };
    }
    /**
     * Build a UserMessage for MAIN next-step / context injection.
     * Returns null when there is nothing to carry.
     */
    toUserMessage(input) {
        const carrier = this.toCarrier(input);
        if (!carrier)
            return null;
        return buildSummaryCarrierMessage(carrier);
    }
}
/** Build a user-role UserMessage from a SummaryCarrier. */
export function buildSummaryCarrierMessage(carrier) {
    // Reuse unit-fold-hint producer shape (dsh source.kind closed union); marker identifies carrier.
    return createUserMessage({
        content: [{ type: 'text', text: carrier.text }],
        source: {
            kind: 'unit-fold-hint',
            form: 'notice',
            summary: `SummarySession carrier → MAIN (turn ${carrier.completedTurn})`,
        },
    });
}
/** Extract carrier body if `text` is a summary-carrier notice; else null. */
export function parseSummaryCarrierText(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith(SUMMARY_CARRIER_MARKER))
        return null;
    const body = trimmed.slice(SUMMARY_CARRIER_MARKER.length).trim();
    return body.length > 0 ? body : null;
}
/** True when a UserMessage looks like a summary carrier injection. */
export function isSummaryCarrierMessage(message) {
    for (const block of message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
            if (parseSummaryCarrierText(block.text) !== null)
                return true;
        }
    }
    const summary = message.source?.summary;
    return typeof summary === 'string' && /SummarySession carrier/i.test(summary);
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