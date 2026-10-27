/**
 * Ideal Topology v1 — WorkUnit model + registry + delivery helpers.
 *
 * Recoverable Parallel Work Units (session-local). CheckpointStore owns
 * durability; Orchestrator owns admit/classify; this module is the unit model.
 *
 * Community homage; not affiliated with xAI.
 *
 * @module @harness-plugins/grokbot-agent-loop/unit/work-unit
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** Visible marker for unit-aware fold notices (tests / trajectory). */
export const UNIT_FOLD_MARKER = '[grokbot-unit-fold]';
/** Visible marker when OTHER is forked as a sibling WorkUnit (P1-a). */
export const UNIT_FORK_MARKER = '[grokbot-unit-fork]';
/**
 * Visible marker when fork wanted a host subagent but `ctx.subagents` was
 * missing — falls back to 0.1.8 registry-only + single-Agent cancel-then-claim.
 */
export const UNIT_FORK_DEGRADED_MARKER = '[grokbot-unit-fork-degraded]';
/** Visible marker when a completed sibling/peer result folds back into MAIN. */
export const UNIT_FOLD_BACK_MARKER = '[grokbot-unit-fold-back]';
/** Visible marker for peer/agent-lane structured handoff notices (P1-b). */
export const PEER_HANDOFF_MARKER = '[grokbot-peer-handoff]';
/** Visible marker for DeliveryGate continuation notices. */
export const DELIVERY_GATE_MARKER = '[grokbot-delivery-gate]';
/** P0/P0.1: default gate-driven continuations per unit (0.1.7+). */
export const DEFAULT_DELIVERY_GATE_MAX = 2;
/** Default minimum plain-text length to count as substantive chat delivery. */
export const DEFAULT_SUBSTANTIVE_MIN_CHARS = 400;
/** Default goalSummary truncation. */
export const DEFAULT_GOAL_SUMMARY_MAX = 240;
/** Default peer handoff delivery shape (living-handoff inspired). */
export const DEFAULT_PEER_DELIVERY_SHAPE = ['theme', 'keyPoints', 'todos'];
/**
 * Normalize config aliases → canonical admit path.
 * `spawn` | `fork` | `subagent` → spawn path; everything else → fold.
 */
export function normalizeRpwuOtherMode(mode) {
    if (mode === 'spawn' || mode === 'fork' || mode === 'subagent')
        return 'spawn';
    return 'fold';
}
/** Compact FNV-1a style hash for assistant prefix observability (not crypto). */
export function simpleTextHash(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
/** Truncate a goal for registry / fold display. */
export function summarizeGoal(text, maxLen = DEFAULT_GOAL_SUMMARY_MAX) {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= maxLen)
        return trimmed;
    return `${trimmed.slice(0, maxLen)}…`;
}
/**
 * Whether assistant text counts as a real chat deliverable (not tool narration).
 * Substantive if: fenced code; length ≥ threshold; or a short structured list.
 */
export function isSubstantiveAssistantText(text, options = {}) {
    const trimmed = text.trim();
    if (!trimmed)
        return false;
    // Fenced code (``` or ~~~) — MAIN CLI / snippets pasted into chat.
    if (/```[\s\S]*```/.test(trimmed) || /~~~[\s\S]*~~~/.test(trimmed))
        return true;
    const minChars = options.minSubstantiveChars ?? DEFAULT_SUBSTANTIVE_MIN_CHARS;
    if (trimmed.length >= minChars)
        return true;
    // Light OTHER-list heuristic: several bullet/numbered lines, enough body.
    const listLines = trimmed.split(/\n/).filter(line => /^\s*[-*•]\s+\S/.test(line)
        || /^\s*\d+[.)]\s+\S/.test(line)
        || /^\s*\d+、\s*\S/.test(line)
        || /^\s*[（(]?[一二三四五六七八九十\d]+[）)、.]\s*\S/.test(line));
    if (listLines.length >= 3 && trimmed.length >= 120)
        return true;
    return false;
}
/**
 * Delivery inference for one assistant step (0.1.7 substantive rule):
 * - tool + non-substantive text (progress / "下面开始写…") → workspaceOnly, chatPosted false
 * - substantive text (fence / long / list) → chatPosted (tools optional)
 * - pure short text, no tools → chatPosted (short answers stay valid)
 * - tool-only → workspaceOnly
 */
