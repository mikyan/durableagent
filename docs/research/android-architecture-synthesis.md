# Android Agent：开源研究与下一轮决策

研究日期：2026-11-03。状态：保留第一轮源码研究与原始提问。

> 后续更新：用户已接受首次初始化之后免重复人工的体验，要求完整可复制命令，并确认 SDK 1.5.0 设计／验证基线。Aether 补充研究已完成；当前结论见 [Aether 汇总](aether-synthesis.md)与 [technical-design.md](../technical-design.md)。下文第 7 节是上一轮提问，不是要求用户再次回答 Q6。

**结论：已确定的分工有可借鉴的真实实现，但没有一个已检查项目能直接满足我们的全部架构与恢复要求。下一步应确认部署方向、运行时验证顺序和 SDK 基线，而不是直接开始生产编码。**

本轮安排 4 个并行研究方向，并补做原始文件访问研究、运行时候选交叉复核，以及 SDK 1.3.0 → 1.5.0 关键契约差异审计。仅阅读公开文档、源码、发布元数据及本机 SDK；未安装软件、下载可执行交付物、执行上游代码或连接设备、使用模型凭据、修改原型或编写生产代码。

## 1. 不再重开的决定

- 正式界面：WebView + Kotlin；TypeScript + React + Vite；沿用已批准的 Console 原型。
- 主 Agent：Pi Durable + Pi AI，在本应用的运行宿主中运行，与 UI 宿主分进程。
- 命令端：完整 Termux 环境，优先保留 Android 场景中尽可能广泛的兼容安装能力。
- Termux 不接管主 Agent、模型会话和恢复决策。它可以运行命令、文件操作和执行桥。
- 产品仍以会话为中心；不新增任务中心、第二个助手或必须先建项目的流程。
- 自动续跑、主动停止不复活、原始文件访问、省流策略仍是要求，不因参考项目缺少能力而削减。

研究不等于决定。以下“首选”保留当轮建议，不表示生产部署、运行时或协议已经锁定；后续已确认的 SDK 1.5.0 设计／验证基线以文首更新为准。

## 2. 证据怎么看

- **源码事实**：找到固定修订中的真实调用、配置、状态所有者或构建路径。
- **作者测试记录**：上游作者报告过的测试结果；不是我们独立复测。
- **工程推论**：可据源码提出的集成方案，仍可能需要适配。
- **待验证**：必须通过产物检查、模拟器或真机验证的能力。

发布了 AAR 不等于 Pi SDK 已能运行；有前台 Service 不等于分进程；能重新连接不等于能恢复同一次执行。

## 3. 最有价值的开源参考

