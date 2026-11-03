# Pi Durable 1.5.0：扩展注册与应用组合事实审计

研究日期：2026-11-03。状态：只读源码研究；研究本身没有选择应用描述符，没有新增插件框架，没有执行上游代码或设备测试。

后续决定：用户已通过 Q12 确认一份薄的应用描述关联可选 UI 与 Agent 贡献入口，见 [Module 设计](../module-design.md)。本文保留当时源码事实与候选评估，不将后续选择冒充 SDK 自带机制。

## 1. 结论先行

1. **SDK `Extension` 是具名的 Agent 能力集合，不是应用插件宿主。** 它只有必需的 `name`，以及可选的 `tools`、`sections`、`hooks`、`wraps`、`tasks`。没有 UI、依赖声明、安装初始化或卸载清理字段。[S1]
2. **Agent 侧注册与组合已经存在。** 应用创建 `createRegistry()`，依次 `install()`，再将 registry 传给 `Harness.open()`。SDK 已处理按名安装／替换、会话选择、工具覆盖、包装、hook 顺序和任务定义查找。应用不应再实现相同机制。[S2–S5]
3. **一个带可选 UI 入口与可选 Agent 入口的应用描述符，可以是合理的薄组合，但不是 SDK 的要求。** 前提是只关联随包能力、分发到两个运行宿主，并把 Agent 贡献交回 SDK。本文不选择这个形状；两个显式清单加共享标识也可表达相同关系。
4. **UI-only 不需要空的 SDK 扩展，更不需要虚假的工具。** 它可以调用宿主已有的查询与订阅 Interface；核心再使用 `Conversation.entries()`、`watch()`、`agent()` 等 SDK 方法。查询这些方法不以调用者注册为 `Extension` 为条件。[S7–S8]
5. **UI 生命周期、应用资源生命周期、SDK 任务生命周期不是同一件事。** `uninstall()` 不等待旧调用结束，也不执行扩展清理。应用资源必须有明确所有者；页面卸载不能等同于停止 Agent。[S5–S6]

以上 1、2、4 的 SDK 部分和 5 的 registry 行为是源码事实。第 3 项及 UI 到核心的应用接线方式是设计评估，不是已定 Interface。

## 2. 固定输入与研究范围

先读了[首版需求](../requirements-v1.md)、[Module 设计](../module-design.md)、既有 [Android SDK 契约审计](pi-sdk-android-contracts.md)和 [1.5.0 差异审计](pi-sdk-1.5-delta.md)，并核对技术设计中的 UI 扩展背景。

本轮按用户最新确认处理 Q9、Q10、Q11，不受旧文件“建议／待决定”标签影响：

- Q9：一个工具环境 Module，统一文件访问、命令生命周期、就绪、输出、取消与结果核验。
- Q10：固定核心持有持久化、恢复、停止、平台检查与实际执行不变量；扩展通过 Interface 使用。
- Q11：一个模型配置 Module，统一配置与凭据入口，模型能力复用 Pi AI。
- 真实自定义 React UI、UI-only、可信开发者编写的随包扩展、共享 React、不承诺旧插件原文兼容，均不重新讨论。
- TypeScript 核心在 WebView 外；Kotlin 负责 Android 机制和必要控制。共享 React 仅指 UI 宿主与 UI 扩展，不是前后端共用 JavaScript 对象或运行上下文。
- V1 为 YOLO，无应用逐操作审批流程；Android 系统授权仍必须申请、检查并处理拒绝与撤销。

新增上游证据仅来自 `earendil-works/pi@f9a26365568127461c47a07a37dcb42c140a3ac5`。以命令行 HTTPS 读取固定 raw 文本，在内存中定位行号。没有使用浏览器、凭据、设备、安装、可执行下载或上游代码执行。没有验证 npm 发布包与固定树逐字相同。

## 3. 源码事实：`Extension` 的真实形状

以下是公开定义，保留字段与类型：[S1]

```ts
interface Extension<Tool extends ToolRegistration = ToolRegistration> {
  readonly name: string;
  readonly tools?: readonly Tool[];
  readonly sections?: readonly PromptSection<Tool>[];
  readonly hooks?: readonly HookRegistration[];
  readonly wraps?: readonly Wrap<Tool>[];
  readonly tasks?: readonly AnyTask[];
}
```

