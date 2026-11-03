# Pi SDK 1.5.0：输入边界、工作区上下文与退休能力

研究日期：2026-11-03。唯一上游基线：`earendil-works/pi@f9a26365568127461c47a07a37dcb42c140a3ac5`。这是窄范围源码研究，不是实现或运行验证。

已读 [data-design.md](../data-design.md)、[数据政策研究](pi-sdk-1.5-data-policy.md)、[数据权威研究](pi-sdk-1.5-data-authority.md)，并交叉核对相关扩展／版本研究。**按本次指令，Q19—Q26 已接受**；不沿用旧文档的待确认标签，不修改其他文件。不讨论传输或 Android 实现。

## 1. 关键约束

1. **发送意图、request ID、submission、inbox item、entry、run 和 generation task 不是一一对应。** 多个输入可以加入同一 run；一个 run 可以经过多个 generation task；`pi.live.run.taskId` 会交接，不是稳定 run ID。[S1–S4]
2. **有受支持的原子接入点：`Conversation.submit(tx, draft)`。** 应用 document 的检查／绑定、接纳输入及其可能启动的 run，可以处于同一 SDK commit。它必须先于第一次 table write；不能先创建 conversation 再在同一个 commit 调用它。[S5]
3. **没有已声明的通用 `beforeRun`／`onInboxConsumed` 事务 hook。** 输入排队后，由内置边界自动放入 transcript 并启动后继工作。`beforeRequest`、`afterTools`、`afterRun` 不是这一原子边界的替代。[S2、S4、S6]
4. **SDK 自动复制 task-owned 子 conversation 的 `pi.agent`，不自动理解应用工作区绑定。** 应用可以在创建事务／全局创建 hook 复制自己的上下文；产品登记必须保持显式。[S7、S8]
5. **固定版本没有删除 conversation、entry、submission 的公开 API，也没有这些记录的 retire 操作。** `abort`、reset、context omit、列表隐藏都不是物理删除。`Tx.retireDoc()` 是实际存在的文档生命周期操作；SQLite 对部分文档 revision 做 SQL 删除，但保留生命周期记录和 rewindable 历史。[S9–S12]
6. **Pi AI 已支持不同自定义 Provider ID 共存。** 可以保留旧连接定义，再为替代定义使用新 ID；无需第二套 Provider 框架。SDK 不自动冻结定义或凭据。[S15、S16]

## 2. 输入、run、generation 和 idle 的准确关系

### 2.1 身份与接纳

| 名称 | 固定源码事实 |
|---|---|
| `draft.requestId` | 宿主提供的可选字符串；在 **同一 conversation** 内去重。已有记录且 type 相同就返回原 submission，不比较 content、附件元数据或排队选项；type 不同则报错 |
| `SubmissionId` | SDK 全局数值身份；记录类型为 `input`、`write` 或 `continue`，不是 request ID，也不是 entry ID |
| inbox item | 尚待边界放置的 submission 内容；`id` 是 SubmissionId，带 `steer`／`followUp`／`write` 标签。不是另一条独立业务任务 |
| entry | 输入放置时产生的 transcript 记录。普通 input 产生 1 个 user entry，可带自定义 kind／data；排队期间还没有它，timestamp 在放置时生成 |
| run | `pi.live.run` 中的控制状态，含当前 generation 的 `taskId`、待结算的 `inputs`、工具轮数 `turns`、可选 `first`／`afterRun` |
| generation | 持久 `pi.generation` task。一次 task 可以经历 prepare、request、retry、poll、tools、finish／drain；重试不必新建 task。工具轮后通常创建下一 generation 并交接同一个 run |

证据：[S1–S4]。`LiveRun` 没有独立稳定 `id`；`first` 可缺失，continue 还可能沿用失败 run 的 first，不能未经规则就把它当作唯一 run key。[S3、S4]

**对 Q25 的约束：**应用必须固定同一次意图的目标、内容和 request ID；SDK 去重不替应用校验内容一致性。重试已撤回／已结束的同类型 request ID，仍找回原 submission，不会重新发送。用户主动再发须用新身份。接纳确认、`placed`、模型真正读取到输入、`done` 是不同事实；prepare 失败或后续上下文处理都可能阻止模型实际采用该输入。[S1、S2]

