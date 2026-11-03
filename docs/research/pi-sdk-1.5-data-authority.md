# Pi SDK 1.5.0：持久数据的权威来源与凭据边界

研究日期：2026-11-03。状态：固定源码研究；不是存储方案或实现授权。

基线：`earendil-works/pi@f9a26365568127461c47a07a37dcb42c140a3ac5`。该提交的 Pi Durable、Pi AI package 均声明 `1.5.0`。[S1]

## 1. 结论先行

1. **Durable 确实保存会话 transcript，不只是执行检查点。** 其存储对象包括 `ConversationRecord`、不可变 `EntryRecord`、`SubmissionRecord`、内部 `TaskRecord` 和版本化 document。用户消息、模型回复、工具结果、压缩摘要可以进入这些记录。但它们不是现成的完整产品会话管理系统。[S2–S5]
2. **“SDK 已保存全部聊天历史”和“宿主必须另存一份全部消息”都不成立。** SDK 保存经其 Interface 接纳、提交的内容。宿主必须补足标题、项目关联、工作区语义和应用消息元数据。可以使用 SDK 自定义 entry/document，不代表必须建第二套消息正文权威库。[S2–S5、S9]
3. **不能把所有 document 当缓存。** `pi.live` 同时包含运行控制与展示进度；`pi.inbox` 保存尚未进入 transcript 的输入；`pi.provider` 保存稳定 Provider 会话身份；`pi.usage` 包含不能只靠普通消息重算的压缩请求用量。[S5–S8]
4. **可持久化请求选项存在凭据复制路径。** `ConversationStreamOptions` 没有声明 `apiKey`，但允许 `headers`。把 Key 放进 `Authorization`／`x-api-key` 会随 generation、compaction 的请求检查点保存。运行时传入额外 `apiKey` 字段，也不能依靠 TypeScript 类型自动过滤。[S10–S13]
5. **已有受支持的鉴权 Seam，可以避免这些无必要副本。** `HarnessOptions.models` 接收 `Models` 或返回当前 `Models` 的函数。`createModels({ credentials, modelsStore, authContext })` 将凭据解析放在实际 Provider 请求前。无需把原始 Key 写入 Durable settings、会话文档或请求检查点。[S14–S16]
6. **未证明默认日志会固定打印 Key，也未证明整条链绝不泄露。** 已查 Harness 的默认 telemetry 为 NOOP；报告路径没有默认 `console` 输出选项。但错误正文可以进入持久消息、状态及已启用的 telemetry。截断错误不等于脱敏。[S17–S19]

### 本轮沿用的已确认边界

已读[需求](../requirements-v1.md)、[Module 设计](../module-design.md)、[1.5.0 差异研究](pi-sdk-1.5-delta.md)、此前 SDK 宿主契约研究和 `GLOSSARY.md`。审计开始时 `module-design.md` 的 Q9—Q11 状态尚未更新；本轮以用户最新确认作为输入，将工具环境 Module、固定核心不变量、共享模型配置 Module 视为已确认，不改写原文件。

主 Agent 与 SDK 留在本应用。TypeScript 核心解释业务事实并协调恢复；Kotlin 提供平台机制与必要控制。UI 不拥有 SDK 执行。SDK 内部 task 不形成产品任务实体。以下权威划分不决定数据库数量、表结构、通信协议或凭据算法。

## 2. Durable 实际保存什么

“保存”以下均指配置了满足契约的持久 `Storage`，且相应提交已完成。`MemoryStorage` 只是内存参考实现，不能提供跨进程重启的耐久性。[S20]