| 字段 | SDK 含义 |
|---|---|
| `name` | registry 身份；会话保存名称，不保存代码对象 |
| `tools` | 工具定义，包括实际执行逻辑；不是 UI 菜单动作 |
| `sections` | 系统提示词片段；不是 React 页面区域 |
| `hooks` | 按任务名称匹配的 handler 集合；不是插件安装事件 |
| `wraps` | 按工具名称或 section key 包装最终选中的定义 |
| `tasks` | registry 全局可解析的持久任务定义，不以某会话选中该扩展为前提 |

`defineExtension()` 只是带类型的 identity function，直接返回输入；它不注册、不初始化、不做验证。`hook()` 把任务 token 转为任务名称；`wrapTool()` 同样只保留目标工具名称。[S3]

**扩展状态不等于描述符里的 `state` 字段。** SDK 使用 `defineDoc()`、事务中的 `tx.doc()` 和读取／watch Interface。官方例子把 document token 放在扩展定义之外，首次写入才创建文档；读取不存在的文档时使用默认值。document 定义不需要 registry 注册。[S10]

`Extension` 也没有 `version`、`requires`、`before`、`after`、`priority`、`setup`、`dispose` 或 React 字段。任务自己的版本与迁移是另一层，不能误称为扩展包版本机制。[S1、S5]

## 4. 源码事实：registry 组装、选择与冲突

### 4.1 组装顺序与职责

最小路径为：创建 registry → 安装 Agent 贡献 → 将 registry、models 和其他宿主选项交给 `Harness.open()`。[S2、S4]

- `createRegistry()` 初始只包含 `GenerationTask`、`ToolTask`、`CompactionTask`；它们不是普通扩展，不能被普通安装替换或卸载。
- registry 是应用拥有的内存对象。重启后宿主重新安装代码；会话持久化的是 `pi.agent` 中的名称选择。
- `HarnessOptions.registry` 接受 `RegistryReader`，不是另一个应用扩展描述符。
- `Harness.open()` 检查必需的内置任务是否存在，然后打开任务调度状态。它没有逐扩展执行初始化回调。
- `install()` 验证候选状态，再同步发布并通知订阅者。没有多个扩展安装的 batch；验证失败时不发布候选状态。
- scheduler 订阅 registry 变化，重新考虑被阻塞任务。[S2、S4、S6]

另有 `registryReader()`，可以把 Chord 的 `RegistryValue<RegistrySnapshot>` 适配为 Durable 的 `RegistryReader`。这不是应用必须采用 Chord registry 的要求，更不是需要再造一个 Agent registry 的理由。本轮没有审计 Chord 通用 registry 的全部能力。[S9]

### 4.2 安装与会话选择不是一回事

默认情况下，会话选择全部已安装扩展，按安装顺序。宿主 `settings.extensions` 可以改变默认选择；会话 `AgentState.extensions` 可以指定完整名称数组，或对默认值执行 `add`／`remove`。[S1、S5]

- 完整数组使用数组顺序；增量选择在默认序列末尾添加名称，再移除指定名称。
- 重复选择名称保留首次位置；未安装名称被跳过，不报“缺少依赖”。
- 配置中传入扩展对象时，SDK 保存／解析的是名称。一个旧对象仍指向该名称当前安装的版本。
- 已安装但未被会话选中的扩展不贡献该会话的工具、提示词或 hooks；其 `tasks` 定义仍进入全局任务查找表。

**推论：**不能把“应用已打包”“SDK 已安装”“会话已选中”“UI 页面已挂载”设计成同一个状态开关。固定核心的查询能力也不应依赖会话是否选中了某个 Agent 扩展。

### 4.3 重名行为必须按层区分

