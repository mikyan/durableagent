# Pi SDK 的 Android 宿主契约审计

研究日期：2026-11-03。状态：源码研究，未选型，未实施，未做真机测试。

> 版本提示：本文主体审计 SDK 1.3.0。后续已完成[1.5.0 关键契约差异审计](pi-sdk-1.5-delta.md)。不得把本文的数据库方法、watch 类型、参数校验和恢复细节直接用于 1.5.0。

本文使用简化技术中文。每句尽量只表达 1 个意思。“必须”表示规则，“可以”表示能力。保留 `Module`、`Interface`、`Seam`、`Adapter` 的既有含义。本文不增加产品实体。

## 1. 结论先行

**源码支持把 `pi-durable` 和 `pi-ai` 留在本应用。源码不证明任意 Android JavaScript 引擎已经满足要求。** 完整 Termux 可以只承担命令和工具执行。宿主必须补齐以下契约：[S1–S8]

1. 应用运行宿主持有 SDK 状态，独占 SDK storage，并管理恢复。
2. 存储 Adapter 必须提供真正的事务隔离、提交确认和故障语义。
3. 模型传输必须满足所选 Provider 的实际依赖。一个 `fetch` 替换不能覆盖全部 Provider。
4. 执行 Adapter 必须同时满足文件与 shell 契约。跨 UID 不能只传一个路径。
5. 执行 Module 必须核验不确定结果、落实运行策略，并使主动停止在重启后仍有效。

**3 个直接阻断“简单接线即可运行”的发现：**

- SQLite schema 使用 `STRICT` 和 `json_valid`。Android API 33 的标准 SQLite 3.32 不够。[S3、S10]
- `beforeTool` 不在安全重放路径上重新执行。策略只放在这个 hook 中会漏过恢复执行。[S7]
- 内置 Bash 没有可重连的执行收据契约。恢复只产生 `interrupted`，不会查询 Termux 中的真实结果。[S6、S7]

这些发现不改变已确认的 WebView、Kotlin、React、独立运行进程或完整 Termux 决定。运行时、部署、协议、`targetSdk` 和存储布局仍待决定。

## 2. 证据范围、版本与许可

### 2.1 核验对象

直接读取以下已安装包的 `package.json`、`dist/*.js` 和 `dist/*.d.ts`：

- `D:\Code\pi-pocket\node_modules\@earendil-works\pi-durable`：`1.3.0`。
- `D:\Code\pi-pocket\node_modules\@earendil-works\pi-ai`：`1.3.0`。
- 相关已安装依赖：`chord`、TypeBox、Provider SDK 和图片依赖。

使用命令行 HTTP 读取 npm 元数据、上游源码、SQLite 文档和 Android 文档。使用 `git ls-remote` 核验上游版本引用。没有使用浏览器、凭据、设备、安装或下载代码执行。

上游 `v1.3.0` 指向 `71023aec1546d6d677a65669c5665c0927ce0dd0`。下文 Pi 源码链接固定到这个提交。[S1]

npm 记录 `pi-ai@1.3.0` 于 2026-10-15 19:11 UTC 发布。`pi-durable@1.3.0` 于同日 19:13 UTC 发布。研究时，2 个包的 `latest` 都是 `1.5.0`，元数据于 2026-11-02 更新。本文主体没有审计 `1.5.0`；后续差异见上述专项文件。两份研究均没有批准升级。[S2]

`CHANGELOG.md` 记录了 `1.3.0` 的 schema 前缀和 Cloudflare 事务协调修改。`1.2.0` 修改了工具结果、嵌套调用和存储失败语义。这是持续维护的证据，也是升级必须重新验收契约的证据。它不是 Android 兼容性保证。[S2]

GitHub REST 接口返回限流。公开 Git 引用和固定提交的 raw 文件仍可读取。npm 版本元数据没有给出 `gitHead`。本文没有下载 tarball，也没有证明本机所有文件逐字等于发布产物。

关键本机文件的 SHA-256：

| 相对 `@earendil-works` 的路径 | SHA-256 |
|---|---|
| `pi-durable/dist/storage/sqlite/migrations.js` | `d69e1af500302f09442a10bc0826a4fbd5d727adbc902bd8f5526ff00d4ac44b` |
| `pi-durable/dist/harness/tool.js` | `24bb04b63b394f87dbadc3b24039a4d5e618cfb282ec1b5624e6b22f13a99f26` |
| `pi-ai/dist/api/google-generative-ai.js` | `3a19fb56e96e60751a27a19f891264a3ab471cf4973307308ffdc8f8d2669397` |
| `pi-ai/dist/api/openai-codex-responses.js` | `4d90da82aaac68f9f0e1fd7daec39f1aa285c111bf04c7ddefa52e920b41b2cc` |

### 2.2 许可事实

以下版本和许可来自已安装包的 `package.json`。上游根 `LICENSE` 确认 Pi 使用 MIT，要求保留版权和许可文本。[S1]