| 数据 | 固定源码事实 | 不应扩大为的保证 |
|---|---|---|
| SDK conversation | `ConversationRecord` 保存 ID、可选 fork 父会话和 entry 截点、可选创建者 task／conversation 边 | 没有内置标题、项目、产品工作区或会话列表生命周期字段；也不是一个 Android 进程 |
| 输入请求／接纳记录 | `SubmissionRecord` 区分 `input`、`write`、`continue`，保存排队、放入 transcript、完成或未回答状态及关联 entry；`requestId` 由宿主提供，去重范围为 conversation | 不是每次 HTTP 请求的完整存档；不是外部命令幂等收据；不是产品任务 |
| 排队输入内容 | `pi.inbox.items` 保存 input content 或待写 `EntryDraft`；放入 transcript 后从队列移除 | 不能只备份 entries 就声称所有已接纳输入都已备份 |
| 对话消息／事件 | `EntryRecord.model` 为模型消息数组；`data` 为应用 JSON；还可保存 context head、context edits、生成它的 task ID | 一个 entry 不必等于一个可见聊天气泡；display-only entry 可以没有模型消息 |
| 内部执行 | `TaskRecord` 保存定义名／版本、input、owner、background、abortRequested、重启计数、运行时间；活动状态含 checkpoint、wait 或 sleep deadline；最终状态含 outcome／result | 不保存 JS 调用栈或 Promise；最新 task record 不是所有历史状态迁移的审计日志 |
| 工具与模型结果 | 内置 entries 有 `pi.assistant`、`pi.tool-result`；task outcome 可以另持结果；失败与中断可以产生错误或部分回复记录 | SDK 结果不证明 Termux 文件副作用已经核验；保留的工具输出不保证等于完整原始 stdout／stderr |
| 请求恢复依据 | generation 请求 checkpoint 固定模型引用、thinking level、stream options、context cutoff；deferred 模型响应另存 handle 与轮询时刻 | 不是完整网络报文或远程 SSE 游标；`beforeRequest` 还能改当次消息，不得把 cutoff 说成最终 wire payload 的逐字快照 |
| 扩展状态／memo | session、conversation、task scope 的 JSON documents；conversation 可选 latest／rewindable 与 fork 行为；task memo 为小型、先写者胜出的值 | 不是自带的语义长期记忆系统；task 到 completing／terminal 不再保留 memos，不能当永久知识库 |

证据：记录类型、存储写入联合类型、内置 entry、inbox 和 generation 路径。[S2–S5、S11]

### 必须分开的 3 种“事件”

- **Transcript event**：`EntryRecord` 是持久记录，内容可以包含消息。[S2、S4]
- **Provider stream event**：start／delta／end 等是运行时流协议。generation 消费它们，限频写部分回复，再写结果；不是把每个事件逐条永久保存。[S11]
- **Watch／commit／telemetry 通知**：用于观察和派生视图。watch 可折叠更新，重连从当前 view 开始。`Storage` 没有通用的“读取全部历史通知”Interface；telemetry 的保存依赖宿主 Adapter。[S3、S9、S17]

因此不能承诺从 SDK 存储恢复原始 token 到达顺序、每一帧 UI 更新或所有日志。也不能反过来说 SDK 完全不保存事件。

### 消息历史不等于当前模型上下文

`EntryRecord.model`、`head`、`edits` 和 fork ancestry 共同决定模型可见内容。压缩追加摘要并改变活跃上下文范围；旧 entries 仍在 storage。`ConversationTranscript` 负责客户端分页和缺口，不是另一份持久聊天仓库。[S2、S9]

SDK `Session` 是一个存储修改线的所有者，可以容纳多个 SDK conversation。`pi.provider.sessionId` 是 Provider cache／session affinity 身份，不是产品会话列表记录，更不是存放聊天正文的远程库。[S3、S7]

## 3. 宿主仍须提供什么

下表分配语义权威，不要求特定数据库或重复保存已有内容。

| 产品事实 | SDK 已提供的部分 | 宿主必须提供的部分 |
|---|---|---|
| 产品会话 | SDK ID、历史、提交与执行状态，以及创建／fork Interface | 哪些 SDK conversation 出现在产品列表；会话与应用记录的关联；新建、选择及跨会话路由语义。内部 task-owned conversation 不自动成为用户会话 |
| 标题 | `ConversationRecord` 无标题字段 | 若界面显示持久标题，宿主定义并保存标题及其修改规则。自动生成标题也不是 SDK 固定能力；用户改名不能靠再次生成还原 |
| 项目 | 无内置项目记录 | 用户建立的具名上下文、项目与工作区的关联、会话选择项目的事实 |
| 工作区 | `pi.agent.cwd` 是环境中的目录；env builder 接收 conversationId、cwd 和读能力 | 默认工作区、项目工作区、稳定身份／目录解释，以及文件访问能力和实际执行主体。cwd 字符串不等于跨 UID 授权或完整工作区记录 |
| 用户消息 | 接纳后保存 content、submission 和对应 entry；默认 user message 带 timestamp | 输入来源、作者、路由等实际需要的应用语义；重发时稳定的 `requestId`；未接纳输入与已接纳输入的区别 |
| 应用消息元数据 | `InputEntry` 支持自定义 kind／data；`EntryDraft` 支持 display-only 内容 | 所需来源、附件关联、自定义展示数据由应用显式供应；SDK 不会从 UI 自动获取它们 |
| 模型回复／工具结果 | 内置 task 写 entries 和 live 状态 | 应用展示和扩展内容的投影。没有理由仅为聊天页面另造竞争的正文权威副本 |
| 附件及原始文件 | 消息可包含模型所需内容，entry data 可带应用信息 | 选中文件、原始文件访问权、文件生命周期、附件与消息的关联。某个模型内容副本不能证明仍能访问原文件 |
| 模型配置 | Pi AI 模型目录、Provider、鉴权 Interface；`pi.agent` 保存模型引用等会话选择 | 应用公开配置、用户选择、凭据权威与配置作用域；不是把凭据放到工具工作区 |

