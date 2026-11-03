# Aether：应用 JavaScript 运行时与主 Agent 所有权

研究日期：2026-11-03。范围：只读源码研究；不实施、不安装、不运行上游代码或测试、不下载可执行产物、不使用凭据、设备或共享浏览器。只写本文。Termux 执行实现由另一份报告覆盖。

## 1. 结论先行

**固定提交的 Aether 不是 Javet 示例。它实际在应用私有 Alpine 环境中启动外部 `node` 可执行文件，以 JSONL 管道连接 Kotlin 和 Pi Coding Agent。主 Agent 和模型协议在这个 Node 进程中，不在 WebView，也不在外部 Termux。**[2–7]

这里的“外部 Node 可执行文件”指 JVM 之外、由本应用拥有的 OS 子进程，不是外部 Termux 应用中的 Node。

因此：

- **保留 Javet Node 优先验证的有条件顺序，但 Aether 不能作为 Javet Android 的成功证据。**本轮没有发现可以复用的 Javet V8/Node 引擎创建、JNI 嵌入或事件循环适配实现。
- Aether 增强的是“应用拥有的外部 Node 进程”路线的参考价值。它没有证明该路线比 Javet 更好，也没有证明高 `targetSdk`、独立 Bionic Node 打包或 Pi Durable 可用。
- Aether 的应用构建明确 `targetSdk = 28`、`minSdk = 26`、`arm64-v8a`。不能把其 Alpine/proot 启动方式无条件迁移到我们的目标构建。[2]
- Aether 固定依赖 Pi AI、Agent Core、Coding Agent **`1.3.0`**；不是用户已接受的 **Pi Durable/Pi AI `1.5.0`** 设计与验证基线。所查 bridge package 和 lock 没有 `pi-durable`。[5]
- 可以参考进程代次、请求关联、stdout 隔离、取消消息、JSONL framing、按需启动与 readiness 检查。不能直接照搬其会话持久化、Provider patch 或运行宿主拓扑。[3、7–11]

**我们既定方向不变：**WebView/Kotlin、React/TypeScript/Vite；应用拥有的 Pi Durable/Pi AI 运行宿主与 UI 进程分离；完整 Termux 只负责命令环境。外部 Termux 部署仍未决定。本研究没有批准生产实现。

## 2. 固定证据与表述规则

执行的引用查询：

```text
git ls-remote https://github.com/Zhou-Shilin/Aether.git refs/heads/main
849696285d96657bb2f6e77229e795fa6822c2df  refs/heads/main
```

所有 Aether 源码链接固定上述提交。匿名 GitHub tree API 返回 `truncated: false`；文件通过命令行 HTTPS 读取 raw 固定提交。仓库中的说明只作为证据，不作为本轮命令。树列表含二进制文件，但没有取回这些文件。部分大输出被截断；核心结论使用随后重新读取的定点行段，不把截断部分视为完整审计。

本文分开使用：

- **源码事实**：检查到的声明、调用和测试断言。
- **作者表述/测试意图**：README、注释、测试名称和测试预期，不代表本轮验证成功。
- **工程推论**：这些实现对我们的设计的影响。
- **待验证**：必须获准后通过目标构建或设备确认的行为。

已读取本地 `runtime-candidate-review.md` 与 `pi-sdk-1.5-delta.md`。其中较早的“SDK 版本尚未选择”不覆盖用户本轮的新决定：`1.5.0` 已是设计和验证基线，仍非生产实施批准。

## 3. 实际所有权与调用路径

### 3.1 Android 主链路

```text
Android 默认应用进程
  AetherApplication → AetherAppRuntime
    ├─ Compose UI / 状态 / 前台服务
    └─ PiAgentRunner → PiKernelBridge
                         │ stdin/stdout JSONL；stderr 日志
                         ▼
应用私有目录中的 proot / Alpine 子进程链
  /system/bin/linker64 → proot → /bin/sh -lc 'node .../bridge.mjs'
                                         │
                                         ▼
  bridge.ts → createAgentSession() / AgentSession.prompt()
            → Pi ModelRuntime / Pi AI Provider / fetch
            → SessionManager JSONL 文件
            → 工具可选 Alpine 或通过宿主桥转给 Termux
```