### 2.2 何时入队、批量放置与结算

- idle 且 inbox 空时，input 在接纳 commit 中追加 entry、创建 placed submission、启动 run 和 generation。不是先接纳、以后才发生可观察的 run-start 事务。
- busy 时，input 默认排为 follow-up；`whenBusy: "steer"` 排为 steer；`reject` 拒绝且不写记录。`whenIdle: "reject"` 在无 run 时拒绝，即使 inbox 非空。
- `continue` 只在 idle 接纳，不排队，也不新写 user entry。它先以 final 边界放置已有队列，再与选中的输入共同开始 run。若上下文没有待回答内容，prepare 以 `nothing_to_answer` 结束。
- `write` 是被动 transcript 写入，本身不触发 generation。纯展示写入通常立即完成，即使 busy；只有已有 queued reset 时才排队，避免落在 reset 之前。
- idle 但 inbox 非空时，新 input／影响模型上下文的 write 先入队，再在同一接纳 commit 执行 final 边界；新输入未必被本次选中。[S1、S2]

边界使用当时同步读取的 settings：

| 边界 | write | steer | follow-up |
|---|---|---|---|
| `postTools` | 全部 | 按 steeringMode 取首个或全部 | 不取 |
| `final` | 全部 | 按 steeringMode 取首个或全部 | 按 followUpMode 取首个或全部 |

两个 mode 均默认为 `one-at-a-time`；可选 `all`。这是**分别按标签选择**，不是全队列每次最多 1 条：final 可以同时选 1 条 steer 和 1 条 follow-up。先按 ID 顺序放 writes，再按 ID 顺序放选中的 user items；不是将多条内容拼成一个 entry。较早 follow-up 可以继续等待，而较晚 steer 先被 postTools 取走。选中项和 stale write 从 inbox 按位置移除。[S2、S3]

普通 postTools 将选中 steer 的 submission ID 加入当前 run，再创建下一 generation。成功 final 结算当前输入，选中的用户输入共同启动一个后继 run；整个交接可在一个 commit 内完成，**不保证中间出现 idle 窗口**。postTools 选中 queued reset 时改按 final 处理，旧输入以 `reset` 未回答结束。[S2、S4]

`onYield` 可以在没有 queued user item／reset 时追加内部 user message 并继续当前 run，保留原 submissions，重置 turns。它不要求新的宿主 submission。若选中了 `afterRun` hooks，答案先提交、原输入先变为 done；run 保持 busy，等 hook 请求的持久任务终结后才处理 final 队列。[S4、S6]

失败时 `afterFailedRun` 默认 `keep`，队列可留在 idle conversation；`continue` 才执行 final 并继续，`withdraw` 将 queued user inputs 结算为 `run_failed`，保留 writes。run task abort／fault／orphan 与 `Conversation.abort()` 不同：后者还撤回其作用域内 queued user inputs。`Submission.abort()` 只撤回 queued 项；placed 返回 `already_placed`，终态返回 `settled`，都不删 submission。[S1、S2]

### 2.3 不要合并 3 种“空闲／完成”

1. **输入接纳的 idle：**`pi.live.run === undefined`。可以仍有未放置 inbox 或其他任务。
2. **`Submission.wait()` 完成：**该 submission 是 done／unanswered；after-run 工作、后继 run 或其他任务仍可存在。
3. **`Conversation.waitForIdle()`：**普通 ownership 作用域没有 live 非 background task，包括非后台任务拥有的子 conversations；不要求 inbox 空，也不等待后台子树。Harness 的等待从 ownerless roots 遍历。等待 API 会请求调度，不是只读屏障。[S1、S2、S13]

因此不能把上述任一值单独当作“没有任何引用／不会再运行／可以删除数据”的证明。

## 3. 工作区绑定的公开接入点与缺口

### 3.1 可以原子做的事

