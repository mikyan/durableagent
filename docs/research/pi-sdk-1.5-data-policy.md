# Pi SDK 1.5.0：下一轮数据政策的窄范围事实

研究日期：2026-11-03。固定基线：`earendil-works/pi@f9a26365568127461c47a07a37dcb42c140a3ac5`。本报告是源码研究，不是存储选型、实现或运行验证。

## 1. 结论与已接受输入

已完整阅读 [data-design.md](../data-design.md)、[数据权威报告](pi-sdk-1.5-data-authority.md)和[扩展组合报告](pi-sdk-1.5-extension-composition.md)。按本次明确指令，**Q13—Q18 全部已接受**，不采用旧文档的“待确认”标签：产品会话与 SDK conversation 一一关联；共享一个 Storage、一个活动 Session 写入者；稳定工作区记录；不可变附件输入表示与原件引用分开；共享 Provider 配置而会话模型选择独立；持久保存未发送文字草稿。本轮不修改这些决定或其他文档。

主要事实：

- SDK document 可以承载普通应用元数据，并与 SDK 会话创建在一个提交中落盘。`session` 是共享的持久作用域，不随进程重开清空；`conversation` 才声明历史与 fork 规则。[S1–S4]
- `latest` 不支持历史回读；`rewindable` 支持按历史点读取。fork 的 `current`、`asOf`、`initial` 是不同政策，不能由“数据可持久化”推导默认选择。[S1–S3]
- 文档迁移由类型化访问触发，不是启动时全库升级；读取迁移不落盘，事务访问迁移才写新版本 base。[S5]
- 模型选择在 generation 的每次 `prepare` 解析后固定到该次请求 checkpoint。**正常关闭后的原请求恢复，与崩溃后重新准备的重试，不是同一种行为。**[S8–S10]
- checkpoint 固定的是模型身份与部分请求选项，**不固定完整 Provider 定义、端点或凭据**。工作区上下文也没有被 SDK 自动固定到整段工作。[S11–S14]
- SDK 聊天输入的图片是内联 base64；没有通用的耐久文件引用输入类型。不能承诺把 SDK 字段透明改成外部 blob 引用。[S15]

## 2. document 的作用域、历史与 fork

| 范围／政策 | 固定源码语义 | 对下一轮的限制 |
|---|---|---|
| `scope: "session"` | 当前值；Session 关闭再打开不退休；fork 后继续共享 | 可以表达共享应用事实，但没有 session 级 rewindable 历史；不代表跨独立 Storage 共享 |
| `scope: "conversation", history: "latest"` | 只保证当前状态；fork 只能选 `current` 或 `initial` | 不可承诺按旧消息恢复该文档当时的值 |
| `scope: "conversation", history: "rewindable"` | 保留历史回读所需信息；fork 可选 `asOf`、`current`、`initial` | 历史回读不是自动回滚所有应用事实或外部副作用 |
| `scope: "task"` | 当前值；task terminal 时原子退休；fork 不复制 | 不适合作为永久项目、工作区或草稿的生命周期依据 |

`defineDoc` 是 singleton；`defineDocFamily` 的逻辑地址还带 `key`。身份由 kind、scope、可选 key 构成，实例有独立且不复用的 document ID。定义无需注册到扩展 registry；显式传 token 使用。只有 `tx.doc()` 创建缺失实例；`snapshot()`／watch 缺失时返回 `undefined`，不会替应用初始化默认记录。[S1、S2]

### fork 的精确含义

- fork 指向一个具体可见 entry `E`。子 transcript 到 `E` 为止；文档的 as-of 点却是 **包含 `E` 的整个提交的最终状态**。同一提交追加多个 entry，不会生成多个不同文档时点。[S3]
- `asOf`：复制该历史点的文档。实现从 `E` 实际所属 conversation 与 `E.commitSeq` 读取；这对继承祖先 entry 的 fork 有意义。
- `current`：复制 fork 提交运行时选定的、已经提交的父 conversation 当前值，而不是 `E` 时的值。
- `initial`：不复制实例；子会话后续 `tx.doc()` 才按定义初始化。创建 hook 若访问该文档，可以提前完成这一步。
- `current`／`asOf` 复制 singleton 和 family，包括当前没有对应定义代码的实例；保留源存储版本，子实例独立、ID 新建。任务及 task 文档不复制；session 文档不复制且继续共享。
- 同一个事务若既 fork，又改父会话的 `current` 文档，会被拒绝。底层 copy 读取提交前的源；同 batch 也不能创建、修改或退休被选中的源实例。[S3]