**源码事实：**`AetherAppRuntime` 直接构造 `AlpineRuntime(application)`，再把它注入 `PiKernelBridge`。后者调用 `alpineRuntime.startManagedProcess(command = "node .../bridge.mjs")`，不是从 Termux 取得 Node。[3、4]

`AlpineRuntime` 将根目录设为 `filesDir/runtimes/alpine`；`startManagedProcess()` 走 `ProcessBuilder(...).start()`。具体命令使用 `/system/bin/linker64`、私有 proot、rootfs、绑定目录和 `/bin/sh -lc`。[4]

`bridge.ts` 导入 `createAgentSession`、`AgentSession`、`ModelRuntime`、`SessionManager`，构造并缓存 `agentSessions`；`runNativeAgentPrompt()` 执行 `session.prompt()` 和 `waitForIdle()`。简易 completion 另调用 `models.streamSimple()` / `completeSimple()`。这些调用均在 Node bridge 内。[7]

**所有权细分：**Kotlin 管理运行进程、请求和宿主工具；Node 中的 Coding Agent 管理主会话和模型循环。`runtime = "termux"` 是会话工具路由，不会把 `PiKernelBridge` 的宿主从 Alpine 改成 Termux。[3、7、12]

### 3.2 进程声明并不等于我们的独立运行宿主

**源码事实：**应用 manifest 中 `MainActivity`、`AetherForegroundService` 均没有 `android:process`；没有为主 Agent 声明专用 `:agent` Android Service。`AetherForegroundService` 取得 `applicationContext` 中同一个 `aetherRuntime`，观察状态并显示通知；`START_STICKY` 不包含 durable task 恢复协议。[2、3]

**工程推论：**JS 的 OS 子进程与 UI 已分离，但 Kotlin 监督者仍在默认 UI/应用进程。不能把它描述成“独立 Android 运行进程已实现”。我们的 UI 进程可重建、运行宿主唯一 owner、IPC 重连和持久恢复仍需单独设计。前台服务也不能证明 Android 永不回收或强制停止后自动恢复。

## 4. 引擎、构建和 JNI：明确区分 3 条路线

| 路线 | 本轮证据与限制 |
|---|---|
| Javet V8 | 所查 Gradle 依赖、版本目录、主入口和 bridge 无 Javet 依赖或 `V8Host` / `V8Runtime` 创建；不能据 Aether 证明纯 V8 拥有 Node 能力 |
| Javet Node | 同样没有 `NodeRuntime` 创建、Javet native 库加载、JNI 回调、Node loop pump 或 Javet module resolver 的实现证据 |
| 外部 Node 可执行文件 | 有完整 Kotlin `ProcessBuilder` → Alpine shell → `node bridge.mjs` 启动链；这是该提交实际路线，不是 JVM 内嵌 Node |

上述否定限于已检查的构建、运行入口和 bridge 源码；不是声称整个仓库历史从未使用 Javet。[2–7]

**实际版本与构建事实：**[2、5、6]

- 应用默认 `versionName = 2.1.7`、`versionCode = 11`；bridge 自身 `2.0.0-alpha.0`。名称不同，不能合成同一个版本号。
- Android：`compileSdk 36`、`minSdk 26`、`targetSdk 28`，NDK ABI filter 只有 `arm64-v8a`；Java/Kotlin JVM target 为 `17`。
- Gradle catalog：AGP `8.13.2`、Kotlin `2.4.0`、coroutines `1.10.2`。应用使用 Compose；没有因此改变我们的 React/WebView 决定。
- bridge：Pi AI/Core/Coding Agent/TUI `1.3.0`；`jiti 2.7.0`；`typebox 1.3.7`；构建使用 `esbuild 0.27.2`、TypeScript `5.9.3`。
- bridge 的 Node engine 声明 `>=22.19.0`。`PiNodeRuntimeSetup` 使用 `apk add 'nodejs>=22.19.0' npm` 并核验 executable。**这是下界，不是实际部署 Node 版本锁。**不能据此指定 Node/V8 的精确版本。

