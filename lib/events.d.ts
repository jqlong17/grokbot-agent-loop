/**
 * AgentEvent / trajectory stream — Ideal Topology v1.
 *
 * Outer harness emits structured control events; inner dsh loop owns ReAct I/O.
 * Minimal emitter for tests / trajectory tooling.
 *
 * @module @harness-plugins/grokbot-agent-loop/events
 */
import type { OrchestratorAction } from './orchestrator/types.ts';
/** Structured outer-harness trajectory events. */
export type AgentEvent = {
    type: 'admit';
    action: OrchestratorAction;
    unitIds: readonly string[];
    at: number;
} | {
    type: 'step-start';
    unitId: string;
    turn: number;
    step: number;
    at: number;
} | {
    type: 'tool';
    unitId: string;
    toolCallId: string;
    name?: string;
    at: number;
} | {
    type: 'checkpoint';
    unitId: string;
    stepIndex: number;
    reason: string;
    at: number;
} | {
    type: 'absorb';
    unitId: string;
    at: number;
} | {
    type: 'spawn';
    unitId: string;
    parentId: string;
    degraded?: boolean;
    at: number;
} | {
    type: 'merge';
    siblingId: string;
    mainId: string;
    at: number;
} | {
    type: 'settle';
    unitId: string;
    at: number;
} | {
    type: 'decision';
    action: OrchestratorAction;
    reason: string;
    at: number;
};
export type AgentEventListener = (event: AgentEvent) => void;
/** Minimal synchronous event emitter (tests + trajectory). */
export declare class AgentEventBus {
    private readonly listeners;
    readonly history: AgentEvent[];
    on(listener: AgentEventListener): () => void;
    emit(event: AgentEvent): void;
    clear(): void;
}
//# sourceMappingURL=events.d.ts.map