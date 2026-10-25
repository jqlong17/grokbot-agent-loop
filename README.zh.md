# GrokBot Loop

**面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（dsh）的可打断双车道 agent-loop 插件。**

> **声明：** 仅社区致敬命名。**与 xAI / Grok Bot 无任何隶属、背书或赞助关系。** 独立 MIT 插件，通过 Cordis id `agent-loop` 替换官方 `@deepseek-ai/dsh-agent-loop`。

[English](./README.md) | 中文

## 行为对比

| 行为 | 官方 loop | GrokBot Loop |
|---|---|---|
| 忙时 Enter → `steer()` | 等到当前 step 边界 | **协作取消** → 新 step 认领用户文本 |
| 流式输出中插话 | 等 step 结束 | 中止当前流（**保留已流出前缀**）并认领 |
| Cmd/Ctrl+Enter → `followup()` | next-turn 排队 | 相同（QueueDock 互补路径） |
| 静默 `inject()` / 工具续跑 | next-step、不唤醒 | 相同（Agent 车道，不抢占） |
| 轨迹 / 用量 / 工具 | 完整 | 同一套 session + `agent/*` 契约 |
| 卸补丁 | — | 恢复官方 loop |

**双车道**

- **用户车道** — `steer` / 人工（以及通过 `followup` 的排队）：始终最高优先。
- **Agent 车道** — 工具续跑 / 静默 `inject`：认领时用户车道为空才继续；永不抢占。

## 安装（仅 Git URL）

需要可用的 dsh profile（Node `^22.19.0 \|\| >=24.0.0`，dsh `>=0.2.0 <0.3.0`）。Peer 由 dsh 安装解析（`@deepseek-ai/*` **0.2.1-rc.3** 线，见 `package.json`）。

```sh
dsh plugin --profile web add github:jqlong17/grokbot-agent-loop
```

包内 `cordis.patch.yml` 会按 id 替换 `agent-loop`：

```yaml
- id: agent-loop
  name: '@harness-plugins/grokbot-agent-loop'
  config:
    maxParallelToolCalls: 10
    interruptOnSteer: true
    agents: []
```

完整示例见 [`examples/cordis.patch.yml`](./examples/cordis.patch.yml)。

### 卸载 / 恢复官方 loop

```sh
dsh plugin --profile web remove @harness-plugins/grokbot-agent-loop
```

或从 profile 的 `cordis.patch.yml` 删掉对 `agent-loop` 的覆盖，使 `@deepseek-ai/dsh-base` 中的官方 `name` 重新生效。

## 忙时 Enter 与排队快捷键

1. Web 端将 **Busy Enter** 设为 **Steer（插话）**，使普通 Enter 走 `agent.steer()`。
2. GrokBot Loop 会对进行中的 step **抢占取消**，而不是等待或丢进 QueueDock。
3. **Cmd/Ctrl+Enter** 仍走 `agent.followup()` → **next-turn 排队**。

配置项：`interruptOnSteer`（默认 `true`）。设为 `false` 可在保持本包挂载的同时恢复官方 steer 等待语义。

## 架构

在官方 agent-loop（MIT）之上增加纯策略 **Scheduler** 与可打断 **steer** 准入：

1. `decideAdmission('steer', { busy })` → preempt + next-step 认领。
2. Driver：协作 `cancel(..., { keepInbox: true })` → 入队 next-step → latch wake。
3. `AgentFactory`（`create` / `resume`）与官方一致。

## 开发

```sh
npm install
npm test
npm run smoke
```

## v1 明确非目标

- Temporal / 云端耐久 runner
- 多 bot 编排
- 宣称官方 Grok Bot 产品

## 许可

MIT — 见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
