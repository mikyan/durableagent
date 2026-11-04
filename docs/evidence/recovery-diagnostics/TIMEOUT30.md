# 真实请求 30 秒上限的独立诊断

在 `8ebc6e91f7170425270ed18cbd64ad8406833ffd` 上仅修改三个 Android 测试文件。产品仍是 DD7；这不是 MiMo01 的修复。新参数 `bashTimeoutSeconds=30` 只约束本次全新输入的提示，并在杀 owner 前检查模型实际选择的固定请求。模型未遵守时保留失败并走该输入原有的 stop 清理，不改请求、不重发。

`RecoveryFailureObservation.fixedRequest` 只读精确 session/family intent 文档，在同一 SQLite READONLY 事务中取最新 version=1 base 和后续 delta。它只提取完整不可变 request；未知操作、根路径和 request 子路径修改均拒绝。随后校验 execution、product、SDK 会话、既有回执的 requestDigest 及本次完整命令，只输出摘要、timeoutMs 和修订序号。此旁路是诊断观测，不是新增产品接口，也不启动 Harness、模型或执行通道。

小型真实 Android 测试选择器为 `RecoveryFailureObservationTest#fixedRequestObservationVerifiesReceiptBeforeReportingTimeoutWithoutExposingContent`。隔离 SQLite 夹具覆盖 base-null→request delta、无关 cursor/receipt delta、最新 base、完整根替换、错误摘要／执行身份／命令和部分 request 修改；每次读取前后主数据库字节相同，输出不含私有命令或环境字符串。

冻结件位于 `D:/durableagent-validation/t17-timeout30-diagnostic01`：

- 产品 APK：`dd7dd5ca97c130ff4ef95b59ae53c95910999d35c3664f6bee99f7490e6e5e5a`，与 reconnect 修复一致。
- 测试 APK：`22fb7d972a01dae5725663c940aab9b8f6672a440c03f5cc89144748c3c35a9e`。
- 三份测试源码的原始字节摘要见该目录 `test-source-manifest.json`。

Root 已在相同 DD7 / 22FB 组合执行小型观察器测试：1/1、0.309 秒，通过。真实 MiMo 试验沿用 `RecoveryRealApplicationTest#realFileResumesOriginalExecutionAfterOwnerDeathUsingItsPersistedCredential`，额外传入 `bashTimeoutSeconds=30`、`recoveryDiagnostic=true`，保留原 MiMo01 的 `recoveryWaitMs=120000`。Root 独占设备并使用已有保存连接；不重新提供凭据，不重发旧失败输入。实际重型结果须另行记录，不能由小型观察器通过推断。

## MiMo04 的实际结果

`t17-real-mimo04-timeout30-device.log`：DD7 / 22FB，1/1、37.467 秒，通过。新 run 为 `2bc5e56b-a338-41bb-b5a4-e240bb104b33`，执行 `b136a758-9f33-46f8-85f4-3355fe879ec9`。杀 owner 前只读证明 `timeoutMs=30000`、完整命令匹配、回执摘要 `25db34598033e4ce89f639c159b2e0d625db32a103f2ead5310f614a41c4c9f0` 一致（文档 176，base seq 198，latest seq 206）。

Owner PID 23505→23669；无绑定 10 秒时仍为同一工具 execute/replay-safe、cursor=1，随后原生完成投影在客户端重新连接前出现。同一执行最终 completed、sequence=6、exitCode=0、scopeConfirmed=true、outputCursor=2；实际读取文件为 `part-one\npart-two\n`，工具和助手历史都有最终内容。日志的 `completeRequestCountObserved=false`，因此不宣称观测到全程精确 HTTP 总数。

这一次独立试验通过，未稳定复现 MiMo01，也没有改动产品恢复逻辑。首次失败仍未解释；固定 30 秒参数的成功不足以证明间歇性问题已修复或定位。原件的外部独立读回、设备凭据审计与整体 T17 验收仍由 root 分别记录。