| 包 | 已检查版本 | 声明许可 |
|---|---|---|
| `pi-durable`、`pi-ai`、`chord`、`pi-codemode`、`pi-telemetry` | `1.3.0` | MIT |
| `typebox` | `1.3.27` | MIT |
| `diff` | `8.0.4` | BSD-3-Clause |
| `@silvia-odwyer/photon` | `0.3.3` | Apache-2.0 |
| `openai` | `7.19.0` | Apache-2.0 |
| `@anthropic-ai/sdk` | `0.129.0` | MIT |
| `@google/genai` | `2.21.0` | Apache-2.0 |
| `@aws-sdk/client-bedrock-runtime` | `3.1127.0` | Apache-2.0 |
| `@smithy/node-http-handler` | `4.12.1` | Apache-2.0 |
| `http-proxy-agent`、`https-proxy-agent` | `9.1.0` | MIT |
| `partial-json` | `0.1.7` | MIT |

这不是最终 APK 的完整许可证清单。最终构建还必须检查传递依赖、WASM、原生库及 notice。SDK 的 MIT 许可不决定 Termux 的许可义务。

## 3. 可移植入口与实际导入图

### 3.1 已见源码

2 个 SDK 都声明 `engines.node >=22.19.0`。这表示包声明的 Node 基线，不表示非 Node 引擎获得官方完整支持。[S1]

`pi-durable` 的根入口导出 Harness、任务、会话、文档和内存存储。它没有静态导入 Node 文件、进程或 SQLite Adapter。按包内相对静态导入遍历，根入口到达 34 个文件。[S1、S4]

主要路径如下。箭头表示实际导入或调用关系，不表示新增 Module：

- `pi-durable` → `harness/*`、`session/*` → `chord`、`chord/context`、`chord/delta`、`chord/output`。
- `pi-durable` → `pi-ai/utils/{uuid,validation,retry,overflow,estimate,transcript}`、`typebox/compile`。
- `pi-durable/tools` → 工具实现 → `ExecutionEnv`；另用 `diff`、TypeBox、文本编解码。
- `pi-durable/storage/sqlite` → portable schema、migration 和 storage → 宿主 `SqliteDatabase`。
- `pi-durable/storage/jsonl` → portable JSONL storage → 宿主 `FileSystem`。
- `pi-ai` → `Models`、鉴权、目录存储和工具函数。根入口不自动导入所有 Provider 实现。
- `pi-ai/providers/openai` → 模型目录、鉴权声明 → lazy `openai-responses` → `openai` SDK。
- `pi-ai/providers/*` 的实现可以继续懒加载。构建必须检查动态导入，不只检查根入口。

`pi-ai` 根入口的包内相对静态遍历到达 25 个文件。它包括可捕获失败的 Node 文件鉴权探测。`pi-ai/compat` 另外加载旧式全局注册和内置集合，不能把它与精简根入口混为一谈。[S4、S5]

这些数量不包括所有外部包。静态遍历也不能证明所有运行分支可用。

### 3.2 明确的 Node 部分

| 入口或路径 | 实际依赖及限制 |
|---|---|
| `pi-durable/env/node` | `node:child_process`、`node:fs`、`node:os`、`node:path`、`node:crypto`、文件监视 |
| `pi-durable/storage/sqlite/node` | `node:sqlite`、`node:fs/promises`、`node:path` |
| `pi-durable/storage/jsonl/node` | Node 文件环境 |
| `pi-durable/images/node` | `node:worker_threads`、文件读取、`createRequire` |
| `pi-ai/api/bedrock-converse-stream` | AWS SDK、`NodeHttpHandler`、HTTP/HTTPS proxy agents |
| Pi AI 的部分 OAuth 流程及 CLI | Node HTTP 回调服务器、加密和进程环境 |

Bedrock 的 lazy loader 特意使用变量导入，避免浏览器打包器跟进 Node-only 实现。这只能延迟问题，不能让该实现变成可移植代码。[S4、S5]

**推论：**即使应用最终采用 Node，也不能直接把 `NodeExecutionEnv` 当成外部 Termux Adapter。它在应用宿主的 UID 和文件视图中执行。

### 3.3 最小 JavaScript 和 Web 能力

核心实际路径需要现代 ESM、Promise、异步迭代、私有字段、集合、`Proxy`、`WeakRef` 和 `BigInt`。还需要以下宿主能力：[S4、S5]

- `Promise.withResolvers`、`structuredClone`、`queueMicrotask`。
- `AbortController`、`AbortSignal`、`throwIfAborted()`；模型目录刷新使用 `AbortSignal.any()`。
- `setTimeout`、`clearTimeout`、`Date.now`、`performance.now`。
- `TextEncoder`、`TextDecoder`、`Uint8Array`、`ArrayBuffer`。
- `crypto.getRandomValues`。`uuidv7()` 直接调用它。
- 图片工具的 `btoa`。图片读取不能只靠字符串假实现二进制。
- 模型 HTTP 的 `fetch`、`Headers`、`Request`、`Response` 和增量 `ReadableStream`。Provider SDK 的具体路径还会使用更多 Web 类型。

