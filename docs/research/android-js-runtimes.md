# Android 应用内 JavaScript 运行时研究

研究日期：2026-11-03。状态：研究完成，未选型，未实施。

## 1. 答案先行

**先验证 `Javet` 的 Android Node 模式。保留独立 `Hermes` 和 `QuickJS` 作为非 Node 候选。**

这不是最终选择。排序依据是现有 Android 交付物、宿主集成成本和 SDK 适配风险。

关键发现：

1. `Javet 6.0.3` 确实发布 Android Node AAR。构建脚本固定 `Node 26.13.0`，不是桌面 Node 的推断。`5.0.11` 固定 `Node 24.19.0`。两者均满足 SDK 的 `>=22.19.0` 版本条件。[J1][J2]
2. 社区 `nodejs-mobile` 已发布 Android 包的核验版本是 `18.20.4`。`update22-9-0` 分支仍是 `22.9.0`。两者都低于该条件。16 KB 修复没有升级 Node。[M1][M2][M3]
3. `Hermes` 可以作为非 UI 引擎运行。选择它**不要求把 WebView UI 改成 React Native**。但引擎没有自动提供 React Native 的网络、定时器和平台绑定。[H1][H2]
4. `Cash App Zipline 1.28.0` 提供维护中的 Android QuickJS 绑定。其嵌入引擎版本文件仍为 `2021-03-27`。有 16 KB 链接设置，但现有 JNI API 不等于可直接运行 npm SDK。[Q1][Q2]
5. 所有候选都没有在本项目中通过 SDK、流式模型请求或自动恢复验收。源码中的页对齐设置也不是最终 APK 的 16 KB 验收结果。

固定约束保持不变：`WebView + Kotlin`、`TypeScript + React + Vite`、独立运行宿主进程、应用内 `Pi Durable` 与 `Pi AI`、完整 Termux 命令环境。本报告不选择 `targetSdk`、Termux 部署、IPC 协议或存储布局。

## 2. 方法与证据边界

已完整阅读 `docs/requirements-v1.md` 和 `docs/technical-design.md`。本次只写本文。

- 使用命令行 HTTP 读取官方源码、构建脚本、Maven POM、发布目录和官方文档。
- 使用 `git ls-remote` 固定分支提交。没有克隆、安装或执行上游代码。
- 没有下载 AAR、SO、APK 或其他可执行交付物。没有使用设备、凭据或共享浏览器。
- GitHub REST API 返回匿名限流 `403`。改用公开源码、Git HTTP 引用和发布页面。
- **源码事实**：直接来自所列文件或发布元数据。
- **推断**：根据源码提出的集成方式或风险，不是已运行结果。
- **待验证**：需要构建、二进制检查、模拟器或真机的事实。

本文用中文短句表达。每项要求使用“必须”。每项能力使用“可以”。标识符保持原样。

### 核验版本与维护记录

| 项目 | 固定版本或提交 | 本次维护证据 | 证据限制 |
|---|---|---|---|
| 官方 Node | `v22.19.0`；补查 `v26.13.0` | 有嵌入 API、Android 配置源码 | Android 在 `v22.19.0` 明确不是受支持平台 |
| 社区 `nodejs-mobile` | `v18.20.4`；`d9552e0e01ed5bdbe12a31d1ce6c0877a4f39580` | 2025-11-13 提交加入 16 KB 构建参数 | 主分支仍为 Node `18.20.4`；不能据此称为持续跟随 Node 安全更新 |
| 16 KB 分支 | `ff4e063f1f1911047c067335ad0a3d81336236ca` | 2025-11-17 发布准备提交 | 没有核实对应新发布二进制 |
| Node 22 分支 | `106c51f95d55d1010de56a2ffd09bfb4ba819a47` | `src/node_version.h` 为 `22.9.0` | 分支存在不是可用交付物证明 |
| `Javet` | `6.0.3` = `5d51b4eb0bfd4869436c906ce0748b325f445959`；另查 `5.0.11` | `6.0.3` 于 2026-11-02 发布；发布记录含 Node 关闭、JNI 泄漏修复 | Android 构建流程存在，不等于每个 Android 测试已通过 |
| `Hermes` | RN `v0.82.1` 固定 `265ef62ff3eb7289d17e366664ac0da82303e101` | Android AAR 日期为 2025-10-20；另查主线 `2f82501597d8659df644b547ffa89931f4d80092`，2026-11-02 仍有 Android Intl 修改 | 旧 AAR 与最新主线不能混用版本结论 |
| `Zipline` | `1.28.0`；主线 `67c0c92d8c9e2a833566fd7d5dbbc7a21f502cb1` | 2026-09-29 发布；Android 构建与 JNI 源码存在 | 绑定维护活跃不代表内嵌 QuickJS 已更新到同期上游 |

维护日期来自提交、发布目录或 changelog。[M3][J1][H3][Q1] 它们不是长期维护承诺。

## 3. SDK 版本条件怎样使用

本机以下文件均声明版本 `1.3.0`，以及 `engines.node: >=22.19.0`：

