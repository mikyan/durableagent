# T01：验证应用内运行宿主能够运行 Pi SDK 1.5.0

执行结果（2026-11-04）：已通过，合入集成分支 `dcc8fca`。固定官方 Javet i18n 6.0.3 在 S23 ARM64 / 4 KB 与 API 36 x86_64 / 16 KB 模拟器各通过 3 项完整仪器测试，含真实 MiMo；另有 6 项桌面测试。标准非 i18n 变体的失败、固定产物、测量及范围见[实测报告](../../../evidence/t01/README.md)。本票提供 T02 的运行时前提，远端随完整交付 PR 合并关闭。

## What to build

交付一个可重复运行的最小 Android 验证闭环：从本应用发起一段受控文本会话，在与 WebView UI 分开的运行宿主中加载真实 Pi Durable／Pi AI 1.5.0，观察增量回复、取消、关闭和重新创建。先验证 Javet Android Node，形成可供后续工单采用的证据和失败退出结论。

## Acceptance criteria

- [x] 固定实际 SDK 发布产物、传递依赖、Javet AAR 和构建工具版本，记录来源、摘要及与研究基线的差异；不使用浮动 latest，不以本机 1.3.0 代替 1.5.0。
- [x] 本应用以 compileSdk／targetSdk 36 构建；核验 ARM64 原生依赖、实际 Node 版本、最终 APK 的 ELF／打包对齐及 16 KB 页面兼容条件，记录具体设备或验证环境。
- [x] 实际创建运行时并加载 SDK；静态导入、package exports、相对导入、import.meta、Node 内建模块和启用的 lazy Provider 导入均经过真实入口验证，不能只凭 loader 未报错判成功。
- [x] 通过真实 SDK 文档跟踪、pi-schema 参数校验、异步迭代、WeakRef／Proxy、随机数、文本编解码与取消路径验证必要运行能力；不以假 WeakRef 或删除校验约束补齐。
- [x] 使用确定性模型传输夹具完成一次会话，任意分块的 UTF-8、SSE 和工具参数不损坏，回复为增量输出；取消能够中止挂起读取。此项不宣称任何真实 Provider 已验收。
- [x] UI 页面销毁／重建不销毁运行宿主；在最小观察界面中重新连接可以看见当前状态，主 Agent 始终属于本应用而非外部 Termux。
- [x] 正常关闭、运行时故障、再次创建和重复启动分别验证；没有遗留 JNI 资源导致的不可重建，也没有两个活动 SDK 写入所有者。持久化故障恢复由 T02 验收。
- [x] 记录启动耗时、会话峰值内存、关闭／取消耗时和测试输入，给出可复现的通过／失败清单，不把测得数字泛化为未测试设备保证。
- [x] 若 SDK 加载需要大量自维护 resolver、无法满足异步／关闭契约或原生交付物不兼容，门槛判失败并保留复现；重新比较应用自有 Node 子进程／独立 Hermes，不静默降低 target、移动主 Agent 或改换 UI。
- [x] 结果明确区分源码证据、模拟器结果与目标设备结果。T02 只有在本票产生满足其 SDK／运行时前提的通过证据后才能开始。

## Blocked by

无（设计依赖已具备；执行仍须另行授权）。

## Implementation notes

- 已确认：Kotlin 管理独立应用运行进程，TypeScript 组织业务，UI 只调用和观察；Pi Durable 执行状态机不另写一份。
- 自主细化：最小观察界面和受控模型响应只覆盖验证闭环，不建立完整产品页面或万能多引擎框架；先比较真实 Node loader 引导及合理打包，避免维护 npm resolver。
- 运行时状态由 Kotlin 宿主管理，SDK 会话事实由单一 Session 管理。加载失败、SDK 初始化失败、模型传输失败和宿主退出分别报告，页面显示启动不等于就绪。
- 本票可采用非持久测试存储隔离运行时问题；不得将其冒充生产耐久方案。生产运行时仍须综合 T02 与后续设备结果收敛。

## Test seam

最高入口是最小应用会话动作与观察 Interface；内部使用真实 SDK、受控模型传输和实际 Android 宿主。复用 SDK 已有可移植行为及研究中的导入／primitive／传输用例，按 1.5.0 更新。当前仓库没有生产测试套件，不能声称复用了本仓库已有测试。

## Scope and execution boundary

范围是候选验证和证据报告，不交付完整应用、不承诺所有 Provider 或所有 Android 16 设备。编写验证工程、下载／安装运行时或 SDK、运行上游代码及设备操作，均需本次 spec 工作之后的明确执行授权。ready-for-agent 表示工单设计可承接，不代表已有这些授权。

## Sources

- [技术设计：Q5 与运行验证基线](../../../technical-design.md)
- [运行时候选交叉复核](../../../research/runtime-candidate-review.md)
- [Android 16 宿主约束](../../../research/android16-host-baseline.md)
- [SDK 1.5.0 契约差异](../../../research/pi-sdk-1.5-delta.md)
- [旧基线宿主契约及待更新用例](../../../research/pi-sdk-android-contracts.md)
- [Aether 的应用自有 Node 对照](../../../research/aether-synthesis.md)
