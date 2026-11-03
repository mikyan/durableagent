# Pi SDK 1.3.0 → 1.5.0：Android 宿主契约差异

研究日期：2026-11-03。状态：固定源码差异审计；未选型、未实施、未运行上游代码、未做真机测试。

本文只补充 `pi-sdk-android-contracts.md` 和 `runtime-candidate-review.md`，不改写它们。使用简化技术中文。保留 `Module`、`Interface`、`Seam`、`Adapter` 的含义。

## 1. 结论先行

**此前的架构边界不变，但 `1.5.0` 不是 `1.3.0` 的直接替换。** SDK 仍可留在本应用。完整 Termux 仍可只负责工具执行。独立运行宿主仍必须管理持久状态、执行核验和主动停止。

必须更新的契约有：

1. SQLite Interface 增加 `runCounted()`。`Storage.commit()` 改为批次和持久化收据。
2. SQLite schema 从 `1` 升到 `2`。任务新增持久 `sleeping` 状态。
3. 进度可以先显示、后持久化。UI 可见不再等于已经落盘。
4. 崩溃恢复增加连续重启上限。被打断的模型请求改计失败尝试，而不是直接重发。
5. watch、报告和文件监听 Interface 发生不兼容变化。`pi.live` 在固定源码中是 **version `3`**，不是发布说明中某条记录的 `2`。
6. 参数校验从 TypeBox 转到 `pi-schema`。旧的校验行为和运行时验收清单不能原样沿用。

**未消失的阻断项：**安全重放仍跳过 `beforeTool`；内置 Bash 仍没有命令重连收据；Google 仍拒绝不同的自定义 `fetch`；Bedrock 和 Codex WebSocket 仍不能由一个普通 `fetch` Adapter 覆盖。[3–13]

这些差异不批准任何生产 SDK 版本，也不改变运行时候选排序。Javet Node 优先验证仍只是有条件的实验顺序。独立 Hermes 和应用拥有的 Node 子进程仍需比较。没有重测 Javet、Hermes、ABI、Termux 或 Android 策略。

## 2. 固定版本与证据方法

| 名称 | `git ls-remote` 核验的提交 |
|---|---|
| `v1.3.0`，下称 A | `71023aec1546d6d677a65669c5665c0927ce0dd0` |
| `v1.5.0`，下称 B | `f9a26365568127461c47a07a37dcb42c140a3ac5` |

源码来自 [A 固定树][A] 和 [B 固定树][B]。使用命令行 HTTP 读取 raw 文件，并在内存中比较文本。没有安装 SDK，没有下载二进制，没有使用浏览器、凭据或设备。没有证明 npm 发布产物与这 2 个提交逐字相同。

发布说明只用来发现检查点。大范围输出曾被截断；本文结论使用随后取得的文件差异或定点代码，不把截断部分视为已经审计。GitHub REST 匿名接口限流；raw HTTP 和 Git 引用查询可用。

下文区分：

- **源码事实**：固定源码声明或执行的行为。
- **推论**：这些行为对应用 Module 和 Adapter 的影响。
- **待测**：必须在获准的目标构建或设备上验证的行为。

## 3. 入口、运行时基线与参数校验

### 3.1 package exports 和 engines

**源码事实：**A、B 的 `pi-durable`、`pi-ai`、Chord 均声明 `engines.node >=22.19.0`。B 没有提高这个声明基线。[1]

- `pi-durable` 保留已有子路径，包括 `env`、`env/node`、`storage/sqlite`、`storage/sqlite/node`。新增 `storage/indexeddb` 和 `storage/store`。
- `pi-ai` 的 package export 路径映射不变。但根入口移除 `Type`、`Static`、`TSchema` 的 TypeBox 转导出，增加 identity 和流式 JSON 工具导出。
- Chord 新增 `sqlite`、`sqlite/node`、`sqlite/cloudflare`、`telemetry-sqlite`、`next` 入口。
- Durable 的 portable SQLite 入口从 Chord 转导出数据库类型。Node 子路径转用 `@earendil-works/chord/sqlite/node`，后者仍导入 `node:sqlite`。[2–4]

