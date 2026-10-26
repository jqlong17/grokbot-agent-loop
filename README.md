# GrokBot Loop

**Interruptible dual-lane agent-loop plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (dsh).**

> **Disclaimer:** Community homage naming only. **Not affiliated with, endorsed by, or sponsored by xAI or Grok Bot.** Independent MIT-licensed plugin that replaces the stock `@deepseek-ai/dsh-agent-loop` Cordis row by id.

English | [中文](./README.zh.md)

## What it does

| Behavior | Stock `@deepseek-ai/dsh-agent-loop` | GrokBot Loop |
|---|---|---|
| Busy Enter → `steer()` | Waits for current step boundary | **Cooperative cancel** → new step claims user text |
| Mid-stream user steer | Parks until step ends | Abort active stream (**keeps streamed prefix**) + claim |
| Cmd/Ctrl+Enter → `followup()` | next-turn Queue | Same (QueueDock complementary path) |
| Silent `inject()` / tool continue | next-step, no wake | Same (agent lane; no preempt) |
| Trajectory / usage / tools | Full | Same session + `agent/*` contracts |
| Uninstall patch | — | Restores stock loop |

**Dual lanes**

- **User lane** — `steer` / human (and Queue via `followup`): always highest priority.
- **Agent lane** — tool-continue / silent `inject`: only proceeds when the user lane is empty at claim time; never preempts.

## Install (Git URL alone)

Requires a working dsh profile (Node `^22.19.0 \|\| >=24.0.0`, dsh `>=0.2.0 <0.3.0`). Peers resolve from the dsh installation (`@deepseek-ai/*` **0.2.1-rc.3** line — see `package.json`).

```sh
# Preferred: activate as a profile bundle (declares dsh.bundle.patch)
dsh plugin --profile web add github:jqlong17/grokbot-agent-loop

# Or npm/pnpm into the profile, then ensure cordis.patch swaps id agent-loop
pnpm --dir "$DSH_HOME/profiles/web" add github:jqlong17/grokbot-agent-loop
```

The package ships `cordis.patch.yml` that replaces Cordis id `agent-loop`:

```yaml
- id: agent-loop
  name: '@harness-plugins/grokbot-agent-loop'
  config:
    maxParallelToolCalls: 10
    interruptOnSteer: true
    steerFoldHint: true
    steerFoldMode: bot-like
    steerResumeAnchor: true
    rpwuEnabled: true
    rpwuOtherMode: fold
    rpwuSubagentProvider: spawn
    rpwuSubagentDelivery: caller
    deliveryGate: true
    deliveryGateMaxRetries: 2
    agents: []
```

See [`examples/cordis.patch.yml`](./examples/cordis.patch.yml) for a copy-paste profile overlay (includes optional `dsh-subagent` + spawn deps for P1.5).

### Manual profile patch

If you install without the bundle layer, add the snippet above to:

`~/.dsh/profiles/<name>/cordis.patch.yml`

### Uninstall / restore stock loop

```sh
dsh plugin --profile web remove @harness-plugins/grokbot-agent-loop
```

Or delete the `agent-loop` override from your profile patch so `@deepseek-ai/dsh-base`’s stock `name: '@deepseek-ai/dsh-agent-loop'` wins again.

## Busy Enter vs Queue shortcut

1. Set Web **Busy Enter** preference to **Steer** (插话) so plain Enter calls `agent.steer()`.
2. GrokBot Loop then **preempts** the live step instead of waiting or QueueDock-parking.
3. **Cmd/Ctrl+Enter** still calls `agent.followup()` → **next-turn Queue** (documented complementary path).

Config flags:
- `interruptOnSteer` (default `true`) — set `false` for stock steer wait semantics
- `steerFoldHint` (default `true`) — after preempt, inject a producer notice: fully answer the newest interrupt, then finish the prior unfinished task without omission (prompt-layer fold vs grok.com Bot; does not rewrite user interrupt text)
- `steerFoldMode` (default `bot-like`) — `bot-like` full two-phase copy; `minimal` shorter notice, same ordering contract
- `steerResumeAnchor` (default `true`) — embed a truncated unfinished MAIN user quote in the fold notice so the model resumes the exact prior deliverable in visible chat; set `false` for 0.1.4-style notices
- `rpwuEnabled` (default `true`) — RPWU WorkUnit registry + step checkpoints + fold-into-unit; set `false` for ≈0.1.5 behavior
- `rpwuOtherMode` (default `fold`) — P1-a/P1.5: `fold` keeps OTHER inside MAIN (0.1.7 short-protocol); `fork` / `subagent` try host `ctx.subagents.startActivation` for a real child Session, then fold back into MAIN; without the seam, degrade to registry-only + `[grokbot-unit-fork-degraded]`
- `rpwuSubagentProvider` (default `spawn`) — provider name for `startActivation` (`spawn` or `fork`)
- `rpwuSubagentDelivery` (default `caller`) — `caller` = plugin awaits result and folds; `parent` also lets the host inject a parent notice
- `deliveryGate` (default `true`, requires RPWU) — block unit completion on non-substantive / workspace-only delivery; when a unit has `deliverySpec`, also verify shape + sink
- `deliveryGateMaxRetries` (default `2`) — max DeliveryGate continuation injections per unit