| 重名位置 | 固定源码行为 |
|---|---|
| 两次 `install()` 使用相同扩展 `name` | 后者原位替换前者，不报重名错误，不改变安装位置 |
| `uninstall()` 传入同名旧对象 | 依名称移除当前对象；不存在则不做事；之后重新安装会追加到末尾 |
| 一个扩展内部重复工具名 | 安装抛错 |
| 一个扩展内部重复 section key | 安装抛错；key 还必须匹配 `^[a-z][a-z0-9_-]*$`，且不能是 `instructions` |
| 不同扩展提供相同工具名／section key | 允许安装；会话组合时，后选中的定义覆盖前者，保留该 key 首次出现的位置 |
| 任务名重复，包括内置任务、不同扩展及同一扩展内部 | 候选 registry 构建抛错；同名扩展替换时按替换后的整体状态验证 |
| 重复 hook 注册 | 没有按 hook 名称去重的规则；匹配的注册依顺序参与分发 |

依据为 `validateExtension()`、`RegistryState`、`install()`、`selectExtensions()`、`resolveAgent()` 与 `agentHooks()`。[S2、S5]

**应用层可讨论但尚未决定的规则：**随包清单可以主动拒绝意外重复的应用标识或 SDK 扩展名，以便尽早发现误覆盖。但这将是应用装配校验，不是 SDK 默认行为，也不能误伤有意的工具覆盖。

## 5. 源码事实：依赖与顺序不是依赖解析器

SDK `Extension` 没有依赖声明，也没有拓扑排序、版本区间解析或自动安装依赖。必须区分 JavaScript import 依赖、宿主构造依赖、扩展选择顺序和持久任务等待关系。[S1–S3、S5]

组合按以下步骤进行：[S5]

1. 求出会话选中的扩展序列。
2. 收集所有工具与 sections，完成同名覆盖。
3. 按扩展选择顺序，再按各扩展 `wraps` 数组顺序，对最终定义应用包装。
4. 过滤启用／提供给模型／可供嵌套调用的工具。
5. 最后追加会话 `instructions` section。
6. hooks 按所选扩展顺序及各扩展的注册顺序，匹配当前任务名称。

因此，wrapper 不要求提供目标的扩展先安装：所有定义先完成收集，再执行包装。目标根本不存在时，wrapper 不做事；它不会自动安装目标。wrapper 抛错或改名时，该次解析删除目标并报告错误。[S5]

hooks 是任务提出的具体问题。多个 hook 的返回值如何合并、短路或选择，由对应任务的契约决定，不能概括为“所有 hooks 都是后者覆盖前者”。例如 `beforeTool` 的首个 block 生效，`onYield` 使用首个 continue；它们不是应用启动顺序。[S1、S6]

**推论：**随包代码可以通过显式 import、构造参数和明确清单顺序提供所需依赖。缺少自动依赖图不自动构成建设通用插件依赖框架的理由。若应用确实要求某两个贡献同时存在，可以做定点装配检查，但本文不选规则或格式。

## 6. 源码事实：初始化与清理的实际位置

| 生命周期 | 实际位置与限制 |
|---|---|
| 定义／安装扩展 | `defineExtension()` 返回对象；`install()` 验证并发布；没有扩展 `onLoad`／`setup` |
| 初始化应用资源 | 由宿主或普通工厂组织；不是 `Extension` 自动提供的协议 |
| 创建会话 | `HarnessOptions.conversationCreated` 在创建／fork 的事务中执行；便捷方法随后应用 `agent`，再执行该次 `init` |
| 初始化扩展文档 | document token 的 `initial` 与 `tx.doc()`；不是扩展安装 hook |
| 模型／工具／压缩阶段 | `GenerationHooks`、`ToolHooks`、`CompactionHooks` 及自定义任务 hooks；不是 APK 启停 hook |
| 替换／卸载扩展 | 只发布新 registry 状态；不执行 `dispose`，不跟踪旧代码的引用数，不自动取消旧执行 |
| 关闭 Harness | SDK 关闭会话／存储并等待调用退出；不是遍历扩展清理任意宿主资源 |
| UI 挂载／卸载 | 应用 React 宿主的生命周期；SDK `Extension` 不管理 |

SDK 规范明确：已开始的调用继续使用取得的代码；每个任务 phase 持有自己的 registry snapshot。卸载后立即释放旧调用使用的资源，可能使该调用失败。需要优雅释放的资源由其所有者管理；规范给出引用计数作为例子，不规定应用必须采用它。[S5]

`afterRun` 不是通用退出清理：它在成功回答／terminate 后安排持久任务，不在所有失败或 abort 后执行。自定义任务的 abort handler 也不是扩展卸载 hook。[S1]