**推论：**可移植数据库 Seam 仍存在。不是所有宿主都必须采用 `node:sqlite`。新增 IndexedDB/Store 导出也不等于已经选择这些存储，更不要求把 SDK 放进 WebView。`engines` 未变不证明 Android 兼容性未变。

本轮没有重建 B 的完整传递导入图。此前 A 的“34/25 个相对静态文件”数量不能套到 B。

### 3.2 TypeBox → pi-schema

**源码事实：**B 的 Durable、AI、Chord 使用 `@earendil-works/pi-schema`，不再直接依赖 TypeBox。AI 的 `validateToolArguments()` 使用：

```ts
compile(schema, { formats, coerce: true, unresolvedRefs: "reject" })
  .parse(structuredClone(toolCall.arguments))
```

Durable 的 structured output 校验也改用 `pi-schema`。内置 Bash schema 改用 `obj`、`str` 等 builder，并明确 `{ open: true }`。[2、5]

**推论：**工具参数 Interface、校验错误和强制转换必须重新验收。不能把 TypeBox 自定义校验当作仍在执行的策略。策略应核验实际执行参数，不能只信任模型原始 JSON。

已检查 `pi-schema` 的 package、入口和 validator 入口。没有全面审计其 compiler、coercer、格式实现及全部传递依赖。因此不据此宣布整个 SDK “无需动态代码”或“已兼容 Hermes”。

## 4. 存储 Seam：必须更新的差异

### 4.1 SqliteDatabase Interface

A 的数据库 Interface 位于 Durable。B 将它移到 Chord，再从原 Durable 子路径转导出。[3]

B 新增必需方法：

```ts
runCounted(sql: string, ...params: SqliteValue[]): Promise<number>
```

计数使用 SQLite `changes()` 语义。索引写入和 trigger 导致的额外行变化不计入。数据库对象和事务 handle 都必须实现它。Node Adapter 返回 statement `run(...).changes` 的数值。

以下规则没有变化：

- 所有操作异步返回。
- 事务内部只使用该事务 handle。
- 无关操作和其他事务必须排队。
- callback 结束后，事务 handle 失效。
- Promise 在提交或回滚结束后才完成。
- callback 失败且回滚成功时，返回原错误。
- 回滚也失败时，必须返回不同错误，不能伪称已回滚。

**推论：**Kotlin SQLite Adapter 仍可实现这个 Seam，但旧实现必须补齐 `runCounted()`。不能用固定 `0` 伪实现。若通过单独 `changes()` 查询实现，必须保证查询与目标 statement 之间不插入别的写操作。

Node driver 仍采用 `BEGIN IMMEDIATE`。其 statement cache 新增 `256` 项上限。这是资源管理变化，不是 Android SQLite 可用性证明。[4]

### 4.2 SQL schema 与降级

**源码事实：**B 保留初始 schema，再增加 migration `2`。它重建 tasks 表，把 `sleeping` 加入 `status` 的 CHECK 约束，复制旧记录，再重建索引。迁移仍在数据库事务内执行。[6]

`STRICT`、`json_valid`、既有索引和写入语法没有被移除。表名和索引名定义没有改名；prefix 校验转交 Chord。`ids.ts` 两版逐字相同。

A 支持 schema `1`，并拒绝比自己更新的版本。因此，已经迁移到 schema `2` 的库不能直接交回 A 打开。升级必须验证中断恢复和回退方案；不能靠替换包文件降级。

**推论：**此前对 SQLite 能力的要求仍有效。提高 `targetSdk` 仍不是升级 SQLite 引擎的方法。本轮未重新核查 Android 各 API 的 SQLite 版本表。

### 4.3 Storage.commit 不再是单次 writes → Seq

A：`commit(writes, context): Promise<Seq>`。

B：[7]

```ts
commit(batches, receive, context): Promise<CommitResult>
// receive(index, seq)
// CommitResult = { stored: number; refused?: unknown }
```

B 的 SQLite 实现：