上述缺口来自 SDK 实际记录字段，而不是只因 README 没有介绍某个功能。[S2、S4、S10、S14–S16]

**真实可用的宿主接入点：**`defineEntry`、`defineDoc`／`defineDocFamily`、`Tx.appendEntry`、`Tx.doc`、`ConversationCreateOptions.init`、`HarnessOptions.conversationCreated`。创建 hook 和 init 可以在 SDK 创建提交内初始化应用 document。是否将某项产品记录放入这种 document，留待后续设计；“应用拥有语义”不等于“必须在另一库”。[S2–S4、S9–S10]

## 4. 权威数据、可重建数据与不可混同的数据

| 类别 | 权威／可重建判断 | 本应用边界 |
|---|---|---|
| 已提交 SDK conversation、entry、submission、task、document | **SDK 恢复权威**；不能从聊天截图或 UI 内存补齐 | 应用运行宿主持有唯一可写 SDK owner；TypeScript 使用 SDK Interface，不由 Kotlin／UI 改内部表 |
| `pi.live.run`、`pi.inbox`、abort 标记、sleep／retry checkpoint | **控制或接纳权威**，不是可随意丢弃的展示缓存 | 固定核心负责恢复不变量；普通扩展不能换掉此权威 |
| `pi.live` 的流式 partial／正在运行的工具输出 | 展示进度；部分提交可以 `deferred`，崩溃可丢失尚未落盘部分 | UI 看见不等于 durable；不能把执行核验唯一证据放在这里 |
| `pi.provider` | 稳定 Provider 会话身份，不能重开时随意重新生成 | 由 SDK 保存；与产品会话 ID、外部命令关联标识分开 |
| `pi.usage` | SDK 用量账本，**不保证只靠 transcript 重建**；还记录没有对应普通 entry 的压缩请求用量 | 不是 Provider 最终计费账单；未提交的崩溃中用量也可能缺失 |
| 标题、项目关联、用户配置、应用专有元数据 | **应用事实权威**；除非另有完整来源，不能标成缓存 | TypeScript 核心组织，模型配置 Module 统一模型配置；落盘驱动可由 Kotlin Adapter 提供 |
| 用户停止意图与平台控制事实 | **必须明确其耐久权威**；不是“JS 进程消失”就能重建 | Kotlin 必须保留 JS 无响应时的控制能力；后续设计协调，不制造第二套 SDK 状态机 |
| Termux 命令接纳、退出、停止确认、完整输出位置 | **工具环境执行事实**；SDK 终态不能替代这些事实 | 工具环境 Module 提供核验，TypeScript 决定会话如何继续 |
| Android 当前授权、网络和进程状态 | 平台事实，以实际平台检查为准；历史记录不能代替现状 | Kotlin 提供事实；持久“已授权”标志不能保证授权未撤销 |
| 当前模型 context、UI view、transcript 分页状态、列表摘要、搜索索引 | 有完整输入与版本规则时可重建；不是正文或恢复权威 | React 只观察和呈现；重连重新取得状态 |
| 远程模型目录缓存 | 有可重新获取来源时可重建 | `ModelsStore` 是目录 Seam；用户自定义端点、模型定义和选择不能仅因同样是 JSON 就归为缓存 |

SDK 事实见 [S2–S3、S5–S9、S16、S20]。Android／Termux 分工来自既有需求与 Q8—Q11，属于本应用设计边界，不宣称 SDK 已实现平台控制和外部执行核验。

