# Android Agent 技术研究索引

研究日期：2026-11-03。当前仅完成文档、源码和发布元数据研究；未实施生产代码、未下载或运行原生交付物、未做 Android 设备测试。

## 从这里开始

[第一轮开源研究汇总](android-architecture-synthesis.md)：固定条件、项目比较、关键发现、候选顺位和验收门槛，保留该轮原始提问。

[Aether 补充结论](aether-synthesis.md)：说明应用自有 Node 子进程、外部 Termux、完整初始化命令及自动启动的真实证据。

**最新决定：**用户已确认 Q3-I（独立官方 Termux 两个 APK）、首次初始化体验、Q6（SDK 1.5.0 基线），并报告小米 15／S23 均运行 Android 16；Q5 维持已原则认可的 Javet Node 首个验证候选。用户现已确认本应用 `compileSdk=36`／`targetSdk=36` 验证基线，以及首版 Android 16 起、ARM64 范围；Q8 的 TypeScript 业务主侧与 Kotlin 平台控制分工也已确认，系统授权与首版不实现的操作审批必须区分。Q9—Q11 的工具环境、固定核心与扩展、模型配置职责，以及 Q12 的薄扩展描述现均已确认。已进入[领域模型与持久化](../data-design.md)讨论，Q13—Q26 均已确认，[应用记录设计](../data-records.md)中的 Q27—Q35 也已全部确认；常规工程细节由代理收敛至 [spec／工单](../specs/v1/README.md)；相关依据见 [Module 设计](../module-design.md)和 [技术设计树](../technical-design.md)，不重新打开已确认项，也没有开始实现。

研究与正式决定分开：当前决定见 [technical-design.md](../technical-design.md) 和 [ADR](../adr/)。各报告保留研究当时的状态；最新用户确认以主设计与 spec 为准。未通过的运行时与设备验证不能因政策确认而改写为成功。

## 本轮专项研究

| 文件 | 主要内容与边界 |
|---|---|
| [android-js-runtimes.md](android-js-runtimes.md) | Javet Node、nodejs-mobile、Hermes、QuickJS/Zipline、Javet V8；版本、Android 发行物、JNI、调度和生命周期。仅提出验证顺位 |
| [pi-android-reference-projects.md](pi-android-reference-projects.md) | Moose 的真实 Agent 放置、平台 Adapter、Termux 桥与后台实现；区分 UI 卸载、共享运行时和独立进程。末尾补查冷启动证据 |
| [termux-integration-reference-projects.md](termux-integration-reference-projects.md) | AcodeX、VHEditor、Monet、官方 Termux；部署、包源、前缀、启动、文件、停止和许可 |
| [pi-sdk-android-contracts.md](pi-sdk-android-contracts.md) | **SDK 1.3.0** 的详细宿主契约、存储、Provider、执行与恢复；24 项后续契约测试。不可直接套用到 1.5.0 |
| [pi-sdk-1.5-delta.md](pi-sdk-1.5-delta.md) | **1.3.0 → 1.5.0** 关键差异：SQL、存储收据、deferred progress、sleep/wake、重启预算、watch、schema；10 项增量验收。不是全部依赖重审 |
| [android-file-access-and-workspaces.md](android-file-access-and-workspaces.md) | 私有目录、共享存储 `noexec`、SAF、原始文件和一致命名空间；不把 `/sdcard` 或副本当作完整解决方案 |
| [runtime-candidate-review.md](runtime-candidate-review.md) | 交叉复核 Javet 的 SQLite 构建与 ESM 限制、Hermes 配置、运行时与部署／ABI 的依赖；保留本应用 Node 子进程比较路线 |

## Aether 与目标设备补充研究

| 文件 | 内容与限制 |
|---|---|
| [aether-runtime-reference.md](aether-runtime-reference.md) | 应用自有 Alpine／PRoot Node 子进程、Pi Coding Agent 1.3.0、进程通信、存储和测试；不是 Javet 或 Durable 1.5.0 成功证明 |
| [aether-termux-execution-reference.md](aether-termux-execution-reference.md) | 一次初始化、复制命令、自动 Service dispatch；冷启动未验证，不将空 root 开关或排障按钮误判为禁止自动启动 |
| [target-device-baseline.md](target-device-baseline.md) | 厂商一手资料及证据缺口；后续用户已报告两部手机均为 Android 16，仍不等于完成 ABI／系统配置检测 |
| [android16-host-baseline.md](android16-host-baseline.md) | 本应用 36/36 验证基线、JNI 与 exec 的区别、双 APK target、FGS、通知、作业配额及支持范围；没有选择生产设置 |

## Module 与数据契约补充研究

| 文件 | 内容与限制 |
|---|---|
| [pi-sdk-1.5-extension-composition.md](pi-sdk-1.5-extension-composition.md) | SDK 扩展字段、registry 组合、重名差异、任务与 UI 生命周期；薄应用描述方向随后已由 Q12 确认，不另造 SDK 注册机制 |
| [pi-sdk-1.5-data-authority.md](pi-sdk-1.5-data-authority.md) | SDK 已存历史与控制数据、宿主仍需补充的产品事实、真实存储 Interface，以及请求选项复制凭据的路径；SQLite 方向后来由 Q20 确认，schema 与加密仍未定 |
| [pi-sdk-1.5-data-policy.md](pi-sdk-1.5-data-policy.md) | document 作用域／fork／迁移、创建事务、启动就绪、模型更改与各类重试的不同读点、工作区宿主责任，以及图片必须内联的输入契约；研究不替用户作决定 |
| [pi-sdk-1.5-input-and-retirement.md](pi-sdk-1.5-input-and-retirement.md) | 输入批次、run／generation／idle 的区别、事务接纳与上下文接入、SDK 没有会话历史删除 Interface、文档退休及自定义 Provider 身份；未运行 SDK |
| [android-private-data-and-backup.md](android-private-data-and-backup.md) | Keystore 与 API Key 密文、CE／锁屏认证、密钥失效、云／D2D 备份限制，以及原生 SQLite／DataStore／SharedPreferences 的能力区别；未做设备测试 |

## 此前的机制研究

- [termux-exec.md](termux-exec.md)：预加载、启动兼容、系统 linker 模式及限制。
- [termux-packaging-options.md](termux-packaging-options.md)：官方包前缀、应用 ID、仓库与 APK 签名区别。
- [termux-managed-startup.md](termux-managed-startup.md)：外部调用、首次配置、生命周期、输出与取消的已有能力和缺口。

## 证据使用规则

- 固定源码、作者测试记录、本轮实测与工程推论必须分开；本轮没有 Android 实测。
- 使用 1.5.0 前必须结合差异报告，不沿用 1.3.0 的数据库方法列表、watch 类型或校验器假设。
- SDK 存储收据不是命令执行收据。UI 已显示不是已持久化。界面重连不是执行恢复。
- 新研究中的反例会限制旧研究的泛化：特别是 Moose 的重启后启动失败，不能写成仅首次初始化问题。
- 参考项目的界面、任务模型、审批、周期任务或完整后端，不自动成为本产品要求。
- 当前只讨论已满足前置条件的选择。研究可以先固定 SDK 验证基线，但这不等于批准生产采用。具体协议、生产版本与运行时必须结合部署和明确的验收范围再锁定。