**政策含义而非选型：**不能让产品登记、草稿或共享引用仅因“附在 conversation 上”就无意继承。需要显式决定各文档 fork 语义；本报告不替这些记录选择政策。`latest` 也不等于“物理上只有一条记录”：`checkpointWhen` 决定 base／delta，长期不 checkpoint 的当前值文档仍可能积累长 delta 链。[S1、S2]

## 3. 文档迁移的边界

`version` 是正整数。存储版本等于 token 时直接用；较旧时调用一个 `migrate(value, fromVersion)` 生成完整当前值；无迁移器的旧版本或比 token 更新的版本都拒绝类型化访问。[S5]

- 迁移函数要求纯函数，返回 JSON object。`tx.doc()`、`snapshot()`、`snapshotAsOf()`、`watchDoc()` 都可以触发迁移。
- 只读访问只在内存迁移；后续成功的 `tx.doc()` 仍必须写当前版本 base，即使 JSON 深度相等、业务没有再改字段。
- 事务失败不保存迁移；迁移与该事务的后续修改合并成最终 base。
- 历史不批量重写；先按历史记录重建，再迁移读取到的值。fork 复制存储中的值／版本，不使用已在内存迁移过的 tracker；子实例以后再迁移。
- 未访问、或没有定义的文档保持原存储内容。`Harness.open()` 不扫描升级普通应用文档。
- **迁移不能改写已有实例的 scope、history 或 fork 语义。** token 与记录不一致时拒绝访问；不能靠版本号升级把 latest 偷换成 rewindable。[S5]

这是 SDK document 值迁移，不等于应用全库迁移、存储 backend schema 升级、凭据迁移或附件搬迁。它也不自动建立项目／工作区引用完整性。

## 4. 应用元数据可以与 SDK 记录共同创建

`createConversation({ ownership, agent, init })`／`fork(...)` 的创建提交可原子包括：conversation、内置文档、应用创建 hook、`agent` 修改、`init` 中的 document／entry 等写入。[S4]

执行顺序是：

1. 创建／fork conversation，fork 已准备相应文档副本。
2. 内置 hook 初始化 `pi.live`、`pi.inbox`、`pi.usage`、新的 `pi.provider`，处理 `pi.agent`。
3. `HarnessOptions.conversationCreated(tx, record)`。
4. 便捷方法应用传入的 `agent`。
5. 执行该次 `init(tx, conversationId)`。

raw `tx.createConversation()`／`tx.forkConversation()` 也运行创建 hook。hook 抛错会失败整个创建提交。由于此时已经发生 table write，hook 和 `init` 中的 table reads 会抛 `ReadAfterWrite`；document 访问仍可用。事务内读取应使用 `tx`，不能回调外层 Session 的排队读取。[S4、S2]

应用可以在这个提交中登记产品会话关联或初始化模型选择，无需另造消息正文权威。但：

- 全局创建 hook 也会看到内部 task-owned conversation；产品可见性仍由应用明确登记，不能把“hook 调用了”当作产品会话证明。
- 首次 `submit()` 是之后另一次调用；创建与首次接纳不会自动合成一个原子操作。官方规范建议用 `init` 写稳定查找 key，以便崩溃后先找回已创建 conversation，再重试带 request ID 的提交。[S4]
- `root()` 对已经存在的 root 忽略 `agent` 和 `init`；它不是每次启动都执行的初始化或迁移 hook。
- 原子范围只覆盖该 SDK 提交，不能扩大到独立凭据存储、Android 授权、原始文件或 Termux 副作用。

## 5. 元数据供应 Models／settings 时的启动约束

`HarnessOptions.models` 接受 `Models` 或同步 `() => Models`；`settings` 接受对象或同步函数。它们不是可以随时 `await` 数据库的异步加载器。settings 在每个使用点解析，部分读取位于 Session mutation line；SDK 不负责从应用文档自动构建这些运行对象。[S6、S11]

`Harness.open()` 不执行任务 handler，但会恢复／协调 SDK 记录并可能写入；“尚未调度”不等于只读打开。普通应用文档不会被自动扫描迁移。宿主可以在 open 返回后读取／初始化文档，而不启动任务；必须在 `resume()` 或其他会启动调度的操作前，准备好 Models、必要配置和资源。[S6]