**特别限制：**可重建不是“可以现在删除”。`history: "latest"` 的文档没有承诺完整历史；memo、输出、应用覆盖值或压缩用量缺失时，单靠 entries 不一定能重建。生命周期、保留、删除和迁移规则仍待设计。

## 5. 实际存储 Interface：不要发明 SDK 没有的 Store

### 5.1 Durable 的 `Storage`

公开契约位于 `packages/durable/src/types.ts`。[S3]

- `commit(batches, receive, context): Promise<CommitResult>`；`CommitResult = { stored, refused? }`。
- 每个 batch 原子写入并获得独立 seq。SDK 检查拒绝某个 batch 时，前面成功 batch 可以已持久化。
- `receive(index, seq)` 是耐久收据，不是 UI 发布，也不是外部命令完成收据。拒绝 Promise 表示结果可能不确定；已发收据仍有效。
- `mintId()` 提供 Session 全局 ID；`conversation`／`scanConversations`、`entry`／`scanEntries`／`findLatestHeadMarker`、`task`／`scanTasks`、`submission`／`scanSubmissions`／`submissionByRequest` 读取记录。
- `findDocument`／`document`／`scanDocuments` 读取文档及定义所支持的时点。
- `publishing?` 是可选发布作用域；`close` 关闭资源。
- `StorageWrite` 只有 conversation、entry、task、submission 与 document create／copy／change／retire 这些种类。没有内置 project、workspace、title、credential 或通用 event-log 写入类型。

`Session.commit`／`Tx` 才是应用与扩展组合 SDK 修改的上层边界。自定义 app document 可以与 entries、tasks 在同一 SDK 提交内变化；不能由此推导 SDK 提交可以原子覆盖 Android 平台动作或独立 Termux 副作用。

### 5.2 已存在的底层 Seam

- `SqliteStorage.open(db, options)` 消费 Chord 的 `SqliteDatabase`。它有 `exec`、`run`、`runCounted`、`get`、`all`、`transaction`、`close`。事务 handle 有效期、排队隔离、提交完成和回滚失败语义必须保真。[S21]
- 包导出 Memory、JSONL、SQLite、IndexedDB、Store 等 storage 入口。入口存在不是此次选型，尤其不意味着把运行宿主搬到 UI WebView。[S1、S20]
- `MemoryStorage` 的名字与 Agent 长期记忆无关。它是非持久 backend。[S20]
- 本轮没有审计所有 backend。此前 `1.5.0` 的批次、迁移、单 owner 和 deferred 约束仍适用；不能套用 `1.3.0` 的旧 `Storage.commit` 签名。

### 5.3 Pi AI 的独立 Store

- `CredentialStore`：按 Provider ID 保存 1 份 credential；方法为 `read`、`list`、`modify`、`delete`。`modify` 是序列化读改写；`list` 返回不含秘密的 `CredentialInfo`。[S15]
- `ModelsStore`：按 Provider ID 读取／写入／删除模型目录、ETag、检查时间等。它不是会话存储，也不是统一应用设置库。[S16]
- 2 个默认实现均为内存实现；应用必须提供所需的持久能力。`AuthContext.env`／`fileExists` 是鉴权来源 Adapter，不是 credential vault。[S14–S16]

这些 Interface 的存在不决定使用数据库、文件还是原生安全存储，也不决定具体加密方案。

## 6. 原始 API Key 的复制路径：有限审计

### 6.1 已确认的持久化风险

**路径 A：声明允许的 headers。**

`HarnessSettings.stream.headers` → `resolveSettings()` 的浅复制 → generation `request.streamOptions` 或 compaction `streamOptions` → `TaskRecord` checkpoint → `Storage`。

`ConversationStreamOptions.headers` 是普通字符串字典，没有把 Authorization、x-api-key 等鉴权 header 排除。将 Key 放在其中，就进入可持久化数据。`metadata` 同样是普通 JSON，不能放秘密。[S10–S13]

**路径 B：越过静态类型的额外 apiKey。**

Pi AI 的 `ProviderRequestOptions` 明确允许 `apiKey`。Durable 的 curated 类型没有该字段，但 `resolveSettings` 使用 `{ ...settings?.stream }`，generation／compaction 直接保存 `settings.stream`。事务复制 JSON record，没有在这条路径按 `ConversationStreamOptions` 白名单重建对象。来自 JavaScript、反序列化配置或较宽对象的字符串 `apiKey` 可以随该对象进入 checkpoint。[S10–S13、S18]

