# 随包扩展与明确转交

T14 的入口是 `src/extension-protocol.ts` 中的 data-only 描述。描述只关联应用身份、名称及可选入口键。UI 独立解析为共用宿主 React 的动态模块；Node 独立解析为实际 Pi Durable 1.5.0 Extension。描述不含 React 函数、SDK 闭包或可执行控制权限。

当前示例：

| 功能 | UI 入口 | SDK 贡献 |
|---|---|---|
| 会话时间线 | 自定义历史、过滤、分页、进度订阅 | 无 |
| 明确跨会话转交 | 无独立页面 | `app.routing`，提示词与 list/status/create/transfer 工具 |
| 模型与连接 | 现有模型设置界面 | `app.models`，公开配置查询与当前模型选择 |

会话、项目界面也使用同一 UI 入口表。配置、原生持久化、停止、来源与目标身份验证、接纳策略和执行权限仍由固定核心持有；扩展不能通过公共操作更换这些实现。可信随包代码不是恶意代码沙箱，本票不增加动态安装、启停管理或另一套调度器。

## 装配与生命周期

装配先验证应用身份、缺失入口及最终 SDK 扩展名称，再交实际 SDK registry 安装。不同扩展的同名工具/section 有意覆盖遵循实际会话选择顺序；task 名称冲突由 SDK 拒绝。重开宿主复制显式注入的 SDK 贡献，随后构建本次宿主 registry，不改写外部 registry 对象。

`extensions.get` 返回随包、实际 SDK 安装以及当前会话选择状态。页面只在 React 子树成功 commit 后显示“本页已挂载”；加载、异常、未挂载分别展示。Agent-only 不创建空 UI，UI-only 不安装占位 Agent。关闭时间线只释放自己的 subscription。

初始化失败会使宿主启动失败并标明扩展身份；加载/渲染异常由页面边界诊断。`subscription-error` 表示观察不可用；不会捏造 conversation 的 done/failed 记录。存储失败仍在宿主状态中如实显示。已有调用的资源由其实际所有者在结束时释放；SDK uninstall 和 UI unmount 都不被当作自动中止/自动 dispose。

时间线先查询最多 30 条记录，再观察当前 SDK 视图；按稳定 entry ID 合并。历史分页保留不透明 cursor。切换会话后迟到结果无效；长记录超过 4,000 UTF-16 code units 时仅挂载前 1,000 units（不拆 surrogate pair），展开后显示完整原文。固定历史没有截断或改写。

## 转交身份和双库事实

`conversation_list` 返回每页最多 30 个产品摘要及稳定 ID；查询不返回完整上下文。相同标题不代替 ID。普通输入仍只提交到当前会话。当前工具轮次上限细化为 8，以容纳列表、查询、明确转交和最终答复。

实际 SDK tool 从继承的 ExecutionBinding 获取产品控制归属，使用 invocation-bound memo 固定来源 SDK 身份、task ID 和 native control generation。转交再固定目标预期位置、目标 control version、明确正文及 `tool-route-${taskId}` 动作身份。重试不得采纳新的来源代次或新的目标位置。

原生 `createRouteJson` 仅绑定给 Node；WebView 的 native input switch 不提供任意转交写入口。它在同一原生 SQLite 事务内：

1. 核验来源身份/停止代次、目标存在/停止状态和位置预期及编辑 fence。
2. 固定独立的正文对象、摘要及持有关系，创建带来源关联的原生发送意图。
3. 记录动作与完整参数指纹；同身份同参数查回已提交事实，改参数拒绝。

这一步不读取或覆盖目标草稿。随后 `Submissions.send` 复用 T07 的同一配置/控制/模型/输入验证、SDK 原子接纳映射和 T08 位置绑定。SDK `submit`、Admission 与 Binding 共同提交。ACK 携带来源关联并校验一致性；路由 ACK 的独立 `kind: route` 返回不读取、不携带也不清理目标草稿，即便正文恰好相同。普通作者发送 ACK 保留原草稿 CAS 契约。Routing 另外只投影意图、接纳/回执、进展、等待与确认状态，不向来源工具结果序列化原生 ACK；UI 也不把 route ACK 当作作者草稿清除事实。

来源停止在目标 SDK 提交前被观察到时，SDK 事务回滚；意图保留其原代次，不通过恢复复活。来源投递资格取消用 `sourceCancelled` 表达，`cancelled` 仍只表示目标停止。若停止与两个库之间的提交重叠，是否已接纳以持久 SDK receipt 核验，不能只凭取消标志推断。已接纳的目标工作是独立提交：来源随后停止不抹掉它，也不会在 UI 中伪称目标已请求停止；目标自己的停止仍有效。SDK 已提交而 native ACK 丢失时，对同 intent 核验并补齐 ACK，保留后来草稿。此设计承诺唯一 SDK 输入身份，不承诺宿主崩溃后外部模型永不重复计费。

位置修改仍持有 T08 原生编辑 fence，并在同一个 SDK 事务核验接纳事实。来源取消的转交只有在 Admission、原生 ACK、SDK submission 均不存在、原来源身份和停止代次可验证时才不再占用位置；读取异常或各方分歧保持拒绝。已有接纳回执的独立目标仍核验完整回执/Binding/SDK 记录，并继续受未结算输入、任务后代、待确认停止和未决效果保护。不会因为 `sourceCancelled` 一律跳过这些检查，也不会自动应用之前被拒绝的位置提案。

`routing.create` 复用 T04 稳定 creationId 注册语义；内部 task conversation 不自动登记为产品会话。模型工具走同一个 `models.get` / `models.select` Interface，不获得凭据写入或解密能力；公开查询只读取凭据元数据。默认模型和当前模型保持独立。

## 可复现验证

桌面：在 `runtime` 执行 `npm test`；在 `ui` 执行 `npm test` 与 `npm run build`。`validation/extension-policy.mjs` 的 9 项及 `registry-policy.mjs` 的 3 项相同回调也由实际 Android Node 执行，显式使用 app-private 临时目录。

Android：先构建 runtime/UI，再用 Android Gradle 构建 app 与 androidTest。T14 测试类：`NativeRoutingTest`、`NativeRoutingCrashTest`、`ExtensionApplicationTest`。后者真实 MiMo 方法只在显式 `realProvider=true` 和既有加密测试胶囊可用时运行，默认验证正常 ACK；用新胶囊及 `routeAckLoss=true` 单独重跑该方法验证丢 ACK。两种都检查来源历史和实际序列化请求不含唯一合成目标草稿。debug-only `extensions-fixture` / `extensions-real` 不注入 T08 受控文件环境；这些纯应用工具无需实际执行环境，不能据此声称 Termux 文件操作通过。51/52 控制仅用于明确夹具目标/共享政策，不是产品 UI 操作。

实际设备结果、失败演进和 APK hashes 随 T14 evidence 归档；文档中的测试设计本身不是通过证据。