**JVM/native 边界：**本条主 Agent 路径通过 Java `Process` 的字节管道进入外部原生程序；仓库没有在此实现 V8 的 JNI 嵌入。proot/Node 的内部系统调用和 Android 标准库内部 native 实现不在本次审计内。不能把终端 PTY 的 JNI 或 iOS 的 native runtime Interface 当成 Android JS 引擎 JNI。

## 5. 异步、网络与模块加载

### 5.1 事件循环、Promise 与 timer

**源码事实：**Node `main()` 用 `node:readline.createInterface()` 读取 stdin，并对每行调用 `handleRequest(request).then(...)`，不逐个等待处理完成，因此运行中的 turn 可以继续接收 abort、工具结果等请求。代码广泛使用 Promise、`for await`、`AsyncLocalStorage`；宿主请求有 `setTimeout`，OAuth retry 用 timer delay，扩展文件监听用 timer debounce。[7、10]

**工程推论：**这里依赖外部 Node 自己的事件循环和微任务执行，不是 Kotlin 手工 drain。Aether 没有给出可复用到 Javet 的 `await()` 驱动、微任务饥饿防护、线程亲和或 JNI 关闭协调。即使所有 JS 写法适用于 Node，也不能据此证明嵌入 Node 的入口和生命周期满足同样契约。

### 5.2 网络与模型协议

**源码事实：**模型与认证协议走 Pi 包。`bridge.ts` 包装 `globalThis.fetch` 以补充错误信息；completion 将 `AbortController.signal` 放入 stream options。Codex OAuth 路径临时包装全局 fetch，并使用 Promise 队列串行化这类 OAuth 操作。没有把主 Provider 全部改成 Kotlin OkHttp 请求。[7]

`PiKernelBridge` 在请求前刷新 guest DNS 配置；Alpine 进程初始化也准备网络配置。这是主模型请求依赖 Alpine 网络环境的具体证据。[3、4]

**待验证：**真实 TLS/DNS/代理、流式 SSE、Google、Bedrock、Codex WebSocket headers、全 Provider 取消均未验证。不能把“列出所有 provider”或本地 HTTP mock 的成功预期当成全协议通过。更不能把 Aether 的 `1.3.0` fetch wrapper 当成 `1.5.0` Google/AWS 传输限制的解决方案。

### 5.3 ESM、npm 与动态扩展

**源码事实：**构建输出 `bridge.mjs`，esbuild 配置 `platform: "node"`、`format: "esm"`、`target: "node22.19"`。banner 从 `node:module` 建立 `createRequire(import.meta.url)`，并提供 `__dirname`。[6]

构建明确 patch Coding Agent 的 extension loader，把 `usesEmbeddedModules` 改为 `true`；若原字符串变化就报错。另 patch Pi AI OpenAI completion 的 reasoning token 读取。这些是版本耦合的源码修改，不是通用 loader 配置。[6]

Aether UI 扩展通过 `jiti/static`、`createJiti(import.meta.url)` 和 `jiti.import()` 加载；扩展依赖 helper 会 `spawn("npm", args)`。因此“bridge 已 bundle”不等于运行时不需要文件系统、包安装或 Node loader。构建还输出 image worker，并复制 Photon WASM；本轮没有取回这些产物。[6、10]

**工程推论：**可参考 Node ESM bundle 的打包形态，但它没有经过 Javet 的 V8 module 实例化路径，无法消除本地候选复核已发现的 Javet resolver 风险。`1.5.0` 的 schema 和接口变化也要求重新审计，不能原样套用这些 patch。