`chord` 根入口包含传输代码。压缩对象帧分支使用 `Buffer` 和 Node zlib。浏览器 WebSocket 解压分支使用 `Blob`、`Response` 和 `DecompressionStream("deflate-raw")`。Harness 本地状态使用不等于启用这些传输。不能因此强行选择 Chord 作为 Android 通信协议。[S4]

`/images` 的 Photon 和 `/codemode` 的沙箱是另外的能力面。它们不是 Harness 根入口启动的必要条件。若产品实际启用它们，必须另测 WASM、内存和取消。不能因包声明了依赖，就让运行宿主无条件加载所有代码。

**待验证：**目标引擎必须实际导入选定打包产物，运行参数校验和文档跟踪。一个空 Promise 示例不足以验证 TypeBox、`WeakRef` 和 Chord 行为。

## 4. 存储 Seam：不是“能执行 SQL”就够了

### 4.1 `SqliteDatabase` 的完整 Interface

接口为 `exec`、`run`、`get`、`all`、`transaction`、`close`。[S3]

- `exec` 必须支持多条 SQL，无绑定参数。
- `run`、`get`、`all` 必须支持单条 SQL 和位置绑定。
- 值类型包括 `null`、`number`、`bigint`、`string`、`Uint8Array`。
- 无结果的 `get` 必须返回 `undefined`。
- 事务回调必须只使用传入的事务句柄。
- 无关操作和其他事务必须等待当前事务结束。
- 回调完成后，事务句柄必须失效。
- `transaction()` 的 Promise 必须在提交或回滚完成后才结束。
- 回调失败且回滚成功时，必须返回原错误。
- 回滚也失败时，必须返回不同错误，例如 `AggregateError`。

在事务回调中调用外层 database，包括外层 `close()`，会排到自身后面。源码明确说明这会永久等待。Kotlin/JNI Adapter 必须保持连接、排队和事务句柄语义，不能逐条散发给不相关线程或连接。

Node 参考 Adapter 使用串行操作队列和 `BEGIN IMMEDIATE`。SDK Session 还有自己的提交队列。Session 的队列不能替代数据库 Adapter 的队列。[S3、S8]

### 4.2 SQL 功能和 Android 版本

`migrations.ts` 实际使用：[S3]

- `STRICT` 表。
- `CHECK(json_valid(...))`。
- 整数主键、复合主键、约束和普通索引。
- 部分索引：`WHERE head IS NOT NULL`。
- `INSERT OR IGNORE`。

运行查询还使用 `ON CONFLICT ... DO UPDATE`。此次检查没有发现必须依赖 FTS、`RETURNING` 或窗口函数的 storage 查询。不能把这些未发现能力误列为当前硬依赖。

`STRICT` 最低要求 SQLite `3.37.0`。JSON 函数在 `3.38.0` 起默认内置，但编译仍可删除 JSON 支持。更早版本需显式启用 JSON1。[S10]

Android 官方表给出以下标准版本。厂商可以不同，同一 API 也可能升级：[S10]

| Android API | 官方表中的 SQLite | 对当前 schema 的结论 |
|---|---|---|
| 28 | `3.22` | 不支持 `STRICT`；不能直接使用 |
| 30 | `3.28` | 不支持 `STRICT` |
| 31–33 | `3.32` | 不支持 `STRICT` |
| 34 | `3.39` 或 `3.42` | 达到 `STRICT` 版本门槛；仍须验证 JSON 和 Adapter |
| 35 | `3.44` | 同上 |

**推论：**如果支持较旧系统，并选择 SDK 的 SQLite storage，随应用提供合格 SQLite 引擎会成为实质选项。另一个选项是运行宿主自带 SQLite，例如合格的 Node SQLite。二者都未选择。`targetSdk` 不会升级设备 SQLite。

不能删除 `STRICT` 或 `json_valid` 来假装满足原契约。也不能把“应用支持 SQLite”当成所需功能已存在。能力检查必须覆盖版本、编译功能和真实迁移。

### 4.3 单一所有者、提交和耐久性

`SqliteStorage` 在内存中分配 `nextId`。`commit()` 在一个数据库事务中写入记录、文档修订和序号，再更新内存。ID 必须保持 JavaScript 安全整数语义。[S3]

**每份 SDK storage 必须只有 1 个进程所有者。** SDK 没有跨进程所有权锁。WAL、busy timeout 和表名前缀都不能代替所有权。UI 进程和 Termux 执行端不能打开同一份 SDK storage 驱动另一个 Harness。[S3、S8]