1. 在一个 SQL 事务中处理多个 batch；每个 batch 有自己的 `seq`。
2. 每个 batch 先检查，再写入；检查能看到前面 batch 的写入。
3. SDK 自身检查拒绝某个 batch 时，保留前面成功的 batch。该 batch 和后续 batch 不写入。
4. 数据库调用失败不是这种拒绝。它导致事务失败并尝试回滚。
5. SQL `COMMIT` 返回后，按顺序调用 `receive(index, seq)`。

Interface 把异常返回定义为结果可能不确定。已经发出的持久化收据仍有效。`receive` 是存储收据，不是 UI publication，更不是 Termux 命令收据。

**推论：**若宿主直接实现 `Storage`，这是主要破坏性变更。若只实现 `SqliteDatabase`，批次逻辑由 SDK 承担，但宿主仍必须保证整个事务和提交确认的语义。必须区分业务检查拒绝、数据库失败和提交后断线。

### 4.4 进度先显示、后落盘

B 的 `CommitPersistence` 默认 `immediate`。可选 `deferred` 只适用于符合条件的已有 conversation document 更新：`history: "latest"`、`fork: "initial"`，且不涉及创建、迁移或退休。[7]

这种更新可以先进入内存、watch 和 view，随后落盘。触发点包括读取或写入该 document 的后续 commit、关闭、退休、离开缓存或期限到达。默认期限约 `1,000 ms`；不是硬实时保证。崩溃可能丢失尚未持久化的内容。

内置工具的进度使用 `PROGRESS_COMMIT`。但执行 intent/checkpoint 单独立即提交，工具才开始执行。返回任务状态的 commit 不会被 deferred。[8]

**推论：**前端看到输出不能作为已持久化、命令完成或可重放的证据。运行时到 UI 的 Interface 必须区分展示状态和持久状态。命令核验收据不能只保存在可丢失的进度 document 中。

### 4.5 readOnly 不等于多个 owner

B 增加 `HarnessOptions.readOnly`。它不恢复 `running` 任务、不运行 scheduler、不发 wake 通知，并拒绝带写入的 commit。Session 在这个模式下不使用普通 read cache。[9]

但是，`SqliteStorage.mintId()` 仍在内存中递增 `nextId`。Harness 和 scheduler 仍维护本地状态。`SqliteStorage.open()` 仍调用迁移。

**推论：**可以研究只读查看端，但不能由此推导多个可写 Harness 可以共享同一个库。此选项也不是 SQLite 的只读连接开关。跨进程实时通知、只读副本同步及一致性尚未验证。应用仍须明确唯一可写 owner；WAL 不替代所有权。

## 5. 执行身份、重放和主动停止

### 5.1 执行 Interface 没有新增重连键

A、B 的 `ExecutionEnv` 仍是 `FileSystem` 与 `Shell` 的组合。`FileSystem.id` 仍表示文件命名空间：相同 id 表示相同路径看到相同文件。它不是 Android UID，也不是授权令牌。[10]

`ShellExecOptions` 和 `Shell.exec()` 在本次完整 `env/index.ts` 差异中没有变化。仍没有执行键、`taskId` 参数或恢复句柄。`cleanup()` 仍用于环境 owner 关闭，不是单请求停止。

内置 file mutation queue 文件逐字相同。它没有升级成跨进程 workspace 锁。内置 Bash 的差异是 schema builder；执行与 replay 契约没有新增命令核验路径。[8、10]

文件监听有破坏性变化：

- `WatchChange` 改名为 `FileChange`。
- 使用 `{ kind: "paths", paths }`、`{ kind: "overflow" }`、`{ kind: "failed", error }`。
- `FileWatcher.close(context)` 改为 `stop(context)`。

**推论：**文件监听 Adapter 必须更新；Termux 执行收据 Seam 仍由应用设计。传相同路径和相同 `id` 不会授予跨 UID 文件访问权。

应用拥有的 SDK 状态、支持 POSIX 的工具工作区、用户授权的原始文件，仍是 3 种存储职责，不是新增产品实体。共享 `/sdcard` 仍不是完整跨 UID 工作区方案；其 `noexec`、缺少符号链接和构建兼容风险沿用此前研究，未在本轮重测。