export function inferDeliveryFromBlocks(blocks, options = {}) {
    let hasText = false;
    let hasTool = false;
    const textParts = [];
    for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0) {
            hasText = true;
            textParts.push(b.text);
        }
        if (b.type === 'tool-call')
            hasTool = true;
    }
    const combined = textParts.join('\n');
    const substantive = hasText && isSubstantiveAssistantText(combined, options);
    // Progress narration beside tools is not chat delivery — gate should still run.
    if (hasTool && hasText && !substantive) {
        return { chatPosted: false, workspaceOnly: true };
    }
    if (substantive)
        return { chatPosted: true, workspaceOnly: false };
    if (hasText && !hasTool)
        return { chatPosted: true, workspaceOnly: false };
    if (hasTool)
        return { chatPosted: false, workspaceOnly: true };
    return { chatPosted: false, workspaceOnly: false };
}
/** Extract plain assistant text length + hash from content blocks. */
export function assistantPrefixStats(blocks) {
    const parts = [];
    for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string')
            parts.push(b.text);
    }
    const text = parts.join('');
    return { cursor: text.length, hash: simpleTextHash(text), text };
}
/** Normalize a peer handoff packet (trim + copy arrays). */
export function normalizePeerHandoffPacket(packet) {
    return {
        theme: String(packet.theme ?? '').trim(),
        keyPoints: [...(packet.keyPoints ?? [])].map(s => String(s).trim()).filter(Boolean),
        todos: [...(packet.todos ?? [])].map(s => String(s).trim()).filter(Boolean),
        ...(packet.summary !== undefined ? { summary: String(packet.summary).trim() } : {}),
    };
}
/** Default deliverySpec for peer/agent-lane returns. */
export function defaultPeerDeliverySpec(sink = 'chat') {
    return {
        shape: [...DEFAULT_PEER_DELIVERY_SHAPE],
        sink,
        description: 'Peer/agent-lane handoff: theme + keyPoints + todos',
    };
}
/**
 * Verify deliverySpec against unit.deliveryPayload.
 * No spec → satisfied (gate falls back to chatPosted / workspaceOnly).
 */
export function verifyDeliverySpec(unit) {
    const spec = unit.deliverySpec;
    if (!spec || spec.shape.length === 0)
        return { ok: true, missing: [] };
    const payload = unit.deliveryPayload ?? {};
    const missing = [];
    for (const field of spec.shape) {
        const v = payload[field];
        if (v === undefined || v === null) {
            missing.push(field);
            continue;
        }
        if (typeof v === 'string' && v.trim() === '') {
            missing.push(field);
            continue;
        }
        if (Array.isArray(v) && v.length === 0) {
            missing.push(field);
            continue;
        }
    }
    return { ok: missing.length === 0, missing };
}
/** True when deliverySpec (if any) is fully satisfied. */
export function isDeliverySpecMet(unit) {
    return verifyDeliverySpec(unit).ok;
}
/**
 * Whether DeliveryGate should inject a continuation.
 * Fires when retries remain and either chatPosted is false, workspaceOnly sticky,
 * or an attached deliverySpec is unsatisfied (P1-c).
 */