**已有 conversation 的输入接纳：**宿主可在 `Harness.commit()`／`Conversation.commit()` 内通过 `tx.doc()` 检查应用绑定和 `LiveDoc`，调用 `conversation.submit(tx, draft)`，然后保存返回的 SubmissionId 及必要应用关联。文档读写可在 submit 前后；同一 commit 失败则共同不落盘。task／tool 也可通过已取得的 conversation handle，在自己的 commit 中使用此 overload。[S5]

限制：

- admission 必须先于 `appendEntry`、`createTask`、`createSubmission`、另一 admission 等 table write；`tx.createConversation` 已是 table write。因此创建与首次 submit 不能靠这个 overload 无缝合为一个 commit。
- commit 内不能调用外层 Session／Harness 排队读取或 Submission 方法；使用 `tx`，否则可自锁。
- `submit` 会启用调度，包括已有恢复工作；应用必须在进入它以前完成全局启动就绪检查。同一 admission 新建的工作只能在其 commit 成功之后运行，但这不暂停已在运行的任务。
- 去重返回旧 submission 时，应用自己的写入仍需保持幂等；不能把重试误当新绑定。[S1、S5]

**conversation 创建：**`HarnessOptions.conversationCreated(tx, record)` 和创建选项 `init` 在创建 commit 内工作；前者位于内置文档初始化之后，后者在 convenience 的 agent change 之后。hook 抛错会使创建失败。此处只能继续文档访问等合法操作，table reads 因已有 table write 而拒绝。[S7]

这些能力证明可以实施“创建时”或“接纳时”的明确绑定，不代表已经替 Q21 选定“开始”的含义。

### 3.2 不能误称为通用 run-start hook

| 接入点 | 能力与限制 |
|---|---|
| `HarnessOptions.env({ conversationId, cwd, read }, context)` | 每次环境使用时调用，可异步，且不在 Session 修改线上；可读取应用已存绑定并构造相应环境。参数没有 taskId／submissionId／runId，不是原子 inbox-consumed 通知 |
| `GenerationHooks.beforeRequest` | 每次模型请求尝试调用，包括恢复；此时 prepare 已读取上下文、调用 env、渲染提示词并写 request checkpoint。不能保证它先于所有工作区相关行为 |
| `beforeTool` | 首次工具 intent 之前调用，但 safe replay 的 execute 恢复分支不重跑它；不能独自保证恢复后的工作区绑定 |
| `afterTools` | 工具已经结束；在工具轮边界事务之前调用，不是把绑定和消费队列共同提交的接口 |
| `onYield`／`afterRun` | 成功答案路径上的控制／后处理；不是所有 run 的开头或所有结束路径 |
| `HookApi.memo()` | 可保存该 task 的先写者胜出小值；HookApi 没有通用 commit 方法。memo 不是跨 generation 的永久 run 上下文 |
| 自定义 task／tool 的 `commit()` | 可为其自己控制的后续工作记录上下文，但不能据此宣称已拦截全部内置 generation 和自动后继 run |

证据：[S4–S6、S14、S17]。特别注意：**generation prepare 捕获 env builder 异常、报告后继续渲染，env 可以为 undefined。不能仅靠 env 抛错宣称已经阻止模型请求。**[S14]

**设计约束，不是新政策：**若要求按“队列实际消费／run 开始”才绑定，不能把每次 submit 当作一个独立执行组，也不能以会变化的 generation taskId 代替稳定分组。应先明确 steer 加入旧 run、final 批量开始新 run、自动 continue、after-run 和后台工作分别沿用哪份绑定。现有公开 API 未提供统一的事务前置 hook 来自动完成该规则；本轮不补写第二套调度器，也不承诺仅靠 watch／beforeRequest 即可解决竞态。

## 4. 内部 task conversation 如何获得上下文