Node Adapter 默认使用 `journal_mode=WAL` 和 `synchronous=NORMAL`。进程崩溃与掉电不是同一耐久性等级。SQLite 官方说明，WAL 的 `NORMAL` 可以在掉电后丢失最近提交。宿主必须明确用户已确认结果的耐久性要求，不能直接继承默认值后宣称零丢失。[S3、S10]

JSONL portable 路线确实存在。它依赖文件追加、截断、刷新和恢复协议，并把历史保留在内存中。`fsync` 默认关闭。它不是无需原生存储适配的捷径，也不是已选择的 Android 存储。[S3]

存储异常通常使 Session 进入 `SessionFailed` 并关闭。SDK 不自动重试这些故障。存储 Adapter 必须谨慎处理短暂故障。提交结果不明时，不能直接重复逻辑提交。宿主必须重新打开并核验已提交状态。[S8]

## 5. 模型 Seam：复用协议，但不能承诺全部组合

### 5.1 真实调用链

`GenerationTask` 固定本次模型和上下文 cutoff，随后调用 `runtime.models.streamSimple()`。它把 `runtime.signal` 和持久化的 `ProviderDoc.sessionId` 传入 Pi AI。`Models` 解析凭据，再调用所属 Provider。Provider 继续调用 SDK 或自身协议实现。[S5、S7]

主 Agent 必须保留这条链。Android Adapter 可以提供传输和凭据，但不能另造一套模型协议。

`createModels()` 接受 `CredentialStore`、`ModelsStore` 和 `AuthContext`。默认存储只是内存。默认 `AuthContext.fileExists()` 在非 Node 环境中会探测失败并返回 `false`。应用必须提供安全凭据存储，不能期待环境变量或文件探测自动找到 Android 凭据。[S5]

`ConversationStreamOptions` 是经过筛选的可持久化选项。它不包含 `fetch` 函数。`createModels()` 也没有统一的全局 fetch 参数。需要注入时，可以在应用持有的 `Models` 或 Provider 调用 Seam 合并运行时选项。也可以提供合格的宿主全局 `fetch`。这不是把函数写入 `AgentDoc`。[S5、S7]

### 5.2 按实际传输分类

| 实现 | 源码事实 | Android 集成含义 |
|---|---|---|
| `anthropic-messages` | 把 `options.fetch` 传给 Anthropic SDK；自行增量解析 SSE | API Key 路径可以使用 fetch Adapter；仍须验证 SDK 所需 Web 类型 |
| `openai-completions`、`openai-responses` | 把 `options.fetch` 传给 OpenAI SDK | 可以复用原协议和流事件；兼容端点仍须逐个验证 |
| `azure-openai-responses` | 客户端选项传递 `fetch` | 还需端点、版本和鉴权验证 |
| `pi-messages`、`mistral-conversations` | 直接使用 `options.fetch ?? globalThis.fetch` | 可以适配 HTTP；取消和流错误仍须保真 |
| `google-generative-ai`、`google-vertex` | 若自定义 fetch 不等于全局 fetch，明确报错 | “逐请求 fetch 注入”方案不能覆盖它们 |
| `bedrock-converse-stream` | 使用 AWS SDK 和 `NodeHttpHandler`；未见消费 `options.fetch` | 不能按普通 fetch Provider 宣称支持 |
| `openai-codex-responses` | 有 SSE、WebSocket 和缓存连接路径 | fetch 不能覆盖 WebSocket；首版不要求其 OAuth 登录 |

Google SDK 的导出区分 `browser` 和 `node`。构建条件选错可以引入 Node 鉴权等依赖。用全局 fetch 适配 Google 是需要验证的候选，不是已经完成的适配。Vertex 的环境鉴权也不能等同于 Gemini API Key。[S5]

这张表不是删减 Provider 的决定。它定义支持矩阵必须按“运行时 × Provider × 鉴权 × 传输 × 端点”验证。SDK 目录中存在模型，不等于该组合已获支持。

### 5.3 流式、取消和重试

Anthropic 的实际 SSE 路径使用 `response.body.getReader()`、增量 `TextDecoder` 和 reader 的 `releaseLock()`。OpenAI SDK 也使用 Web `ReadableStream`。宿主不能等完整响应下载后再伪造增量事件。[S5]

必须传递状态码、headers、非成功响应体和网络错误。必须保持 UTF-8 跨块字符、SSE 跨块事件和 JSON 工具参数片段。必须为未消费流和取消提供真实资源释放。

`AbortSignal` 不能只取消 UI 等待。它必须中断挂起的网络读取。取消不能撤销 Provider 已完成的远程处理，也不保证不计费。

Codex 源码调用 `new WebSocketCtor(url, { headers: wsHeaders })`。普通浏览器 WebSocket 的第 2 参数不是这种 headers 对象。仅有同名全局类不够。连接超时、流空闲超时、取消和会话清理也必须匹配。[S5]