### 5.2 beforeTool 的恢复缺口仍存在

两版的首次调用都执行参数校验、`beforeTool`、再次校验，再记录 intent 和执行工具。B 把展示用 slot 更新与立即持久化的 intent 拆开，但仍保证 intent 先于执行。[8]

恢复进入 `execute` phase 后，只有已存 replay 和当前工具 replay 都为 `safe`，才重新调用执行体。**这条分支仍没有重新运行 `beforeTool`。**非 safe 分支写入 `interrupted`，不会查询外部命令结果。

B 新增连续重启限制；达到上限时可以先结束为 `restart_limit`，不再进入上述执行分支。因此不能把 B 概括成“safe 工作会无限重试”。

**推论：**强制授权、路径权限、计费网络策略等仍必须覆盖实际执行入口及恢复执行。只放在 `beforeTool` 中不够。把任意 Bash 改成 `safe` 也不能建立幂等性。

### 5.3 abort 与 close 仍不同，但恢复行为更具体

**源码事实：**B 的 `Conversation.abort()` 仍提交 abort 标记、撤回范围内排队输入，并等待普通 ownership scope 空闲。`background: true` 额外覆盖停止被接纳时到达的后台任务，不自动覆盖后来创建的所有后台工作。[9]

B 新增：

- `TaskRecord.restarts`；打开库时，对遗留 `running` 任务计数并转为 `pending`。
- `restartLimit` 默认 `5`。任务状态取得进展后清除连续计数。
- 内置工具达到上限时产生 `restart_limit` 结果。其他任务及达到上限的 abort handler 可以变成 `faulted`。
- 正常关闭会 signal 并等待 invocation，再把相应 `running` 任务写回 `pending`，保留已提交的 abort 标记。成功关闭不会被下次 open 计为崩溃。
- `afterTool` 也处理 Harness 生成的失败、阻止和取消结果。在部分重启上限路径上跳过 hook。慢的 abort 结果 hook 可以延迟停止完成。[8、9]

**推论：**`close()` 仍不是用户停止。主动停止必须提交 durable intent，并对 Termux 命令及其子进程落实停止。SDK 任务变为终态不证明外部进程已经结束。关闭、进程被杀、SDK fault 和用户停止必须分别显示、记录和验收。

### 5.4 持久 sleep 和模型恢复

B 新增 `sleeping`、`TaskRuntime.sleepUntil()`、`Harness.wake()`、`HarnessOptions.onWake` 和宿主 timer Interface。[9]

- sleep deadline 使用 Harness 的 epoch 毫秒时钟。重开同一库的宿主必须使用同一时钟基准。
- 配置 `onWake` 后，SDK 不再为这些 sleeping task 自己安排唤醒 timer。宿主必须安排唤醒，再调用 `resume()`。
- 没有 `onWake` 时使用运行进程中的 timer。这不保证 Android 在进程死亡后唤醒应用。

B 的 generation `request` 和 `poll` phase 检测 `restarts`。被崩溃打断的请求计为失败尝试，按 retry 策略等待或结束为 `interrupted`。poll 重试继续查询原 deferred response。A 的对应 phase 没有这条计费失败分支。[11]

**推论：**恢复 Module 必须纳入时钟、重试预算和 wake 生命周期。不能把 Android 的进程重建当作无限免费重发。正常 close 后的恢复也不能与 crash 后的恢复混为一谈。具体 Android 唤醒机制未选定。

## 6. UI/运行宿主 Interface 与持久文档版本

B 根入口移除 `watchEvents` 及相关 event 类型，也移除旧 `DocumentState`。状态 watch 转用 Chord 的 `WatchHandle`。[2、12]