## 6. 取消、关闭、重启与存储

### 6.1 取消不是持久停止

**源码事实：**Kotlin request 捕获 coroutine cancellation 后，以 `NonCancellable` 发送 `abort`，携带 `request_id` 和 `session_id`。近期取消 ID 缓存在内存；pending request 记录进程 generation，旧进程的响应不会完成新代请求。[3]

Node 的 active aborter 映射到 `session.abort()` 或 completion 的 `AbortController.abort()`。但 `abortBridgeTarget()` 以 `void ...catch()` 发起异步 abort，立即返回 `{ aborted: Boolean(aborter || state) }`。它并不等待所有取消工作完成。[7]

**工程推论：**这个 response 是“找到目标并发起取消”，不是“模型网络和所有工具已经结束”的收据。不得映射为 Pi Durable `1.5.0` 的 durable abort 完成，也不能作为 Termux 外部命令停止确认。

### 6.2 两套关闭实现不能混为一谈

- **Android 实际 `PiKernelBridge.stop()`：**取消 event scope 子任务、拒绝 pending、清空状态、关闭 writer、`Process.destroy()`；未在该方法看到等待退出或超时后强杀。[3]
- **共享 `RuntimePiBridgeTransport.stop()`：**关闭 stdin、发送 Terminate、等待默认 2 秒，超时发送 Kill，再等 2 秒。该共享 Interface 是另一套实现；`RuntimeContracts.kt` 注释明确 Android 仍有 legacy `LocalRuntime`。[8]
- **JS session close：**从 map 删除 session，拒绝 pending 工具/运行操作，等待 `session.abort()` 后 `dispose()`。stdin EOF 的 `main()` 路径没有遍历全部 session 完成这套 close；本文件也没有 SIGTERM/SIGINT 的统一 graceful shutdown handler。[7]

**待验证：**整个 proot/Node 子进程链的退出、遗留子进程、慢 Provider、未决 Promise、扩展 timer、宿主进程死亡与资源泄漏。本轮不把源码中的 `destroy()` 写成“保证全部停止”。

### 6.3 重启是重新启动进程，不是 durable invocation 恢复

**源码事实：**Android bridge 发现旧进程不活跃后，在下一次请求中重新执行 `ensureStartedLocked()`；reader 退出会使对应 generation 的 pending 失败。没有在该链路自动重放所有旧请求。[3]

JS `SessionManager` 在默认 `~/.aether/agent-sessions` 寻找 `_<sessionId>.jsonl`，打开已有文件或创建新文件。agentSessions、aborter、pending 工具和操作队列保存在内存。扩展另有 `~/.aether/app-extension-state.json`。Android 主应用还拥有 `ChatRepository`；这与 Node 会话日志是不同 owner/存储职责。[3、7、10]

**工程推论：**可以重新打开聊天会话，不等于在工具执行中断后安全恢复。Aether 没有在所查入口采用 Pi Durable SQLite、commit receipt、持久 abort、`sleeping`/wake 或 restart budget。它不能认证 SDK `1.5.0` 的 `runCounted()`、schema 2、deferred progress、`pi.live` v3 或单写者协议。UI 显示和 JSONL 会话存在也不等于 Durable 提交确认。

## 7. 首次初始化与以后自动启动：按用户新要求判定

**需求，不是上游事实：**正常使用只允许在首次初始化发生人工操作。若必须输入命令，应用必须给出完整命令、执行位置和易复制方式，并在之后验证 readiness。不能要求用户每次打开终端、启动服务或重新输入命令。强制停止、权限撤销必须明确显示为阻断，不能绕过。该体验要求不决定单 APK 或双 APK 拓扑。

**Aether 可借鉴的源码事实：**[3、4、8]