Durable 的 generation 重试与 Provider 内部重试是 2 层。Durable 默认 `maxRetries: 3`。已检查的 OpenAI/Anthropic 路径禁用底层 SDK 的自动重试，再由 Pi 的请求重试辅助函数执行配置。辅助函数默认额外重试为 0。其他 Provider 不应据此一概推断。[S5、S7]

宿主必须统一总预算，并显示等待原因和重试时间。进程退出后，普通未完成模型请求可能重新发出。已保存的部分文本不是远程 SSE 游标。

## 6. 执行 Seam：文件与 shell 必须属于一致的环境

### 6.1 `ExecutionEnv` 的真实 Interface

`ExecutionEnv` 同时继承 `FileSystem` 和 `Shell`。[S6]

文件侧不只有 `read` 和 `write`。还包括：

- `id`、`cwd`、绝对路径、拼接路径和 canonical path。
- 文本与二进制读取、追加、截断、刷新、重命名。
- 打开的二进制 reader、位置读取和行扫描。
- 目录分页、临时文件、删除、存在性和 metadata。
- 文件监视与清理。`listFiles` 是可选能力。

二进制 reader 必须保持已打开文件的身份。路径被重命名后，后续读取仍应针对原文件。逐次按原路径重新打开不满足这个契约。

文件预期错误使用 `Result` 和 `FileError.code` 返回。不可用功能必须明确失败，不能悄悄成功。监视重连后覆盖不确定时必须报告 `overflow`，不能只从新事件继续。

shell 侧必须保持以下区别：

- 字符串命令经过环境 shell。
- argv 数组直接执行，参数不再由 shell 解析。
- `cwd`、`env`、`inheritEnv` 和超时必须有效。
- stdout/stderr 分别增量解码，并报告到达顺序和流来源。
- `window` 可以省略已丢弃输出，但 `skipped` 的字节和换行计数必须准确。
- `spillPath` 必须指向完整原始输出；超时或取消也可能带有它。
- 取消和超时只终止本次命令的进程。
- `cleanup()` 终止环境拥有的全部命令，只能用于所有者关闭。

一个“执行字符串后返回最终文本”的远程调用不满足这个 Interface。Bash 工具还会设置输出截断、spill 和流窗口。[S6]

### 6.2 命名空间身份与双 UID

`FileSystem.id` 表示文件命名空间。相同 ID 必须在相同路径看到相同文件，与 `cwd` 无关。`NodeExecutionEnv` 使用 `node:local`。不能把这个默认身份直接复制到互相隔离的应用和 Termux 文件视图。[S6]

Android 使用 UID 和 SELinux 隔离应用。独立 Termux APK 的命令在 Termux 身份下运行。应用私有绝对路径不是跨 UID 的访问授权。一个进程中的 fd 数字也不是另一个进程可直接使用的文件句柄。[S11]

**推论：**外部 Termux 路线需要让执行环境的文件方法和 shell 方法看到一致的命名空间。可以由执行端处理工具工作区文件访问。具体协议未选择。应用 UI 不应自行猜测 Termux 路径。

spill 文件、临时文件和 canonical path 也必须经过这个环境读取。不能把 Termux 的 `spillPath` 直接交给应用本地 `fs.readFile`。

`Harness.buildEnv()` 按当前会话 `cwd` 构建环境。工具重放也重新构建环境。配置变更可能影响之前已经生成的工具调用。宿主必须定义执行中的工作区配置如何固定，不能假设 SDK 自动冻结它。[S7]

### 6.3 3 种存储角色，仍沿用现有产品术语

| 存储角色 | 权威所有者与要求 |
|---|---|
| 应用拥有的 SDK 状态 | 本应用运行宿主拥有。包括会话、输入去重、任务检查点、文档、重试和取消意图 |
| 具备 POSIX 能力的工具工作区 | 完整 Termux 工具能够使用。项目依赖和构建可能需要可执行文件、软链接、权限和正确大小写语义 |
| 已授权的用户原始文件 | 必须实际操作获授权的原文件。路径或文档 URI 的访问能力须单独核验 |

这 3 项是存储角色，不是新项目类型、任务实体或产品工作区概念。同一位置是否能承担多个角色，需要后续验证。

**不能用共享 `/sdcard` 目录作为跨 UID 的完整解决方案。** Termux 官方执行文档指出，共享仿真存储使用 `noexec`，也不能创建硬链接或软链接。这会破坏部分构建和项目依赖。`bash /sdcard/script` 能读取脚本，不证明该目录满足完整工具工作区语义。[S12]

同样，复制原文件到工具工作区，只解决了副本可访问。它不能自动满足操作原始文件的需求。原始文件映射、授权和回写由独立文件研究继续处理；本文不选择 SAF、挂载或复制方案。

## 7. 恢复、实际执行策略与主动停止

### 7.1 SDK 实际保证什么

