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
    agents: []
```

See [`examples/cordis.patch.yml`](./examples/cordis.patch.yml) for a copy-paste profile overlay.

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

Config flag: `interruptOnSteer` (default `true`). Set `false` for stock steer wait semantics while keeping this package mounted.

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
- Multi-bot orchestration
- Claiming to be an official Grok Bot product

## License

MIT — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE) (upstream agent-loop attribution).