- listener 使用 `(call, context)`；Durable 的有效值调用是 `{ kind: "value", value, ops, retired }`。
- `WatchEnd` 使用 `kind`，包含 `stopped`、`aborted`、`ended`、`listener_error`、`failed`。
- document watch 跟随地址，而不是只跟随一个 incarnation。退休不再用 `null` 值表达，也不必结束 watch。
- `observeCommits()` 使用 observer 对象并返回 `detach()`；只在内容已存储后发布持久 commit。
- `DocumentCommitChange` 区分 `kind: "change"` 和 `kind: "retire"`。
- `SessionEnd.reason` 改为 `SessionEnd.kind`。
- `onReport` 接收一个带 `kind` 和 `error` 的 `Report`，不能继续按旧回调参数解析。

**必须纠正发布说明线索：**A 的 `LiveDoc.version` 是 `1`；B 固定源码第 194–212 行定义的是 **`3`**。其 migration 把 compaction 的 `reason` 改为 `trigger`，并给缺少 `run.turns` 的运行补 `0`。`ToolTask.version` 也从 `2` 变为 `3`，新增对未提供工具调用的输入标记支持。[8、12]

**推论：**宿主/React 的同步 Adapter 必须固定匹配的 SDK 状态版本。不能把旧事件流或旧 `pi.live` JSON 结构当作稳定协议。SQLite schema 版本、document 版本和应用 IPC 协议版本是不同层次，不能只检查其中一个。本文不选择 IPC 协议。

## 7. Provider 传输：主要限制没有消失

| 检查项 | A → B 源码结果 | 架构影响 |
|---|---|---|
| Google Generative AI | 仍检测 `options.fetch !== globalThis.fetch` 并报不支持 custom fetch | 不能仅注入每请求 Kotlin fetch 就宣称支持 |
| Google Vertex | 相同拒绝逻辑仍在；继续使用 Google SDK client | ADC、鉴权刷新和实际网络链路仍需独立验证 |
| Bedrock lazy 入口 | 文件逐字相同，继续使用变量 specifier 动态 import 实现 | lazy 只推迟依赖，不消除依赖 |
| Bedrock 实现 | 仍使用 AWS SDK；运行时导入 `NodeHttpHandler`、HTTP(S) proxy agents；Node/Bun proxy 或强制 HTTP/1 分支设置 handler | `options.fetch` 没有被接到这些请求上；不能当成普通 fetch Provider |
| Codex SSE | 仍通过 `options?.fetch ?? globalThis.fetch` 发 POST | 可保留独立 SSE Adapter 验证路线 |
| Codex WebSocket | 仍执行 `new WebSocketCtor(url, { headers: wsHeaders })` | 浏览器标准 WebSocket constructor 不提供这个 headers 契约；fetch 不能覆盖它 |

证据为两版 Provider 源文件差异及 B 的具体构造/发送代码。[13]

Bedrock 的 `node:https` 在这里是 **type import**，不能单独作为运行时 Node 依赖证据。实际证据是 AWS handler、proxy agent 的运行时导入和调用。源码也有非 Node 配置分支；本轮没有验证该分支及外部 AWS SDK 在目标 bundle 中的完整可用性。因此结论是“普通 fetch 接线未覆盖”，不是“所有非 Node 实现绝无可能”。

B 新增 `ClientIdentity` / `HarnessOptions.identity`，用于 User-Agent 和 Provider attribution。Codex 继续发送默认 `originator: "pi"`。这些身份字段不是执行身份、权限或幂等执行键。[9、13]

**推论：**此前“按 Provider 划分传输 Adapter”的结论不变。支持全 Provider 仍需证明 Google、AWS SDK、SSE、WebSocket 和取消各自的运行路径，不能用单个 Provider 的成功替代。

## 8. 对原结论的影响

