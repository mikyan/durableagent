# Android 本机 Pi：参考项目源码研究

研究日期：2026-11-03。状态：仅研究，不构成选型或实施授权。

## 结论

**最强参考是 `sugarforever/moose`。它确实在 Android 应用内运行 `pi-durable` 和 `pi-ai`。它不是远程聊天客户端，也没有把主 Agent 放进 Termux。**

但 Moose **没有证明我们的分进程架构**。它用 React Native 的现有 `ReactContext` 和 Hermes 执行 Agent。前台 Service 继续使用同一个上下文。Activity 可以销毁或重建；UI 和 Agent 仍共享进程与 JavaScript 运行时。[M1–M4]

可以借鉴它的可移植打包、模型传输注入、SQLite 串行事务、停止标记、Termux 执行桥和故障测试。不能直接移植其 React Native UI、进程管理或整套产品功能。`pi-durable-expo-env` 是文件适配库，不是完整命令环境。[M1–M8、E]

本轮没有找到同时证明以下全部条件的项目：WebView + Kotlin、独立应用内运行宿主进程、Pi Durable、完整 Termux、授权原始文件访问和重启后自动续跑。这个结论只覆盖本轮检查范围，不表示不存在其他项目。

## 证据范围与版本

下文用 3 类标记：**源码**表示可检查的实现；**推断**表示架构判断；**待测**表示源码不能证明的设备行为。

使用命令行 HTTPS、公开 Git 引用和源码检查。没有使用共享浏览器、凭据、设备或安装命令。没有运行下载的项目代码，没有下载 APK。只写本报告。早期审计仅提供检索线索。

从上游 `earendil-works/pi` 开始。检查了 `v1.3.0` 和当次 `main` 源码中的 Moose 项目引用。没有找到 `sugarforever/moose`、`[Moose]` 或 `Moose app` 引用；`smoosex` 是无关贡献者。不能称 Moose 为上游认证方案。随后通过公开仓库检索定位 Moose。

GitHub REST API 返回匿名配额耗尽。版本通过 `git ls-remote`、标签、原始源码和提交补丁核验。未核验所有发布资产或 CI 运行结果。

| 项目 | 检查版本 | 维护证据与许可 |
|---|---|---|
| Pi | `v1.3.0`，`71023aec1546d6d677a65669c5665c0927ce0dd0` | 与本机 SDK `1.3.0` 对齐。另检索当次 `main`，HEAD 为 `0c7c7419886ba1879564e20eaaf44ffbf01ffc75`，不混用其 API。根 `LICENSE` 为 MIT。[P] |
| Moose | `v0.8.0`，`a48d170309f8587c733a232f6d4fd12c7cc3d6c5` | HEAD 与标签相同。提交日期 2026-10-23。存在 `v0.1.0` 至 `v0.8.0` 标签、测试和 APK 工作流。根许可 MIT。[M0] |
| `pi-durable-expo-env` | `v0.1.0`，`d60ce108e9690ad0b58eb462216421524c6cacc3` | 提交日期 2026-10-19。存在测试和 Changesets 工作流。npm `0.1.0` 元数据与仓库对应。MIT。[E] |
| `rho` | `0.1.12`，`073a3ee8a5dc0efd5dd32d773a760575ed38abc7` | 当次 HEAD 提交日期 2026-05-26。MIT。仅作不匹配对照。[R] |
| `pi-droid` | `742aadb456c9e78297b687321bfe0984106f5eb3` | 当次 HEAD 提交日期 2026-04-17。MIT。仅作不匹配对照。[D] |
| Ferngeist | `1.5.2`，`e85485f01d9a967a3c64aea376784f6c569d96ae` | 发布提交日期 2026-11-01。MIT。仅作不匹配对照。[F] |

MIT 允许复用，但必须保留相应版权和许可文本。根许可不替代依赖许可审计。Moose 可选 iOS iSH 集成另有 GPL 义务；不能据根 MIT 文件推断整个产品及所有二进制都是 MIT。该 iOS 后端不属于本项目的参考部署方案。[M9]

## 1. Moose：实际执行链

### 1.1 Agent、引擎与原生绑定

**源码：** `package.json` 固定 `pi-durable`、`pi-ai`、`chord` 为 `1.3.0`。Expo 为 `58.0.17`，React Native 为 `0.88.0`，React 为 `19.3.0`。这些是被检项目版本，不是我们的版本决定。[M0]

执行链为：

