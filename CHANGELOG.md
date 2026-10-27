# Changelog

Community homage plugin — **not affiliated with xAI / Grok Bot**.

## 0.2.3

**Slices D + E** toward Ideal Topology score ≥8.0.

- **D — SummarySession carrier:** `MemorySummarySession` + `SUMMARY_CARRIER_MARKER` inject summary back into MAIN as **user-role** (`buildSummaryCarrierMessage` / `injectSummaryCarrierIntoMain`). Stub remains available; no second product UI.
- **E — File CheckpointStore hydrate:** put → new-process `FileCheckpointStore` → hydrate rebuilds unit + checkpoints + workId. Memory stays default; File is opt-in durability evidence (not Temporal). Interruptible ⊥ Durable tests stay separate.

## 0.2.2

**Slices B + C** toward Ideal Topology score ≥8.0.

- **B — parallel gold:** deterministic vitest proves parent≠child Session when `ctx.subagents` seam exists (`ActivationManager.starts`, `activationRef`, fold/merge/gate). Missing seam → visible degrade, never throws. Optional `scripts/live-parallel.mjs` skips without `GROKBOT_LIVE_PARALLEL=1`.
- **C — DecisionLayer:** `RuleDecisionLayer` + `scoreRoute` (cancel / queue / absorb short OTHER / spawn independent). Wired as Orchestrator default; `PassthroughDecisionLayer` opt-out. LLM is not the OS.

## 0.2.1

**Slice A — thin Agent main path.**

- TurnRunShell + ActivationManager are the live admit→run→checkpoint→settle / spawn path.
- Agent is Cordis host glue; Orchestrator.admit remains the only routing brain.

## 0.2.0

Ideal Topology v1.1 outer harness skeleton. Default `rpwuOtherMode`: **spawn**.