`ToolTask.call` 的顺序是：[S7]

1. 解析工具并校验参数。
2. 执行 `beforeTool`。
3. 再次校验修改后的参数。
4. 提交 `phase: "execute"`、最终参数和 replay 策略。
5. 构建执行环境并调用工具。
6. 提交工具结果。

未声明 replay 的工具默认 `unsafe`。内置 Bash 没有声明 `replay: "safe"`。[S6、S7]

恢复进入 `ToolTask.execute` 后，只有已存策略和当前策略都为 `safe` 才重新调用工具。否则，SDK 写入 `interrupted`，附带已提交输出。这个结果表示可能部分执行，不表示没有执行。

在“意图已存，命令尚未启动”窗口崩溃，也会得到这种保守结果。在“命令已经完成，SDK 结果尚未存”窗口崩溃，同样会得到这种结果。SDK 不知道外部文件或进程的最终状态。

### 7.2 必须增加的执行核验，不是再造 Agent

应用侧的 SDK 状态必须保持权威。Termux 执行端可以拥有命令侧记录。命令侧记录只回答某次操作是否接收、启动、结束、取消，以及输出在哪里。

它不能接管模型、会话调度或整个恢复决定。

**推论：**跨进程执行必须有稳定关联标识、重复提交处理、状态查询、输出续取和取消确认。还必须区分“确认未启动”“仍运行”“已完成”和“结果不明”。这不是选择 Binder、HTTP 或套接字。

`Shell.exec()` 的参数没有 `taskId`、执行键或恢复句柄。环境工厂只得到会话、`cwd` 和读取能力。现成 Interface 不会自动建立上述收据协议。[S6、S7]

工具调用处有 `api.taskId` 和持久化 `api.memo()`。它们可以帮助专用工具或包装逻辑关联一次执行。具体设计仍须覆盖“应用已提交、执行端未接收”和“执行端已完成、应用未确认”2 个窗口。不能把命令文本哈希当成完整幂等键。

**不能只把 Bash 改成 `safe`。** 通用 Bash 没有可靠的通用副作用核验。只有能够重连旧执行或证明重做安全的调用，才可以获得安全重放策略。

现成 unsafe 恢复路径直接产出错误，不会重新进入工具执行体查询收据。因此宿主必须明确核验发生在 `resume()` 前、恢复协调流程中，还是专用可恢复工具中。本文不选择这 3 者的具体组合。

若无法核验，必须停止相关操作并说明原因。只把 `interrupted` 交给模型，再允许模型盲目重发同一命令，不满足产品恢复要求。

### 7.3 策略必须覆盖真实执行

安全重放直接进入 `run()`，不会重跑 `beforeTool`。提示词、工具描述和首次 hook 不能独自承担强制策略。[S7]

策略 Seam 必须覆盖实际执行，包括最终 `command`、`cwd`、环境变量、文件写入和重放。`createBashTool({ prepare })` 还可以修改实际执行内容。因此审核最初参数不等于审核最终操作。[S6]

`wrapTool` 可以包装选中的工具实现。底层执行 Adapter 可以统一检查能力使用。它们可以承载不同层次的策略，但不能互相替代。可信随包扩展若直接使用 Node 或联网能力，也必须服从宿主约定。SDK 扩展不是恶意代码沙箱。

内置 `withFileMutationQueue()` 只按 `env.id + canonicalPath` 串行化本进程中的 `edit` 和 `write`。源码明确说它不锁 Bash 或其他进程。[S6]

**推论：**产品要求的同工作区潜在写入串行，必须由应用执行 Module 补齐。不能把单文件队列误称为工作区锁。等待策略、取消等待和进程退出后的占用核验必须共用这条 Interface。

省流策略也必须覆盖运行中网络变化。仅在命令启动前检查一次不够。暂停、中止或继续的具体机制待定。不能把终止任意 Bash 后的重新启动视为安全恢复。

### 7.4 主动停止与宿主关闭不同

`Conversation.abort()` 在一个提交中撤回排队输入，并标记当前范围内的任务取消。它等待会话空闲。默认不穿过后台任务边界；`{ background: true }` 才覆盖这些任务。排队的普通 write 与输入撤回也不是同一规则。[S7]

`Harness.close()` 则通知正在运行的代码退出，但不写入任务最终结果。重新打开后，这些工作可以恢复。关闭宿主不能代替用户停止。[S8]

重开时，scheduler 把 surviving `running` 改回 `pending`。已保存的取消意图具有优先级。`resume()` 启用调度，但不会替 Android 启动进程。[S7]

**宿主义务：**

- 用户停止的确认必须有持久化依据。
- UI 断开不能取消停止请求的执行。
- 停止必须传到真实 Termux 命令进程，并等待或核验终止。
- 取消回调不等于进程树已停止。
- 旧网络响应、旧命令收据和恢复计时器不能重新激活已停止工作。
- 外部命令若在应用退出后仍运行，恢复协调必须先查询它。