**应用评估：**如果描述符需要通过工厂使用工具环境或模型配置 Module，应复用这些 Module 的 Interface；不要把它们变成可替换核心的插件依赖。确有资源时再明确谁创建、谁等待、谁释放，不为每个纯贡献预建一套启停状态机。

SDK 的 registry 确实支持运行中替换。这只是源码能力。随包扩展不隐含本应用 V1 支持运行时热重载、手机动态安装或无重启升级，本文不新增这些承诺。

## 7. UI 是否应放在 SDK `Extension` 外

### 源码事实

`Extension` 没有页面、路由、React renderer、UI 上下文或挂载／卸载字段。SDK 的 `sections` 是提示词，工具 `details` 是给 UI 使用的数据，不是可执行 UI 注册。[S1]

SDK 允许工具类型携带应用自有的可选 metadata；Harness 仍只依赖 `ToolRegistration`，生成模型工具声明时保留 Pi AI 的工具字段。这个通道不构成页面宿主，也不能自然表示没有工具的 UI-only 扩展。[S11]

### 应用推论与候选评估，不是选型

**在当前已定进程划分下，UI 注册应由应用 UI Interface 承接，不应伪装成 SDK 的标准字段。** 即使 TypeScript 结构类型允许对象带额外属性，Durable 也不会因此挂载 React UI。

一个应用描述符关联可选 UI 入口和可选 Agent 入口，可以只做以下薄组合：

- 关联同一随包能力的身份和两个构建入口。
- 在 WebView 一侧把真实 React 内容交给 UI 宿主，使用宿主共享的 React。
- 在运行宿主一侧把已有 `Extension` 或构造它的入口交给 SDK registry。
- 通过应用 Interface 注入当前会话、查询、订阅和必要动作能力。

这里的“Agent 入口”指产生 SDK `Extension` 的代码入口，**不是 SDK 的 `Agent` 类型**；后者是会话解析后的模型、工具与选择结果。[S1]

薄组合的合理性来自两个实际不同的宿主，而不是包装 SDK 字段本身。一个源码描述符也不能让 React 函数、SDK 闭包或运行时资源直接跨进程共享；构建必须让两侧只加载各自代码。描述符是单个文件、类型关联还是两个清单，仍未选择。

若应用层再次实现工具 schema、hooks dispatch、同名覆盖、任务迁移、Agent 选择、持久执行或第二个 registry，则是在重复 SDK。若额外引入通用依赖求解器、动态 loader、插件市场或全局 lifecycle manager，则超出当前任务。

因此，本轮只能判断“可选 UI＋Agent 的薄关联是可行候选”，不能判断“必须增加统一描述符”。

## 8. UI-only 如何调用现有核心查询

### 可核验的 SDK 事实

核心持有的 `Harness` 可以取得 `Conversation`；其 `entries()` 提供带 cursor 的历史分页，`watch()` 提供结构视图，`agent()` 查询当前解析后的配置。`Harness.inspect()`、`usage()` 和 Session 的文档读取／观察也是宿主侧能力。[S7–S8]

这些方法没有“调用者扩展名称”或“先安装一个 backend extension”的参数。它们不靠工具调用或模型回合工作。`Harness.conversation()` 只查会话是否存在并返回 handle；`Conversation.agent()` 在核心解析现有状态。[S7]

### 应用接线建议，不声称已经实现

```text
UI-only React 页面
  → 应用提供的查询／订阅客户端
  → 既定 UI 与运行宿主通信 Adapter（协议未选）
  → TypeScript 核心的会话／配置等 Interface
  → 已有 Harness／Conversation 或其他核心 Module
```

以 timeline 为例：UI 使用当前会话标识请求消息页，接收核心返回的稳定标识与分页信息，并订阅后续变化。核心复用 `entries()`／`watch()`；UI 在本地完成筛选与展示。定位已显示消息属于 UI 宿主能力，不必为了它注册 Agent 工具。

“已有查询”表示宿主将提供或已定义为职责的能力；当前项目仍在设计期，不能把这条路径写成已经交付的接口。

必要限制：