export function shouldRunDeliveryGate(unit, options = { enabled: true }) {
    if (!options.enabled)
        return false;
    const max = options.maxRetries ?? DEFAULT_DELIVERY_GATE_MAX;
    if (unit.gateRetries >= max)
        return false;
    if (unit.status === 'completed' || unit.status === 'cancelled')
        return false;
    const spec = unit.deliverySpec;
    const specOk = isDeliverySpecMet(unit);
    if (spec) {
        // Contract present: sink + shape drive the gate.
        if (!specOk)
            return true;
        if (spec.sink === 'chat' && !unit.delivery.chatPosted)
            return true;
        if (spec.sink === 'chat' && unit.delivery.workspaceOnly)
            return true;
        if (spec.sink === 'workspace')
            return false;
        if (spec.sink === 'notice')
            return false;
        return false;
    }
    if (!unit.delivery.chatPosted)
        return true;
    // Sticky chatPosted from an earlier OTHER answer must not skip MAIN tool dumps.
    if (unit.delivery.workspaceOnly)
        return true;
    return false;
}
/** True when tryComplete is allowed under DeliveryGate rules. */
export function canMarkCompleted(unit, options) {
    if (unit.status === 'cancelled')
        return false;
    if (!options.deliveryGate)
        return true;
    const max = options.maxRetries ?? DEFAULT_DELIVERY_GATE_MAX;
    const spec = unit.deliverySpec;
    if (spec) {
        if (!isDeliverySpecMet(unit)) {
            // Exhausted retries → allow complete (same honesty as workspaceOnly budget).
            return unit.gateRetries >= max;
        }
        if (spec.sink === 'chat') {
            if (!unit.delivery.chatPosted)
                return false;
            if (unit.delivery.workspaceOnly && unit.gateRetries < max)
                return false;
        }
        return true;
    }
    if (!unit.delivery.chatPosted)
        return false;
    // After gate budget is exhausted, allow complete even if still workspace-leaning.
    if (unit.delivery.workspaceOnly && unit.gateRetries < max)
        return false;
    return true;
}
/** Build fold-notice suffix referencing the bound MAIN unit (fold mode). */
export function buildUnitFoldBlock(unit) {
    return (`${UNIT_FOLD_MARKER} Bound MAIN work unit ${unit.id} ` +
        `(goal: ${unit.goalSummary}). Fold OTHER into this unit; ` +
        `keep step checkpoints; resume from the last completed step. ` +
        `Visible chat delivery is required before this unit can complete.`);
}
/** Build fork-notice suffix for a MAIN + sibling pair (fork mode). */
export function buildUnitForkBlock(main, sibling) {
    const childPart = sibling.childSessionId
        ? ` Host child Session ${sibling.childSessionId} runs OTHER in parallel;`
        : '';
    return (`${UNIT_FORK_MARKER} Forked sibling work unit ${sibling.id} ` +
        `(lane: ${sibling.lane}, goal: ${sibling.goalSummary}) from MAIN ${main.id} ` +
        `(goal: ${main.goalSummary}).${childPart} Track sibling status/checkpoints independently; ` +
        `when the sibling completes, fold its result back into MAIN conversation ` +
        `(no fake Temporal — parent+child Session via host subagent when linked).`);
}
/**
 * Build degraded-fork notice when host `ctx.subagents` is unavailable (P1.5).
 * Keeps 0.1.8 registry sibling + single-Agent cancel-then-claim semantics.
 */