- `D:\Code\pi-pocket\node_modules\@earendil-works\pi-durable\package.json`
- `D:\Code\pi-pocket\node_modules\@earendil-works\pi-ai\package.json`

**Node 路线必须区分版本符合和行为符合。** `26.13.0` 或 `24.19.0` 满足版本范围，不证明 Android 构建启用了全部所需模块。仍须检查 ESM、`node:sqlite`、网络和文件 Adapter。

**非 Node 路线不能仅凭 `engines.node` 排除。** Durable 有 `/env`、`/storage/sqlite` 和 `/storage/jsonl` 等独立入口。非 Node 引擎必须使用可移植导入图，并提供实际宿主能力。不能用假的 `process.version` 解决兼容问题。

本报告不重复完整 SDK 导入审计。Provider、存储事务、扩展和图像依赖的最终清单由 SDK 专项研究确定。

## 4. Node 路线

### 4.1 官方 Node：有嵌入 API，没有对应的官方 Android 发行包保证

**源码事实：** `v22.19.0/BUILDING.md` 明确写明 Android 不受支持，当前 CI 没有 Android 测试。`android_configure.py` 拒绝 API 小于 `24`。脚本接受 `arm`、`arm64/aarch64`、`x86`、`x86_64`，但这不是全部架构都构建成功的证明。[N1]

官方 `v22.19.0/SHASUMS256.txt` 列出桌面平台、源代码和头文件，没有 Android 包。不能把 `linux-arm64` 包当成 Android `arm64-v8a` 包。[N2]

**嵌入接口是真实存在的。** 官方示例使用：

- 进程级 `InitializeOncePerProcess()`。
- `MultiIsolatePlatform`、`CommonEnvironmentSetup` 和 `LoadEnvironment()`。
- 每个 `Environment` 对应 1 个 `Isolate` 和 1 个 `uv_loop_t`。
- `SpinEventLoop()` 驱动事件循环。
- `node::Stop()` 停止运行。官方说明它可以跨线程调用。
- 最后释放 isolate、平台和进程级状态。[N3]

**推断：** 可以把 JNI 封装放进本应用的 Service 运行进程。专用线程运行 Node，不需要本地 HTTP 后端。宿主必须管理线程进入、请求队列、错误边界和资源释放。

另一种方式是本应用拥有的 Node 子进程。它仍可以符合“主 Agent 属于应用”约束，但必须解决合法的可执行打包位置、依赖、进程监督和 IPC。直接执行的候选须适配 Android 的 ABI、链接和系统调用条件；Android/Bionic 构建是一条路线，不是所有子进程方案的唯一前提。后续 [Aether 研究](aether-runtime-reference.md)还找到应用私有 PRoot／Alpine 中运行 Node 的源码先例，它另需用户态环境、包来源和生命周期验证。不能从外部 Termux 借用 Node 来代替这些验证，也不能从可写目录直接启动的假设推导 `targetSdk`。[A2]

**维护成本：** 官方嵌入 C++ API 允许在大版本发生不遵循普通弃用流程的破坏性修改。[N3] 自维护 Android Node 发行物必须承担补丁、构建、ABI 和安全更新。优先验证已有 Android JNI 发行项目更合理。

### 4.2 `nodejs-mobile`：真正能嵌入，但当前核验版本不满足直接 Node 路线条件

社区项目的 `v18.20.4` 发布目录确实有 `nodejs-mobile-v18.20.4-android.zip`。[M1]

构建脚本产生 `libnode.so`。默认构建 `armeabi-v7a`、`arm64-v8a`、`x86_64`。`x86` 在默认脚本中被注释掉。发布版本 CI 使用 NDK `r24`，API `24`。配置脚本还明确设置 `--shared`、`--with-intl=none`。[M2]

重要差异：`doc_mobile/BUILDING.md` 有 API `23` 示例，但配置源码拒绝小于 `24`。必须以所选构建和二进制为准。CI 变量叫 `ANDROID_TARGET_SDK_VERSION`，这里用于本机编译 API，不是产品 Manifest 的 `targetSdk`。[M2]

旧官方示例通过 JNI 调用 `node::Start(argc, argv)`。它还把标准输出接到 Android 日志。示例证明原生集成，不证明完整的关闭、重启、取消和 JNI 资源管理已经合格。[M4]

项目 FAQ 要求进程内使用单个运行实例，并在独立线程运行。多个会话可以共用该实例，不能把“每个会话新建 1 个 Node”当成受支持设计。事件循环与 WebView 无关。[M4]

#### 分支与变体的否定结果

| 项目或分支 | 直接核验结果 | 结论 |
|---|---|---|
| 社区发布 `v18.20.4` | Node `18.20.4`，模块 ABI `108` | 低于 SDK Node 条件 |
| 社区 `update22-9-0` | Node `22.9.0`，模块 ABI `127` | 仍低于 `22.19.0`；没有核实对应发布包 |
| 社区 16 KB 修复分支 | Node 保持 `18.20.4` | 页对齐修复不是 Node 升级 |
| `JaneaSystems/nodejs-mobile` | `d7750834d9b2abf9df7a9149aa511c1cad8fffca` 为 `12.19.0` | 历史来源，不是满足当前 SDK 的交付方案 |
| `1Conan/nodejs-mobile` | `ff0708fb693f431e95714778fd9fd92c60b62a38` 为 `18.20.2`；所查发布以 iOS 为主 | 没有建立满足条件的 Android 交付证据 |