- UI-only 表示“不新增 Agent 侧贡献”，不表示“不使用后端”。没有 Agent 入口时，装配器可以完全不调用 `registry.install()`，无需空扩展占位。
- UI 使用受控应用 Interface，不直接获得 Harness、SDK 数据库、Termux 或通用 Kotlin 调用入口；核心核验调用上下文和目标会话。
- 订阅必须能取消；页面重建后重新获取状态。停止 UI 查询／订阅不等于停止 Agent 执行。
- watch 可见的部分进度可能尚未持久化；沿用 1.5.0 差异审计，不把 UI 已显示等同于已落盘。[S8]
- SDK registry 或 settings 变化不提交会话文档；展示解析后的工具／模型时，不能只等 conversation watch，核心需要适时重新调用 `agent()`。[S5]
- 如果所需信息尚未由核心提供，应讨论真实查询能力，而不是新增仅为转发查询的 backend 扩展。若确有新的 Agent 工具、提示词或持久任务，才使用对应 SDK 贡献。
- 常规模型配置查询只返回公开配置与凭据配置状态；不向 UI 广播原始 Key。YOLO 不取消系统授权、停止、省流或资源检查。

## 9. 给下一轮 Module 决策的事实边界

可以继续讨论：应用贡献的关联方式、UI 具体挂载位置、稳定标识、必要资源的所有者、装配错误如何报告，以及现有核心查询如何供 UI 使用。

不必重做：SDK Agent registry、工具／提示词组合、任务注册和恢复、Pi AI Provider 框架。不得重开 Q9—Q11 或真实 React／UI-only 等既定选择。

尚未验证：实际双侧构建与依赖隔离、Android 通信与重连、UI 分页和订阅性能、资源释放竞态。源码阅读不代替目标运行时验收。

## 10. 固定源码证据

以下链接全部固定到本轮指定提交；行号为实际读取文本的位置。没有跟随文档中的 `main` 链接。

- **[S1] 类型与 hooks：**[`harness/types.ts`：Extension／Registry／AgentState，L412–529](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L412-L529)；[Harness 选项与创建 hook，L684–709](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L684-L709)；[任务 hooks，L977–1079](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L977-L1079)。
- **[S2] registry 完整实现：**[`harness/registry.ts`，L1–114](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/registry.ts#L1-L114)。
- **[S3] 定义 helper：**[`harness/define.ts`，L14–61](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/define.ts#L14-L61)。
- **[S4] Harness 打开与会话初始化：**[`harness/harness.ts`，L583–611](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L583-L611)；[L428–459](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L428-L459)。
- **[S5] 组合、选择、顺序与生命周期：**[`harness/agent.ts`，L189–361](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/agent.ts#L189-L361)；[规范 L3180–3326](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L3180-L3326)；[替换、迁移与资源，L4345–4365](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4345-L4365)。
- **[S6] scheduler 订阅与 hook 分发：**[`scheduler.ts`，L433–439](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L433-L439)；[L2620–2644](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/scheduler.ts#L2620-L2644)。
- **[S7] 无扩展身份参数的核心读取：**[`harness/types.ts`，L803–947](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/types.ts#L803-L947)；[`harness.ts` 会话查找，L397–408](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L397-L408)；[agent 解析，L277–288](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/harness.ts#L277-L288)。
- **[S8] Session 文档观察、持久化与查询：**[`types.ts`，L1139–1300](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/types.ts#L1139-L1300)。
- **[S9] 现有 Chord registry Adapter：**[`harness/registry-reader.ts`，L1–34](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/src/harness/registry-reader.ts#L1-L34)。
- **[S10] 扩展状态例子与无 document 注册：**[`test/examples/10-extension-state.ts`，L21–64](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/test/examples/10-extension-state.ts#L21-L64)；[规范 L4360–4361](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L4360-L4361)。只读取例子，没有执行。
- **[S11] 工具 metadata 不等于 UI 注册：**[规范 L3160–3166](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/durable/docs/spec.md#L3160-L3166)。

补充交叉核对了固定提交的 `src/index.ts` 和 README 中 Extensions、Reload、Hooks、Watching a Conversation 章节。涉及精确组合规则时，以以上实现和对应规范为依据；README 的概述不覆盖 deferred 持久化例外。