会启用调度的不只是 `resume()`：`submit()`、`compact()`、conversation `abort()`、submission/task/idle 的等待调用都可能让已有恢复工作开始。只读查询、document reads、watch 不启动调度。`onWake` 会在 open 后通知宿主；接入的唤醒路径也不能绕过配置就绪要求。[S6]

**应用必须处理的启动依赖：**如果配置权威就是这个 Storage 的 app document，不能假定把闭包写成“同步调用尚未拿到的 Harness 去异步读取配置”就可工作。需要能同步返回的有效启动值／已装载投影，并在任务可运行前完成实际配置装载。SDK 内部缓存保留／进度配置也通过 host settings 回调读取，恢复过程中可能触及；不能让该回调在初始化完成前访问未赋值对象或重入 mutation line。[S6]

这只是现有暂停调度与同步读取契约的约束，不要求第二个 SDK Session、另一个执行状态机或新的全局生命周期框架。具体启动投影、缺失／迁移失败如何阻止运行，以及配置提交到运行投影的可见性边界仍属宿主接线问题；异步 watch 不等于与文档提交同刻切换配置。[S6、S16]

## 6. 会话模型改变：精确到读取点与恢复路径

### 6.1 新会话默认值不是 SDK 隐式模型继承

`ModelRef` 只有 `{ provider, modelId }`。`pi.agent` 为 conversation／rewindable／asOf 文档；`configure` 修改这个会话的选择，`null` 清除，`undefined` 不改。[S7]

**实际 `HarnessSettings` 没有默认 model 字段。** `resolveAgent()` 的模型只来自 `state.model`；ownerless 新 conversation 初始 agent 为空。不能把“未设置字段跟随 host”的类型概述泛化成模型自动跟随全局默认。Q17 的“新会话默认模型”由应用在创建时显式写入；改默认值并不要求改已有 `pi.agent`。缺失或查不到模型时 generation 失败 `no_model`，不是静默选择替代模型。[S7、S8]

fork 的 agent 取 as-of 副本；新的 task-owned conversation 复制 owner conversation 的已存 agent。后续父修改不跟随。产品默认初始化不能无意覆盖这些不同创建语义。[S7]

### 6.2 生效时间表

以下“修改”指会话 `configure({ model: ... })` 已提交；“新请求”不能等同于一次用户点击或整个 run。

| 时点／路径 | 会话选择的实际作用 |
|---|---|
| 输入已排队，但尚未进入下一次 generation `prepare` | 在之后的 prepare 读取当前 `pi.agent`；输入接纳时没有冻结模型选择 |
| `prepare` 已解析 agent | 该次解析的 model／thinking level 保持不变；即使准备仍在异步渲染、配置又已提交，也不会中途重读。prepare 把模型引用、thinking level、stream options、context cutoff 写入 request checkpoint |
| 已有 request checkpoint，或正在发出／接收该请求 | request 用 checkpoint 的 model reference；改会话选择不会替换或自动取消这个请求 |
| 工具回合后、下一次生成 prepare，或普通可重试错误后的 retry → prepare | 重新读取当前选择和 settings；同一 run 的后续请求可能使用新模型 |
| 正常 close 成功把运行任务保存为 pending，随后 reopen 原 request | 不记 crash restart；恢复原 checkpoint，保留原模型引用、thinking level、stream options、cutoff；`beforeRequest` 会重跑 |
| crash 留下 running request，随后 reopen | 恢复标记 restarts；该 attempt 计为 interrupted，不直接无条件重发原请求。有重试额度时 backoff 后重新 prepare，届时可采用新模型；无额度则结束，另受 restart limit 约束 |
| 恢复处于 prepare 的工作 | 重新 prepare，采用当次解析到的选择；不能声称凡是已有 task 都固定旧模型 |
| deferred response 的 poll／恢复 | 保存并使用原 model reference 和 handle；不因当前选择改变而另开请求。中断 poll 的允许重试仍 poll 原响应，而非普通 retry 的重新 prepare |
| 已完成 compaction select 的 summarize／retry／恢复 | 保留选定模型引用、thinking level、stream options 和摘要范围；压缩 retry 不回 select。尚未 select 才读取当前选择 |

依据为 generation、compaction、scheduler 的实际分支和规范。[S8–S10] 若 close 未完整成功，则不能套用“正常 close”的恢复保证。这里描述的是 **SDK 已有状态语义**，不是要求应用复刻这些 phase 或管理另一套 task 状态。