| 原结论 | 本轮裁定 |
|---|---|
| SDK 留在应用；Termux 只执行工具 | 保留。未发现要求移走 SDK 的接口变化 |
| 独立运行宿主拥有持久状态和恢复 | 保留；新增 deferred、restart、sleep/wake 验收义务 |
| 存储 Adapter 可替换 Node SQLite | 保留；补齐 `runCounted`，更新 storage 批次契约 |
| SQLite 引擎必须满足实际 SQL | 保留；新增 schema `2` 升级/回退门槛 |
| 只有一个可写 SDK owner | 保留；readOnly 不是多写者协调机制 |
| beforeTool 不能独自承载强制策略 | 保留；safe replay 仍绕过它 |
| 外部命令须有独立核验收据 | 保留；`receive(index, seq)` 只是 SDK 存储收据 |
| 用户停止不等于关闭宿主 | 保留；重启上限和 hook 增加边界情况 |
| A 的类型、事件、进度和校验清单可直接用于 B | 否；必须按本报告更新 |
| Javet/Hermes/应用 Node 已能据此选型 | 否；缺少目标构建和真机闭环证据 |

运行时、Termux 部署、`targetSdk`、协议和存储布局仍未决定。本报告不挑选生产 SDK 版本。

## 9. 后续验收增量：未执行

在原报告契约测试之外，至少加入以下检查：

| 测试 | 必须验证 |
|---|---|
| `sqlite-run-counted` | database/transaction 两个 handle；trigger 排除；并发不污染 `changes()` |
| `sqlite-v1-v2-migration` | 旧记录、索引、迁移中断；旧 SDK 拒绝新 schema；备份恢复方案 |
| `storage-group-receipts` | 第 N 个 batch 拒绝、数据库检查失败、COMMIT 失败；receipt 顺序和可见性 |
| `deferred-is-not-durable` | UI 已显示后杀进程；丢失进度不能丢失执行 intent 或外部核验记录 |
| `restart-limit-and-close` | 连续 crash 达到上限；正常 close 不增加计数；已有 abort intent 保留 |
| `sleep-wake-reopen` | 持久 deadline、重复 wake、时钟变化、进程死亡与重开；没有意外复活 |
| `model-crash-budget` | request/poll 中断进入 retry 预算；poll 不另建请求；停止后不恢复旧请求 |
| `watch-and-document-version` | B 的 tagged watch、退休/重建、`pi.live` v3、IPC 重新连接 |
| `schema-policy-regression` | 实际参数强制转换、错误、未知字段和旧自定义校验；执行侧策略不能漏过 |
| `provider-transport-delta` | Google custom fetch 拒绝、AWS 实际 handler、Codex SSE/WS headers 和取消 |

## 10. 实际检查清单与未审计范围

路径相对 A/B 仓库根。花括号只用于列举文件，不表示目录全部已读。

### 10.1 双版本比较

- `packages/{durable,ai,chord}/package.json`：完整比较 exports、engines、直接依赖。
- `packages/durable/src/index.ts`、`packages/ai/src/index.ts`：完整入口差异。
- `packages/durable/src/storage/sqlite/{database,index,migrations,schema,node,storage}.ts`：完整文件差异；对迁移、提交和 ID 分配另外检查 B 代码。
- `packages/durable/src/ids.ts`：逐字相同。
- `packages/durable/src/env/index.ts`：完整差异；执行 options、身份和文件监听 Interface。
- `packages/durable/src/env/node.ts`：读取过差异；不构成 Node 文件/进程 Adapter 的完整重审。
- `packages/durable/src/tools/{bash,file-mutation-queue}.ts`：完整差异，后者逐字相同。
- `packages/durable/src/harness/tool.ts`：完整差异；首次调用、安全重放、结果、abort 和重启上限路径。
- `packages/durable/src/types.ts`、`packages/durable/src/harness/{types,harness}.ts`：大范围差异及定点 Interface 检查；不声称审计每个方法。
- `packages/durable/src/harness/scheduler.ts`：两版 open/关闭路径；B 的 abortConversation、重启计数、sleep/wake、join 和上限分支。没有完整审计调度算法。
- `packages/durable/src/harness/{live,generation}.ts`：两版版本/请求恢复片段；B 的 LiveDoc migration、progress、restart 和 request/poll 分支。没有完整审计 generation 和 compaction。
- `packages/ai/src/utils/validation.ts`：完整差异。
- `packages/ai/src/api/{google-generative-ai,google-vertex,openai-codex-responses,bedrock-converse-stream.lazy}.ts`：完整差异，再检查传输相关片段。
- `packages/ai/src/api/bedrock-converse-stream.ts`：读取过差异；定点核验 imports、client/config、handler 和 fetch 接线。较大的消息转换差异不属于本轮完整审计。
- `packages/ai/src/types.ts`：读取过差异；不构成完整 Provider API 兼容审计。