```text
React Native 应用 / Hermes
  → getMobileRuntime / RuntimeOwner
  → openMobile
  → MobileEngine.open
  → SqliteStorage.open + Harness.open
  → Pi AI Provider → expo/fetch → 模型服务
  → ExecutionEnv → 本机文件，或 Termux 执行桥
```

`src/runtime/engine.ts:383–389` 在应用中创建 `Harness`。`src/platform/open.ts` 注入 SQLite、凭据、模型传输及文件环境。Termux 服务只导入 `NodeExecutionEnv`，没有创建主 `Harness`。[M1、M5]

**源码：** `scripts/bundle-runtime.mjs` 使用 esbuild 的 `platform: "browser"`、`format: "esm"`、`target: "es2022"`。它还改写 3 处 Pi AI 环境鉴权实现，禁用 Node 环境发现。依赖审计排除 Node 存储、Node 执行环境及部分云 SDK。[M2]

这不是“只换一个引擎即可运行”。`src/platform/polyfills.ts` 补充随机数、`AbortSignal` 方法及 `Promise.withResolvers`。原生能力由 Expo 文件、SQLite、SecureStore、网络模块提供。后台与 Termux 安装模块使用 Kotlin Expo Module 接口。[M1–M4]

**推断：** 可以复用可移植入口和适配边界。不能把 Expo 的绑定直接当作普通 Kotlin/Hermes 宿主。独立运行宿主必须重新提供模块、线程、事件循环和销毁规则。打包脚本按 SDK 内部文件名改写源码，升级时必须重新检查导入图。

### 1.2 模型流

**源码：** `src/runtime/providers.ts` 只注册 OpenAI、Anthropic 和 Codex。它调用 Pi AI 的 `stream` / `streamSimple`，并注入 `expo/fetch`。Codex 明确指定 `transport: "sse"`。密钥从 SecureStore 读取，不交给 Termux 服务。[M1]

`tests/background-sse.test.ts` 测试分段 SSE、UI 取消订阅、文件工具及下一轮模型调用。`scripts/smoke-portable.mjs` 在不提供 `process`、`Buffer`、`require` 的 Node VM 中测试便携入口。[M8]

**限制：** Node VM 不是 Hermes。该测试也不是原生网络测试。3 个 Provider 不代表全部 Pi AI Provider 已适配。SSE 成功不证明 WebSocket、压缩、所有取消路径或所有模型端点成功。

### 1.3 SQLite 与存储所有权

**源码：** `openMobile` 打开应用内 `moose.sqlite`，设置 WAL、外键和 `synchronous = FULL`。`SerialSqliteDatabase` 用同一队列处理读、写、事务和关闭。事务使用 `BEGIN IMMEDIATE`，只向回调提供有效期受限的事务句柄。[M1、M3]

`RuntimeOwner` 缓存一次初始化 Promise。React 页面不关闭运行时。SDK 数据和应用 `moose_data` 表通过同一个适配器访问。凭据由 SecureStore 管理。默认文件位于应用文档目录下的 `pi-workspaces/<workspaceId>`；Termux 文件由 Termux UID 管理。[M1、M3、E]

**推断：** 单所有者和事务排队可直接作为设计样本。但 Moose 没有提供运行宿主与 UI 之间的数据库 IPC。我们的 UI 不能照搬 `openMobile` 后自己再开同一份 SDK 数据库。

### 1.4 Termux 命令与文件

**源码：** Kotlin `MooseTermuxModule` 通过 `com.termux.RUN_COMMAND` 调用官方 `com.termux.app.RunCommandService`。它指定 `/data/data/com.termux/files/usr/bin/bash`，后台执行，并接收 `PendingIntent` 结果。[M6]

安装脚本检查 `node >=22.19`、安装 `nodejs-lts` 和 `util-linux`、使用 `flock`，从临时 loopback 端点取得 APK 内的服务文件，并检查 SHA-256。随后启动 `$HOME/.moose-termux/service.mjs`。这是执行桥部署，不是主 Agent 部署。[M6]

执行通信链为：

```text
应用 Hermes 中的 TermuxEnvironment
  → Ed25519 签名 HTTP 请求 → 127.0.0.1:18765
  → Termux Node 服务 → NodeExecutionEnv → Bash / 子进程 / 文件
```

服务检查签名、请求 ID、60 秒时间窗口和请求大小，并拒绝带 `Origin` 的请求。文件方法通过 RPC 调用。命令使用 `exec`、带游标的 `poll`、`cancel`、`ack`。输出是轮询增量，不是 `RUN_COMMAND` 完成回调提供的流。[M5]