- `tx.createConversation({ ownership: { kind: "task", taskId } })` 显式指定 owner；SDK 从任务记录导出 `record.owner = { taskId, conversationId }`。owner 可以是同事务早先创建的任务，但最终不能是 completing、terminal 或 abort-marked。ownership 与 fork parent 是不同关系。[S7、S8]
- 普通 task-owned 新 conversation 复制 owner conversation **当时已存的 `pi.agent`**，含 model、cwd、扩展／工具选择等；以后不跟随父修改。ownerless 新 conversation 初始 agent 为空；fork 保留按历史点复制的 agent。[S8]
- 普通创建不会复制任意应用 document，也不继承 transcript。若需原历史，必须显式 fork；若需工作区绑定，应用必须显式供应。
- 可在创建事务里写子应用 context document；或者全局 `conversationCreated` 根据 `record.owner.conversationId`／`taskId`，通过 `tx.doc()` 读取已建立的父／任务应用上下文，再写子文档。此时不要用 `tx.task()` 再查 owner，因为 table read 已不合法。应区分缺失绑定与真正的默认值，不能悄悄解析成当前全局目录。
- hook 会看见内部 conversation；**执行上下文继承与产品登记必须是两件事**。只有应用显式登记的记录进入产品列表，不能因持有 workspace 或 ownerless 就自动成为产品会话。
- replay-safe 工具可以先 `scanConversations({ ownerTaskId })` 找已建子 conversation，再决定创建；commit 后取得 invocation-bound handle，用稳定 request ID 提交。官方例子使用 task ID 派生 request ID；Provider tool-call ID 不保证 Session 内唯一。[S7、S8]

fork 的应用文档仍按 `asOf`／`current`／`initial` 各自规则复制。不能让 fork 顺带复制产品可见性、当前工作组或已过期授权语义。后台子 conversation 还可能晚于父 run 继续工作；owner task 终结不删除 conversation，也不永久禁止其以后的输入。[S8、S12、S13]

## 5. 删除、退休和引用：固定版本实际支持到哪里

### 5.1 API 能力表

| 对象 | 实际支持 | 不支持／不能这样描述 |
|---|---|---|
| conversation | 创建、fork、查找、遍历、abort；可另用 app document 管理产品可见性 | `Conversation`、`Tx`、`Storage` 没有 conversation delete／retire；隐藏产品登记不删除 SDK conversation，也不停止它 |
| entry | 追加不可变 entry；用后续 `head`／`edits` 改变模型上下文解释 | 没有 entry delete／retire；reset、压缩、omit／replace 不抹除原 entry |
| submission | 接纳、按 request 查找、排队放置、结算、撤回 queued 项 | 没有 submission delete／retire；移除 inbox item 不删除接纳记录或 request 去重记录 |
| document | `Tx.retireDoc(token, scopeId?, key?)`；token overload 覆盖 session／conversation／task 与 family | retirement 是结束 incarnation 的生命周期，不是任意数据擦除 API，也不递归删除其他对象 |
| task | abort／终态结算；终态原子退休 task documents | 终态 task receipt 保留可查询，conversation 和 owner 边不会随 task 退休 |

依据是完整公开 `Tx`／`Storage` 方法、`StorageWrite` 联合类型、Conversation Interface 与 terminal 契约，不只是搜索不到方法名。[S9–S11]

`retireDoc` 不创建缺失实例；已获取 draft 的最终内容与退休一起处理；同一逻辑地址以后再 `tx.doc()` 会创建新 incarnation 和新 ID。current 读取不再返回已退休实例，但 rewindable 历史点仍可选中旧 incarnation。[S10、S12]

### 5.2 SQLite 确实删除了什么

固定实现对 session、task、`history: "latest"` conversation document 定义 `isCurrentOnly`：

- 新完整 base 提交时，SQL `DELETE` 该 incarnation 的旧 `documentRevisions`，再插入新 base。
- retirement 时删除其 `documentRevisions`，但 `documents` 表的 record 仍保留，并写 `retiredAt`。
- rewindable conversation document 不走这两条 revision 删除分支；base 不能授权删除仍可寻址的历史。[S10、S11]

这可以称为**revision 行删除／允许的物理回收**，不能扩张成“会话已物理删除”或“敏感内容已安全擦除”。本轮没有检查 SQLite 空闲页、WAL、备份、外部附件或其他副本的残留；SQL DELETE 不证明这些字节全部消失。

