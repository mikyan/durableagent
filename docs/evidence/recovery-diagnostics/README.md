# T17 恢复失败的有界诊断

基线为 `dfe6a3a008e7ce9081a362c8d834e7e5ac87dfa0`。本提交只有测试、夹具和证据；没有产品修复，不能关闭首次 MiMo01 失败。

## 原始问题与范围

Root 的 MiMo01 真正调用 MiMo、使用持久凭据和 Termux，E7CF 主 APK / 3D99 测试 APK 在 148.548 秒失败：命令运行中杀死应用 owner 后，120 秒内没有原生完成投影。独立只读观察确认外部命令完成、原件为 `part-one\npart-two\n`，但 SDK 最后只有部分输出；测试 finally 后任务为 aborted。最终 completed 回执可能由清理核验写入，不能视为中途恢复证据。原始日志和快照由 root 保留：`%TEMP%/durableagent-implementation/t17-real-mimo01-*`；不得发布私有 SQLite 原件。

三个可证伪假设为原生省流中断、无界面 owner 未驱动 SDK、原生输出通道未确认。Root 对目标执行的稳定只读政策快照没有 `policyInterrupted`，且策略关闭，因此未支持第一项。其余两项尚未被定位；没有按推测修改产品或增加超时／重试额度。

## 快速宿主反馈

在 `runtime` 运行 `node --test test/recovery-running-execution.test.mjs`。实际 Application、ModelConnections、Pi SDK、SQLite 和子进程 SIGKILL；只有模型 HTTP 与外部执行服务为可控边界。外部执行账本在应用子进程退出后保留，先保存一段原件和输出，再由独立父端完成第二段。恢复后不发任何 Application 查询，先等 `publishProjection` 完成，再核验同一输入、一条执行、原件和完整工具历史。

六个精准中断点均通过，`t17-running-host-timing02-commit.log` 为 6/6、3.772 秒：外部 start 已保存、部分输出返回、query 返回但 cursor 尚未保存、实际 SQLite COMMIT 之前、COMMIT 之后、输出检查点保存之后。两个 SQL 切点只在测试存储驱动中定位原 cursor=1 写入并杀进程；不改 SDK 文档，最终断言走公开接口。此结果排除这些宿主窗口中的确定性失败，不能替代 Android 原生时序。

早期 `baseline01` 只有测试预期漏掉末尾换行导致失败；实际已完成恢复，不能称产品 RED。修正预期后 baseline02 通过；baseline03 加入无客户端完成投影，baseline04 换成产品 ModelConnections，均通过。所有日志保留，未选择性丢弃失败。

## Android 观察器回归

诊断测试在杀 owner 前、无绑定恢复 10/30 秒、失败且尚未执行 finally stop 时，以 SQLite READONLY 事务读取目标 SDK 任务形状、执行修订、原生投影／probe／政策。SDK 文本仅记录长度和枚举；没有 Harness、模型 transport、执行 query 或凭据访问。失败后的 owner 状态读取明确标记发生于失败和重新绑定之后，不能证明此前无绑定成功。

首次观察器在 Android 上将返回行的 `PRAGMA busy_timeout` 交给 `execSQL`，三库都失败。小型真实 Android 回归用三个本测试创建的隔离 SQLite 库验证完整字段、过滤其他会话／命令、读取前后字节相同：

- 相同测试源码 SHA-256 `5427e1f6a54a913034085726d9004a151e3da8c170242f6c40885b6ebb53642d`。
- 旧观察器 RED：FBE0 测试 APK，0.687 秒，三库 `SQLiteException`，第一条读取断言失败。
- 仅将 PRAGMA 改为 `rawQuery` 并增加固定错误阶段／类别，C251 测试 APK GREEN：1/1、0.797 秒。回归没有改动任何产品数据或启动 SDK／模型。

选择器：`dev.durableagent.probe.RecoveryFailureObservationTest#readonlyDiagnosticObservesThreeRealAndroidDatabasesWithoutChangingThem`。

## 后续独立设备试验，非修复证明

Root 用相同 E7CF 产品 APK 发起两个全新 UUID 的真实 MiMo 试验，没有重发原输入：MiMo02 / b17 为 1/1、33.706 秒，但观察器失败；MiMo03 / C251 为 1/1、41.216 秒，三库诊断读取均成功，10 秒时工具仍执行、cursor=1，随后收齐两段并完成。两次成功都没有产品改动；原始 MiMo01 间歇性失败仍未解释。完整日志由 root 保留在 `%TEMP%/durableagent-implementation/t17-real-mimo0{2,3}-diagnostic-device.log`，由 T17 单独归档和审计。

冻结主 APK SHA-256：`e7cf5a6ddff4bc435f513fc727e2ac1f12b93801aefb6570fb8e4457b650bfc0`。

测试冻结件位于 `D:/durableagent-validation/`：

| 目录 | 测试 APK SHA-256 |
| --- | --- |
| `t17-diagnostic-test01` | `b17a6e21f77c6a341e87173e27cd7780be9839dde8379251a4be92251640be7b` |
| `t17-observer-regression-red01` | `fbe0dd909294e52a24ad23885ad1b9cc958f44a5a58bc89d0847c9f55e054557` |
| `t17-observer-regression-green01` | `c2516f1057f7d40580a139813d3cfc8386ce8934c39dc164f9434bbe4c24b03f` |

这些构建只替换测试 APK。源码与随附日志的原始字节摘要见 `manifest.json`。本文不把模拟器结果写成 S23／OEM 或 16 KiB 设备运行结果。
