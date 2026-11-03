# T04 验收证据

对应 [T04 工单](../../specs/v1/tickets/04-durable-conversation.md) 与 [实现说明](../../../runtime/APPLICATION.md)。使用真实 Pi Durable/Chord/Pi AI 1.5.0、T02 SqliteStorage 和 T01 Javet NodeI18n 6.0.3；只将确定性测试的外部模型 HTTP 换成 fixture。真实 Provider 用例使用用户授权的 MiMo，不把研究或桌面测试冒充设备结果。

第五最终候选的模拟器完整套件 4/4 通过（44.409 秒），Galaxy S23 的停止与真实 MiMo 子集 2/2 通过（5.823 秒）。模拟器覆盖实际 React 两会话、唯一 UI 绑定时 Activity 重建、正常关闭／重开运行宿主、大历史跨 Binder、完整原文展开、停止及真实 MiMo。S23 锁屏下的 ActivityScenario 重建仍未通过，不能将子集结果写成实体设备全部 UI 已验收。

| 产物 | SHA-256 |
| --- | --- |
| 最终 debug APK | `e385ed92e6a11fc2605c7d1eb3665f18ac1306a77b560afa26a816bea2b09659` |
| 最终 instrumentation APK | `a9781cecefb55703ad924607b7f42b839b36ee90d4ed77639aa81246a19114d6` |

运行平台：Android 16 / API 36；16 KB page-size x86_64 模拟器及 4 KB page-size ARM64 Galaxy S23。SDK/runtime/SQLite 版本延续 [T01](../t01/README.md)／[T02](../t02/README.md)。此处没有 ARM64 16 KB 实体设备结果。

最终日志：[模拟器完整套件](emulator-final-instrumentation.log)、[S23 两项子集](s23-final-subset-instrumentation.log)。六条用户输入中包含五条约 90,000 单元文本及一条 90,000 U+0001 控制字符文本，聚合历史 1,981,410 UTF-16 bytes／12 条消息。断言全部六条原文相同、实际 React 展开第一条 90,000 单元原文、重建后重新折叠且整页历史 JSON 相同、模型请求仍为六次；不是只检查消息数量或截断预览。

真实 MiMo 验证使用两个独立产品会话、共两次模型请求；正常关闭后用不含原 Provider 的验证 Models 重开，两个历史 message IDs／原文仍完全相同，新增模型请求为零。该策略同时验证读取旧历史不依赖 Provider 当前可用性。正常响应后的 transport abort 清理字段不是本票的显式停止证据；停止由单独挂起传输用例验证。

另在最终 APK 上，两台设备均完成真实 UI 进程 SIGKILL／重新进入测试。动作只通过实际 React 新建／发送／导航控件，没有额外 observer 绑定。模拟器 UI PID 13385→13521，Agent PID 始终 13473；S23 UI PID 28311→28505，Agent PID 始终 28428。两会话已完成历史的全部 message IDs 和原文在重连后相同。证据：[模拟器进程重建](emulator-ui-process-real.json)、[S23 进程重建](s23-ui-process-real.json)；可复现脚本为 [application-ui-process.mjs](../../../android/scripts/application-ui-process.mjs)。这里的进程检查不声称观测了模型请求计数，计数由独立 instrumentation 用例提供。

模拟器实际重连界面已检查：[截图](emulator-reconnected.png)。S23 当时仍有系统 keyguard，截图前 viewport 为 0×0，重连后 360×780 但截图回调超时；JSON 明确保留此诊断，只认可其 DOM／进程断言，不声称实体机已解锁或通过可见界面、键盘验收。

最终 APK 及 test APK 的 SHA-256 与设备安装候选一致，SDK36 `zipalign -c -P 16 4` 通过；两 ABI native SO 的 SHA-256 与 T01 固定 i18n AAR 原件完全相同。版本和哈希索引见 [artifacts.json](artifacts.json)。独立静态评审确认双向有界 ACK 分片、连接／timeout 清理、两侧共享扩展描述及长消息原文保留；`aapt2` 核对了打包备份配置的 9 个域×2 通道和 manifest 禁用备份开关。这些配置检查不替代 T16 的实际备份／迁移测试。

## 桌面与构建