上游 `NodeExecutionEnv` 用 `spawn` 启动分离进程组；取消尝试对进程组发送 `SIGKILL`。Bash 从固定路径或 `PATH` 查找。Android 上的子进程树行为仍需测试。[P]

**重要限制：**

- `jobs`、输出和结果保存在服务内存。`.requests` 持久记录意图与确认，不保存可完整恢复的命令输出。
- 服务重启后，未确认的命令会阻止后续 shell 执行。旧请求 ID 不会盲目重放。
- 客户端先向执行桥发送 `ack`，再向调用方返回结果。这个确认不是应用 SDK 事务提交。不能宣称跨数据库和工具副作用的 exactly-once。
- `cancel` 失败会保留结果不明语义。它不证明已杀死所有后代。
- `/workspace` 是文件 RPC 别名。服务把它映射到 `$HOME/.moose-termux/workspaces/<id>`。Bash 仍有 Termux UID 的权限，不受该路径校验形成的安全沙箱限制。
- 源码证明用了官方环境和 `pkg`，不证明全部包、ABI、依赖升级或高 target 执行链兼容。
- 这没有解决我们的共享项目目录、跨 UID 原始文件访问或 SAF URI 与 shell 路径互通。[M5、M6]

### 1.5 后台、UI 生命周期与恢复

**源码：** `MooseExecutionService` 的 Manifest 没有 `android:process`。Service 的静态状态持有已有 `ReactContext`，并调用 `HeadlessJsTaskContext.getInstance(pending.context)`。它没有创建第二个 Hermes 或独立 `ReactHost`。[M4]

因此，以下区别必须保留：

| 问题 | 源码结论 |
|---|---|
| UI 页面卸载后继续运行 | 有设计与测试支持。运行时不归 React 视图所有。 |
| Activity 销毁后继续运行 | 作者记录了模拟器测试。依赖原进程和原 React 运行时仍在。 |
| UI 进程死亡而 Agent 进程继续 | **没有证明。没有独立运行宿主进程。** |
| JS 运行时销毁后继续 | 不支持；模块 `OnDestroy` 调用 `runtimeDestroyed()` 并取消运行。 |
| 系统重新启动 Service 后自动恢复 | 不支持该路径；返回 `START_NOT_STICKY`。 |
| 重启解锁后自动唤醒 | 未实现启动接收器或后台唤醒调度。 |

Service 提供 30 分钟预算、有限 wake lock、15 秒启动握手和停止通知。停止先持久保存原因；JS 10 秒内不确认时，原生代码终止本进程。下次打开先处理停止标记，再恢复 Harness。[M4]

`recoverMobileRuntime` 在有凭据时调用 `engine.resume()`。`resumePending` 先 `inspect`，获取执行许可，记录重启，再调用 `harness.resume()`。前台返回不重新提交同一输入。[M1、M7]

**差距：** 这是“重新打开后恢复”及“同进程 Activity 不持有执行”的样本。它不是我们的分进程、系统获准重启后自动恢复和重启解锁闭环。它的审批、每会话独立工作区和周期任务也不能变成本项目的新需求。

## 2. 测试成熟度：不要只读 README

Moose 有实际代码、集成测试、Kotlin Service 和 APK 工作流，不只是概念样板。工作流使用锁文件，并生成 Android 测试签名 APK；iOS 发布任务被禁用。[M0、M8]

但同一修订中的说明存在不同步：

- README 仍称 Termux 设备验证待完成，并列出较旧 Expo Doctor 结果。
- `docs/background-recovery.md` 记录 2026-10-22 的 API 35 arm64 模拟器测试：5/10 分钟锁屏、网络断开恢复、Doze、进程终止重开、通知停止和真实 Termux 冻结恢复。
- 2026-10-23 记录进一步通知测试，随后记录 `245` 个测试通过、`37` 个跳过，以及 `3` 个 bootstrap 测试通过。
- 记录明确说 Termux 冷启动时可能拒绝 `RUN_COMMAND`，仍需先打开 Termux。后续冻结恢复成功不消除这个前提。[M7]

这些是**作者的验证记录**，不是本轮独立复测。源码测试能证明测试设计；文档结果不能升级为真机兼容保证。厂商省电、实际设备、完整超时、真实模型和全部 Termux 包仍未由本轮证明。

## 3. `pi-durable-expo-env`：可借鉴，但不能替代 Termux