以上是本次检查范围，不是宣称所有网络上的 fork 都不存在新版。[M5]

16 KB 修复在构建 workflow 中加入 `LDFLAGS: -Wl,-z,max-page-size=16384`。`v18.20.4` 原始发布 workflow 没有这一行。修复分支 changelog 保留了不一致的旧日期，不能把它当成 2024 年已发布 16 KB 包的证据。[M3]

**建议：** 不以降级 SDK、忽略 `engines` 或减少能力来迁就旧 Node。保留其 JNI 和打包方式作为参考。若后续发现新发行物，重新检查版本和构建链。

### 4.3 `Javet`：当前最值得先验证的嵌入 Node 交付方式

这不是“Java 能调用桌面 V8”的泛泛候选。Maven Central 公开列出：

- `com.caoccao.javet:javet-node-android:6.0.3`，AAR `74,172,483` 字节。
- `com.caoccao.javet:javet-node-android:5.0.11`，AAR `63,047,970` 字节。
- 另有 `-i18n` 变体。[J1][J2]

这些是发布归档大小，不是单 ABI APK 增量或运行内存。

**版本交叉核验：** `6.0.3` 的 Android workflow checkout `Node v26.13.0`，应用补丁，再构建 JNI。Node 自己的 `src/node_version.h` 也声明 `26.13.0`。`5.0.11` 的 workflow 固定 `24.19.0`。[J2]

必须诚实区分：这是“源码配置与发布物存在”的证据。本轮没有读取 AAR 内部 ELF，也没有执行 `process.versions`，因此不声称完成了发布二进制内容认证。

**Android 约束：**

- Node workflow 只发布 `arm64-v8a` 和 `x86_64`。不能把 README 的 4 架构总表套给 Node 模式。
- Node 编译 API 为 `24`。Android library 源码 `minSdk = 24`。
- `6.0.3` 使用 NDK `r29`。`5.0.11` 使用 `r27d`。
- `6.0.3/cpp/cmake/platforms/Android.cmake` 在 Node 和 V8 链接路径都设置 `-Wl,-z,max-page-size=16384`。
- 文档称从 `4.1.4` 支持 16 KB。这有构建参数佐证，但仍需最终 ELF 和 APK 检查。[J2][J3]

**JNI 与事件循环：**

`V8Runtime.await()` 进入原生 `Await()`。Node 模式调用 `uv_run()`，再执行平台 `DrainTasks()`。`RunOnce` 和 `RunTillNoMoreTasks` 使用 `UV_RUN_ONCE`。无等待模式使用 `UV_RUN_NOWAIT`。[J4]

因此，Java 的方法名不是完整调度策略。活跃连接可以使“运行到没有任务”长时间不返回。宿主必须避免阻塞 Service 主线程。必须选择等待策略，并验证取消命令能及时到达。

关闭路径使用 `SpinEventLoop()`、`node::Stop()`、资源释放和 libuv 关闭。`6.0.3` 还处理了 `FinalizationRegistry` 清理时的退出崩溃。此前发布包含 JNI 引用、事件循环和 isolate 关闭修复。[J4][J5]

这些修复体现真实维护，也说明关闭流程不是可忽略的边角问题。必须测试“有网络请求时关闭”“取消后重建”“旧回调到达已销毁运行时”。

**模块兼容边界：** Javet 有自己的模块执行与解析接口。存在 Node 模式，不保证任意入口都沿用 Node ESM 解析。发布记录已增加 `builtInModuleResolution`。必须对实际打包入口检查静态 `import`、动态 `import()`、`import.meta`、相对路径和 Node 内置模块。[J5]

**推断：** Kotlin 可以通过 Java API 持有运行时。把它放入已确定的独立 Service 进程，不需要 RN，也不需要更换 WebView。用 Pi 的环境和工具 Adapter 接 Termux，不把 Javet 的 `child_process` 当作完整命令环境。

### 4.4 Node 的流式 HTTP、WebSocket 和取消

源码不是只有 API 名称。Node bootstrap 暴露 `fetch`、`Response`、`WebSocket`、`AbortController`、`TextDecoder` 和 Web Streams。`fetch` 转到内嵌 Undici。Undici 源码注册 `AbortSignal` 监听，并在取消时销毁连接。[N4]

这使现代嵌入 Node 比裸引擎少一大块网络适配。但仍有 4 个门槛：

1. Android 构建必须实际启用所需功能。不能只看桌面全局对象列表。
2. Provider 可能使用 Node 的 `ws` 风格接口或自定义头。标准 `WebSocket` 对象不自动等价。
3. TLS 根证书、系统代理、DNS、网络切换和 Android 网络安全配置必须单独验证。不能假定 Node 与 Kotlin 网络栈行为一致。
4. `AbortController.abort()` 是请求取消。`node::Stop()` 是整个环境停止。用户停止单个会话时，不能默认终止全部会话。

