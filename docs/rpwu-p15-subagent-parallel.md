# RPWU P1.5 — Subagent-backed true-parallel WorkUnit

**Status:** implemented in `@harness-plugins/grokbot-agent-loop` **0.1.9**  
**Baseline:** 0.1.8 (PR #6) — registry `forkSibling` / `acceptPeerHandoff` / `deliverySpec`  
**Scope:** plugin only. Community homage; **not** affiliated with xAI.

## Problem

0.1.8 `rpwuOtherMode=fork` registers an independently queryable sibling WorkUnit, but still runs on a **single** Agent:

- dsh `Phase` is unary (`idle | maintenance | running`); `wakeDriver` only latches while busy.
- Same Session / same Agent cannot dual-kick the LLM.
- Tool parallelism (`maxParallelToolCalls`) is not model parallelism.

So fork was honest registry bookkeeping + prompt hooks — **not** a second model request. Closing the Grok-style gap requires the host’s existing second lane: `ctx.subagents.startActivation` → child Agent + child Session.

## Non-goals

- Changing dsh `Phase` to allow multi-kick on one Agent
- Temporal / durable cloud runner / Feishu blackboard / Grok Bot UI
- Making `workflow.parallel` or experimental `agent-team` the default path
- Embedding a subagent backend inside this plugin
- Claiming “same-session dual request” semantics

## Architecture

```
┌─ parent Session (MAIN) ─────────────────────────────┐
│  ReactLoopAgent (this plugin)                        │
│  WorkUnitRegistry: MAIN + sibling (background)       │
│  keep running current turn                           │
└───────────────────────┬──────────────────────────────┘
                        │ ctx.subagents.startActivation
                        ▼
┌─ child Session (OTHER) ─────────────────────────────┐
│  host backend: spawn-in-process | fork-in-process    │
│  independent Agent + LLM kick                        │
└───────────────────────┬──────────────────────────────┘
                        │ activation.result / subagent/end
                        ▼
              foldSiblingIntoMain / acceptPeerHandoff
              + DeliveryGate on MAIN conversation
```

| Layer | Owns |
|---|---|
| Plugin registry | WorkUnit ids, `childSessionId` / activation ref, fold-back, DeliveryGate |
| Host `dsh-subagent` | Provider registry, activation manager, lifecycle events |
| Host backend | Real child Agent + Session (`spawn` / `fork`) |

## Config knobs

| Knob | Default | Meaning |
|---|---|---|
| `rpwuOtherMode` | `fold` | `fold` = 0.1.7/0.1.8 short protocol (unchanged). `fork` or `subagent` = try host activation. |
| `rpwuSubagentProvider` | `spawn` | Provider name passed to `startActivation` (`spawn` or `fork`). |
| `rpwuSubagentDelivery` | `caller` | `caller` = plugin awaits result and folds; `parent` = also host parent notice. |
| `rpwuEnabled` / `deliveryGate*` | unchanged | Still gate MAIN delivery after fold-back. |

## Failure / degraded path

1. **No `ctx.subagents` / no `startActivation`** → registry-only sibling (0.1.8) + visible `[grokbot-unit-fork-degraded]` + single-Agent cancel-then-claim. No crash.
2. **`startActivation` rejects** (limit, unauthorized parent, missing provider) → sibling marked cancelled / failed notice; MAIN left running; no throw out of `steer()`.
3. **Child `stopReason !== completed`** → fold-back still runs with diagnostic/partial output so MAIN can react; DeliveryGate may continue.

## Acceptance tests

1. Default `fold`: short-protocol preempt path unchanged (existing interruptible / work-unit tests green).
2. `fork`/`subagent` + mocked `ctx.subagents`: `startActivation` called with `parent` + OTHER prompt; sibling has `childSessionId`; on `result` settle, MAIN receives fold-back / peer handoff via `foldSiblingIntoMain` / `acceptPeerHandoff`.
3. No subagent service: `[grokbot-unit-fork-degraded]` present; process does not throw.
4. README honesty: parallel = parent Session + child Session via host subagent — **not** Temporal, **not** same-Agent dual kick.

## Honesty limits

- Child Session ≠ same-session dual request.
- Depends on host mounting `@deepseek-ai/dsh-subagent` plus a backend (`dsh-subagent-spawn-in-process`, optionally `dsh-subagent-fork-in-process`).
- Plugin does not ship or replace those backends.
- Fork backend seeds only the parent’s **completed** turn prefix; in-flight MAIN turn is not copied into the child.