### 6.3 模型身份、端点、选项、凭据不能混写成一个“快照”

1. **身份：**checkpoint 只保存 `ModelRef`，不是完整 `Model`。request／poll／summarize 都通过当前 `runtime.models.getModel(provider, modelId)` 再解析。因此相同身份可以指向更新后的模型定义；查不到仍会失败，而不是自动换模型。[S8–S11]
2. **端点与定义：**Pi AI `Model` 包含 `baseUrl`、headers、compat、sampling defaults 等；`Models` 可以替换 Provider。请求时鉴权结果还可能覆盖 `baseUrl`。旧 checkpoint 不保证旧端点、旧兼容参数或旧模型默认选项。[S11、S12]
3. **显式请求选项：**Durable prepare 保存 `settings.stream` 和 thinking level，所以改变这些 host 设置不会改已有 request checkpoint；重新 prepare 才取新值。可是最终 options 还结合当次解析的 Model、auth 和 hooks，不能称为完整 wire request 快照。compaction 的已选请求同样有其固定选项，并显式调整 cache／token／deferred 行为。[S8、S10–S12]
4. **凭据：**Pi AI `Models.streamSimple()`／`completeSimple()`、deferred fetch 在实际 Provider 调用前执行 `applyAuth()`，通过当前 `CredentialStore`／auth context 解析。请求时构造的 Key／headers 不需要写回 Durable checkpoint。恢复可以使用轮转后的凭据；不能承诺恢复仍用旧 Key。[S12]
5. **已在网络中的请求：**单纯改会话选择不会重新调用该请求或替换已经发出的鉴权数据。`applyAuth` 完成前的配置／凭据变化可能被本次解析看见；之后的并发原地对象修改、Provider 内部重试／OAuth 刷新何时重新读值，没有通用原子冻结保证。本轮不审计所有 Provider，也不承诺轮转会立即撤销在途请求。[S8、S12]

继续沿用安全边界：不得把 Key／鉴权 headers 放进可持久化 `settings.stream`。类型省略 `apiKey` 不是运行时字段过滤；显式 request options 在 auth 合并时还可能优先于当前凭据。[S8、S12；既有数据权威报告]

## 7. 已开始工作的工作区冻结由谁负责

**若产品要求已开始工作不悄悄切换工作区，该要求由宿主落实，不是 SDK 自动保证。**[S13]

`HarnessOptions.env` 每次使用时根据 conversation ID、当前 `pi.agent.cwd` 和 DocumentReader 构建环境。generation prepare 为提示词渲染调用；工具执行各自调用；恢复后的工具重跑会拿当时的环境与 cwd；自定义 `runtime.env()` 也重新调用。模型请求固定并不代表之后的工具环境也固定。[S13]

SDK 的 phase registry snapshot／已开始工具持有实现，固定的是代码选择，不是项目、工作区目录、访问授权或外部文件内容。宿主若需固定工作区上下文，必须定义固定时点及恢复所需事实，让工具环境按该事实执行和核验。稳定 workspace ID 本身不冻结其当前目录绑定；固定身份也不能延长已撤销的 Android 授权。[S13、S14]

本轮不选择“排队时／开始时／工具执行时”的产品政策，不建立工作区调度器，也不重做 SDK 状态机。

## 8. 附件输入：不承诺 SDK 字段透明外置

聊天 `UserMessage.content` 为字符串或 `(TextContent | ImageContent)[]`；工具结果也只在模型内容数组中声明 text／image。`ImageContent` 明确要求 `data: string` 为 base64，以及 `mimeType`。未提供 URL、文件路径、SAF URI、blob ID、文件句柄或通用 `FileContent` 作为这套输入联合类型的替代。[S15]

OpenAI Responses Adapter 将它构造成 `data:<mime>;base64,<data>` 的 `input_image.image_url`；该 wire 字段名字含 URL，不表示 Pi AI 输入接受任意耐久引用。其他 Provider 自有的 file API 是否存在，不改变已核验的通用 SDK 输入契约。[S15]

所以 Q16 可以区分应用的不可变输入表示和原始资源引用，但若将图片交给现有 SDK `ImageContent`，必须在该边界供应内联内容。文件可采用明确提取的文本／图片表示；在 app metadata 中存原件引用不会自动变成模型可读取的附件。Storage backend 若将内容物理外置，仍须完整满足 SDK 原记录读写契约；本轮没有验证这种 backend，也不承诺通过替换 SDK JSON 字段就透明完成外置、恢复或清理。