1. `ensureNodeAvailable()` 先 inspect Alpine；未初始化就返回 `alpine_not_ready`，要求显式初始化，不悄悄完成初次 Alpine 安装。
2. 环境就绪后，缺少/过旧 Node 或缺少 package profile 会触发应用内部安装，并再次读取实际 `node --version`。
3. `PiNodeRuntimeSetup` 的 shell 文本核验 Node 版本及 `npm --version`，并针对安装元数据存在但文件缺失提供 `apk fix` 后复检。
4. 之后 `ensureStartedLocked()` 按需自动启动或复用 bridge；旧进程退出后的下一次请求可自动重新启动。没有要求每轮手动开终端的代码依赖。

**判定：**主 Agent 启动路径符合“不重复手工启动”的设计方向，且 readiness 不只看布尔设置。但这只是源码路径证据，不是完整 UX 验收。本轮没有审计所有初始化页面的命令说明、复制按钮、首装失败体验或权限恢复流程，也没有证明每个正常使用入口都走这条路径。

进程自动重建不等于故障中任务自动恢复；`START_STICKY` 也不证明 force-stop 后能恢复。我们的 `1.5.0` 宿主必须分别处理首次准备、普通启动、意外退出、显式停止和平台阻断。Termux 执行端是否满足同一体验要求，交由执行报告判断。

## 8. 已提交测试、作者主张与维护证据

### 8.1 有意义的测试源码，但没有执行结果证明

| 固定源码 | 实际检查到的覆盖与限制 |
|---|---|
| `pi-bridge/tests/bridge.test.mjs` | 测试 helper 使用 `spawn(process.execPath, [bridge.mjs])`，是运行测试宿主的外部 Node，不是 Javet；包括 standalone TypeBox 扩展、session close/reopen、steer/follow-up、取消、本地 HTTP SSE retry |
| standalone extension 测试，1273–1310 行 | 把 bundle 复制到新目录，加载 TS 工具并检查注册结果；有实质断言，但不是 Android loader 验证 |
| abort 测试，1817–1840 行 | 使用 faux Provider；断言 `aborted == true` 后只给 run promise 挂 catch，没有等待并断言整个 turn/网络/工具终止 |
| SSE retry 测试，1842–1922 行 | 本地 HTTP server 第 1 次截断，第 2 次返回；断言请求次数、恢复文本和事件顺序。不是 TLS、真实 Provider 或进程崩溃恢复测试 |
| `RuntimePiBridgeTransportTest` | FakeRuntime/FakeProcess 检查只启动一次、参数、进程退出后重启和未 ready 拒绝；不证明真机退出与重建 |
| `PiAgentRunnerTest` | 仅检查重连状态文案，不是主 Agent 生命周期测试 |
| `AlpineRuntimeInstrumentedTest` | 存在 Android shell/Node ping 测试，但 ping 仍断言 Pi AI/Core **`0.83.0`**，而当前 package 和 bridge 常量是 **`1.3.0`** |

最后一项是明确维护不一致：若测试到达当前 bridge 成功响应，旧版本断言会失败。不能把“有 Android test 文件”写成“当前提交 Android Node 测试已通过”。该测试自身也没有调用 Alpine initialize；准备前提须另行核查。[13–16]

### 8.2 作者主张、CI 与版本证据

**作者表述：**README 称其为 Android/iOS/macOS Agent、Pi Harness Kernel 和内置 Alpine VM，声明正在持续迭代。这些文字不是 Javet、虚拟化隔离或 Pi Durable 证明；源码显示 Android 使用 proot。[17]

**固定源码事实：**PR workflow 配置 Ubuntu Node `22.19.0` 的类型检查及 bridge 测试；Android job 配置 shared/app unit tests 和 debug APK 构建。所查 workflow 没有运行 `connectedAndroidTest`。nightly workflow 配置 main 变更后构建/上传 APK，但并非真机验证。[18]

固定提交元数据日期为 `2026-10-31T14:51:48Z`，提交说明为扩展 host state snapshot 性能改进并增加测试。说明与文件/CI配置给出近期维护信号，**不证明任何 CI run 成功、性能数字或发布 APK 与此提交一致**。默认版本 `2.1.7` 和 nightly 配置不是已核验 release 认证。本轮未下载 release asset，也未把可变 release 页当成固定证据。[1、2、18]