### 0.1.9 notes

**P1.5 subagent-backed true parallel** (follow-up to 0.1.8 / PR #6). Spec: [`docs/rpwu-p15-subagent-parallel.md`](./docs/rpwu-p15-subagent-parallel.md).

- `rpwuOtherMode: fork|subagent` calls `ctx.subagents.startActivation` so OTHER runs on a **child Agent + child Session** while MAIN keeps its live turn (parent is not cancelled).
- Sibling WorkUnit gains `childSessionId` / `activationRef`; settle → `foldSiblingIntoMain` / peer packet + DeliveryGate.
- Missing host seam → visible `[grokbot-unit-fork-degraded]` + 0.1.8 registry-only cancel-then-claim (no crash).
- Default `fold` short-protocol unchanged.

Honest limit: parallel means **parent Session + child Session via host subagent** — not Temporal, not same-Agent dual LLM kick. Mount `@deepseek-ai/dsh-subagent` + `dsh-subagent-spawn-in-process` (optional fork-in-process) in the profile.

### 0.1.8 notes

RPWU P1 slice toward Grok Bot–like work mode (community homage; **not** affiliated with xAI):

- **P1-a fold|fork** — `rpwuOtherMode: fold|fork` (default `fold`). Fork creates a sibling WorkUnit (status / checkpoint / lane queryable via `workUnits.query` / `siblingsOf`); `foldSiblingIntoMain` folds the result back into user-facing MAIN without inventing Temporal.
- **P1-b agent-lane peer return** — `acceptPeerHandoff` models background/peer finished → structured packet (`theme` / `keyPoints` / `todos`) → fold into MAIN conversation (`[grokbot-peer-handoff]`).
- **P1-c deliverySpec** — optional `{ shape, sink }` on WorkUnit; DeliveryGate verifies the contract when present; sticky `chatPosted` + `workspaceOnly` from 0.1.7 unchanged for units without a spec.

Honest limit (closed in 0.1.9 for the fork path): 0.1.8 fork was registry-level sibling bookkeeping inside one Agent session.

### 0.1.7 notes

DeliveryGate substantive delivery: `text + tool` with progress-only narration (no code fence / short body) stays `workspaceOnly` so the gate still fires; sticky `chatPosted` from an earlier OTHER answer no longer skips MAIN tool dumps (`workspaceOnly` also gates). Default `deliveryGateMaxRetries` raised to **2**. Gate notice asks to paste MAIN code/progress into the visible reply.

### 0.1.6 notes

RPWU P0: in-memory WorkUnit registry, step checkpoints on step/end + preempt, fold-into-unit (unitId + goal in fold notice), DeliveryGate (≤1 chat continuation when `chatPosted` is false).

### 0.1.5 notes

MAIN resume anchor on preempt: fold notice quotes the unfinished human MAIN (≤1200 chars) and tightens chat dual-delivery (OTHER then MAIN in the same visible assistant reply; workspace-only ≠ done).

### 0.1.4 notes

Chat-inline dual delivery in fold notice: prefer completing OTHER then unfinished MAIN in the same visible chat/conversation reply; do not treat workspace/tool-only writes as done unless the user asked to save files.

### 0.1.3 notes

Stronger fold copy (never imply dropping the prior task); fixed claim order human→fold; `lastSteerPreempt` trajectory meta; `steerFoldMode`.

## Architecture

Fork of the official agent-loop (MIT) with a thin dual-lane **Scheduler** and interruptible **steer** admission:

1. `decideAdmission('steer', { busy })` → preempt + next-step claim.
2. Driver: cooperative `cancel({ kind: 'user' }, { keepInbox: true })` → enqueue next-step → latch wake.
3. `AgentFactory` (`create` / `resume`) unchanged vs stock — same session persistence and UI events.

Pure scheduler is unit-tested; loop contracts covered by vitest against `@deepseek-ai/dsh-*` peers.

## Develop

```sh
npm install
npm test          # build + vitest
npm run smoke     # entry + scheduler dry-run
```

## Intentional v1 non-goals

- Temporal / durable cloud runner
- Changing dsh `Phase` to allow same-Agent multi-kick
- Embedding a subagent backend inside this plugin
- Claiming to be an official Grok Bot product

## License

MIT — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE) (upstream agent-loop attribution).