## 5. `Hermes`：独立后台引擎，不是 UI 框架决定

### 5.1 交付物与宿主入口

React Native `v0.82.1` 的 `.hermesversion` 固定到 `265ef62ff3eb7289d17e366664ac0da82303e101`。Maven 有 `com.facebook.react:hermes-android:0.82.1` 的 release AAR。构建脚本发布 `hermesvm` Prefab 头文件与原生库。[H1][H3]

该构建的默认 ABI 是 `armeabi-v7a`、`arm64-v8a`、`x86`、`x86_64`。版本目录规定 `minSdk = 24`、NDK `27.1.12297006`。构建参数包含 `ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`。[H3]

这些是所查 AAR 构建的约束。不是 Hermes 所有版本的统一最低 API。RN 工程的 `targetSdk = 36` 也不是本项目必须接受的目标 SDK。

**源码事实：** `API/hermes/hermes.h` 暴露 `makeHermesRuntime()`。`hermes.cpp` 实现 JavaScript 执行、Host Function、微任务入队和 `drainMicrotasks()`。[H1]

**推断：** Kotlin 可以通过小型 JNI/C++ 宿主持有 Hermes。宿主把工作派到专用线程，调用 JSI Host Function 接入平台。此路径不需要加载 RN 页面或 RN renderer。已有 WebView UI 继续单独运行。

不能把 AAR 包名中的 `react` 理解为必须采用 RN UI。也不能反向假定该 AAR 已提供适合我们使用的完整 Kotlin 服务运行器。仍须验证 JSI 链接、JNI 初始化、Intl Java 类和所需 native dependencies。

### 5.2 引擎没有自动提供的平台服务

RN `Libraries/Network/fetch.js` 明确导入 `whatwg-fetch`。RN `Libraries/WebSocket/WebSocket.js` 通过 `NativeWebSocketModule` 连接网络，并处理原生事件。[H2]

这证明网络来自平台绑定，不是 Hermes 引擎本身。直接嵌入 Hermes 后，宿主必须提供：

- 定时器、任务排队、Promise 微任务调度和异常上报。
- `fetch` 所需的请求、响应和增量读取接口。
- UTF-8 增量解码、背压和取消传播。
- Provider 实际需要的 WebSocket 方法、事件和握手头。
- 安全随机数、URL、文本编码和其他导入图要求的 Web API。
- Pi 环境、持久化和工具桥。

这些可以由 Kotlin 网络库和 JavaScript 兼容层提供。它们不要求重写 Pi 的 Provider 协议。

所查 `drainMicrotasks()` 实现直接调用 `drainJobs()`。源码注释说明 `maxMicrotasksHint` 尚未实现，排空过程无界。[H1] 因此必须验证微任务链占用、取消响应和调度公平性。不能把一次 JNI `evaluate` 返回当成整个异步任务完成。

**不采用的捷径：** 把 RN 的 `fetch` 文件复制进工程，不等于得到流式 `Response.body`。本次没有建立该 RN polyfill 满足 Pi 增量读取契约的证据。

## 6. 轻量候选：`QuickJS` 与 `Zipline`

### 6.1 为什么选择此项目研究

`CashApp/quickjs-java` 的公开入口已转为 `Cash App Zipline`。它不是只剩 README 的 Android wrapper。`1.28.0` 有 JNI 源码、Android 构建、发布 AAR 和近期维护记录。[Q1]

发布物分为 Kotlin 层 `zipline-android` 和本机层 `zipline-android-ndk`。后者 AAR 为 `2,818,267` 字节。不能只拿前者 `279,903` 字节宣称完整引擎体积。[Q1]

### 6.2 源码揭示的能力与缺口

- `zipline/native/quickjs/VERSION` 为 `2021-03-27`。
- `QuickJs.kt` 提供 `create()`、`evaluate()`、`compile()`、`execute()`、`close()`。
- JNI 入口提供内存限制、栈限制和 `interruptHandler`。
- 类注释明确说明实例不支持并发访问，必须由外部同步。
- Android NDK 模块构建 4 个常见 ABI。
- `1.28.0` 的版本目录和 changelog 将 `minSdk` 定为 `23`。README 中 API `18+` 已落后，不能继续引用。
- CMake 明确设置 `-Wl,-z,max-page-size=16384`。changelog 从 `1.16.0` 记录 16 KB 修复。[Q2]

**重要否定结果：** QuickJS 原生头文件有 `JS_ExecutePendingJob()`，但所查 `QuickJs.kt` 没有公开对应方法。`Context.cpp`、`quickjs-jni.cpp` 和 `InboundCallChannel.cpp` 中没有找到对它的调用。[Q3]

这不是证明整个 Zipline 没有异步能力。Zipline 可以为 Kotlin/JS coroutine 提供调度。但这不足以证明普通 TypeScript npm 包的原生 Promise 会自动得到正确调度。

