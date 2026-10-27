/**
 * RPWU P1.5 — host subagent seam helpers (duck-typed; no hard dep on dsh-subagent).
 *
 * True parallel = parent Agent keeps its turn while `ctx.subagents.startActivation`
 * runs a child Agent + child Session. This module only starts activations and
 * maps results into registry fold-back packets.
 *
 * @module @harness-plugins/grokbot-agent-loop/work-unit-subagent
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type PeerHandoffPacket, type WorkUnitActivationRef } from './work-unit.ts';
/** Minimal activation result shape we consume from the host seam. */
export interface SubagentResultLike {
    readonly output: readonly ContentBlock[];
    readonly structured?: unknown;
    readonly diagnostic?: string;
    readonly stopReason: string;
}
/** Minimal activation handle returned by `startActivation`. */
export interface SubagentActivationLike {
    readonly childId: string;
    readonly messageId?: string;
    readonly result: Promise<SubagentResultLike>;
    dispose(): Promise<void>;
}
/** Duck-typed `ctx.subagents` surface used by this plugin. */
export interface SubagentsRuntimeLike {
    startActivation(spec: {
        readonly provider: string;
        readonly label: string;
        readonly request: {
            readonly parent: Agent;
            readonly prompt: ContentBlock[];
            readonly agentOptions?: unknown;
        };
        readonly signal: AbortSignal;
        readonly delivery: 'parent' | 'caller';
    }): Promise<SubagentActivationLike>;
}
export interface ResolveSubagentsOptions {
    /**
     * Cordis context that may expose `subagents` when the host mounts dsh-subagent.
     * Prefer `get('subagents')` — bare `.subagents` throws when the service is not injected.
     */
    readonly ctx: {
        subagents?: SubagentsRuntimeLike;
        get?(name: string, strict?: boolean): unknown;
    } | null | undefined;
}
/** True when the host seam exposes a callable `startActivation`. */
export declare function resolveSubagentsRuntime(options: ResolveSubagentsOptions): SubagentsRuntimeLike | null;
export interface StartWorkUnitSubagentOptions {
    readonly subagents: SubagentsRuntimeLike;
    readonly parent: Agent;
    readonly promptText: string;
    readonly label?: string;
    readonly provider?: string;
    readonly delivery?: 'parent' | 'caller';
    readonly signal?: AbortSignal;
}
export interface StartedWorkUnitSubagent {
    readonly activation: SubagentActivationLike;
    readonly activationRef: WorkUnitActivationRef;
}
/**
 * Start a host child for a forked OTHER WorkUnit.
 * Caller owns fold-back via `activation.result` (prefer `delivery: 'caller'`).
 */
export declare function startWorkUnitSubagent(options: StartWorkUnitSubagentOptions): Promise<StartedWorkUnitSubagent>;
/** Prefer structured peer packet; else derive theme/keyPoints from assistant text. */
export declare function peerPacketFromSubagentResult(result: SubagentResultLike, goalSummary: string): PeerHandoffPacket;
//# sourceMappingURL=subagent.d.ts.map