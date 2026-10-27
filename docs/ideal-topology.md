# Ideal Harness Topology v1.1 (condensed)

Community homage target — **not** xAI / Grok Bot official. Supersedes v1.

## One line

**Outer Orchestrator** schedules durable WorkUnits; **TurnRunShell** stitches inner dsh ReAct steps; **CheckpointStore** keeps completed steps; **MergeBus + DeliveryGate** fold back to chat. Defaults **spawn** (fold = compat).

## Outer vs Inner

| Layer | Owns |
|---|---|
| **Outer** (this plugin) | admit · absorb\|spawn\|cancel\|queue · CheckpointStore · MergeBus · DeliveryGate · AgentEvent |
| **Inner** (dsh) | model↔tool ReAct loop |
| **Host second lane** | `ctx.subagents.startActivation` |

## Core objects

- `Orchestrator` — deterministic routing (LLM is not the OS); **only** admit brain
- `DecisionLayer` / `RuleDecisionLayer` — cheap score/route before expensive spawn (0.2.2)
- `WorkUnit` + `workId` / `InputRecord.inputId`
- `TurnRunShell` + `checkpointChain` + `turn-settle` — live main path (0.2.1+)
- `UnitRunner` + `ActivationManager` — live spawn path (0.2.1+)
- `MainSession` + `MemorySummarySession` — **user-role summary carrier** (0.2.3)
- `CheckpointStore` + `DurableWorkflow` — memory default; **File hydrate smoke** (0.2.3); no Temporal required
- `AgentEvent` bus · `MergeBus` · `DeliveryGate`

## 0.2.3 — Summary carrier + File hydrate (D + E)

```
SummarySession.summarize → user-role carrier → inject into MAIN messages
FileCheckpointStore.put → (process restart) → hydrate → unit + checkpoints + workId
```

- **D:** `MemorySummarySession` accumulates turn hints and emits `[grokbot-summary-carrier]` as **user-role** into MAIN (`injectSummaryCarrierIntoMain`). No second product UI. Stub remains opt-out.
- **E:** File-backed store round-trips across a new process instance; Memory stays default. Interruptible ⊥ Durable remain separate test files.

## 0.2.2 — parallel gold + DecisionLayer (B + C)

Dual-Session gold with fake seam; `RuleDecisionLayer` cheap route before spawn.

## 0.2.1 — thin Agent main path

TurnRunShell + ActivationManager live; Agent = Cordis glue.

## Interruptible ⊥ Durable

| | Interruptible | Durable |
|---|---|---|
| Meaning | cut current turn/stream | completed steps never redo |
| Tests | `interruptible.spec.ts` | `durable-invariant.spec.ts` · `file-checkpoint-store.spec.ts` |

## Breaking (0.2.0)

- `rpwuOtherMode` default: **`spawn`** (was `fold`)
- Package layout under `orchestrator/` `unit/` `checkpoint/` `merge/` `delivery/` `turn/` `session/` `events/`

## Non-goals (this release)

Temporal engine · Feishu · Mac live smoke · changing dsh Phase machine