## 9. 保留的未知项与范围限制

下一轮真正需要决定或验证的只是：各 app document 的具体范围／fork／保留政策；启动配置投影与就绪门槛；工作区固定边界；附件物料化与大小／清理规则；公开配置改变后在途请求和 deferred handle 的兼容处理。文档迁移不能替这些应用政策作决定。

未验证目标运行时、所有 Storage backend、崩溃／正常 close 的设备测试、并发配置热换、Provider 内部重试或 OAuth 行为；未核实 npm 包与提交逐字一致。研究只用本地读取和命令行 HTTPS 读取固定源码文本，没有浏览器、凭据、设备、安装、可执行下载或上游代码执行。只写本报告。

## 10. 固定证据索引

所有上游链接均固定到同一提交。实现用于核对精确分支；规范用于说明受支持的契约。

- **[S1] 文档定义与范围：**[types.ts L42–89](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L42-L89)；[规范 L1296–1362](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1296-L1362)。
- **[S2] token、初始化与访问限制：**[documents.ts L38–79](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/documents.ts#L38-L79)；[规范 L4360–4361](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4360-L4361)；[规范 L6430–6446](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L6430-L6446)。
- **[S3] fork：**[规范 L1773–1815](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1773-L1815)；[forks.ts L25–97](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/forks.ts#L25-L97)。
- **[S4] 创建提交与顺序：**[harness.ts L428–459](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L428-L459)；[types.ts L531–535](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L531-L535)、[L704–709](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L704-L709)；[规范 L817–875](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L817-L875)。
- **[S5] 迁移：**[documents.ts L167–208](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/documents.ts#L167-L208)；[transaction.ts L1222–1234](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/transaction.ts#L1222-L1234)；[规范 L1738–1771](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1738-L1771)。
- **[S6] 启动、settings 与暂停调度：**[harness.ts L218–261](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L218-L261)、[L586–610](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L586-L610)；[scheduler.ts L433–479](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L433-L479)；[规范 L803–845](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L803-L845)、[L977–989](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L977-L989)。
- **[S7] 模型引用、选择与默认缺口：**[ModelRef](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L55-L61)；[HarnessSettings 全类型](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L613-L650)；[agent.ts 文档 L43–52](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L43-L52)、[修改 L89–93、L122–129](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L89-L129)、[创建 L176–187](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L176-L187)、[解析 L279–290](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L279-L290)。
- **[S8] generation 实现：**[prepare／request／retry／poll L173–338](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L173-L338)；[interrupted L496–543](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L496-L543)；[phase agent 缓存](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L2616-L2625)。
- **[S9] 正常关闭与 crash 不同：**[scheduler.ts L563–584](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L563-L584)；[规范 L4842–4856](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4842-L4856)、[L4886–4921](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4886-L4921)。
- **[S10] compaction：**[compaction.ts L119–237](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/compaction.ts#L119-L237)；[各读取点规范 L3310–3320](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L3310-L3320)。
- **[S11] 当前 Models 与可变目录：**[HarnessOptions L684–703](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L684-L703)；[scheduler getters L2649–2659](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L2649-L2659)；[Models setProvider L417–425](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L417-L425)、[getModel L490–496](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L490-L496)。
- **[S12] 定义与请求时鉴权：**[BaseModel／Model L841–884](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/types.ts#L841-L884)；[getAuth L754–772](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L754-L772)、[applyAuth L843–899](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L843-L899)、[stream／complete／deferred L929–987](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L929-L987)。
- **[S13] 工作区环境是使用时解析：**[harness.ts L290–296](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L290-L296)；[规范 L1008–1055](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L1008-L1055)。
- **[S14] 代码 snapshot 的不同保证：**[规范 L4345–4368](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4345-L4368)。
- **[S15] 输入图片／文件边界：**[ImageContent L438–442](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/types.ts#L438-L442)、[UserMessage L579–583](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/types.ts#L579-L583)、[ToolResult L642–659](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/types.ts#L642-L659)；[Responses 图片编码 L103–109](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/openai-responses-shared.ts#L103-L109)、[L314–321](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/openai-responses-shared.ts#L314-L321)。
- **[S16] watch 不阻塞提交：**[规范 L5559–5566](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L5559-L5566)。