export function buildUnitForkDegradedBlock(main, sibling) {
    return (`${UNIT_FORK_DEGRADED_MARKER} Host ctx.subagents.startActivation unavailable; ` +
        `registry-only sibling ${sibling.id} (lane: ${sibling.lane}, goal: ${sibling.goalSummary}) ` +
        `under MAIN ${main.id}. No second LLM — falling back to single-Agent cancel-then-claim ` +
        `(0.1.8 fork bookkeeping). Mount dsh-subagent + spawn/fork-in-process for true parallel.`);
}
/** Build fold-back notice when a sibling/peer result rejoins MAIN. */
export function buildUnitFoldBackNotice(main, sibling, packet) {
    const packetBlock = packet
        ? ` Packet: theme="${packet.theme}"; ` +
            `keyPoints=${packet.keyPoints.length}; todos=${packet.todos.length}` +
            (packet.summary ? `; summary=${summarizeGoal(packet.summary, 80)}` : '') +
            '.'
        : '';
    const text = `${UNIT_FOLD_BACK_MARKER} Sibling/peer unit ${sibling.id} completed and folded ` +
        `into MAIN ${main.id} (goal: ${main.goalSummary}).${packetBlock} ` +
        `Resume MAIN from its last completed step; surface the folded result in visible chat.`;
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'unit-fold-hint',
            form: 'notice',
            summary: `Fold-back: ${sibling.id} → MAIN ${main.id}`,
        },
    });
}
/** Build a peer-handoff notice carrying structured theme/keyPoints/todos. */
export function buildPeerHandoffNotice(main, peer, packet) {
    const points = packet.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('; ');
    const todos = packet.todos.map((t, i) => `${i + 1}. ${t}`).join('; ');
    const text = `${PEER_HANDOFF_MARKER} Peer/agent-lane unit ${peer.id} returned into MAIN ${main.id}. ` +
        `theme: ${packet.theme}. ` +
        `keyPoints: [${points}]. ` +
        `todos: [${todos}].` +
        (packet.summary ? ` summary: ${packet.summary}` : '');
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'peer-handoff',
            form: 'notice',
            summary: `Peer handoff → MAIN ${main.id}: ${packet.theme}`,
        },
    });
}
/** DeliveryGate continuation notice (producer-owned). */
export function buildDeliveryGateNotice(unit) {
    const specCheck = verifyDeliverySpec(unit);
    const specPart = unit.deliverySpec
        ? ` deliverySpec(sink=${unit.deliverySpec.sink}, shape=[${unit.deliverySpec.shape.join(',')}])` +
            (specCheck.ok ? ' met;' : ` missing=[${specCheck.missing.join(',')}];`)
        : '';
    const text = `${DELIVERY_GATE_MARKER} DeliveryGate for unit ${unit.id} ` +
        `(goal: ${unit.goalSummary}): prior step looked incomplete` +
        `${specPart} ` +
        `(chatPosted=${unit.delivery.chatPosted}, workspaceOnly=${unit.delivery.workspaceOnly}). ` +
        `Paste the MAIN code / CLI progress (fenced code block) and any still-missing ` +
        `OTHER answer / required deliverySpec fields into the visible assistant reply now — ` +
        `do not only write to disk.`;
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'delivery-gate',
            form: 'notice',
            summary: `DeliveryGate: require chat-visible MAIN/OTHER delivery for unit ${unit.id}`,
        },
    });
}
export function isDeliveryGateNotice(message) {
    return message.source.kind === 'delivery-gate';
}
export function isPeerHandoffNotice(message) {
    return message.source.kind === 'peer-handoff';
}
/** Payload object derived from a peer handoff packet. */
export function peerPacketToPayload(packet) {
    const normalized = normalizePeerHandoffPacket(packet);
    return {
        theme: normalized.theme,
        keyPoints: [...normalized.keyPoints],
        todos: [...normalized.todos],
        ...(normalized.summary !== undefined ? { summary: normalized.summary } : {}),
    };
}
/** Session-local WorkUnit table (P0/P1: in-memory, Agent lifetime). */
export class WorkUnitRegistry {
    units = new Map();
    activeId = null;
    seq = 0;
    lastCheckpoint = null;
    create(input) {
        this.seq += 1;
        const id = input.id ?? `wu-${this.seq}`;
        if (this.units.has(id)) {
            throw new Error(`WorkUnitRegistry: duplicate unit id "${id}"`);
        }
        if (input.parentId != null && !this.units.has(input.parentId)) {
            throw new Error(`WorkUnitRegistry: unknown parent unit "${input.parentId}"`);
        }
        const unit = {
            id,
            workId: input.workId ?? id,
            goalSummary: summarizeGoal(input.goalSummary),
            status: 'pending',
            lane: input.lane ?? 'user',
            parentId: input.parentId ?? null,
            createdAtStep: input.createdAtStep ?? 0,
            createdAtTurn: input.createdAtTurn ?? 0,
            checkpoints: [],
            delivery: { chatPosted: false, workspaceOnly: false },
            foldedOtherSummaries: [],
            gateRetries: 0,
            deliverySpec: input.deliverySpec ?? null,
            deliveryPayload: null,
            lastPeerPacket: null,
            childSessionId: null,
            activationRef: null,
        };
        this.units.set(id, unit);
        return unit;
    }
    get(id) {
        return this.units.get(id);
    }
    list() {
        return [...this.units.values()];
    }
    /** Independently queryable unit view (status / checkpoint / lane). */
    query(id) {
        const unit = this.units.get(id);
        if (!unit)
            return undefined;
        return {
            id: unit.id,
            status: unit.status,
            lane: unit.lane,
            parentId: unit.parentId,
            goalSummary: unit.goalSummary,
            checkpointCount: unit.checkpoints.length,
            lastCheckpoint: unit.checkpoints.at(-1) ?? null,
            delivery: { ...unit.delivery },
            deliverySpec: unit.deliverySpec
                ? { ...unit.deliverySpec, shape: [...unit.deliverySpec.shape] }
                : null,
            deliverySpecMet: isDeliverySpecMet(unit),
            childSessionId: unit.childSessionId,
            activationRef: unit.activationRef
                ? { ...unit.activationRef }
                : null,
        };
    }
    /** List siblings (children) of a parent unit. */
    siblingsOf(parentId) {
        return this.list().filter(u => u.parentId === parentId);
    }
    /** P1.5: find the WorkUnit linked to a host child Session id. */
    byChildSessionId(childSessionId) {
        return this.list().find(u => u.childSessionId === childSessionId);
    }
    /**
     * P1.5: attach host activation identity to a sibling unit after
     * `startActivation` publishes a child.
     */
    linkChildActivation(unitId, ref) {
        const unit = this.units.get(unitId);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${unitId}"`);
        unit.childSessionId = ref.childSessionId;
        unit.activationRef = {
            childSessionId: ref.childSessionId,
            provider: ref.provider,
            ...(ref.runId !== undefined ? { runId: ref.runId } : {}),
        };
        if (unit.lane === 'user')
            unit.lane = 'background';
    }
    /** List units on a given lane. */
    byLane(lane) {
        return this.list().filter(u => u.lane === lane);
    }
    bindActive(id) {
        if (id !== null && !this.units.has(id)) {
            throw new Error(`WorkUnitRegistry: cannot bind unknown unit "${id}"`);
        }
        this.activeId = id;
    }
    active() {
        if (this.activeId === null)
            return null;
        return this.units.get(this.activeId) ?? null;
    }
    markStatus(id, status) {
        const unit = this.units.get(id);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${id}"`);
        unit.status = status;
    }
    foldOther(unitId, otherSummary) {
        const unit = this.units.get(unitId);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${unitId}"`);
        const summary = summarizeGoal(otherSummary, 120);
        unit.foldedOtherSummaries.push(summary);
    }
    updateDelivery(id, flags) {
        const unit = this.units.get(id);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${id}"`);
        unit.delivery = { ...unit.delivery, ...flags };
    }
    setDeliverySpec(id, spec) {
        const unit = this.units.get(id);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${id}"`);
        unit.deliverySpec = spec
            ? { shape: [...spec.shape], sink: spec.sink, ...(spec.description ? { description: spec.description } : {}) }
            : null;
    }
    setDeliveryPayload(id, payload) {
        const unit = this.units.get(id);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${id}"`);
        unit.deliveryPayload = payload === null ? null : { ...payload };
    }
    appendCheckpoint(cp) {
        const unit = this.units.get(cp.unitId);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${cp.unitId}"`);
        const full = {
            ...cp,
            toolResultRefs: [...cp.toolResultRefs],
            delivery: { ...cp.delivery },
            at: cp.at ?? Date.now(),
        };
        unit.checkpoints.push(full);
        unit.delivery = { ...full.delivery };
        unit.status = full.status;
        this.lastCheckpoint = full;
        return full;
    }
    /** Ensure a MAIN unit exists for the given goal; bind it active and mark running/paused. */
    ensureMainUnit(options) {
        const existing = this.active();
        if (existing && (existing.status === 'running' || existing.status === 'paused' || existing.status === 'pending')) {
            // Prefer an open user-lane MAIN (parentId null). If active is a sibling, climb.
            if (existing.parentId === null && existing.lane === 'user') {
                if (options.status)
                    existing.status = options.status;
                return existing;
            }
            const parent = existing.parentId ? this.units.get(existing.parentId) : null;
            if (parent && (parent.status === 'running' || parent.status === 'paused' || parent.status === 'pending')) {
                if (options.status)
                    parent.status = options.status;
                this.bindActive(parent.id);
                return parent;
            }
        }
        // Also reuse any open root MAIN even if not currently active.
        for (const u of this.units.values()) {
            if (u.parentId === null
                && u.lane === 'user'
                && (u.status === 'running' || u.status === 'paused' || u.status === 'pending')) {
                if (options.status)
                    u.status = options.status;
                this.bindActive(u.id);
                return u;
            }
        }
        const unit = this.create({
            goalSummary: options.goalSummary,
            lane: 'user',
            createdAtTurn: options.turn,
            createdAtStep: options.step,
        });
        unit.status = options.status ?? 'running';
        this.bindActive(unit.id);
        return unit;
    }
    /**
     * P1-a: fork a sibling WorkUnit under MAIN.
     * Sibling is independently queryable; MAIN stays the control-plane parent.
     * By default binds the sibling active so subsequent checkpoints land there
     * until {@link foldSiblingIntoMain} rebinds MAIN.
     */
    forkSibling(options) {
        const parent = this.units.get(options.parentId);
        if (!parent)
            throw new Error(`WorkUnitRegistry: unknown parent unit "${options.parentId}"`);
        if (options.pauseParent !== false && parent.status === 'running')
            parent.status = 'paused';
        const sibling = this.create({
            goalSummary: options.goalSummary,
            lane: options.lane ?? 'user',
            parentId: parent.id,
            createdAtTurn: options.createdAtTurn ?? parent.createdAtTurn,
            createdAtStep: options.createdAtStep ?? parent.createdAtStep,
            deliverySpec: options.deliverySpec ?? null,
        });
        sibling.status = options.status ?? 'running';
        if (options.bindActive !== false)
            this.bindActive(sibling.id);
        return sibling;
    }
    /**
     * P1-a: complete a forked sibling and fold its result back into MAIN.
     * Does not invent Temporal — registry status + optional packet + rebind only.
     */
    foldSiblingIntoMain(options) {
        const sibling = this.units.get(options.siblingId);
        if (!sibling)
            throw new Error(`WorkUnitRegistry: unknown sibling "${options.siblingId}"`);
        if (!sibling.parentId) {
            throw new Error(`WorkUnitRegistry: unit "${options.siblingId}" has no parent to fold into`);
        }
        const main = this.units.get(sibling.parentId);
        if (!main)
            throw new Error(`WorkUnitRegistry: missing parent "${sibling.parentId}"`);
        const packet = options.packet ? normalizePeerHandoffPacket(options.packet) : null;
        if (packet) {
            this.setDeliveryPayload(sibling.id, peerPacketToPayload(packet));
            if (!sibling.deliverySpec) {
                this.setDeliverySpec(sibling.id, defaultPeerDeliverySpec('chat'));
            }
            // Folding into chat: mark sibling chat delivery satisfied for gate.
            this.updateDelivery(sibling.id, { chatPosted: true, workspaceOnly: false });
            main.lastPeerPacket = packet;
            main.foldedOtherSummaries.push(summarizeGoal(packet.summary ?? `peer:${packet.theme}`, 120));
        }
        else {
            main.foldedOtherSummaries.push(summarizeGoal(`fold-back:${sibling.goalSummary}`, 120));
        }
        const gateOpts = {
            deliveryGate: options.deliveryGate ?? false,
            maxRetries: options.maxRetries,
        };
        if (!this.tryComplete(sibling.id, gateOpts)) {
            // Force-complete sibling after fold-back bookkeeping when gate still blocks
            // (caller explicitly requested fold-back).
            sibling.status = 'completed';
        }
        if (main.status === 'completed' || main.status === 'cancelled') {
            // Leave MAIN status as-is; still rebind for queryability.
        }
        else if (main.status === 'paused' || main.status === 'pending') {
            main.status = 'running';
        }
        this.bindActive(main.id);
        const notice = packet
            ? buildPeerHandoffNotice(main, sibling, packet)
            : buildUnitFoldBackNotice(main, sibling, null);
        this.appendCheckpoint({
            unitId: main.id,
            stepIndex: main.checkpoints.at(-1)?.stepIndex ?? main.createdAtStep,
            turn: main.checkpoints.at(-1)?.turn ?? main.createdAtTurn,
            assistantPrefixCursor: main.checkpoints.at(-1)?.assistantPrefixCursor ?? 0,
            assistantPrefixHash: main.checkpoints.at(-1)?.assistantPrefixHash ?? '00000000',
            toolResultRefs: [],
            status: main.status,
            delivery: { ...main.delivery },
            reason: packet ? 'peer-handoff' : 'fold-back',
        });
        return { main, sibling, notice };
    }
    /**
     * P1-b: peer/background finished → structured packet → agent-lane unit → fold into MAIN.
     * Simulates the living-handoff return path inside the registry (tests / host hooks).
     */
    acceptPeerHandoff(options) {
        const parent = this.units.get(options.parentId);
        if (!parent)
            throw new Error(`WorkUnitRegistry: unknown parent "${options.parentId}"`);
        const packet = normalizePeerHandoffPacket(options.packet);
        const sink = options.sink ?? 'chat';
        const peer = this.create({
            goalSummary: options.goalSummary ?? `peer:${packet.theme}`,
            lane: options.lane ?? 'agent',
            parentId: parent.id,
            createdAtTurn: options.createdAtTurn ?? parent.createdAtTurn,
            createdAtStep: options.createdAtStep ?? parent.createdAtStep,
            deliverySpec: defaultPeerDeliverySpec(sink),
        });
        peer.status = 'running';
        this.setDeliveryPayload(peer.id, peerPacketToPayload(packet));
        this.updateDelivery(peer.id, {
            chatPosted: sink === 'chat' || sink === 'notice',
            workspaceOnly: sink === 'workspace',
        });
        this.appendCheckpoint({
            unitId: peer.id,
            stepIndex: peer.createdAtStep,
            turn: peer.createdAtTurn,
            assistantPrefixCursor: 0,
            assistantPrefixHash: simpleTextHash(packet.theme),
            toolResultRefs: [],
            status: 'running',
            delivery: { ...peer.delivery },
            reason: 'peer-handoff',
        });
        const folded = this.foldSiblingIntoMain({
            siblingId: peer.id,
            packet,
            deliveryGate: true,
        });
        // Prefer the peer-handoff-shaped notice over generic fold-back.
        const notice = buildPeerHandoffNotice(folded.main, folded.sibling, packet);
        return { peer: folded.sibling, main: folded.main, notice };
    }
    tryComplete(id, options) {
        const unit = this.units.get(id);
        if (!unit)
            return false;
        if (!canMarkCompleted(unit, options))
            return false;
        unit.status = 'completed';
        return true;
    }
    bumpGateRetry(id) {
        const unit = this.units.get(id);
        if (!unit)
            throw new Error(`WorkUnitRegistry: unknown unit "${id}"`);
        unit.gateRetries += 1;
        return unit.gateRetries;
    }
    snapshot() {
        return {
            activeId: this.activeId,
            units: this.list().map(u => ({
                ...u,
                checkpoints: [...u.checkpoints],
                foldedOtherSummaries: [...u.foldedOtherSummaries],
                delivery: { ...u.delivery },
                deliverySpec: u.deliverySpec
                    ? { ...u.deliverySpec, shape: [...u.deliverySpec.shape] }
                    : null,
                deliveryPayload: u.deliveryPayload ? { ...u.deliveryPayload } : null,
                lastPeerPacket: u.lastPeerPacket
                    ? {
                        theme: u.lastPeerPacket.theme,
                        keyPoints: [...u.lastPeerPacket.keyPoints],
                        todos: [...u.lastPeerPacket.todos],
                        ...(u.lastPeerPacket.summary !== undefined
                            ? { summary: u.lastPeerPacket.summary }
                            : {}),
                    }
                    : null,
                childSessionId: u.childSessionId,
                activationRef: u.activationRef ? { ...u.activationRef } : null,
            })),
        };
    }
    /**
     * Replace in-memory state from a durable snapshot (CheckpointStore.hydrate).
     * Cleared first so hydrate is idempotent.
     */
    restoreSnapshot(snapshot) {
        this.units.clear();
        this.activeId = null;
        this.lastCheckpoint = null;
        let maxSeq = 0;
        for (const raw of snapshot.units) {
            const unit = {
                ...raw,
                workId: raw.workId ?? raw.id,
                checkpoints: raw.checkpoints.map(cp => ({
                    ...cp,
                    toolResultRefs: [...cp.toolResultRefs],
                    delivery: { ...cp.delivery },
                })),
                foldedOtherSummaries: [...raw.foldedOtherSummaries],
                delivery: { ...raw.delivery },
                deliverySpec: raw.deliverySpec
                    ? {
                        shape: [...raw.deliverySpec.shape],
                        sink: raw.deliverySpec.sink,
                        ...(raw.deliverySpec.description
                            ? { description: raw.deliverySpec.description }
                            : {}),
                    }
                    : null,
                deliveryPayload: raw.deliveryPayload ? { ...raw.deliveryPayload } : null,
                lastPeerPacket: raw.lastPeerPacket
                    ? {
                        theme: raw.lastPeerPacket.theme,
                        keyPoints: [...raw.lastPeerPacket.keyPoints],
                        todos: [...raw.lastPeerPacket.todos],
                        ...(raw.lastPeerPacket.summary !== undefined
                            ? { summary: raw.lastPeerPacket.summary }
                            : {}),
                    }
                    : null,
                childSessionId: raw.childSessionId,
                activationRef: raw.activationRef ? { ...raw.activationRef } : null,
            };
            this.units.set(unit.id, unit);
            const m = /^wu-(\d+)$/.exec(unit.id);
            if (m)
                maxSeq = Math.max(maxSeq, Number(m[1]));
            const last = unit.checkpoints.at(-1);
            if (last && (!this.lastCheckpoint || last.at >= this.lastCheckpoint.at)) {
                this.lastCheckpoint = last;
            }
        }
        this.seq = Math.max(this.seq, maxSeq);
        if (snapshot.activeId !== null && this.units.has(snapshot.activeId)) {
            this.activeId = snapshot.activeId;
        }
        else if (snapshot.activeId === null) {
            this.activeId = null;
        }
    }
}
export function buildDeliveryGateMeta(unit, injected) {
    const { missing } = verifyDeliverySpec(unit);
    return {
        kind: 'delivery-gate',
        unitId: unit.id,
        gateRetries: unit.gateRetries,
        injected,
        marker: DELIVERY_GATE_MARKER,
        missingSpecFields: missing,
    };
}
//# sourceMappingURL=work-unit.js.map