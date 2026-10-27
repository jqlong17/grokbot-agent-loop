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
- `DecisionLayer` / `RuleDecisionLayer` — cheap score/route before expensive spawn (**0.2.2**)
- `WorkUnit` + `workId` / `InputRecord.inputId`
- `TurnRunShell` + `checkpointChain` + `turn-settle` — **live main path** (0.2.1+)
- `UnitRunner` (`InProcess` \| `Subagent`) + `ActivationManager` — **live spawn path** (0.2.1+)
- `MainSession` + `SummarySession` (stubs OK)
- `CheckpointStore` + `DurableWorkflow` seam (memory default; no Temporal required)
- `AgentEvent` bus · `MergeBus` · `DeliveryGate`

## 0.2.2 — parallel gold + DecisionLayer (B + C)

```
User/steer → classify → DecisionLayer.score/route (cheap)
                → Orchestrator.admit (absorb|spawn|cancel|queue)
                → TurnRunShell (checkpointChain + settle)
                → ActivationManager.start/wait/cancel  (parent≠child Session)
                → MergeBus + DeliveryGate → MAIN chat
```

- **B:** With `ctx.subagents`, dual Session is observable (`startActivation`, `activationRef`, `hostActivations.starts` parentId ≠ childSessionId); fold/merge/gate still apply. Missing seam → visible degrade, never throws. CI uses fake-seam vitest (`tests/parallel-gold.spec.ts`); optional `scripts/live-parallel.mjs` skips unless `GROKBOT_LIVE_PARALLEL=1`.
- **C:** `RuleDecisionLayer` (default) — cancel explicit, queue steer, absorb short OTHER / same deliverable, spawn independent. `PassthroughDecisionLayer` opt-out. Orchestrator remains sole admit brain.

## 0.2.1 — thin Agent main path (wired)

Admitted turns run through **TurnRunShell**; spawn through **ActivationManager**. Agent = Cordis host glue.

## Interruptible ⊥ Durable

| | Interruptible | Durable |
|---|---|---|
| Meaning | cut current turn/stream | completed steps never redo |
| Tests | `interruptible.spec.ts` | `durable-invariant.spec.ts` |

## Breaking (0.2.0)

- `rpwuOtherMode` default: **`spawn`** (was `fold`)
- Package layout under `orchestrator/` `unit/` `checkpoint/` `merge/` `delivery/` `turn/` `session/` `events/`
- Root package still re-exports practical symbols

## Non-goals (this release)

Temporal · Mac smoke · Feishu · full Summary product (slice D) · changing dsh Phase machine
