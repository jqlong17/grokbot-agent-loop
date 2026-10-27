/**
 * In-memory CheckpointStore (default) — Ideal Topology v1.
 * @module @harness-plugins/grokbot-agent-loop/checkpoint/memory-store
 */
/** Default session-local store; survives preempt within process lifetime. */
export class MemoryCheckpointStore {
    units = new Map();
    checkpoints = new Map();
    activeId = null;
    put(cp) {
        const list = this.checkpoints.get(cp.unitId) ?? [];
        const full = {
            ...cp,
            toolResultRefs: [...cp.toolResultRefs],
            delivery: { ...cp.delivery },
        };
        list.push(full);
        this.checkpoints.set(cp.unitId, list);
        const unit = this.units.get(cp.unitId);
        if (unit) {
            unit.checkpoints = [...list];
            unit.delivery = { ...full.delivery };
            unit.status = full.status;
            this.units.set(cp.unitId, unit);
        }
    }
    saveUnit(unit) {
        const copy = {
            ...unit,
            checkpoints: unit.checkpoints.map(cp => ({
                ...cp,
                toolResultRefs: [...cp.toolResultRefs],
                delivery: { ...cp.delivery },
            })),
            foldedOtherSummaries: [...unit.foldedOtherSummaries],
            delivery: { ...unit.delivery },
            deliverySpec: unit.deliverySpec
                ? {
                    shape: [...unit.deliverySpec.shape],
                    sink: unit.deliverySpec.sink,
                    ...(unit.deliverySpec.description
                        ? { description: unit.deliverySpec.description }
                        : {}),
                }
                : null,
            deliveryPayload: unit.deliveryPayload ? { ...unit.deliveryPayload } : null,
            lastPeerPacket: unit.lastPeerPacket
                ? {
                    theme: unit.lastPeerPacket.theme,
                    keyPoints: [...unit.lastPeerPacket.keyPoints],
                    todos: [...unit.lastPeerPacket.todos],
                    ...(unit.lastPeerPacket.summary !== undefined
                        ? { summary: unit.lastPeerPacket.summary }
                        : {}),
                }
                : null,
            activationRef: unit.activationRef ? { ...unit.activationRef } : null,
        };
        this.units.set(unit.id, copy);
        if (copy.checkpoints.length > 0) {
            this.checkpoints.set(unit.id, [...copy.checkpoints]);
        }
    }
    list(unitId) {
        if (unitId !== undefined) {
            return [...(this.checkpoints.get(unitId) ?? [])];
        }
        const all = [];
        for (const cps of this.checkpoints.values())
            all.push(...cps);
        return all;
    }
    latest(unitId) {
        const list = this.checkpoints.get(unitId);
        return list?.at(-1) ?? null;
    }
    setActiveId(activeId) {
        this.activeId = activeId;
    }
    /** Export a serializable snapshot (file store / tests). */
    exportSnapshot() {
        const units = [];
        for (const unit of this.units.values()) {
            const cps = this.checkpoints.get(unit.id) ?? unit.checkpoints;
            units.push({
                ...unit,
                checkpoints: cps.map(cp => ({
                    ...cp,
                    toolResultRefs: [...cp.toolResultRefs],
                    delivery: { ...cp.delivery },
                })),
            });
        }
        return {
            activeId: this.activeId,
            units,
            checkpoints: this.list(),
        };
    }
    hydrate(registry) {
        const snap = this.exportSnapshot();
        registry.restoreSnapshot({
            activeId: snap.activeId,
            units: snap.units,
        });
    }
}
//# sourceMappingURL=memory-store.js.map