SDK 会等待忽略取消信号的工具。Android 进程退出、断线和双 UID 取消仍需应用执行契约处理。

## 8. 最小深 Module 划分建议

以下是职责与真实 Seam，不是已批准的代码结构。

| Module | 小 Interface 应隐藏的复杂性 | 可复用部分与必要 Adapter |
|---|---|---|
| 应用运行宿主 | 提交输入、停止、查询、订阅；单一所有权和恢复顺序 | Harness、Session、任务和文档；Android 生命周期适配 |
| SDK 存储 | SDK 已定义的 Storage 或 `SqliteDatabase` | portable SQLite/JSONL；真实事务和文件 Adapter |
| 模型接入 | SDK 的 `Models` 和 Provider 行为 | Pi AI 协议；凭据、HTTP、必要 Web 能力 Adapter |
| 本机执行 | 执行、核验、输出、取消；工作区互斥和策略 | `ExecutionEnv`；完整 Termux 执行与文件 Adapter |
| UI 接入 | 高层动作和可重建状态 | WebView/Kotlin 通信 Adapter；不暴露原始数据库或通用原生执行 |

执行收据和 SDK 检查点不能混成同一份“任务状态”。前者记录命令事实，后者决定会话如何继续。应用运行宿主必须协调二者，但不能要求两个 UID 跨库原子提交。

## 9. 后续必须命名并执行的契约测试

本轮没有编写或运行这些测试。

| 测试名 | 必须证明的行为 |
|---|---|
| `portable-import-closure` | 在目标引擎导入实际产物；必要路径不意外加载 Node-only Module |
| `runtime-primitives` | `WeakRef`、`Proxy`、TypeBox、`Promise.withResolvers`、取消、文本编解码、随机数真实可用 |
| `sqlite-capabilities` | 实际迁移支持 `STRICT`、JSON 检查、部分索引和 UPSERT |
| `sqlite-transaction-order` | 事务等待期间，无关读写不能进入；提交后才确认；过期句柄拒绝 |
| `sqlite-rollback-ambiguity` | 回调失败、回滚失败、提交失联分别产生正确语义 |
| `storage-single-owner` | UI 重连、Service 重启和重复启动不会形成 2 个 SDK 所有者 |
| `storage-conformance` | 通过 SDK `registerStorageConformance()`；覆盖混合原子写、ID、游标、文档历史和字符串身份 |
| `storage-crash-durability` | 每个提交窗口进程终止后保持一致；另测掉电，不把二者混同 |
| `provider-runtime-matrix` | 每个声明支持的 Provider/鉴权/端点/传输组合都完成真实请求 |
| `model-stream-fragmentation` | UTF-8、SSE、工具 JSON 任意分块仍正确；不是完整缓冲后重放 |
| `model-cancel-retry-budget` | 取消中断挂起读取；2 层重试有界、可见；终止后不复活 |
| `websocket-header-contract` | 若启用 Codex WebSocket，验证鉴权 headers、超时、关闭和重连 |
| `env-conformance` | 通过 SDK `registerEnvConformance()`；必要时适配其测试命令到 Termux |
| `namespace-original-file` | `read`、`edit`、Bash 和 canonical path 指向同一目标；验证操作原文件而非隐式副本 |
| `posix-workspace` | 代表性项目依赖、软链接和执行语义有效；共享存储失败不能被忽略 |
| `opened-file-identity` | 重命名后 reader 仍读原文件；`noFollow`、目录分页和 watch overflow 保真 |
| `exec-output-contract` | argv 不被重解析；stdout/stderr、超时、spill 和省略计数正确 |
| `exec-crash-windows` | 在意图前后、启动前后、退出前后和结果提交前后终止进程；不重复不确定副作用 |
| `exec-reconnect-identity` | 重复提交同一执行键不重复启动；旧输出和旧结果不会串到新执行 |
| `actual-execution-policy` | 正常调用、嵌套调用、safe replay 和 `prepare` 修改都不能绕过策略 |
| `workspace-mutation-serialization` | 多会话 Bash/写入保守串行；确定无副作用的读取不被全部阻塞 |
| `explicit-stop-survives-restart` | 停止后立刻杀宿主、重启、恢复网络，旧工作仍不复活 |
| `termux-process-tree-cancel` | 中断管道、子进程和脱离进程；不会误杀别的会话 |
| `metered-network-transition` | 运行中切到受限网络时，状态与策略生效；纯本地受控操作仍可继续 |

SDK 已提供环境和存储 conformance cases，不应全部重写。它们不覆盖 Android UID、系统回收、执行端收据或产品省流规则。[S9]

## 10. 下一轮 grilling 的事实输入与阻断项

### 可以据此讨论