对 app document 字段做 `delete` 或把产品列表项隐藏，同样不构成所有历史 revision、fork 副本和 entry 正文的擦除保证。不得以“逻辑删除”功能冒充完成用户数据删除。

### 5.3 fork 与引用必须保留的事实

1. fork transcript 通过 `parent.conversationId` 和 `parent.at` 继承祖先 entries；分页遵守 ancestry cap，不是把整段历史拷成独立 entries。删除父记录／祖先 entry 会破坏这条读取路径；本版本没有提供安全级联删除方案。[S9、S12]
2. conversation document 的 `current`／`asOf` fork 是独立新 ID、新 base；源以后修改或退休不改变已复制子值。反过来，退休父文档也不能擦除子副本。[S12]
3. `snapshotAsOf` 对子 conversation 的继承 entry 会读取拥有该 entry 的祖先历史 incarnation。不能因“子文档已经独立”就删除祖先 rewindable 历史。[S10、S12]
4. fork copy 必须读选定时点活着的源；同一 batch 不能创建、修改或退休被选中源。fork 同事务不能改父 `current` 文档。[S12]
5. submission 的 entry／answer、任务 outcome 的 entry ID、context edits／head、owner／parent 边，以及 app JSON 中的附件／工作区引用均可能继续使用数据。SDK 没有通用 app 引用计数或级联 GC Interface；自定义 JSON 的含义由应用负责。终态 outcome 不得引用同次终态即退休的 task document。[S9、S11、S12]

**对 Q26 的限制：**历史默认保留可以遵循 SDK 现状；若以后要求显式物理删除整个产品会话，这是当前公开能力的缺口，不能用隐藏来宣布交付。具体引用封闭、清理范围或 SDK 扩展路径仍未知，本轮不选择绕过 SDK 改内部表。

## 6. Provider 身份：已有能力足够表达新旧并存

**支持。** `Provider.id`／`CreateProviderOptions.id` 为 string，`Model.provider` 可使用自定义身份；`createProvider({ id, auth, models, api })` 组合现有实现，`createModels()` 的 `MutableModels.setProvider()` 按 ID 注册／替换。不同 ID 同时保留；相同 ID 则覆盖原定义。模型查找使用 `(provider, modelId)`。[S15]

因此宿主可以保留旧 ID 的旧定义，把替代连接注册为新 ID，并让新选择指向它。必须同时正确设置其 Model 的 provider 身份和定义；这不是仅修改显示名称。此处只需要既有共享模型配置 Module 管理定义与引用，不需要另建协议分发、鉴权或 Provider registry。[S15、S16]

边界：

- Durable checkpoint 保存 ModelRef，不保存完整连接定义。应用若要保留旧连接，必须持续供应旧 ID 对应的定义，且不能悄悄原地改写它。
- 凭据与动态目录按 Provider ID 访问；新 ID 不会自动继承旧 ID 的 stored credential。保留旧定义不等于必须保留失效秘密，也不冻结 auth 返回的端点。
- `deleteProvider(id)`／`clearProviders()` 只改变运行中的 collection，不级联重写 Durable 引用，也不是会话数据删除；`logout(id)` 另行删除 stored credential。
- 已开始请求、deferred response、OAuth／Provider 特有身份语义是否允许这样的替换，仍须按具体 Provider 验证。这里只证明**自定义身份和共存接入点存在**，不证明每个内置工厂可任意换 ID，也不承诺旧响应永远可恢复。[S15、S16]

## 7. 明确未知项与研究方法

尚未决定：Q21 的精确“开始”边界与批量输入分组、后台任务绑定、自动后继 run 的原子上下文交接；各 app document 的作用域／fork／保留政策；显式删除产品语义；Provider 旧定义何时可以退出引用集合。这些不能由一个 SDK idle 标记推导。

只用本地读取及命令行 HTTPS 读取固定提交的源码文本。没有浏览器、凭据、设备、安装、可执行下载或上游代码执行。未运行单测、并发／恢复实验；未审计所有 backend、Provider 或安全擦除。不把源码支持当作目标运行时验收通过。唯一写入文件为本报告。

