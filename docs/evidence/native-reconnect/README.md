# 原生宿主显式重新连接

实际存储锁导致宿主打开失败后，旧页面的“重新连接”只重建 JavaScript 客户端，没有请求原生宿主重开。锁已释放时，页面仍保留失败。此修复让同一按钮先等待有请求标识的原生重连确认，再刷新状态；不创建会话、不重新发送输入。

原生请求只使用 Kotlin 客户端固有的存储域，在 owner 线程检查关闭状态和存储域。没有 node 时走已有的打开流程，仍须取得真实 OS 锁并恢复停止围栏；已有健康或只读 owner 均保留。页面不能用请求载荷选择另一个存储域。

## 固定回归与实际结果

`HostReconnectApplicationTest#renderedReconnectReopensFailedNativeOwnerAfterActualLeaseClearsWithoutResetOrSend` 使用真实 Application、SQLite、OS 域锁、AgentActivity 与渲染按钮。它先保存空会话和未发送草稿，再由测试 actor 持有域锁：重连必须仍失败且数据库字节不变；释放锁后再次点击必须恢复同一个会话和草稿、零发送与模型请求。健康状态再次重连须保留同一 owner。

相同测试 APK SHA-256：`7feb882175f1eed0e25e31370ac5dfd6972bbcddeacc6f2eaf107ed9635ace65`，相同测试源码 SHA-256：`ffd46f3a2b120381b2640c81c349c7aabb573bf1f67143d1228fa784461230ed`。

| 实际执行 | 结果与边界 |
| --- | --- |
| 原 E7CF 产品 / 7FEB 测试 | RED，17.588 秒，释放 OS 锁后的渲染重连断言失败；此前持锁保护和数据库字节断言通过。 |
| 修复 DD7 产品 / 相同 7FEB 首次更新后运行 | FAIL，9.885 秒，初始状态读取五秒超时，尚未进入持锁和重连断言。原因未直接测定；不声称冷启动通过。 |
| 相同 DD7 / 相同 7FEB 随后独立 UUID 运行 | GREEN，1/1，11.407 秒；PID 22832 中 failed/no-owner 转为新实例 ready/单 owner，草稿和会话保留，零发送／模型请求，健康重连保持原 owner。 |

首次更新后的观测失败没有删除，也没有增加超时或修改因果测试来获得 GREEN。早期构建因 `JSONObject`/`String` 参数类型错误失败，修正后 assembleDebug、assembleDebugAndroidTest、lintDebug 通过；两份构建日志均保留。相关 UI browser/controller/input-controller 共 8/8 通过（0.507 秒）。

## 冻结与复核

冻结目录 `D:/durableagent-validation/t17-native-reconnect-green01`；产品 APK SHA-256 `dd7dd5ca97c130ff4ef95b59ae53c95910999d35c3664f6bee99f7490e6e5e5a`。构建时基线 `2942502` 加本修复，提交前合入 `32ea1e5` 的 T17 证据文档；两者产品源码相同。

Root 独立 APK 核验通过：74 个 runtime 文件、11 个 UI 项、241 个源码路径、固定 native 摘要、安装载荷和 16 KiB 打包对齐。完整冻结清单另有 423 项，统计范围不同；这不是 16 KiB 设备运行证明。受管 helper 和安装载荷未变化。原始日志、root 核验和源码原始字节摘要见本目录与 `manifest.json`；独立静态审查见 `t17-native-reconnect-review.md`。

复现选择器：

```text
adb -s <authorized-device> shell am instrument -w -r -e class dev.durableagent.probe.HostReconnectApplicationTest#renderedReconnectReopensFailedNativeOwnerAfterActualLeaseClearsWithoutResetOrSend dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

该回归只在隔离 fixture 域中执行，设备由 root 独占安排。S23 最初为何遇到存储锁尚未定位；按钮恢复缺口与该初始原因分开记录。MiMo01 的间歇性工具恢复失败也没有因此关闭。