另外，`Context.cpp` 使用自定义 `JS_NewContextNoEval()`。这个函数安装 Promise 等内建对象，但明确不安装 `eval`，也省略 `BIGNUM`。[Q3] 必须按 SDK 的真实语法、动态代码和数值使用检查。不能把“上游 QuickJS 支持”直接等同于“这个封装开启了支持”。

**推断：** 可以用 QuickJS 做纯后台运行宿主，保持既定 UI。最小可信验证必须先解决普通 Promise 作业循环和 Java/Kotlin 回调桥。随后才验证网络、持久化和 Provider。

Zipline 的高层目标是 Kotlin/JS 服务交换。它不是 npm 浏览器运行时。直接采用高层 API 可能需要额外胶合层。直接采用底层 `QuickJs` 或自写 JNI，则必须承担缺失能力的维护。

此路线不自带 `fetch`、WebSocket、Node 文件系统或 Node 模块解析。必须提供与 Hermes 相同类别的平台 Adapter。`interruptHandler` 可以中断 JavaScript 计算，但不能自动取消 Kotlin HTTP 请求或 Termux 命令。

### 6.3 其他轻量 wrapper 的筛选

还检查了 `taoweiji/quickjs-android`，HEAD 为 `fadb5b52f2ea988420b4d8dfae589ab55d66b911`。README 提供事件队列和 CommonJS 包装，但本轮没有建立近期维护、16 KB 和普通 Promise 完整调度证据。故不把它排在已有发布与维护证据的 Zipline 前面。支持 `require` 也不等于支持 Node 内建模块。[Q4]

## 7. Android V8 补充候选：`Javet` 的 V8 模式

`com.caoccao.javet:javet-v8-android:6.0.3` 确有 Maven AAR。构建固定独立 V8 `15.7.112.19`，4 个 ABI，使用 NDK `r29`。它不是 Node 模式的版本号。[V1]

原生 `Await()` 的 V8 分支调用 `PumpMessageLoop()` 和 `PerformMicrotaskCheckpoint()`。源码明确说明 V8 模式没有 Node 事件循环。[J4]

**优点推断：** 可以复用 Javet 的 Java/JNI 集成，少写一层 C++ 宿主。

**限制：** 没有 Node 的 `fetch`、libuv、模块系统和文件 API。它仍需要非 Node Adapter。独立 V8 的 AAR 也不能用“裸引擎”一词推断很小。本次发布归档为 `103,490,479` 字节，包含多 ABI。[V1]

**最低 API 存在必须核实的差异：** Javet library 的通用 Gradle 文件写 `minSdk = 24`，但安装文档规定 V8 `13.9+`、Javet `4.1.6+` 的 Android 要求为 `29+`。不能只看 Manifest 接受 API 24。必须核实 V8 实际依赖符号和运行平台。[J3][V1]

本报告把该路线放在非 Node 适配实验的比较组。不据此提高产品 `minSdk`，也不把它当作轻量 QuickJS 的同义替代。

## 8. 横向比较

| 方面 | Javet Node | 独立 Hermes | Zipline/QuickJS | Javet V8 | 自构建应用拥有的 Node |
|---|---|---|---|---|---|
| Android 交付证据 | `6.0.3`、`5.0.11` AAR | 固定 RN 版本 AAR + C++ API | `1.28.0` AAR + JNI | `6.0.3` AAR + JNI | 官方源码；没有官方 Android 包 |
| SDK Node 版本条件 | 源码版本满足；行为未验 | 不适用；必须审计可移植入口 | 不适用；必须审计可移植入口 | 不适用；必须审计可移植入口 | 可以选满足条件的源码；构建未验 |
| 网络基础 | Node/Undici；Android 行为待验 | 必须提供平台绑定 | 必须提供平台绑定 | 必须提供平台绑定 | Node/Undici；Android 行为待验 |
| 调度责任 | 宿主驱动 libuv 与 V8 | 宿主任务队列 + 微任务 | 必须先补证普通 Promise job pump | 宿主任务队列 + V8 微任务 | 自己集成 libuv 生命周期 |
| 所查最低 API | `24` | `24`，限所查构建 | `23` | 文档 `29+`；Gradle `24` 有差异 | 配置脚本 `24` |
| 16 KB 证据 | CMake 参数 + 文档 | flexible page 参数 | CMake 参数 + changelog | CMake 参数 + 文档 | 必须自行建立 |
| 主要风险 | JNI 生命周期、ESM、网络与构建差异 | 平台补齐工作、调度与语言兼容 | 旧引擎、封装能力、Promise 调度 | 非 Node 适配、最低 API、体积 | 平台补丁和长期发行维护 |

全部候选都必须维持“运行宿主和 UI 分进程”。引擎线程不是新的 Android 进程。引擎可以关闭，也不等于会话自动恢复已经实现。

## 9. 许可事实