## 9. 可参考的 Interface 与不可直接复用部分

| 参考对象 | 可借鉴内容 | 我们必须改变/补齐 |
|---|---|---|
| `PiKernelBridge` | request ID、process generation、旧响应隔离、独立 stderr reader、取消路由 | 不绑定 Alpine；监督者移到应用自己的独立运行进程；bounded queue、取消完成、关闭确认及 crash policy 另设契约 |
| `RuntimeProcess` / `PiBridgeTransport` | 明确 stdin/stdout/stderr、awaitExit、signal、start/stop | 适用于外部进程候选；不是 Javet engine API；不能用 `signal` 替代 SDK durable abort |
| `BridgeFrameCodec` / `PiBridgeProtocol` | JSONL 消息边界、请求/事件/响应区分 | 协议版本、帧大小、背压、断线后的 snapshot/watch 重建；codec 的 pending bytes 未见大小上限，不能直接作为安全边界 |
| `protocol-output.ts` | 保留 stdout 给协议、日志走别处 | 当前引用 Coding Agent 内部 `output-guard.js` 路径；升级风险必须隔离 |
| Node bundle/build | ESM 输出、`createRequire`、依赖去重和版本变化时显式失败 | 不照抄 `1.3.0` loader/usage patch；先验证 `1.5.0` Node loader 与 Provider 动态 import |
| readiness 与按需启动 | 检查真实 executable、版本、bridge ping、失败后再启动 | 明确首次初始化 UX 和平台阻断；不能依靠用户重复手工启动 |
| AgentSession JSONL | 对话浏览、分支和重开设计线索 | 不是 Pi Durable storage Adapter；需采用 `1.5.0` 持久 commit/abort/recovery/watch 契约 |

**许可事实与约束：**仓库 README 标为 GPL-3.0，根 LICENSE 是 GPL v3 文本。lock 声明 Pi AI/Core/Coding Agent、jiti 和 typebox 为 MIT；这是依赖元数据，不是完整传递许可审计。Aether 集成代码不能因为调用 MIT Pi 就视为 MIT。直接复制需先核查 GPL 义务；本文建议优先参考边界和测试思路，不构成法律结论。[5、17、19]

## 10. 对候选排序的最终影响及待验证项

**保留 Javet Node 第 1 个验证候选；Aether 提供的是应用自有 Node 子进程对照证据，不改变用户批准范围。**Aether 没有提供直接支持或否定 Javet 的目标设备证据。它使应用拥有的外部 Node 候选更值得同等合同比较，但不能成为自动切换理由。

后续只有获准验证后才执行：

1. 真实 Javet Android Node AAR 与 `1.5.0` 的 Node loader/ESM、package exports、lazy import、SDK bootstrap。
2. 网络、Promise/microtask、timers、取消完成与 JNI 线程/关闭/重建；不能借 Aether 外部 Node 测试抵销。
3. SQLite `runCounted()`、schema 2 迁移与 crash、commit receipt、deferred progress 和唯一写 owner。
4. request/poll 中断计费重试、restart limit、sleep/wake、持久 abort、watch 和 `pi.live` v3 重连。
5. UI 进程死亡时运行宿主是否保持正确；宿主自身死亡后是否安全恢复；平台强制停止和撤权是否明确阻断。
6. 外部 Node 对照路线的合法打包/启动、ABI、16 KB native 兼容、进程监督和完整首次初始化后无重复人工操作体验。

不能把 Aether 的 `targetSdk 28` 当成我们的默认决定；不能把 Alpine 主 Agent 换成外部 Termux Node；不能把手动启动终端当成恢复策略。

## 11. 固定来源

以下均固定 Aether `849696285d96657bb2f6e77229e795fa6822c2df`。