## 8. 固定一手证据

所有链接固定同一提交；行号来自本轮实际读取。精确行为以实现配合公开类型核对，规范用于解释契约。

- **[S17] 工具首次 hook／恢复／环境：**[tool.ts L130–227](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/tool.ts#L130-L227)、[L551–563](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/tool.ts#L551-L563)。

- **[S1] 接纳、去重、撤回：**[submissions.ts L64–118](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/submissions.ts#L64-L118)、[L133–160](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/submissions.ts#L133-L160)、[L223–317](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/submissions.ts#L223-L317)。
- **[S2] 队列与失败政策规范：**[spec.md L2847–3065](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L2847-L3065)。
- **[S3] 实际边界／默认 mode／run 字段：**[inbox.ts L7–178](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/inbox.ts#L7-L178)、[agent.ts L80–81](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L80-L81)、[live.ts L137–156](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/live.ts#L137-L156)。
- **[S4] generation 与 run 交接：**[规范 checkpoint L4777–4856](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4777-L4856)、[generation.ts L852–915](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L852-L915)、[L1083–1187](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L1083-L1187)。
- **[S5] 原子 submit overload：**[公开类型 L812–831](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L812-L831)、[规范 L2939–2956](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L2939-L2956)；实现见 S1。
- **[S6] HookApi／全部 GenerationHooks：**[harness/types.ts L950–1008](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L950-L1008)。
- **[S7] 创建 hook 与 owner：**[harness.ts L428–459](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L428-L459)、[harness/types.ts L704–709](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L704-L709)、[transaction.ts L347–407](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/transaction.ts#L347-L407)、[规范 owner 校验 L1489–1511](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1489-L1511)。
- **[S8] 子 conversation：**[agent.ts L176–187](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L176-L187)、[规范 L4027–4105](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4027-L4105)。例子只作阅读，未执行。
- **[S9] 记录／写入／完整公开删除能力边界：**[types.ts L424–612](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L424-L612)、[StorageWrite L912–928](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L912-L928)、[Tx L987–1085](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L987-L1085)、[Storage L1316–1445](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L1316-L1445)、[Conversation L803–875](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L803-L875)。
- **[S10] retirement／历史：**[transaction.ts L648–677](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/transaction.ts#L648-L677)、[L743–753](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/transaction.ts#L743-L753)、[规范 L1528–1552](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1528-L1552)、[L1710–1718](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1710-L1718)。
- **[S11] SQLite revision 删除／task 保留：**[storage.ts L128–134](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/storage.ts#L128-L134)、[L975–1044](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/storage.ts#L975-L1044)、[规范 L2390–2411](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L2390-L2411)、[L2495–2515](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L2495-L2515)、[L6471–6473](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L6471-L6473)。
- **[S12] fork／引用／读取：**[规范 L1773–1815](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1773-L1815)、[L6056–6117](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L6056-L6117)；继承 entry 历史读取另见 S10。
- **[S13] idle／abort／调度：**[harness/types.ts L858–884](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L858-L884)、[scheduler.ts L638–673](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L638-L673)、[L2593–2611](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L2593-L2611)。
- **[S14] 环境与请求 hook 时点：**[EnvTarget L676–703](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L676-L703)、[harness.ts L290–296](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L290-L296)、[generation.ts L180–222](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L180-L222)、[L281–298](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L281-L298)。
- **[S15] Pi AI 自定义 Provider：**[models.ts Provider L158–172](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L158-L172)、[collection L370–439](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L370-L439)、[lookup L490–496](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L490-L496)、[createProvider L1032–1128](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L1032-L1128)、[官方自定义例子 L1267–1331](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/README.md#L1267-L1331)。
- **[S16] 当前鉴权与独立 credential 删除：**[models.ts L754–772](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L754-L772)、[L832–899](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L832-L899)、[目录按 ID L545–561](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L545-L561)。Durable checkpoint 只存模型引用见 S4；实际请求重新 lookup 见 S14。
