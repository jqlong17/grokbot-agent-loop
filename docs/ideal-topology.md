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

- `Orchestrator` — deterministic routing (LLM is not the OS)
- `DecisionLayer` — optional cheap pre-spawn stub
- `WorkUnit` + `workId` / `InputRecord.inputId`
- `TurnRunShell` + `checkpointChain` + `turn-settle`
- `UnitRunner` (`InProcess` \| `Subagent`) + `ActivationManager`
- `MainSession` + `SummarySession` (stubs OK)
- `CheckpointStore` + `DurableWorkflow` seam (memory default; no Temporal required)
- `AgentEvent` bus · `MergeBus` · `DeliveryGate`

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

Temporal engine · official UI · Feishu blackboard · changing dsh Phase machine