### 10.2 B 新增或搬迁的代码

- `packages/chord/src/sqlite/{database,migrations,node}.ts`：完整读取；Node driver 与 A 的 Durable driver 对比。
- `packages/chord/src/index.ts`、`packages/chord/src/watch.ts`：export 定位和公开 watch 类型片段。
- `packages/durable/src/session/session.ts`：readOnly、缓存、deferred 和关闭相关片段。
- `packages/durable/src/harness/agent.ts`：默认 restart limit 及设置解析片段。
- `packages/schema/package.json`、`packages/schema/src/index.ts`、`packages/schema/src/validator.ts`：package/入口及 validator 入口路径。
- `packages/{durable,ai}/CHANGELOG.md`：只作为 A→B 差异线索；没有把全部 release note 当作已核验实现。

### 10.3 明确未审计

未全面检查 B 的传递导入图、锁文件、发布 tarball、完整许可证清单、原生依赖、图片/WASM、OAuth 流程、所有 Provider、模型目录、全部任务迁移、Store/IndexedDB/JSONL/Cloudflare 实现、跨进程订阅，以及上述算法的全部竞态和安全属性。没有运行上游单测、性能测试或设备测试。

没有核验新 schema compiler 的全部功能。没有因 release note 的性能数字而降低内存或性能验收要求。没有证明任一运行时满足 B 的全部 JavaScript primitive、ESM、动态 import 或网络依赖。

## 11. 固定源码定位

[A]: https://github.com/earendil-works/pi/tree/71023aec1546d6d677a65669c5665c0927ce0dd0
[B]: https://github.com/earendil-works/pi/tree/f9a26365568127461c47a07a37dcb42c140a3ac5

下列链接固定 B；第 10 节对应 A 文件可在 [A 固定树][A] 按相同路径定位。搬迁前路径已单独写明。

1. package 声明：[Durable](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/package.json)、[AI](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/package.json)、[Chord](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/chord/package.json)。
2. 根导出：[Durable](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/index.ts)、[AI](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/index.ts)。
3. SQL Interface：[A database.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/database.ts)、[B Chord database.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/chord/src/sqlite/database.ts)。
4. Node driver：[Durable wrapper](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/node.ts)、[Chord 实现](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/chord/src/sqlite/node.ts)。
5. 参数校验：[AI validation.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/utils/validation.ts)、[schema validator.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/schema/src/validator.ts)。
6. 迁移：[A migrations.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/migrations.ts)、[B migrations.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/migrations.ts)、[Chord migration runner](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/chord/src/sqlite/migrations.ts)。
7. 存储/commit：[types.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L1174-L1189)、[Storage Interface](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L1313-L1345)、[SQLite storage.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/storage.ts)。
8. 执行/重放：[tool.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/tool.ts)、[bash.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/tools/bash.ts)。
9. 生命周期：[harness/types.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts)、[scheduler.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts)、[session.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/session.ts)。
10. 执行 Interface：[env/index.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/env/index.ts)、[file-mutation-queue.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/tools/file-mutation-queue.ts)。
11. 模型恢复：[A generation.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/generation.ts#L196-L243)、[B generation.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L497-L543)。
12. 观察与版本：[Chord watch.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/chord/src/watch.ts)、[A LiveDoc](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/live.ts#L111-L117)、[B LiveDoc](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/live.ts#L194-L223)。
13. Provider：[Google](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/google-generative-ai.ts#L85-L89)、[Vertex](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/google-vertex.ts#L94-L98)、[Bedrock lazy](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/bedrock-converse-stream.lazy.ts)、[Bedrock](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/bedrock-converse-stream.ts#L168-L263)、[Codex](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/openai-codex-responses.ts#L1092-L1117)。