这是静态源码路径判断，未运行演示。不是说合法 TypeScript 字面量把 `apiKey` 写进这个类型会通过检查；而是类型检查不是运行时脱敏边界。

SQLite backend 使用普通 `JSON.stringify` 编码 record。字段被类型省略、以后被 task 终态替换，均不等于曾保存的秘密从日志、历史文件或备份中安全消失；本轮没有审计这些保留面。[S21]

### 6.2 受支持的 Models／auth Seam

正常接线可以是：

`会话模型引用与非秘密选项` → `HarnessOptions.models` → `Models.streamSimple()`／`completeSimple()` → `applyAuth()` → `getAuth()`／`CredentialStore` → Provider 请求。

`Models.applyAuth` 在请求时解析 auth，建立新的 `requestOptions`，把 `apiKey`／headers／env 合入 Provider 调用。这发生在 Durable 已建立请求 checkpoint 之后，不要求把解析结果写回 checkpoint。[S11–S15]

因此共享模型配置 Module 可以保留以下边界，而不重建模型协议：

- 普通查询提供公开配置与已配置凭据状态，不提供原始 Key。
- 使用应用提供的 `CredentialStore` 和 `AuthContext`，让 Pi AI 在请求时解析凭据。
- 不把原始 Key 或鉴权 header 混入 `HarnessSettings.stream`、通用文档、模型目录、常规状态广播或工具参数。
- `CredentialStore.list` 是明确的非秘密枚举；`read`、`Models.getAuth`、login 返回值可以含秘密，不能视为 UI 状态查询。
- 通过 `Models | (() => Models)` 支持共享当前配置。其动态变化意味着恢复时可使用当前凭据；不能据此声称检查点固定了当时凭据版本。

这些是已支持的 Seam 与数据曝光约束，不选择凭据算法。调用期原始 Key 仍可能进入可信 JS／Provider 内存；这不是进程内秘密隔离，也不是“Key 永不离开 Kotlin”的证明。[S14–S15]

### 6.3 默认日志、错误和 telemetry

| 检查面 | 已见事实 | 结论限度 |
|---|---|---|
| Harness 默认报告 | 未配置 telemetry 时为 NOOP；`safeReport` 只在提供 `onReport` 时传原始 error；固定 report event 仅放类别、原因、扩展和 task ID | 没有发现该路径默认打印请求 options 或 Key；宿主自行 `console.error(report)` 不在此保证内 |
| Pi AI telemetry | 默认 NOOP；启用后记录 Provider／model、计数等；错误 status 含最多 500 字符的 `errorMessage` | 500 字符截断不是脱敏；错误可能带来自服务端或调用方的内容 |
| Provider 错误 | Anthropic 将 `error.message` 或 JSON 化错误置入 `errorMessage`；OpenAI 错误格式化可包含原始／解析响应正文 | 若错误正文回显秘密，该秘密可随错误传入 SDK；没有看到通用秘密删除器 |
| Durable 错误保存 | generation 将失败 AssistantMessage 追加为 entry，并把错误写入 retry／failure 状态；compaction 也保存失败说明 | 即使不启用日志，错误仍可能进入持久 transcript／document／task outcome |

证据：[S11–S12、S17–S19]。定点搜索的 Provider 文件没有发现直接 `console`／logger 配置打印，但此结果不能覆盖其第三方 SDK、环境变量控制的日志、网络代理、宿主日志或扩展代码。

**结论：**已经发现可避免的直接凭据副本路径，也发现错误内容的间接持久化面。没有证明某个真实 Key 已泄露，没有完成秘密安全审计。

## 7. 下一轮持久化讨论的事实输入与限制

必须回答，但本轮不选择实现：

1. 每项产品事实是否已有唯一来源；哪些 app 元数据使用 SDK document／entry，哪些由宿主其他存储承载。
2. 产品会话与 SDK conversation 的关联、创建与恢复一致性，以及未接纳／已接纳输入的确认边界。
3. SDK 控制状态、平台停止意图和工具环境执行事实如何协调；不能用 UI 状态或单个“完成”标志混合它们。
4. 公开模型配置如何与凭据分离；如何阻止秘密进入 persistable options、错误、广播和日志。
5. 哪些投影确实能重建；尤其不能误删 inbox、live 控制、provider identity 和压缩用量。

