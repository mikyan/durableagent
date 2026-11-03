# Aether 补充研究：能借鉴什么，哪些决定仍未完成

日期：2026-11-03。固定源码：[`Zhou-Shilin/Aether@8496962`](https://github.com/Zhou-Shilin/Aether/tree/849696285d96657bb2f6e77229e795fa6822c2df)。

> 后续用户确认：优先采用本应用 + 独立官方 Termux 两个 APK，小米 15 和 Galaxy S23 均运行 Android 16；已记录 ADR 0005。下文保留本轮研究的原始讨论位置，当前前沿以 `docs/technical-design.md` 为准，不再要求回答 Q3-I。

本轮聚焦 Android 运行时、主 Agent 所有权、Termux 接入与生命周期；不是整个项目的全面安全审计。只读源码、文档和公开元数据，没有安装、运行上游代码、下载原生交付物或操作设备。

## 1. 先记录用户已经确认的内容

- **启动体验已确认**：正常使用最多只在首次初始化要求人工处理。需要命令时，应用提供完整命令、执行位置说明、便捷复制和成功检查；不能反复要求用户手工开启终端或重输启动命令。
- **Q6 已确认**：以固定 Pi Durable / Pi AI **1.5.0** 作为设计与验证基线，不是现在安装或宣布生产可用。
- **Q5 原则上赞同、指定的 Aether 补查已完成**：复核后仍保留 Javet Node 首个验证候选，不重复询问同一个顺位；这不是已经验证的生产架构，也不是开工授权。
- 目标手机：**小米 15、三星 Galaxy S23**；平板计划为**小米平板 9**。实际 Android 版本和设备配置尚未核验。
- 以上没有自动决定具体 APK 部署、应用 ID、`targetSdk`，也不授权生产或验证工程。

## 2. Aether 实际运行在哪里

**它提供了另一个有价值的实现：主 Agent 运行在本应用拥有的 Node 子进程中，而不是在 Javet 中。**

```text
Aether 默认 Android 应用进程
  Compose UI / Kotlin 控制器 / 前台通知 Service
          │ JSONL stdin/stdout，独立 stderr
          ▼
本应用私有 Alpine + PRoot
  Node 子进程 → Pi Coding Agent / Pi AI
          │ 工具可以路由到
          ▼
应用内 Alpine，或独立官方 Termux
```

源码中，`PiKernelBridge` 通过 `AlpineRuntime.startManagedProcess()` 启动 `node .../bridge.mjs`；`bridge.ts` 创建 `AgentSession` 并调用模型。选择 Termux 工具环境不会把这个主 Agent 移到 Termux。

这支持我们已确认的“主 Agent 在本应用、Termux 只负责工具”分工。这里的“Node 子进程”不是外部 Termux 应用，也不要求采用完整桌面 HTTP 后端。

来源：[PiKernelBridge](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/pi/PiKernelBridge.kt)、[Alpine 启动构造](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/AlpineRuntime.kt#L721-L812)、[Node bridge](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/src/bridge.ts)。

### 不能混淆的 4 件事

| Aether 的真实实现 | 对我们意味着什么 |
|---|---|
| 本应用拥有的 Node **OS 子进程** | 这是已有源码先例，不应只当作遥远兜底方案 |
| Kotlin 控制器和前台 Service 仍在默认应用进程 | Node 已与 UI 分进程，但没有完整实现我们要求的独立运行宿主所有权、UI 进程死亡后的控制与恢复 |
| 内置 **Alpine + PRoot**，外部 **Termux** 可选 | 不是将完整 Termux 改包名内嵌；不能以 Alpine 替换已确认的 Termux 命令环境 |
| Pi Coding Agent / Pi AI **1.3.0** | 不是 Pi Durable / Pi AI **1.5.0**，不能复制其会话存储和生命周期来代替 Durable 契约 |

其 Android 构建声明 `minSdk=26`、`targetSdk=28`、`arm64-v8a`。这些是参考项目条件，不自动成为我们的选择。源码要求 Node `>=22.19.0` 并用 `apk` 安装；这不是锁定了某个确切 Node 发行版本。

来源：[Manifest](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/AndroidManifest.xml)、[Gradle](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/build.gradle.kts)、[Pi 依赖](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/pi-bridge/package.json)、[Node 安装与版本核验](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/shared/src/commonMain/kotlin/com/zhousl/aether/runtime/PiNodeRuntimeSetup.kt)。

## 3. 你要求的首次初始化，它确实有值得借鉴的代码

Aether 的 Termux 引导包含：

1. 检查是否安装外部 `com.termux`，并给出安装入口。
2. 请求 `RUN_COMMAND` 系统权限。
3. 准备完整配置命令，提供“一键复制并打开 Termux”。
4. 用户粘贴执行后，运行真实 Bash 探针检查就绪，而不只是勾选“已配置”。
5. 后续命令自动调用 Termux Service。

这是与用户新要求直接相关的参考，而不是把配置工作留给用户查文档或拼命令。

来源：[初始化界面](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/ui/OnboardingScreen.kt#L1258-L1346)、[命令与探针实现](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt)。

### 自动启动的准确结论

**Aether 已实现自动 Service 启动调用；完整冷启动／重启恢复效果仍未由本轮验证。**

- 实际代码先调用 `startForegroundService()`，异常后尝试 `startService()`。
- 代码中的空 root 启动开关不控制这条 Service dispatch，不能只看其注释就断言“不自动启动 Termux”。
- 超时分支确实提供手工打开 Termux 的提示，但这不证明正常冷启动必然要手工操作。
- 尚未找到足够证据证明：首次配置之后，目标设备在正常冷启动、进程回收和重启后都能完成受管启动。

所以不能直接给它判“冷启动失败”，也不能直接认证“已经满足零重复人工操作”。只有实际一般场景反复依赖手工 fallback，才违反我们的要求；强行停止、撤销权限等阻塞必须单独识别并明确显示。

来源：[实际启动调用](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L713-L719)、[空 root 开关](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L92-L96)、[超时提示](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L664-L676)。

## 4. 可以借鉴行为，不能照搬保证

| 可借鉴 | 仍需补齐 |
|---|---|
| 进程 generation、request ID、旧响应隔离 | SDK 唯一写 owner、进程死亡后持久关联与恢复 |
| stdin/stdout JSONL 协议，日志不占协议 stdout | 有界帧、背压、重连和可靠取消确认 |
| Termux 的命令目录、日志、状态查询 | 原子接纳去重、真实进程身份、重启核验、用户停止不复活 |
| 一次配置、复制命令、实际执行探针 | 正常冷启动免重复人工；准确区分缺权限、未就绪和平台禁止 |
| 系统文件管理器直接访问 Alpine 工作区 | 这不是 Agent 原位操作任意授权手机文件；URI 导入仍会复制到工作区 |

特别不能照搬的判断：

- 找到取消目标并发起 abort，不等于所有模型请求和后代进程都已停止。
- 写了 `cancelled` 状态，不等于已经核验停止成功。
- 有日志和 PID，不等于有可靠的持久执行收据；PID 还可能被重用。
- 有 JSONL 对话文件，不等于 Pi Durable 的 checkpoint、commit receipt 和恢复语义。
- 有 Android 测试文件，不等于测试通过；所查 ping 测试仍断言旧 Pi `0.83.0`，与当前依赖 `1.3.0` 不一致。

Aether 根许可为 **GPL-3.0**。其集成代码不能因为调用 MIT 的 Pi 就当成 MIT。复制和分发前需按实际代码及 native 组成处理许可；本轮只参考 Interface、行为和测试思路。

## 5. 对 Q5 的建议有什么变化

**Javet Node 仍可作为第 1 个小范围验证候选；Aether 让“应用自有 Node 子进程”成为更有依据的对照路线。**

理由和代价必须一起看：

- **Javet Node**：有现代 Android 发行物，有望不另带 Linux 用户态环境；但真实 Node loader、SDK 1.5.0、JNI 线程、事件循环与关闭仍需验证。
- **应用自有 Node 子进程**：Aether 给出了实际启动、标准 Node ESM 和进程通信实现，可避免 Javet 特有的 loader 接线；其现成方式另带 Alpine／PRoot，且依赖低 target、原生组件来源、包安装和子进程监督条件。
- **独立 Hermes**：仍可比较，但不能仅因为 Javet 失败就自动胜出。Moose 的 RN/Expo 绑定也不是独立 Kotlin 宿主。

如果 Javet 为加载 SDK 就需要大量自维护 resolver，应及时重新比较 Node 子进程，而不是为了保持先前建议继续堆适配。反过来，Aether 的存在也不能代替 SQLite、恢复、停止、原文件与设备测试。

**修正此前过窄的措辞：**“应用自有 Node 子进程必须使用 Android/Bionic 构建”并不覆盖所有路线。直接执行必须满足 Android 实际执行与链接条件；Aether 则给出“Android 宿主 + 应用自带 Linux 用户态／PRoot + Node”的另一条路径。相关两份旧报告已更正。

这不批准引入 Alpine，不改变完整 Termux 的命令环境选择，也不把主 Agent 移到外部 Termux。最终运行时仍未决定。

## 6. 设备信息的用途

小米官方资料确认 Xiaomi 15 使用 Snapdragon 8 Elite；三星官方资料确认 Galaxy S23 使用 Snapdragon 8 Gen 2 for Galaxy。可优先评估 ARM64 候选，但仍须实际核对 Android 版本、ABI、页面大小及厂商后台限制。

此次未确认准确型号 Xiaomi Pad 9 的可用官方规格，因此保留为计划设备，不用其他代际或 Pro 型号代替，也不宣称该型号不存在。

厂商出厂系统和某个地区的升级记录不能代表用户当前系统。设备版本待用户提供或获准后从设备核验；本轮没有访问设备。

## 7. 当前状态与下一轮

已经确定：启动体验上限、SDK 1.5.0 基线、既定 UI 和主 Agent／工具分工。Aether 补充研究已完成，用户不必再回答 Q6。

仍需核对 **Q3-I 的具体部署**：是否优先采用独立官方 Termux APK，以保留官方包生态。自动冷启动、文件访问与停止恢复必须验收；首次体验的接受不等于已选择具体 APK 形态、替换现有 Termux 或维护自有包仓库。

Q5 按用户原则认可的首个验证候选继续讨论：Javet Node 先验，应用自有 Node 子进程与 Hermes 保留比较。Aether 复核没有要求改变这个顺位，因此不重问；但实际生产运行时仍未选，当前不安装、不写验证工程。

下一层的具体运行时版本、每个 APK 的 target、存储引擎和通信协议仍依赖上述决定及验证条件。不会为了参考 Aether 而改用 Compose、Coding Agent 内核或动态扩展市场。

## 详细报告

- `docs/research/aether-runtime-reference.md`：运行时、主 Agent、SDK、存储、进程通信、测试和许可。
- `docs/research/aether-termux-execution-reference.md`：完整初始化与复制入口、自动启动、执行状态、文件、取消及恢复缺口。
- `docs/research/target-device-baseline.md`：厂商一手资料、已知与未知设备条件。