| 组件 | 已核验许可 | 必须继续做的工作 |
|---|---|---|
| Node / `nodejs-mobile` | Node 主体为 MIT 风格许可；`LICENSE` 同时列第三方组件 | 按实际 OpenSSL、V8、libuv、ICU 等组成保留通知 |
| Javet | Apache-2.0 | 保留许可和适用通知；不能用 Javet 许可代替 Node/V8 的许可 |
| Hermes | MIT | 核查实际 AAR 的第三方库和通知 |
| Zipline 绑定 | Apache-2.0 | 保留绑定层通知 |
| Zipline 内 QuickJS | 源文件头为 MIT 风格许可，Bellard/Gordon 版权 | 同时保留引擎通知；核查自维护修改 |
| 本机 Pi SDK | 两个 `package.json` 均为 MIT | 仍须审计传递依赖和实际打包文件 |

许可来自源码，不是分发法律结论。[L1] 本报告不改变完整 Termux 的独立许可审计范围。

## 10. 排序验证建议，不是最终选择

### 第 1 顺位：`Javet` Android Node

先固定 `6.0.3`。若需要比较版本回归，可用已发布的 `5.0.11` 做对照，不把它默认定为生产版本。

必须验证：

1. 在应用自己的 Service 进程加载 AAR。
2. 读取真实 `process.versions`，检查 Node 内建模块。
3. 运行真实 SDK bundle，检查 ESM 和动态导入。
4. 验证 SSE 增量响应、WebSocket、请求取消和 Kotlin 回调。
5. 在活跃 I/O 下关闭，再重建运行宿主。

**停止条件：** 发布物不能重现构建配置，或核心 SDK 入口不能可靠运行。此时记录原因，再比较下一个候选。不能把 Agent 移到外部 Termux 规避失败。

### 第 2 顺位：独立 `Hermes`

先只验证可移植 SDK bundle、微任务、定时器、增量 HTTP 和取消。不要先建设 RN 应用框架。

用同一测试契约比较 `Javet V8` 可以降低判断偏差。但必须保留其 API `29+` 问题，不提前修改产品兼容范围。

**停止条件：** 需要改写 SDK Provider 核心，或无法可靠提供异步、存储和取消契约。不能因为 UI 已用 WebView 就把 Agent 转入页面线程。

### 第 3 顺位：`Zipline/QuickJS`

先验证普通 Promise 作业的完整链路。再测 SDK 导入图和语言特性。只有这 2 项通过后，才投入完整平台桥。

若需要大量维护 JNI 或升级内嵌引擎，必须重新估算成本。小型库体积不自动等于低维护成本。

### 第 4 顺位：自行维护 Node 嵌入库或应用拥有的 Node 子进程

保留作为明确的工程方案，不把它描述为下载官方 Android Node 即可完成。只有已有项目不能满足关键约束时，再讨论是否接受持续构建和安全维护责任。

当前核验的 `nodejs-mobile 18.20.4`、`22.9.0` 不进入“直接满足 SDK Node 条件”的候选顺位。可移植入口理论上能另行适配，不代表旧 Node 值得作为新宿主基础。

## 11. 无设备可以完成什么，仍有哪些门槛

### 本轮已经完成

- 固定源码、读取版本与构建矩阵。
- 确认相关 Maven 和 GitHub 发布物存在。
- 区分 engine、平台绑定和 Android Service 宿主。
- 找到最低 API、页对齐、事件循环与关闭相关源码。
- 找到 README 与源码、文档间的不一致。

### 后续可在无 Android 设备时完成，但本轮未执行

这些步骤仍需要另行授权，不能视为已获实现许可。

1. 构建最小 SDK 导入图，列出所有缺失全局对象和平台依赖。
2. 下载并检查固定 AAR 的 checksum、POM、Manifest、ABI 和 ELF `DT_NEEDED`。
3. 检查全部 SO 的 ELF LOAD 段对齐。检查最终 APK 的 ZIP 对齐。
4. 检查 `libc++_shared.so`、JNI 桥和附属库，不能只检查主引擎 SO。
5. 对已授权的桌面测试环境运行可移植契约。它不能替代 Android 结果。
6. 生成许可清单和可重现构建记录。

Android 官方要求分别检查 ELF 与 APK 对齐。官方建议现代 AGP/NDK，并继续检查运行时代码中的页大小假设。[A1] 源码含 `16384` 不构成最终验收。

### 模拟器或真机必须验证

- 实际 ABI、最低 API、4 KB 与 16 KB 环境的加载与执行。
- Service 进程加载、JNI 线程归属、退出及重复创建。
- TLS、DNS、流式读取、WebSocket、网络切换及取消传播。
- 中断后的旧回调、旧计时器和重复恢复请求。
- SDK 存储的崩溃一致性、单一所有者和真实文件 Adapter。
- UI 退出后继续执行，系统回收后恢复，用户停止后不复活。
- 冷启动、PSS/RSS、长时间流式响应、GC、耗电和温升。
- 厂商后台策略与真实设备重启。模拟器结果不能替代这些结果。

### 下一轮讨论前应保留的阻塞项