- 运行时选择必须比较真实 Provider 组合和必要 Web 能力，不能只比较能否执行 JavaScript。
- SQLite 选择必须同时回答最低系统版本、引擎版本、事务实现和耐久性等级。
- 外部 Termux 必须说明命令及文件如何共用命名空间，而非只说明命令如何启动。
- 执行恢复必须有明确核验路径；“用 Pi Durable 自动恢复”不是完整答案。
- 主动停止必须区分 SDK 取消意图、命令实际终止和 Android 进程关闭。

### 尚未解除的阻断

1. 未选择应用内运行时。没有 Android 导入或 Provider 真机结果。
2. 未选择 Termux 部署和 UID 关系。无法固定文件和进程控制能力。
3. 未选择 SQLite 引擎或 JSONL。没有可用性和掉电耐久性结果。
4. 未设计命令收据和 SDK 检查点的协调协议。通用 Bash 的未知结果仍不能安全重放。
5. 未选择原始文件访问方案。不能用共享 `/sdcard` 或副本方案替代要求。
6. 没有完成全部 Provider 与传递依赖审计。本文给出具体限制，不给出“全部支持”承诺。

## 11. 来源索引

Pi 固定版本为 `v1.3.0`，提交为 `71023aec1546d6d677a65669c5665c0927ce0dd0`。除明确注明外，下面不是可变分支链接。

- **[S1] 包入口与许可：**[Durable package](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/package.json)、[AI package](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/package.json)、[LICENSE](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/LICENSE)。依赖许可表另据本机各包 `package.json`。
- **[S2] 维护证据：**[Durable CHANGELOG](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/CHANGELOG.md)、[Durable npm 元数据](https://registry.npmjs.org/@earendil-works/pi-durable)、[AI npm 元数据](https://registry.npmjs.org/@earendil-works/pi-ai)。npm 全量元数据是可变资源，读取日期见文首。
- **[S3] 存储实现：**[database.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/database.ts)、[migrations.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/migrations.ts)、[storage.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/storage.ts)、[Node Adapter](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/node.ts)、[JSONL](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/jsonl/storage.ts)。
- **[S4] 导入及运行能力：**[Durable index](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/index.ts)、[AI index](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/index.ts)、[AI compat](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/compat.ts)、[Chord link](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/chord/src/link.ts)、[Chord tracker](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/chord/src/delta/tracker.ts)、[UUID](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/utils/uuid.ts)。
- **[S5] 模型契约及实现：**[types.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/types.ts)、[models.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/models.ts)、[auth/context.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/auth/context.ts)、[Provider 实现目录](https://github.com/earendil-works/pi/tree/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/src/api)。重点为 `anthropic-messages.ts`、`openai-completions.ts`、`openai-responses.ts`、`azure-openai-responses.ts`、`google-generative-ai.ts`、`google-vertex.ts`、`bedrock-converse-stream.ts`、`bedrock-converse-stream.lazy.ts`、`openai-codex-responses.ts`、`pi-messages.ts`、`mistral-conversations.ts`。另检查本机 `openai/internal/shims.mjs`、`@anthropic-ai/sdk/internal/shims.mjs` 和 `@google/genai/package.json`。
- **[S6] 文件与命令：**[ExecutionEnv](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/env/index.ts)、[Node 环境](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/env/node.ts)、[bash.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/tools/bash.ts)、[file-mutation-queue.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/tools/file-mutation-queue.ts)。
- **[S7] 恢复和停止：**[tool.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/tool.ts)、[scheduler.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/scheduler.ts)、[generation.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/generation.ts)、[harness.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/harness.ts)、[types.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/types.ts)、[agent.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/agent.ts)。
- **[S8] Session 所有权与失败：**[session.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/session/session.ts)、[README 的 Storage 与 Errors 契约](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/README.md#storage)。README 只补充契约说明，结论同时核验了实现。
- **[S9] 已有契约测试：**[storage-conformance.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/testing/storage-conformance.ts)、[env-conformance.ts](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/testing/env-conformance.ts)。
- **[S10] SQLite 与 Android 官方资料：**[STRICT](https://sqlite.org/stricttables.html)、[JSON 功能](https://sqlite.org/json1.html)、[synchronous](https://sqlite.org/pragma.html#pragma_synchronous)、[Android SQLite 版本表](https://developer.android.com/reference/android/database/sqlite/package-summary)。文档为可变资源，读取日期见文首。
- **[S11] Android UID 隔离：**[Application Sandbox](https://source.android.com/docs/security/app-sandbox)。官方架构资料，读取日期见文首。
- **[S12] Termux 共享存储限制：**[Termux execution environment](https://github.com/termux/termux-packages/wiki/Termux-execution-environment#file-execution-and-special-file-features-not-allowed-in-external-storage)。实际读取 wiki 的 raw Markdown。该资料可变，读取日期为 2026-11-03；本文只据此记录 `noexec`、链接和构建限制，不宣称已做设备验证。