**源码：** `src/index.ts` 把 Expo 的 `Directory`、`File`、`Paths` 转成 `WorkspaceBackend`。`src/core.ts` 提供可移植 `ExecutionEnv` 子集。默认单文件上限为 8 MiB；`exec` 返回 `shell_unavailable`。它只接受应用所有的 `file:` 根目录。[E]

可以借鉴路径处理、取消检查、读取句柄、文件工具契约测试及后端注入。不能直接满足外部文档 URI、任意授权原始文件、完整 POSIX、watch 或命令执行。

`docs/validation.md` 记录 30 项自动测试和 iOS 模拟器验证。它明确没有 Android 原生运行验证；Android Hermes 资源导出不等于 APK 执行。它只选取 8 项上游环境契约测试，不是全量通过。文档还记录构建工具依赖审计问题，不能把早期版本视作成熟通用文件层。[E]

## 4. 不匹配项目：只用于排除误判

### `rho`：主 Agent 在 Termux 或桌面服务中

**源码：** `install.sh` 的 Android 分支安装 Termux `nodejs-lts`、`tmux` 和 Pi CLI。`web/rpc-manager.ts:67` 执行 `spawn("pi", ["--mode", "rpc"])`。Android 是 Capacitor WebView 包装；`LiveModeService.java` 向服务发送租约心跳，而不是在 APK 中创建 Pi Agent。[R]

因此它属于 **Termux Agent / 桌面服务客户端**，不符合主 Agent 放置约束。可参考重连、输出重放和通知，但不能把其前台 Service 当作应用内 Agent 宿主证明。`@mariozechner/*` 的宽松版本依赖也不是本项目 `1.3.0` 的兼容证据。

### `pi-droid`：Agent 控制手机，不是手机承载 Agent

**源码：** `src/adb/exec.ts` 从 `node:child_process` 导入 `execFile`，运行外部 `adb`。它是 Pi 工具扩展。执行所在宿主通过 ADB 操作 Android。[D]

归类为 **远程手机控制器**。它没有展示本应用内的 JavaScript Agent、Android SQLite 所有权或独立运行 Service。

### Ferngeist：Android 上的桌面 Agent 客户端

**源码：** `AcpTransportClient.kt` 创建 ACP 客户端，连接网关提供的 WebSocket 地址，使用 `sessionId` 和 `attachToken` 恢复连接。它恢复的是网关会话连接，不是 Android 本地 Pi 执行。[F]

归类为 **桌面服务客户端**。可以参考 UI 重连语义，不能用于证明本地 Agent、Termux 工具或本机执行恢复。

## 阻塞项与下一轮讨论输入

1. **运行宿主仍待选择。** Moose 支持非 Node 适配的可行性判断，但没有交付独立 Kotlin/Hermes 宿主。不能据此选择 Hermes，或排除应用管理的 Node。
2. **Termux 部署仍待选择。** Moose 只证明双 APK 执行桥的实现样本。首次初始化、冷启动限制和跨 UID 文件访问必须纳入取舍。
3. **恢复协议仍待设计。** 必须区分应用提交、工具意图、实际副作用、结果确认和 UI 重连。Moose 的内存输出与执行桥确认不是完整恢复协议。
4. **源码借鉴不等于产品移植。** 优先研究打包审计、模型注入、事务队列、停止标记和执行桥。不要导入 React Native UI、周期任务、审批系统或完整产品后端。
5. **真机门槛仍在。** 后续获准验证时，必须测试 UI 进程死亡、运行进程死亡、解锁后恢复、强行停止、网络恢复、主动停止和结果不明工具。还必须测试原始文件、依赖安装升级及子进程取消。

固定的 WebView + Kotlin、TypeScript + React + Vite、独立运行宿主和完整 Termux 约束均不改变。没有选择 target SDK、协议或存储布局。

## 可复核来源

以下链接固定到检查修订或发布标签。提交日期可从对应 commit 的 `.patch` 元数据复核。