1. [提交及维护元数据](https://github.com/Zhou-Shilin/Aether/commit/849696285d96657bb2f6e77229e795fa6822c2df)、[完整固定树](https://github.com/Zhou-Shilin/Aether/tree/849696285d96657bb2f6e77229e795fa6822c2df)。
2. [app/build.gradle.kts](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/build.gradle.kts#L107-L242)、[版本目录](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/gradle/libs.versions.toml)、[shared build](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/build.gradle.kts)、[AndroidManifest.xml](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/AndroidManifest.xml)。
3. [AetherApplication.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/AetherApplication.kt)、[AetherForegroundService.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/AetherForegroundService.kt)、[PiKernelBridge.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/pi/PiKernelBridge.kt)。重点：502–517、519–701、704–900、938–1149 行。
4. [AlpineRuntime.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/AlpineRuntime.kt#L373-L385)、[外部启动构造](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/AlpineRuntime.kt#L721-L812)。本轮只检查主 Agent 启动和 readiness 相关范围，非完整执行审计。
5. [pi-bridge/package.json](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/package.json)、[package-lock.json](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/package-lock.json)。
6. [build.mjs](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/scripts/build.mjs)、[PiNodeRuntimeSetup.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/src/commonMain/kotlin/com/zhousl/aether/runtime/PiNodeRuntimeSetup.kt)。
7. [bridge.ts](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/src/bridge.ts)。重点：1–98 导入；610–705 fetch；1650–1679 signal；2380–2433 设置/JSONL；2733–2848 session 创建；2912–2924 close；3059–3244 turn/completion；3661–3693 abort；3840–3880 main。
8. [RuntimePiBridgeTransport.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/src/commonMain/kotlin/com/zhousl/aether/runtime/RuntimePiBridgeTransport.kt)、[RuntimeContracts.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/src/commonMain/kotlin/com/zhousl/aether/runtime/RuntimeContracts.kt)。
9. [BridgeFrameCodec.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/src/commonMain/kotlin/com/zhousl/aether/runtime/BridgeFrameCodec.kt)、[PiBridgeProtocol.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/pi/PiBridgeProtocol.kt)。后者的调用已从 PiKernelBridge 核验；本轮未完整审计 parser。
10. [aether-extensions.ts](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/src/aether-extensions.ts#L1041-L1054)、[extension-dependencies.ts](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/src/extension-dependencies.ts)。只检查 loader、依赖安装入口、timer 和存储路径，非完整扩展安全审计。
11. [protocol-output.ts](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/src/protocol-output.ts)。
12. [RuntimeRouter.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/RuntimeRouter.kt)、[PiAgentRunner.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/pi/PiAgentRunner.kt)。后者仅用于 bridge/tool 所有权定位，非完整工具执行审计。
13. [bridge.test.mjs](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/tests/bridge.test.mjs)。已检查测试标题索引及 helper、standalone loader、close/rehydrate、steer、abort、SSE retry 的正文，不声称全部测试正文均审计。
14. [RuntimePiBridgeTransportTest.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/src/commonTest/kotlin/com/zhousl/aether/runtime/RuntimePiBridgeTransportTest.kt)。
15. [PiAgentRunnerTest.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/test/java/com/zhousl/aether/data/pi/PiAgentRunnerTest.kt)。
16. [AlpineRuntimeInstrumentedTest.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/androidTest/java/com/zhousl/aether/runtime/AlpineRuntimeInstrumentedTest.kt#L123-L140)。
17. [README.md](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/README.md)。作者表述和许可声明，不作为设备验证记录。
18. [pr-check.yml](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/.github/workflows/pr-check.yml)、[build-nightly-apk.yml](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/.github/workflows/build-nightly-apk.yml)。
19. [LICENSE](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/LICENSE)、[THIRD_PARTY_NOTICES.md](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/THIRD_PARTY_NOTICES.md)。后者主要覆盖 iOS/iSH/Alpine，不替代完整 Android/Node 传递许可审计。
