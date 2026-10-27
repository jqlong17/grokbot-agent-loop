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
- `DecisionLayer` — optional cheap pre-spawn stub
- `WorkUnit` + `workId` / `InputRecord.inputId`
- `TurnRunShell` + `checkpointChain` + `turn-settle` — **live main path** (0.2.1+)
- `UnitRunner` (`InProcess` \| `Subagent`) + `ActivationManager` — **live spawn path** (0.2.1+)
- `MainSession` + `SummarySession` (stubs OK)
- `CheckpointStore` + `DurableWorkflow` seam (memory default; no Temporal required)
- `AgentEvent` bus · `MergeBus` · `DeliveryGate`

## 0.2.1 — thin Agent main path (wired)

As of **0.2.1**, admitted turns actually run through **TurnRunShell** and host-parallel spawn through **ActivationManager**:

```
User/steer → Orchestrator.admit (absorb|spawn|cancel|queue)
                → TurnRunShell.afterStepCheckpoint + checkpointChain + settle
                → ActivationManager.start / wait / cancel / degrade  (spawn)
                → CheckpointStore → MergeBus + DeliveryGate → MAIN chat
```

- **Agent** = Cordis host glue (inbox, phase, physical cancel/claim). Does **not** re-implement routing.
- **TurnRunShell** writes step checkpoints to registry + store; turn-end / fold-back calls `settle()`.
- **ActivationManager** owns start/wait/cancel; missing seam or start failure → visible degrade, **never throws**.
- Interruptible ⊥ Durable remain separately tested (`interruptible.spec.ts` ⊥ `durable-invariant.spec.ts`).

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

Temporal engine · official UI · Feishu blackboard · changing dsh Phase machine · DecisionLayer/Summary full product (next slices)