1. SDK 专项审计必须给出实际可移植导入图与所需 Provider 功能。
2. 必须决定是否授权最小验证工程；本轮尚未授权。
3. 必须取得所选交付物的二进制检查证据。
4. 必须定义设备 ABI、最低系统范围和测试设备。
5. Termux 部署、`targetSdk`、IPC 和存储布局继续待定。运行时候选不能替用户决定这些事项。

## 12. 主要一手来源

### Node

- [N1] Node `v22.19.0`：[Android 支持声明](https://github.com/nodejs/node/blob/v22.19.0/BUILDING.md#android)、[配置源码](https://github.com/nodejs/node/blob/v22.19.0/android_configure.py)。
- [N2] 官方 [`v22.19.0/SHASUMS256.txt`](https://nodejs.org/dist/v22.19.0/SHASUMS256.txt)。
- [N3] Node `v22.19.0`：[嵌入 API 与完整生命周期示例](https://github.com/nodejs/node/blob/v22.19.0/doc/api/embedding.md)。
- [N4] Node 网络实现：[v26.13.0 Web 全局对象](https://github.com/nodejs/node/blob/v26.13.0/lib/internal/bootstrap/web/exposed-window-or-worker.js)、[v22.19.0 编码、取消与 Streams](https://github.com/nodejs/node/blob/v22.19.0/lib/internal/bootstrap/web/exposed-wildcard.js)、[Undici fetch 与取消实现](https://github.com/nodejs/node/blob/v22.19.0/deps/undici/src/lib/web/fetch/index.js)。

### nodejs-mobile

- [M1] [`v18.20.4` 发布](https://github.com/nodejs-mobile/nodejs-mobile/releases/tag/v18.20.4)、[发布附件目录](https://github.com/nodejs-mobile/nodejs-mobile/releases/expanded_assets/v18.20.4)、[版本头文件](https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/src/node_version.h)。
- [M2] `v18.20.4`：[Android 构建脚本](https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/tools/android_build.sh)、[配置源码](https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/android_configure.py)、[CI](https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/.github/workflows/build-mobile.yml)、[构建文档](https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/doc_mobile/BUILDING.md)。
- [M3] [16 KB 主线提交](https://github.com/nodejs-mobile/nodejs-mobile/commit/d9552e0e01ed5bdbe12a31d1ce6c0877a4f39580)、[固定分支 CI](https://github.com/nodejs-mobile/nodejs-mobile/blob/ff4e063f1f1911047c067335ad0a3d81336236ca/.github/workflows/build-mobile.yml)、[发布准备提交及日期差异](https://github.com/nodejs-mobile/nodejs-mobile/commit/ff4e063f1f1911047c067335ad0a3d81336236ca)。
- [M4] [FAQ，固定主线](https://github.com/nodejs-mobile/nodejs-mobile/blob/d9552e0e01ed5bdbe12a31d1ce6c0877a4f39580/doc_mobile/FAQ.md)、[JNI 示例，固定提交](https://github.com/JaneaSystems/nodejs-mobile-samples/blob/52347086d7076d59cf663850b4debd33b17de089/android/native-gradle-node-folder/app/src/main/cpp/native-lib.cpp)。
- [M5] 版本头文件：[Node 22 分支](https://github.com/nodejs-mobile/nodejs-mobile/blob/106c51f95d55d1010de56a2ffd09bfb4ba819a47/src/node_version.h)、[JaneaSystems](https://github.com/JaneaSystems/nodejs-mobile/blob/d7750834d9b2abf9df7a9149aa511c1cad8fffca/src/node_version.h)、[1Conan](https://github.com/1Conan/nodejs-mobile/blob/ff0708fb693f431e95714778fd9fd92c60b62a38/src/node_version.h)、[1Conan 发布索引，检索日快照](https://github.com/1Conan/nodejs-mobile/releases)。

### Javet

- [J1] Maven 发布目录：[Node Android 6.0.3](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android/6.0.3/)、[5.0.11](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android/5.0.11/)。注意新坐标是 `javet-node-android`，不是停在 `4.0.0` 的旧 `javet-android-node`。
- [J2] Android Node workflow：[6.0.3](https://github.com/caoccao/Javet/blob/6.0.3/.github/workflows/android_node_build.yml)、[5.0.11](https://github.com/caoccao/Javet/blob/5.0.11/.github/workflows/android_node_build.yml)；[Node 26.13.0 版本源码](https://github.com/nodejs/node/blob/v26.13.0/src/node_version.h)。
- [J3] Javet `6.0.3`：[Android library Gradle](https://github.com/caoccao/Javet/blob/6.0.3/android/javet-android/build.gradle.kts)、[Android CMake](https://github.com/caoccao/Javet/blob/6.0.3/cpp/cmake/platforms/Android.cmake)、[安装兼容表](https://github.com/caoccao/Javet/blob/6.0.3/docs/tutorial/basic/installation.rst)。
- [J4] Javet `6.0.3`：[Java await](https://github.com/caoccao/Javet/blob/6.0.3/src/main/java/com/caoccao/javet/interop/V8Runtime.java)、[原生运行时、事件循环与释放](https://github.com/caoccao/Javet/blob/6.0.3/cpp/jni/javet_v8_runtime.cpp)、[JNI 入口](https://github.com/caoccao/Javet/blob/6.0.3/cpp/jni/javet_jni_core_v8.cpp)。
- [J5] [6.0.3 发布](https://github.com/caoccao/Javet/releases/tag/6.0.3)、[维护发布索引，检索日快照](https://github.com/caoccao/Javet/releases)、[6.0.3 Node 构建补丁](https://github.com/caoccao/Javet/blob/6.0.3/scripts/deno/patch_node_build.ts)、[Node 内部模块解析桥](https://github.com/caoccao/Javet/blob/6.0.3/cpp/jni/javet_node.cpp)。
- [V1] Javet `6.0.3`：[V8 Android workflow](https://github.com/caoccao/Javet/blob/6.0.3/.github/workflows/android_v8_build.yml)、[V8 AAR 目录](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-v8-android/6.0.3/)、[arm64 GN 参数](https://github.com/caoccao/Javet/blob/6.0.3/scripts/v8/gn/android-arm64-non-i18n-args.gn)。

### Hermes

- [H1] 固定引擎源码：[hermes.h](https://github.com/facebook/hermes/blob/265ef62ff3eb7289d17e366664ac0da82303e101/API/hermes/hermes.h)、[hermes.cpp](https://github.com/facebook/hermes/blob/265ef62ff3eb7289d17e366664ac0da82303e101/API/hermes/hermes.cpp)。
- [H2] RN `v0.82.1` 平台代码：[fetch](https://github.com/facebook/react-native/blob/v0.82.1/packages/react-native/Libraries/Network/fetch.js)、[WebSocket](https://github.com/facebook/react-native/blob/v0.82.1/packages/react-native/Libraries/WebSocket/WebSocket.js)。
- [H3] RN `v0.82.1`：[固定 Hermes 修订](https://github.com/facebook/react-native/blob/v0.82.1/packages/react-native/sdks/.hermesversion)、[AAR 构建与 Prefab](https://github.com/facebook/react-native/blob/v0.82.1/packages/react-native/ReactAndroid/hermes-engine/build.gradle.kts)、[最低 API 与 NDK](https://github.com/facebook/react-native/blob/v0.82.1/packages/react-native/gradle/libs.versions.toml)、[Maven 发布目录](https://repo.maven.apache.org/maven2/com/facebook/react/hermes-android/0.82.1/)、[2026-11 主线维护提交](https://github.com/facebook/hermes/commit/2f82501597d8659df644b547ffa89931f4d80092)。

### QuickJS / Zipline

- [Q1] Zipline：[1.28.0 changelog](https://github.com/cashapp/zipline/blob/1.28.0/CHANGELOG.md)、[Android AAR](https://repo.maven.apache.org/maven2/app/cash/zipline/zipline-android/1.28.0/)、[NDK AAR](https://repo.maven.apache.org/maven2/app/cash/zipline/zipline-android-ndk/1.28.0/)。
- [Q2] Zipline `1.28.0`：[引擎版本](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/quickjs/VERSION)、[QuickJs.kt](https://github.com/cashapp/zipline/blob/1.28.0/zipline/src/jniMain/kotlin/app/cash/zipline/QuickJs.kt)、[Android ABI 构建](https://github.com/cashapp/zipline/blob/1.28.0/zipline-android-ndk/build.gradle.kts)、[16 KB 链接](https://github.com/cashapp/zipline/blob/1.28.0/zipline-android-ndk/src/main/CMakeLists.txt)、[版本目录](https://github.com/cashapp/zipline/blob/1.28.0/gradle/libs.versions.toml)。
- [Q3] Zipline `1.28.0`：[原生 Context](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/Context.cpp)、[JNI](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/quickjs-jni.cpp)、[调用通道](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/InboundCallChannel.cpp)、[裁剪后的内建对象](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/common/context-no-eval.c)、[QuickJS job API](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/quickjs/quickjs.h)。
- [Q4] [taoweiji wrapper 固定修订 README，仅作候选筛选](https://github.com/taoweiji/quickjs-android/blob/fadb5b52f2ea988420b4d8dfae589ab55d66b911/README.md)。

### Android 与许可

- [A1] [Android 官方 16 KB 指南，检索日文档](https://developer.android.com/guide/practices/page-sizes)。
- [A2] [Android 10 可写目录执行限制](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)。
- [L1] [nodejs-mobile LICENSE](https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/LICENSE)、[Javet LICENSE](https://github.com/caoccao/Javet/blob/6.0.3/LICENSE)、[Hermes LICENSE](https://github.com/facebook/hermes/blob/265ef62ff3eb7289d17e366664ac0da82303e101/LICENSE)、[Zipline LICENSE](https://github.com/cashapp/zipline/blob/1.28.0/LICENSE)、[内嵌 QuickJS 版权头](https://github.com/cashapp/zipline/blob/1.28.0/zipline/native/quickjs/quickjs.c)。
