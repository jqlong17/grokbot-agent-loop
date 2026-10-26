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
    steerFoldHint: true
    steerFoldMode: bot-like
    steerResumeAnchor: true
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

配置项：
- `interruptOnSteer`（默认 `true`）— 设为 `false` 恢复官方 steer 等待语义
- `steerFoldHint`（默认 `true`）— 抢占后注入「先完整回答最新插话，再无省略续写被打断主任务；优先同一条可见对话双交付」的 producer notice（对齐 grok.com Bot；不污染用户插话文案）
- `steerFoldMode`（默认 `bot-like`）— `bot-like` 用完整两阶段契约文案；`minimal` 用更短 notice，顺序契约相同
- `steerResumeAnchor`（默认 `true`）— 抢占 fold notice 嵌入未完成 MAIN 用户原文摘要（≤1200 字），强制同一条可见对话里续写；`false` 时≈0.1.4（无锚点引用）
- `rpwuEnabled`（默认 `true`）— RPWU：会话内 WorkUnit 注册表 + step checkpoint + fold-into-unit；`false` 时≈0.1.5
- `rpwuOtherMode`（默认 `fold`）— P1-a/P1.5：`fold` 把 OTHER 折进 MAIN（保持 0.1.7 短协议）；`fork` / `subagent` 走宿主 `ctx.subagents.startActivation` 拉起子 Session；无 seam 时降级为 registry-only + `[grokbot-unit-fork-degraded]`
- `rpwuSubagentProvider`（默认 `spawn`）— `startActivation` 的 provider 名（`spawn` / `fork`）
- `rpwuSubagentDelivery`（默认 `caller`）— `caller` 由插件 await 结果并 fold；`parent` 同时走宿主父级通知
- `deliveryGate`（默认 `true`，依赖 RPWU）— 非实质/仅 workspace 交付时不让 unit 完成；若 unit 带 `deliverySpec`，一并校验 shape + sink
- `deliveryGateMaxRetries`（默认 `2`）— 每个 unit 最多 DeliveryGate 续跑次数

### 0.1.9 改动摘要

**P1.5 subagent 真并行**（跟进 0.1.8 / PR #6）。规格见 [`docs/rpwu-p15-subagent-parallel.md`](./docs/rpwu-p15-subagent-parallel.md)。

- `rpwuOtherMode: fork|subagent` 调用 `ctx.subagents.startActivation`：OTHER 在**子 Agent + 子 Session**跑，MAIN **不 cancel**，父子可同时飞
- sibling 挂 `childSessionId` / `activationRef`；子结算后 `foldSiblingIntoMain` / peer 包 + DeliveryGate
- 未挂 subagent：可见 `[grokbot-unit-fork-degraded]`，回落 0.1.8 单 Agent cancel-then-claim，不崩
- 默认 `fold` 短协议不变

诚实边界：并行 = **父 Session + 子 Session（宿主 subagent）**，不是 Temporal，也不是同 Agent 双 kick。需在 profile 挂 `@deepseek-ai/dsh-subagent` + `dsh-subagent-spawn-in-process`（可选 fork-in-process）。

### 0.1.8 改动摘要

朝 Grok Bot 工作模式再靠一刀（社区致敬，**非** xAI 官方）：

- **P1-a fold|fork** — `rpwuOtherMode: fold|fork`（默认 `fold`）。fork 出可查 status/checkpoint/lane 的 sibling；`foldSiblingIntoMain` 把结果折回 MAIN（不做假 Temporal）
- **P1-b agent-lane peer 回报** — `acceptPeerHandoff`：后台/peer 完成 → 结构化包（`theme` / `keyPoints` / `todos`）→ 折进 MAIN（`[grokbot-peer-handoff]`）
- **P1-c deliverySpec** — WorkUnit 可选 `{ shape, sink }`；gate 在有契约时验字段；无契约时保留 0.1.7 sticky chatPosted / workspaceOnly

诚实边界（fork 真并行缺口已由 0.1.9 接上）：0.1.8 fork 仍是单 Agent 会话内的 registry 记账。

### 0.1.7 改动摘要

- **DeliveryGate 实质交付**：同一步 `短文/进度旁白 + tool` 仍视为未 chat-deliver（`workspaceOnly`），会触发 gate；先 OTHER 后 MAIN 工具落盘时，sticky `chatPosted` 不再跳过 gate
- **`deliveryGateMaxRetries` 默认 2**；gate 文案明确要求把 MAIN 代码/进度贴进可见回复
- 仍可 `deliveryGate:false` / `rpwuEnabled:false` 回退

### 0.1.6 改动摘要

- **RPWU P0**：内存 WorkUnit Registry、step/end + 抢占 checkpoint、fold-into-unit（fold 含 unitId/goal）、DeliveryGate（`chatPosted===false` 时最多 1 次对话续写）
- 保留 0.1.5 MAIN 锚点与 0.1.4 chat-inline dual delivery

### 0.1.5 改动摘要

- 新增 **MAIN 续写锚点**（`steerResumeAnchor`）：抢占时把未完成主任务原文嵌进 fold notice，并收紧「对话内必须双交付」契约
- 保留 0.1.4 chat-inline dual delivery 与 0.1.3 顺序/meta

### 0.1.4 改动摘要

- fold 文案补 **chat-inline dual delivery**：优先在同一条可见对话流里先交 OTHER、再续写 MAIN；勿把仅工作区/工具落盘当完成（除非用户明确要求）
- 保留 0.1.3：`steerFoldMode`、human→fold 顺序、`lastSteerPreempt`

### 0.1.3 改动摘要

- 强化 fold 文案（禁止暗示可放弃主任务）；固定 claim 顺序：用户插话在前 / fold notice 紧随
- 新增 `steerFoldMode: bot-like | minimal`
- 抢占成功写入 `lastSteerPreempt` 轨迹友好标记（非用户可见气泡）

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
- 改 dsh `Phase` 允许多 kick
- 在本插件内嵌 subagent 后端
- 宣称官方 Grok Bot 产品

## 许可

MIT — 见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