| 参考 | 实际提供的证据 | 不能直接照搬的部分 |
|---|---|---|
| [Moose v0.8.0](https://github.com/sugarforever/moose/tree/a48d170309f8587c733a232f6d4fd12c7cc3d6c5) | 应用内 Hermes 运行 Pi SDK 1.3.0；Expo 网络与 SQLite；Termux 只运行执行桥 | Agent 与 UI 共享 React 运行上下文；不证明我们的独立进程、冷启动和原始文件闭环 |
| [Javet 6.0.3](https://github.com/caoccao/Javet/tree/5d51b4eb0bfd4869436c906ce0748b325f445959) | 有 Android Node AAR、Java/JNI Interface、事件循环和关闭实现 | Node 版本满足条件不等于 ESM、SDK、网络与关闭均兼容 |
| [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile/tree/v18.20.4) | 真实 Android `libnode.so`、JNI 与线程集成先例 | 所查发布为 Node 18.20.4，另一分支为 22.9.0；不满足当前审计 SDK 的 Node 基线 |
| [VHEditor](https://github.com/vhqtvn/VHEditor-Android/tree/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04) | 自有应用 ID、重建 bootstrap、自有 APT 仓库；不是有限命令工具箱 | 维护的是一套 Termux 衍生包环境，不是任意改名后直用官方二进制；不移植其 code-server 产品架构 |
| [AcodeX 执行桥](https://github.com/bajrangCoder/acodex_server/tree/ee2cbfe9bf988d2052ef1363c8815276cc84469d) | Rust PTY、WebSocket 输出、重连尾部与终止入口 | 手动启动外部桥、PID/内存会话、CORS 都不满足我们的启动、恢复和认证契约 |
| [Termux:Monet](https://github.com/Termux-Monet/termux-monet/tree/8f19256797216b4b2f73803c268b5e115711a6b7) | 保留 `com.termux` 身份和目录的 UI 分支先例 | 已归档；签名、覆盖安装和数据迁移不能默认接受，不建议把该旧分支作为新产品基础 |

另检查的 `rho`、`pi-droid`、Ferngeist 分别涉及 Termux/桌面 Agent、ADB 控制器或网关客户端。它们不能证明主 Agent 在我们的 Android 应用内运行。

Acode 的内置环境是 Alpine + PRoot + `apk`，有真实包安装能力，但不是完整 Termux。不能以借鉴为名静默替换已经选定的环境。

许可也不同：Moose 根许可为 MIT；Javet 为 Apache-2.0；Termux 应用、Monet、VHEditor 涉及 GPL。实际复制或分发时必须按代码及二进制组成处理通知与对应源码，不能仅看项目首页的一个许可标记。

## 4. 会改变设计的关键发现

### 4.1 现代 Node 可以研究“嵌入应用”，不必成为桌面后端

[Javet 的发布目录](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android/6.0.3/)确实存在 Android Node AAR。固定构建脚本中，6.0.3 使用 Node 26.13.0；5.0.11 使用 Node 24.19.0。它们满足已审计 SDK 1.3.0 的 `>=22.19.0` 版本条件。

这是 Kotlin/Java 经 JNI 使用本应用进程内的 Node，不要求把主 Agent 放到 Termux，也不要求引入完整 Node/HTTP 产品后端。

但交叉复核找到实质风险：**Javet 的通用 V8 模块执行入口不等同于 Node ESM loader。** 默认模块解析、动态 import 和 Node 内建模块有不同路径，上游有明确的失败测试。不能说“开一个开关就能运行 Pi”。

所查构建链接了 SQLite，没有发现关闭 `node:sqlite` 的配置；实际 AAR 内容仍未检查。所查 Node 发行物只有 `arm64-v8a` 和 `x86_64`，具体设备必须核验。源码中有 16 KB 对齐参数，不代表最终 APK 通过了全部对齐和运行测试。

### 4.2 Moose 证明了分工方向，但没有替我们完成宿主

Moose 在应用中创建 Harness，Termux 只导入工具执行环境。其模型密钥、主会话数据库在应用侧。这个分工与我们的要求一致。

它依赖 Expo 的 fetch、SQLite、SecureStore、文件能力和多项 JS 补齐，并对 SDK 的部分 Node 环境探测做打包处理。模型只覆盖其选定的 Provider 组合，不能据此承诺全部 Pi AI Provider。

其 Android Service 没有独立 `android:process`，仍使用已有 ReactContext。可以借鉴事务队列、停止标记、执行桥和故障测试，**不能直接把它包装成我们的独立 Kotlin/Hermes 运行宿主**，也不需要为了借鉴而改选 React Native UI。

### 4.3 外部 Termux 的自动启动必须是验收门槛

官方 `RUN_COMMAND` 提供命令启动入口，但首次仍须安装、初始化、权限和外部调用配置。这不应变成每次手动启动终端的日常操作。

Moose 的作者记录了一次重启后无 Termux 进程时的 `BackgroundServiceStartNotAllowedException`，打开 Termux 后才连上。记录没有充分说明此前初始化、解锁、停止标记和调用方状态，**不能把它解释为仅首次设置问题，也不能据此断言所有冷启动都不可能**。

它的原生客户端调用 `startService()`；官方入口本身在 `onCreate()` 尝试进入前台，并在 Android 8+ 用 `startForegroundService()` 启动后续执行 Service。后续可研究符合平台规则的启动调用和生命周期，但本轮没有证明改变调用方式就能解决问题。[启动源码](https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/src/main/java/com/termux/app/RunCommandService.java)

**硬门槛：**完成首次配置后，在系统允许的正常启动／恢复情境下不能仍依赖重复手动打开 Termux。若做不到，必须复审部署路线，而不是降低原要求。强行停止、权限撤销或系统禁止启动应明确显示阻塞原因，不承诺越过这些限制。

### 4.4 单 APK 自有包名并非不可能，但不是零成本

VHEditor 把应用 ID、目录、bootstrap、APT 源和仓库密钥配成一套自有环境。2026-11-03 检索到的 aarch64 索引有 4,112 个不同包名。这证明存在广泛的重建包环境，不证明这些包已经在本项目可用，也不是官方仓库覆盖率。

因此可以比较完整的 3 条路线：

1. **独立官方 Termux**：保留官方身份和包源；承担首次配置、跨 UID 文件与执行控制、双端更新和恢复。
2. **保留 `com.termux` 的融合 APK**：保留原路径；承担 APK 维护、签名及可能的数据／附加应用迁移，不能与同身份 Termux 独立并存。
3. **自有应用 ID 与前缀仓库**：独立身份；承担包构建、依赖闭包、签名、镜像与持续回归。

本轮没有证据表明改一个 `$PREFIX`、加入 `termux-exec`，就能让任意自有包名无修改兼容整个官方仓库。PRoot 路径转换也尚未成为本项目已验证的等价方案。

### 4.5 SQLite 和模型传输不是“接上同名函数”即可

[SDK 1.3.0 的 SQLite schema](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/sqlite/migrations.ts)使用 `STRICT`、`json_valid` 等功能。[Android 官方版本表](https://developer.android.com/reference/android/database/sqlite/package-summary)中的 API 33 标准 SQLite 不支持该 `STRICT` 门槛。必须验证运行时自带 SQLite 或另一个合格引擎，不能删除 SDK schema 约束来伪装兼容。

SDK storage 要有唯一所有者。事务外操作必须等待正在进行的事务，必须在提交后才确认。UI 和 Termux 不能各自打开同一份 SDK storage 驱动执行。

不同 Provider 的传输也不同：Google 的相关 Adapter 限制独立自定义 fetch；Bedrock 有 Node HTTP 依赖；Codex WebSocket 需要普通浏览器构造器之外的 headers 语义。支持矩阵必须按运行时、Provider、鉴权、端点和传输核验。

**版本范围：**详细契约审计基于已安装的 SDK 1.3.0；另已完成检索日最新 1.5.0 的关键差异审计。两版的 Node 声明基线均为 `>=22.19.0`，上述 SQL 和传输限制没有因此消失。生产版本未选，1.5.0 的完整传递依赖图也尚未全面重审。

### 4.6 文件和恢复是执行桥的核心，不只是 Bash 输出

SDK 的 `ExecutionEnv` 同时包含文件与 shell Interface。同一环境 ID、同一路径必须指向同一文件。外部 Termux 的 `spillPath` 不能直接交给本应用的 `node:fs`。

常见 `/sdcard` 共享存储有 `noexec`、不支持符号链接等约束。它适合部分用户数据，不是所有依赖和构建工作的通用 POSIX 目录。SAF URI 也不是通用 Bash 路径。[固定 AOSP 挂载代码](https://android.googlesource.com/platform/system/vold/+/refs/tags/android-14.0.0_r1/Utils.cpp#1635)

必须分别处理应用的 SDK 状态、工具所需工作区、已授权原始用户文件。这些是存储角色，不是新增产品实体。不能用只修改副本来满足原文件要求。

SDK 自带的 unsafe Bash 恢复会产生 `interrupted`，不会自动查询外部命令结果。`Shell.exec()` 也没有现成的持久执行 ID 或重连收据。需要关联命令接收、启动、结束、输出、取消与应用提交，不能直接把 Bash 标为 safe。

安全重放不重跑 `beforeTool`。省流、停止和实际执行策略必须覆盖执行路径，而不只依赖首次 hook。`Harness.close()` 可留下待恢复工作，不等于用户主动停止。

### 4.7 最新 SDK 1.5.0 不能直接套用 1.3.0 接线图

对[固定 1.5.0 源码](https://github.com/earendil-works/pi/tree/f9a26365568127461c47a07a37dcb42c140a3ac5)的差异审计发现：

- SQLite Interface 新增 `runCounted()`，schema 升至 2；SDK 的 commit 改为批次与持久化收据。
- 部分进度可以先显示、后落盘；执行 intent 仍须先持久化。**UI 已显示不是命令完成或数据已持久化的证明。**
- 新增持久 sleep/wake、连续崩溃重启上限；被崩溃打断的模型请求计入重试预算。它们不替 Android 启动进程，也不保证避免重复计费。
- watch、报告、文件监听和参数校验 Interface 改变。固定源码中的 `pi.live` 是 version 3，不能照抄部分发布说明的 version 2。

新增的 SDK **存储收据**不等于 Termux **命令执行收据**，并未解决外部副作用核验。safe replay 跳过 `beforeTool`、Bash 缺少可重连执行键等结论仍成立。

因此必须先固定后续设计与验证所针对的 SDK 基线。Moose 1.3.0 的代码是行为参考，不是可以不经适配移植到 1.5.0 的成套 Adapter。

## 5. 建议的运行时验证顺序，不是最终选型

| 候选 | 建议理由 | 放弃或重新比较的条件 |
|---|---|---|
| 先验证 Javet Android Node | 已有现代 Node Android 发行物，Kotlin/JNI 接入明确，有望复用较多 SDK Node 能力 | SDK loader 需要大量自维护、生命周期不可靠、实际 ABI 不匹配或资源成本不可接受 |
| 独立 Hermes 作为主要比较候选 | Moose 给出 Pi 可移植集成的真实样本 | 需要重新实现 Provider 协议，或宿主无法满足异步、存储和取消契约 |
| 本应用拥有的 Node 子进程保留比较 | 可能减少特殊 ESM resolver 适配；仍符合主 Agent 放置约束 | Android 可执行打包、监督、IPC 或发行维护成本不合适 |
| QuickJS/Zipline 低优先研究 | 有维护中的 Android 绑定和体积优势线索 | 普通 Promise 作业、现代语言和平台补齐成本过高 |

Hermes 本身不提供 Expo/RN 的网络绑定。已查固定 Hermes 配置还会影响 `WeakRef`、Proxy 和微任务队列；需要真实 SDK 测试。

“自有 Node 子进程一定最差”没有源码依据。其比较成本依赖部署、目标 SDK 和 ABI。Javet-first 只是当前低成本获取证据的建议，不是排除其他路线。

引擎研究不必等待全部部署细节，但最终集成选择必须综合 UID、ABI、打包和目标系统。不会提前创建多引擎通用抽象或空 Adapter。

### 从项目中借鉴哪些深 Module 行为

- **应用运行宿主**：复用 Pi 的会话、任务和检查点；参考 Moose 的运行所有权、事务队列与持久停止标记，不复制其 UI 同进程生命周期。
- **本机执行 Module**：在 SDK 的真实 `ExecutionEnv` Seam 提供完整 Termux Adapter，集中处理文件命名空间、执行核验、取消和策略，而不是让每个工具分别处理连接。
- **模型与存储 Module**：优先使用 SDK 已有 Interface、schema 和 conformance cases，不另写通用模型协议或重复的 Agent 状态机。
- **UI 与扩展接入**：以少量高层命令、查询和订阅连接宿主；内置能力与随包扩展走相同 Interface，不暴露数据库和任意原生执行入口。

这些是后续设计的输入，不是已经批准的类图或代码目录。生产与测试经过同一 Interface；只有确实变化的地方才设置 Seam 和 Adapter。

## 6. 后续验证必须回答的问题

1. **引擎与加载**：实际 AAR、ABI、Node 版本、ESM/lazy imports、SDK 所需全局对象和 16 KB 条件。
2. **模型**：真实分块 SSE、UTF-8、工具参数、取消和错误；逐项核验声明支持的 Provider 组合。
3. **存储**：真实迁移、事务排队、唯一所有者、提交确认和中断窗口；掉电耐久性与进程崩溃分开。
4. **Termux 启动**：首次配置、正常冷启动、仅执行桥死亡、整个 Termux 进程死亡、重启解锁、撤销权限与强行停止分别测试。
5. **工具与原文件**：代表性包安装／升级、项目依赖和构建；文件工具与 Bash 指向同一对象，实际修改授权原文件。
6. **执行恢复**：意图、启动、效果、结束、提交各窗口中断；稳定关联、输出续取和结果核验；不重复不确定副作用。
7. **停止与策略**：进程树取消、停止后不复活、旧回调和受限网络变化；不能误杀现有 Termux 的其他会话。

SDK 1.3.0 专项列出 24 个命名契约测试，1.5.0 差异报告补充 10 项变更验收，并指出可复用的 SDK conformance cases。它们须按最后选择的 SDK 更新，不能把两版清单混作同一个已验收契约。本轮没有编写或执行这些测试。验证工程、设备操作和生产实现都尚未开始。

## 7. 第一轮 grilling 题目（历史记录，后续状态见文首）

### Q3-I：Termux 部署

**问题：是否接受“本应用 + 独立官方 Termux APK”，以及一次明确的初始化和授权，作为首个部署验证方向？**

**推荐：是。** 保留官方包生态，先不承担自有仓库或替换官方身份的成本。但必须验收首次配置之后的受管启动、跨 UID 文件与停止恢复；失败不能以重复手动启动作为正常替代。

这不是再问主 Agent 放在哪里，也不是要求用户现在卸载、安装或配置任何东西。

### Q5：应用内运行时的验证优先级

**问题：是否先以 Javet 的应用内嵌 Node 为首个验证候选，保留独立 Hermes 和本应用拥有的 Node 子进程作比较，而不立即锁定生产版本？**

**推荐：是。** 这与 Termux 部署可以分别表达偏好，但最终运行时选择仍须等待 ABI、实际 SDK 加载及完整集成证据。Node 只作为主 Agent 的宿主；工具执行仍接完整 Termux，不以应用内 Node 的默认 shell 替代。

接受这一验证顺序不等于已经授权编写验证工程。待部署方向、候选和 SDK 基线确定后，再确认最小验证范围、资源成本和成功／失败标准。

### Q6：SDK 设计与验证基线

**问题：是否优先以固定的 Pi Durable / Pi AI 1.5.0 作为后续设计与验证基线，1.3.0 和 Moose 只作参考，不把旧 Adapter 当作直接可用？**

**推荐：是。** 本项目尚无生产数据或实现包袱，优先研究当前版本的持久 sleep/wake、重启预算和提交契约更合适。代价是需要完成新版本的导入／校验依赖审计，并更新对参考项目的适配。生产可用性仍须验证；不追随未固定的 `latest`，也不静默回退旧版本。

这个版本选择与部署偏好可以分别决定。两版目前声明相同 Node 基线，因此首个运行时候选的研究顺序也可以先表达；具体实现和最终运行时只能按所选版本验收。

### 下一层暂不问

- 具体 APK 身份及签名迁移：取决于 Q3-I。
- 每个 APK 的最终 `targetSdk`、`minSdk` 和 ABI：取决于部署、运行时及目标设备。
- SQLite 引擎与布局：取决于运行时、系统范围和耐久性要求。
- Binder、管道、HTTP、WebSocket、SSH/SFTP 等具体协议：取决于实际 Module、UID 和收据契约。
- 工作区和原文件 Adapter 的具体组合：取决于上述部署与访问条件。

需要用户提供、不能从当前仓库推断的验证输入：准备使用的手机／平板型号和 Android 版本。不需要设备序列号或 IMEI。硬件信息用于核验候选，不自动改变已确认的产品范围。

后续仍按既定顺序推进：运行方案 → Module 职责 → 领域与持久化 → Interface → 状态与恢复 → 测试与风险。已确认项不重问，事实由研究补齐，关键取舍由用户决定。

## 8. 详细研究文件

以下文件保存在项目中，含固定版本、主来源、否定结果和验证清单：

- `docs/research/android-js-runtimes.md`
- `docs/research/pi-android-reference-projects.md`
- `docs/research/termux-integration-reference-projects.md`
- `docs/research/pi-sdk-android-contracts.md`
- `docs/research/android-file-access-and-workspaces.md`
- `docs/research/runtime-candidate-review.md`
- `docs/research/pi-sdk-1.5-delta.md`

此前的 `termux-exec.md`、`termux-packaging-options.md`、`termux-managed-startup.md` 仍用于机制与接入背景。新结论应结合固定版本及本轮交叉复核阅读，不把旧文档的候选表述当成已确认架构。