- **[P] Pi `v1.3.0`**：[源码](https://github.com/earendil-works/pi/tree/71023aec1546d6d677a65669c5665c0927ce0dd0)、[Node 执行环境](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/env/node.ts)、[许可](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/LICENSE)。
- **[M0] Moose 版本与发布**：[package.json](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/package.json)、[提交](https://github.com/sugarforever/moose/commit/a48d170309f8587c733a232f6d4fd12c7cc3d6c5)、[工作流](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/.github/workflows/build.yml)、[许可](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/LICENSE)。
- **[M1] 执行与模型**：[open.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/platform/open.ts)、[engine.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/runtime/engine.ts)、[providers.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/runtime/providers.ts)、[runtime-owner.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/platform/runtime-owner.ts)。
- **[M2] 便携打包**：[bundle-runtime.mjs](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/scripts/bundle-runtime.mjs)、[polyfills.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/platform/polyfills.ts)、[compat.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/platform/compat.ts)。
- **[M3] 存储与所有者**：[database.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/storage/database.ts)、[execution-owner.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/runtime/execution-owner.ts)。
- **[M4] Android 后台**：[Manifest](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/modules/moose-background/android/src/main/AndroidManifest.xml)、[MooseExecutionService.kt](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/modules/moose-background/android/src/main/java/dev/verysmallwoods/background/MooseExecutionService.kt)、[MooseBackgroundModule.kt](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/modules/moose-background/android/src/main/java/dev/verysmallwoods/background/MooseBackgroundModule.kt)。
- **[M5] Termux 协议与服务**：[environment.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/termux/environment.ts)、[server.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/components/termux-service/server.ts)、[cli.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/components/termux-service/cli.ts)。
- **[M6] Termux 原生部署**：[MooseTermuxModule.kt](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/vendor/moose-termux-native/android/src/main/java/expo/modules/moosetermux/MooseTermuxModule.kt)、[bootstrap](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/vendor/moose-termux-native/android/src/main/assets/moose-termux-bootstrap.sh)。
- **[M7] 作者验证记录**：[background-recovery.md](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/docs/background-recovery.md)、[README](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/README.md)。
- **[M8] 测试源码**：[background-sse.test.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/tests/background-sse.test.ts)、[smoke-portable.mjs](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/scripts/smoke-portable.mjs)。
- **[M9] 可选 iSH 许可边界**：[集成说明](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/docs/ios-ish-execution.md)、[被固定的 iSH 许可](https://github.com/ish-app/ish/blob/c5ebcabec14f1d8709e91e1905ce0edd7cb9c13c/LICENSE.md)。
- **[E] 文件适配库**：[src/index.ts](https://github.com/sugarforever/pi-durable-expo-env/blob/d60ce108e9690ad0b58eb462216421524c6cacc3/src/index.ts)、[src/core.ts](https://github.com/sugarforever/pi-durable-expo-env/blob/d60ce108e9690ad0b58eb462216421524c6cacc3/src/core.ts)、[验证记录](https://github.com/sugarforever/pi-durable-expo-env/blob/d60ce108e9690ad0b58eb462216421524c6cacc3/docs/validation.md)、[许可](https://github.com/sugarforever/pi-durable-expo-env/blob/d60ce108e9690ad0b58eb462216421524c6cacc3/LICENSE)、[npm 固定版本元数据](https://registry.npmjs.org/pi-durable-expo-env/0.1.0)。
- **[R] rho**：[安装脚本](https://github.com/mikeyobrien/rho/blob/073a3ee8a5dc0efd5dd32d773a760575ed38abc7/install.sh)、[RPC 进程](https://github.com/mikeyobrien/rho/blob/073a3ee8a5dc0efd5dd32d773a760575ed38abc7/web/rpc-manager.ts)、[Android Service](https://github.com/mikeyobrien/rho/blob/073a3ee8a5dc0efd5dd32d773a760575ed38abc7/mobile/rho-android/android/app/src/main/java/dev/rhobot/rhoandroid/LiveModeService.java)、[版本](https://github.com/mikeyobrien/rho/blob/073a3ee8a5dc0efd5dd32d773a760575ed38abc7/package.json)、[许可](https://github.com/mikeyobrien/rho/blob/073a3ee8a5dc0efd5dd32d773a760575ed38abc7/LICENSE)。
- **[D] pi-droid**：[ADB 执行](https://github.com/ArtemisAI/pi-droid/blob/742aadb456c9e78297b687321bfe0984106f5eb3/src/adb/exec.ts)、[许可](https://github.com/ArtemisAI/pi-droid/blob/742aadb456c9e78297b687321bfe0984106f5eb3/LICENSE)。
- **[F] Ferngeist**：[ACP 传输](https://github.com/arafatamim/Ferngeist/blob/e85485f01d9a967a3c64aea376784f6c569d96ae/acp-bridge/src/main/kotlin/com/tamimarafat/ferngeist/acp/bridge/connection/AcpTransportClient.kt)、[发布提交](https://github.com/arafatamim/Ferngeist/commit/e85485f01d9a967a3c64aea376784f6c569d96ae)、[许可](https://github.com/arafatamim/Ferngeist/blob/e85485f01d9a967a3c64aea376784f6c569d96ae/LICENSE)。


## 补充澄清：Termux 冷启动证据（2026-11-03）

**结论：这是已记录的重启后启动失败，但与“完成配置后的普通冷启动”之间仍有未解决的区别。不能把它归为仅首次配置限制，也不能据此断言每次都必须手工打开终端。** 本节限定前文“冷启动限制”的含义。配置后不应反复要求用户手工启动终端，这个硬要求不变。

固定修订仍为 `a48d170309f8587c733a232f6d4fd12c7cc3d6c5`。

- **首次 bootstrap：** `docs/termux-setup-guide.md:14–29` 明确要求首次打开 Termux 完成初始化、授权并设置 `allow-external-apps`。这证明初次配置步骤存在，不证明后续每次启动需要它。
- **模糊摘要：** `docs/background-recovery.md:39` 写的是 “after a cold/inactive service state”。同段说打开一次建立了测试前提。它没有说明该状态的完整来源，也没有证明限制仅发生一次。
- **更具体的作者记录：** `docs/termux-recovery.md:53` 写明 “when Termux had no running process after reboot”，并记录 `MooseTermux.start` 遇到 `BackgroundServiceStartNotAllowedException`。打开 Termux 后连接成功。它不是仅记录首次解压 bootstrap。可是该段没有完整记录重启前是否已完成并验收配置、是否有待恢复运行、解锁状态、应用 stopped 标记、调用时前后台状态或完整异常日志。不得补推为显式强行停止、厂商冻结或某项特定系统豁免缺失。
- **显式强行停止：** 上述冷启动段没有记录对 Termux 的 force-stop。`background-recovery.md:33` 的 SIGKILL 对象是 Moose，不是 Termux；它也不是 Android 设置中的强行停止。不能混用这两项证据。
- **仅执行桥死亡：** `termux-recovery.md:18–19` 记录只 SIGKILL 空闲 Node 执行桥后，返回 Moose或提交新请求会自动启动新桥。无需手工重连。这证明执行桥重启，不证明整个 Termux 应用进程不存在时可以启动。
- **冻结恢复：** `background-recovery.md:35` 和 `termux-recovery.md:47–51` 记录已有 Termux 服务、`isFrozen=true`、`sync unfroze 2074 com.termux for 6`，以及同一 Node PID `2147`。签名文件和 Bash 调用成功，无需打开 Termux。这是已有进程解冻，不是冷启动。单独的前台返回实验也不证明必须由修复调用触发解冻。

**启动代码：** `src/platform/termux.ts:180–203` 自动调用限时 `checkOrRepair`。`src/termux/setup.ts:109–147` 先探测；离线时调用 `native.start`，随后再次探测。`MooseTermuxModule.kt:135–149` 通过 `context().startService(intent)` 启动 `RUN_COMMAND`。没有自动打开 Termux Activity 的回退。`openTermux` 是独立入口，见同文件 `80–83` 行。`status` 只报告安装、权限和本进程的部署状态；没有判别首次安装、force-stop、重启后无进程或一般进程回收。因此，同一段部署代码被用于首次设置和后续修复；方法名 `setup` 不能证明故障仅属于首次配置。

**需求判定：** 作者记录证明该次重启后尝试没有达到无人值守启动。它不足以判定固定配置下所有普通冷启动都会失败，也不足以排除完成设置后的失败。若完成配置、首次解锁且系统允许运行后仍必须打开终端，则不满足我们的硬要求。现有资料不能替代这个条件完整的验收。

补充发现：`termux-recovery.md:33–43、57–65` 还有旧 Moose `v0.3.0` 的 Xiaomi 真机故障记录。打开 Termux 有时恢复未鉴权 HTTP 响应，但后续签名自检仍超时。新修复未在该手机上验证。此记录既不是当前版本自动恢复通过，也不是上述重启冷启动的原因证明。

新增固定来源：[termux-recovery.md](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/docs/termux-recovery.md#L13-L65)、[setup guide](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/docs/termux-setup-guide.md#L14-L29)、[platform/termux.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/platform/termux.ts#L180-L203)、[termux/setup.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/termux/setup.ts#L109-L147)。后台摘要与 Kotlin 启动代码见 [M7]、[M6]。