后续可用合成秘密标记验证 checkpoint、错误、日志和广播，但本轮没有执行测试。没有安装 SDK、执行上游代码、使用浏览器、凭据、设备或下载可执行文件。只使用本地文档与命令行 HTTPS 读取固定 raw 源码。没有证明 npm 包与该提交逐字一致。

源码审阅以公开类型、调用路径和目标片段为主。未全面审计全部 Provider、第三方依赖、OAuth、模型目录实现、所有 storage backend、备份／删除／崩溃转储、平台安全存储、内存清理或恶意扩展。本文不宣布 Android 兼容、掉电耐久性或完整凭据安全已通过验收。

## 8. 固定证据索引

以下链接全部固定到 `f9a26365568127461c47a07a37dcb42c140a3ac5`。实现与概述冲突时采用实现；例如 README 的概述说“存储后才展示”，但 `CommitPersistence` 和 live 实现明确允许 deferred 展示。

- **[S1] 版本与入口：**[Durable package](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/package.json)、[AI package](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/package.json)。
- **[S2] 记录与生命周期：**[types.ts：conversation／entry／submission](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L424-L612)、[task／document](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L613-L798)。
- **[S3] 持久化契约：**[StorageWrite](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L911-L928)、[Tx](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L987-L1040)、[CommitPersistence／Session](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L1174-L1207)、[Storage](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L1313-L1445)。
- **[S4] 内置与自定义消息：**[entries.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/entries.ts)、[InputEntry／SubmissionDraft](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L61-L123)。
- **[S5] 输入接纳与队列：**[inbox.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/inbox.ts#L7-L146)、[submissions.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/submissions.ts#L230-L300)。
- **[S6] 控制与展示同处 live：**[LiveState／LiveDoc／PROGRESS_COMMIT](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/live.ts#L137-L235)。
- **[S7] Provider 身份：**[provider.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/provider.ts)。
- **[S8] 用量：**[usage.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/usage.ts#L7-L45)、[压缩用量提交](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/compaction.ts#L188-L220)。
- **[S9] 视图与宿主状态：**[view.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/view.ts#L42-L90)、[transcript.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/transcript.ts#L6-L58)、[README：watch](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/README.md#L521-L527)、[压缩](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/README.md#L606-L608)、[自定义状态](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/README.md#L798-L840)。
- **[S10] 会话选择与可持久化选项：**[AgentState／init／ConversationStreamOptions](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L460-L555)、[HarnessSettings／Models／env](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L613-L701)、[resolveSettings](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L47-L93)。
- **[S11] generation 数据流：**[checkpoint 定义](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L69-L136)、[选项提交与调用](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L244-L299)、[部分流提交](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L660-L749)、[响应／错误保存](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/generation.ts#L760-L852)。
- **[S12] compaction 请求快照：**[compaction.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/compaction.ts#L140-L220)。
- **[S13] task JSON 复制：**[transaction.ts：创建](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/transaction.ts#L483-L508)、[替换](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/session/transaction.ts#L542-L558)。
- **[S14] Models 接线与请求时鉴权：**[CreateModelsOptions／默认 store](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L376-L415)、[getAuth](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L754-L772)、[applyAuth](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L856-L896)、[streamSimple](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models.ts#L929-L947)。
- **[S15] 凭据 Interface：**[ModelAuth／CredentialStore／AuthContext](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/auth/types.ts#L3-L120)、[内存实现](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/auth/credential-store.ts)。
- **[S16] 模型目录 store：**[models-store.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/models-store.ts)。
- **[S17] 默认报告／telemetry：**[Harness 默认 NOOP](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L218-L242)、[safeReport](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L462-L507)、[Pi AI telemetry](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/telemetry.ts#L125-L210)。
- **[S18] Pi AI 请求类型：**[ProviderRequestOptions](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/types.ts#L159-L218)。
- **[S19] 错误传播：**[Anthropic catch](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/anthropic-messages.ts#L918-L922)、[OpenAI Responses catch](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/openai-responses.ts#L251-L267)、[error-body.ts](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/utils/error-body.ts)。
- **[S20] 内存与 backend 边界：**[MemoryStorage](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/memory.ts#L232-L269)、[README storage](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/README.md#L850-L862)。
- **[S21] SQL Seam 与 JSON 保存：**[Chord SqliteDatabase](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/chord/src/sqlite/database.ts)、[SQLite JSON 编码](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/storage.ts#L73-L76)、[open／commit／ID](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/storage/sqlite/storage.ts#L193-L301)。