- Node 24.14.1：runtime 75/75 通过，包含新增 13 项应用公开 Interface/真实 SQLite 行为测试及 T01/T02 原有 62 项回归。
- React 19.3.1：UI 10/10 通过。新增真实 React → Application → SDK → SQLite 测试验证共享扩展身份、创建、发送、重开历史与没有额外请求；其余 wire fixture 测试验证旧代次/revision、分页、配置门槛与进度状态。长消息用例验证明确折叠、完整原文展开／收起及短消息保持。
- TypeScript、Vite production build、Android debug app/test 构建通过。资产不含 UI 测试 fixture、source map 或 SDK；Android runtime 包保留固定 npm closure。
- 最终 Android `:app:lintDebug` 通过（22 秒）；版本化公开文件的精确真实 Key／设备 serial 扫描为零命中。该扫描不替代 T05 的完整凭据边界验收。
- 独立评审复跑 13 个应用测试通过，复现并确认 pending subscribe/disconnect 旧更新竞态修复。另补测 fatal SQLite 失败通知及新版配置保留原数据。

## 验收映射

| 工单要求 | 可复现断言 |
| --- | --- |
| 稳定默认工作区、创建重试同一身份 | application.test：重复及五个并发 create 仅一个产品登记；workspaceId 相同 |
| 登记／关联／模型同一创建提交 | 创建 COMMIT 故障后重开无半个产品；创建不包含首次输入 |
| 两产品会话共域但独立历史；内部会话不可见 | 桌面真实 SQLite 与 Android 两会话；预先创建的非产品 SDK conversation 不进列表；复用 T02 OS domain lease |
| 页面只通过应用 Interface | 真实 React DOM 点击创建/发送；严格本地 WebView bridge、公开动作白名单及版本失败 |
| 流式、等待、失败、完成与保存区别 | 实际 SDK SSE 流；retry→waiting→failed；progress.persisted=false、历史 persisted=true；fatal Storage 订阅通知 |
| 正常关闭重开及失败保留 | 两会话历史／标题／模型保持；新版 configuration 不能读取但原 marker 可由新版打开 |
| UI 重建不重发、不另开写者、不停止 Agent | Android UI 唯一绑定期间重建前后 native instance 相同；输入数与模型请求数不增加；正常重开后换 native instance |
| 完整快照恢复、旧连接不能覆盖 | UI generation/revision 测试；核心 pending attach 失效；detach 后继续完成；大历史分片重连 |
| 初始化配置／宿主／协议门槛 | 实际 Harness.open settings getter；配置加载时 create/send/stop 被拒；到期持久 retry 门槛前 0 请求、开放后 1 请求 |
| 两侧薄扩展、核心控制保持 | 同一个 data-only CONVERSATION_EXTENSION descriptor；UI 独立 lazy chunk；核心拥有 Storage/gate/stop |
| 自动化完整纵向路径 | ApplicationTest.realReactTwoConversationsReconnectAndNativeReopen；真实 SQLite、DOM 点击、UI 重建、native 正常重开 |

## 保留的失败与限制

首次候选模拟器通过 3 项确定性设备测试，真实 Provider 用例跳过。S23 首次失败暴露测试在 input 仍 disabled/loading 时注入事件的时序条件，并且 cleanup 复用已断开的测试 Wire，掩盖了初始错误；已修复等待条件及不掩盖原错误的清理。

第三候选模拟器 4/4 通过（51.352 秒），包含真实 MiMo；聚合历史约 1,981,410 UTF-16 bytes／12 条消息，穿过分片通道。第三候选 S23 原始错误已明确为锁屏状态下 ActivityScenario.recreate 只能观察到 STOPPED，无法进入要求的 RESUMED；不能将此用例标为通过，也不能归因于未证实的 freezer。设备当时 Awake、stayOn=true、keyguard 仍显示。解锁后的实体设备 UI 重建矩阵由后续验收补齐。

第四候选加入全部六条用户原文比对及大历史重连断言后，模拟器 3/4 通过（63.112 秒）：真实 MiMo、双会话完整路径和停止通过，大文本用例在 WebView DOM 回调等待处超过 10 秒而失败。此时原生公开 Interface 已完成完整原文核对；相关日志没有崩溃或 ANR 证据，不能称为 renderer 崩溃。针对大批长文本的展示成本，后续候选增加明确的展开／收起显示，保持完整历史数据并验收实际展开原文，不用放宽超时来替代修复。第四候选 S23 单独运行停止与真实 MiMo 两项通过（5.049 秒），该子集不覆盖锁屏下的 ActivityScenario 重建。

WebView 16 KB 镜像此前曾有一次 renderer 崩溃，后续原始与最小页多次复测未再现；本切片提供手动恢复机制，不宣称修复了系统组件或证明其永不崩溃。

真实 Key 不进入版本化产物；完整设备 logcat 含无关平台信息，仅保存在本机外部证据目录，不直接提交。设备 serial、账户和凭据不得进入本目录。
