# T17 最终组合与设备验收记录

更新于 2026-11-05。T01—T16 的限定开发前置已经通过，T17 正在执行，尚未完成整体验收。真实 MiMo01 恢复失败：原件完整，但无客户端重连前的应用耐久完成超时。MiMo02／03、JS 忙时通知停止、实际切网及 Termux 强停后明确重开分别有通过记录，未消除 MiMo01 的未决失败。S23 首次打开 storage-owned 的初始原因未知，现已离线、未开始受管初始化；另一个模拟器因果测试确认真实 lease 释放后显式重连仍不能恢复，是单独的已知待修问题。GitHub [#18](https://github.com/mikyan/durableagent/issues/18) 是工单状态权威，完整交付仍为 16/17，PR 保持 Draft。

本轮目标是先核验 Android 16／4 KB x86_64 模拟器上的最终能力组合，再按实际获得的目标手机条件补验。Galaxy S23 在前置盘点与安装时在线且解锁，随后已离线；当前没有本轮手机组合的通过记录。Xiaomi 15、物理平板及 ARM64 16 KB 实机结果仍缺失，模拟器许可没有取消这些边界。

## 固定候选与现场前置

本票从已公开集成 `dfe6a3a008e7ce9081a362c8d834e7e5ac87dfa0` 开始。已实际读取五张前置 issue：T12 12/12，T13、T14 各 11/11，T15、T16 各 13/13。它们等待完整 PR 合并后关闭，保持 open 不表示前置未验收。

本报告提交前已合入 `2942502b49b881322faf21226533b2c5b00a4394` 的测试诊断集成；[诊断材料](../recovery-diagnostics/README.md)随原集成保留，没有改变下列生产候选或修复 MiMo01。

| 对象 | 固定值／证据 |
| --- | --- |
| 最终生产源码 | UI 修复 `4c526920af7b7208b220f2b4805d9f8f577164e2`；原生／runtime／helper 修复 `374d74df91a4c6ae6e8acb8e8bd5f0598cc9c93c` |
| 主 APK | `e7cf5a6ddff4bc435f513fc727e2ac1f12b93801aefb6570fb8e4457b650bfc0`，下文简称 E7CF |
| 测试 APK | `3d99bb4cdb82b76cf328919025ab6ab96d4577ba5442b2d90d3f8bb518ecc938`，下文简称 3D99 |
| MiMo02 诊断测试 APK | `b17a6e21f77c6a341e87173e27cd7780be9839dde8379251a4be92251640be7b`，简称 B17；[元数据](t17-real-mimo02-artifacts.json)记录基于 dfe6a3a、主 APK 仍 E7CF、无生产修改及测试／观察器源码 SHA-256。仅该批使用，不能改写 MiMo01 的 3D99 身份 |
| MiMo03／停止／切网测试 APK | `c2516f1057f7d40580a139813d3cfc8386ce8934c39dc164f9434bbe4c24b03f`，简称 C251；[根任务事后核对](t17-observer-green01-root-artifacts.json)依据冻结 test APK 与三份源码副本，映射测试源码提交 `54ed92dc29988234010e7bf710609ce6a6ac6e11`，无生产修改。此元数据在运行后重建，不是运行前同时记录的 provenance |
| 重连 RED 测试 APK | `7feb882175f1eed0e25e31370ac5dfd6972bbcddeacc6f2eaf107ed9635ace65`，简称 7FEB；目标仍 E7CF。[摘要](t17-native-reconnect-red01-artifacts.json)在运行后从冻结 APK 与测试源码计算，源码提交身份尚未记录，不冒充运行前 manifest |
| 模拟器现场 | Android 16／API 36／x86_64／4096 字节页；Google `BE2A.250530.026.F3/13894323`；WebView `133.0.6943.137`；应用 `0.1.0`。已安装主／测试 APK 摘要与上述固定值一致，见[现场前置](t17-preflight01.json) |
| 应用签名 | Android Debug 证书 SHA-256 `2c9ee1f6b92c5badd36b76d5f7c056915ce90ac59c5c5bd468841826fa62e734`，见[证书读取](t17-app-signature01.log)；不是正式发行签名声明 |
| 运行依赖 | 固定 Pi Durable／Pi AI／pi-schema／Chord `1.5.0`、Javet Node Android i18n `6.0.3`，见[最终包核验](../t12/t12-final-ui01-root-inspection.json)与 [T01 来源](../t01/README.md) |
| Termux | 现场 `0.118.3`／code `1002`，未处于 stopped；发行物／渠道与固定证书来源沿 [T03](../../../termux-probe/validation.md)，本轮不替换、卸载或清空 Termux |
| 初始网络／运行状态 | Wi-Fi 和移动数据开关为 1，两条 AndroidWifi metered override 均为 none，ApplicationService 不在运行；仅是开始前快照，不代替测试后的恢复检查 |
| S23 现场前置 | `SM-S9110`、Android 16／API 36、`arm64-v8a`、4096 字节页，keyguard `showing=false`／`inputRestricted=false`；见[初次只读状态](t17-physical-status01.json)与[15:45Z 只读盘点](t17-s23-readonly-preflight.json)。当时应用 APK 是旧的 `decd21c7b9edb246a6133ee25476104367804080835676e4f50c1ec6ca8df6b0`；原 Termux `0.118.3`／1002 摘要匹配已验证来源，预期受管 helper／manifest／ledger 和双方产品 pairing 缺席。随后[补装固定前置](t17-s23-prerequisites-summary.json) Python `3.14.8`／openssl-tool `1:3.6.5`，再[原位安装 E7CF／3D99](t17-s23-install01.json)，均实际退出 0；保留原应用与 Termux 数据，没有卸载回退或重置。尚未开始受管初始化 |

[冻结元数据](../t12/t12-final-ui01-artifacts.json)和[组件比较](../t12/t12-final-ui01-root-artifact-delta.json)确认：E7CF 只修改强行停止后的中文恢复说明及 UI 生成资源，20 个常规非 UI／非签名 APK 项、测试 APK 与已测 1623 候选完全相同。16 KiB ELF／ZIP 对齐检查属于打包验证；固定 x86_64 Termux 的 16 KB bootstrap 失败仍见 [T03 原记录](../../../termux-probe/validation.md)，不被 4 KB 结果覆盖。

## 本轮批次

| 场景 | 当前状态 | 入口、结果与边界 |
| --- | --- | --- |
| 普通请求重开已配对执行端 | 复用已接受证据 | [T12 1/1，1.230 秒](../t12/t12-autostart-green01-device.log)：实际终止空闲自有 listener 后，普通请求自动重开，原 executor／ledger／pairing 保持，无显式 Connect。实测属于 1623；同组件映射见上，不写成 E7CF 新跑了一次 |
| 原件已追加、结果未提交时恢复 | 复用已接受证据 | [T12 1/1，10.448 秒](../t12/t12-final-original01-device.log)：实际 `:agent` 在 `execution-before-result` 退出后，同 execution／operation 恢复，原件恰好 `local\n`，同意图新增执行为 0。模型传输受控，实测属于 1623 |
| 真实 MiMo、默认工作区、无 UI 宿主死亡恢复 | **失败 1/1，148.548 秒** | [MiMo01 原始日志](t17-real-mimo01-device.log)：第一段 `part-one\n` 已写入，实际 owner 从 17152 更换为 17300；无客户端重连前耐久完成的 120 秒断言超时。随后[独立 Termux 读取](t17-real-mimo01-termux-read.log)确认同一 execution 已 completed／exit 0／scopeConfirmed，原件精确 18 字节；应用恢复完成失败，可见结果尚未复核。开始／结束受 instrumentation 语义影响，不单独证明普通 boot 或 OEM 后台资格 |
| MiMo02 独立新输入的诊断试验 | **通过 1/1，33.706 秒；非修复** | [E7CF／B17 实际日志](t17-real-mimo02-diagnostic-device.log)：无 UI owner 18777→18933，在重连前完成；同一 execution `d7ab477c-e9c4-4826-9149-f432e6c34f0d`，原件精确 18 字节，[独立读取](t17-real-mimo02-termux-read.log)一致。新增 SQLite 诊断观察器自身报错，没有取得中间数据库状态；不能说明 MiMo01 原因已经解决 |
| MiMo03 独立新输入的诊断试验 | **通过 1/1，41.216 秒；非修复** | [E7CF／C251 实际日志](t17-real-mimo03-diagnostic-device.log)：修正测试观察器后取得实际中间状态，owner 19714→19876，无客户端重连前完成；同一 execution `58877da0-1f84-465b-a529-2ec0b1be24ca`、原件完整 18 字节及[独立读取](t17-real-mimo03-termux-read.log)一致。原失败仍未解释 |
| S23 原位安装后的首次产品进入 | **受阻，原因未定** | [可公开现场摘要](t17-s23-visible-startup-observation.json)：E7CF／3D99 安装后，当前用户 0 可见 `Application storage already owned`；一次实际 Android 点击重连后仍失败，创建会话不可用，没有发送／force-stop／重置。现已离线、受管 setup 未开始，截图暂不公开。该 lease 拒绝未证明持续有另一 owner，事后 FD 情况不能解释首次拒绝，也不能据独立用户 95 的存在归因于配置档或 OEM |
| JS 忙时通知停止、新代次及旧通知隔离 | **通过 1/1，17.577 秒** | [实际日志](t17-final-stop01-device.log)：真实 NotificationManager action PendingIntent 由夹具发送，模型受控。目标停止且 scopeConfirmed，独立固定 sleep 仍运行；随后独立 fixture 清理也 scopeConfirmed。新代次完成、后续草稿保持、旧 action 不停止新代次；不是物理点击通知 |
| 下载子进程运行中切换计费网络 | **通过 1/1，24.728 秒** | [实际日志](t17-final-network01-instrumentation.log)：实际 Android 网络／Termux 下载，受控模型；从观察受限到原作用域停止确认 934 ms，返网未重放。服务端仅一 GET、写出 119808 字节，[前](t17-final-network01-before.json)／[后](t17-final-network01-after.json) metered override 均为 none。服务器写出量不称终端接收量，详见[事件](t17-final-network01-events.json)和[服务端日志](t17-final-network01-server.log) |
| Termux force-stop 的正式 Console 提示与明确重开 | **通过，限定 57.3 秒阻塞观察** | [现场摘要](t17-termux-force-stop-summary.json)：实际强停后普通核验显示中文手动重开说明，57.3 秒内保持 stopped，无自动绕过；明确打开 Termux 一次后普通核验恢复原 execution，146 条收据计数及配对摘要不变，无 Connect／setup／新发送。只测试已完成原执行，不含在途 worker 死亡 |
| 最终真实结果的可见 Console 复核 | **MiMo03 已核；其他批次未扩展** | [实际结果](t17-force-stop-ui01.json)与[截图](completed-original-before-termux-stop.png)显示 MiMo03 原输入、工具输出、最终回复和已结算状态；同会话无新发送。MiMo01 失败及 MiMo02 不据此补记可见通过 |
| 真实 lease 释放后的显式重连 | **RED 失败 1/1，17.588 秒，待修** | [E7CF／7FEB 日志](t17-native-reconnect-red01-device.log)：夹具实际持有 OS lease，释放后点击渲染的重连按钮，10 秒内仍未 ready，准确失败于 `HostReconnectApplicationTest.kt:54`。这是独立可复现问题；不证明 S23 初次 storage-owned 的触发原因相同 |
| 本轮数据／日志凭据审计及设置恢复 | MiMo01／02／03 审计已核，最终待验 | [MiMo01 15:45:10Z](t17-real-mimo01-credential-audit.json)、[MiMo02 16:11:24Z](t17-real-mimo02-credential-audit.json)、[MiMo03 16:17:59Z](t17-real-mimo03-credential-audit.json)均有正对照，应用数据与应用 UID 日志三种编码实际秘密匹配为零；排除固定 runtime 解压包，不检查 heap／flash。切网设置恢复已核，全批结束基线及最后审计待验 |

空闲 listener 退出、在途 `:agent` 退出、在途 Termux 执行端／worker 退出和 Android force-stop 是不同故障。本表前两行不能合并声称已完成“在途 Termux 执行端终止后的产品恢复”。没有对应新证据时，该窄范围保持未测，未知副作用仍须暂停核验。

## MiMo01 失败记录

固定候选 E7CF／3D99，`run=695ffb2f-fdb6-42ab-8fb9-d7fede2c83c9`，`product=real-recovery-695ffb2f-fdb6-42ab-8fb9-d7fede2c83c9`，`executionId=c1e28e08-a72b-4fe9-8391-c18764505264`。使用保存的产品连接、默认 tool choice 和默认工作区；[原始日志](t17-real-mimo01-device.log)记录首次原件内容 `part-one\n`、第一次 owner PID 17152 及当时应用请求计数 1。执行者另已观察 owner 17300；该 PID 变化的独立诊断附件尚待交付，不能由 runner 日志单独推出。

测试在 `Unbound product owner durably finishes before any client reconnects` 断言失败。120 秒内未见期望完成，随后测试自身 `finally` 停止原输入并关闭宿主；这不是已恢复通过。当前保留失败和原身份，不重新发送该输入。原因尚在诊断，不能将失败归为模型、网络、Termux 或系统问题。排查与补验结果应另立批次并保留此记录。

失败后没有重新打开 SDK harness 或安装模型传输。[只读摘要](t17-real-mimo01-observation-summary.json)记录：ApplicationService 已无活动；SDK／recovery 两份连续字节副本相同，sidecar 缺席或为空，宿主只读 SQLite `integrity_check` 通过，原数据库仅私存。原件的独立读取为 `part-one\npart-two\n`，18 字节，inode 630070，SHA-256 `c9d69e79af57fe32b6481148132da068c4051bab2eed1484b2d85a263b02558f`；同 execution 收据是 completed／exit 0／scopeConfirmed，输出 cursor 2。应用保留 cursor 1，该会话没有 completion 行。SDK 最后记录为 unanswered／aborted、工具结果只有第一段输出和 abort 提示；这些是测试失败后停止清理的残留，不能改称停止前已经正常完成，也不能由最终状态单独断定根因。已能确认本次外部原件完整，端到端恢复仍未完成。

[失败清理后的策略观察](t17-real-mimo01-policy-observation.json)另记录 owner 缺席、两次只读副本相同：省流 disabled／version 0，网络已知且非计费，原 operation 为 completed／terminal／scopeConfirmed。它只说明清理后的保留状态，不能代替恢复中间过程，也不能据此宣布排除了某一根因。

## MiMo02 独立诊断试验

固定 E7CF／B17，`run=34c52011-c761-41f8-a6a3-147f6d46b852`，原 execution `d7ab477c-e9c4-4826-9149-f432e6c34f0d`。这是独立全新试验，没有重发 MiMo01 的意图，也没有修改生产代码。[日志](t17-real-mimo02-diagnostic-device.log)记录默认 tool choice、真实 MiMo、原件第一段、无客户端 owner 18777→18933、重连前耐久完成和原接纳收据；该批完成断言通过，运行 33.706 秒。同 execution 最终 completed／exit 0／scopeConfirmed，cursor 2，独立 Termux 读到 `part-one\npart-two\n`，18 字节、inode 630072，SHA-256 `c9d69e79af57fe32b6481148132da068c4051bab2eed1484b2d85a263b02558f`。可见 Console 尚未复核。

新增诊断在 owner 死亡前和恢复后约 10 秒两次读取 SDK／recovery／policy 时均输出 `readFailure=SQLiteException`，这是测试观察器失败，不是产品 SQLite 损坏证据。没有从这一批得到预期的中间状态解释。`completeRequestCountObserved=false`，前后进程内计数各 1 不能改写为整条链恰好两次模型请求或零重复计费证明。MiMo02 的通过不能覆盖 MiMo01 的失败，自动恢复门槛仍待诊断及必要修复后的定点补验。

## MiMo03、停止与切网的限定结果

MiMo03 只修正测试观察器，生产 E7CF 保持不变。新 run `4e7e1556-f574-499f-9c26-bb71cb9f2df6` 在 owner 死亡前及恢复后约 10 秒取得 SDK／recovery／policy 只读诊断：当时 generation 等待工具、tool 在 execute，原 execution cursor 1／running，省流 disabled／version 0；这些时间点早于外部命令完成，不能改称重复了 MiMo01 的失败。该批随后正常完成，同 execution 的独立原件 18 字节、inode 630076、SHA-256 与前两批的期望内容一致。后续已在真实 Console 只读核对本批原输入、工具结果和完成回复；完整远端请求计数仍未覆盖，MiMo01 根因仍未定。

停止批次的目标 execution `1cac169d-f648-4258-8b88-f841e6b75a41` 收到 user cancel 后 stopped／scopeConfirmed；不属于它的固定 sleep 在目标停止时仍 running，最终清理收据也确认 stopped。新显式代次 2 的 verifier `5c38d678-ede2-4a00-970d-5ff7a47ab2cc` completed／exit 0，后续草稿保持且迟到旧通知 action 不停止新代次。这是实际通知 action 的程序发送、真实 SDK／Termux 与受控模型，不是物理通知点击或 OEM 后台资格。

切网 run `c7a5330b-1baf-4b9b-833c-3e7ee6de42b5` 的 execution `811d5dea-5787-469b-8265-c1e9932214e8` 在 JS busy 时因 network_policy stopped／scopeConfirmed，观察受限至确认 934 ms；一个模型请求、一个执行，返网未重放。主机 override 命令虽返回 255，控制器分别重新查询到两条 `AndroidWifi;true` 和恢复的两条 `AndroidWifi;none`，实际状态与前后文件构成恢复依据。119808 字节是服务端本次总写出量，不能据此宣称客户端接收量、受限后漏流量或系统级零流量。

## Termux 强停与实际 Console

使用 MiMo03 已完成的原会话和 execution `58877da0-1f84-465b-a529-2ec0b1be24ca`。先在真实 Console 核对[完成结果](t17-force-stop-ui01.json)，再从执行面板查看[原执行行](t17-force-stop-ui08.json)。[强停前只读盘点](t17-termux-force-stop-preflight02.log)没有活动 worker，两个历史 accepted_not_started 记录保持原状。实际 `am force-stop com.termux` 后，点击该行的普通“核验状态”得到[中文错误结果](t17-force-stop-ui09.json)与[实际截图](visible-termux-force-stop-message.png)；[57.3 秒观察](t17-termux-force-stop01-bounded02.json)确认 Termux stopped、无 Termux app PID、没有自动绕过。

执行者明确打开 Termux 一次，返回本应用，再点原行普通核验；[结果](t17-force-stop-ui10.json)与[截图](original-execution-after-explicit-termux-reopen.png)显示同 execution 已结束／退出码 0，错误消失。[后置只读记录](t17-termux-force-stop-after01.log)与前置均为 completed 114、stopped 29、not_started 1、accepted_not_started 2，共 146；配对 SHA-256 同为 `aca431a45c1177e9177ba9829c6962362d9ea29db2f8f01f0c6a41c021c984d4`。没有 Connect、setup、新命令或重新发送。该流程证明真实 force-stop gate 与明确重开的路径，不替代在途 Termux worker 死亡、普通冷启动免手开或 OEM 验收。

导航夹具曾有 ui03 选错 selector、ui04 滑动错区域、ui05／07 将 DOM 节点作为等待表达式结果导致序列化错误；它们由执行者保留，类别与最终路径记在[摘要](t17-termux-force-stop-summary.json)，不计产品失败。首份 bounded 记录包含错误的 PowerShell `Package=System.Object[]` 序列化结果，未作为本目录证据，采用实际行内容完整的 bounded02。

## 显式重连的独立失败

`HostReconnectApplicationTest#renderedReconnectReopensFailedNativeOwnerAfterActualLeaseClearsWithoutResetOrSend` 使用真实存储域 lease 与渲染页面。夹具保留一个会话和草稿，实际持有 lease 引出 storage-owned；持有期间点击重连没有取代原 owner，数据库字节不变。释放 lease 后再通过 DOM 对真实渲染按钮调用 click，期望原生 owner 重开，但在 10 秒断言处失败；整个测试 17.588 秒，1/1 失败。它不是物理 Android 触摸，不调用模型或发送业务输入。

此 RED 是正在修复的独立重连缺陷，不把未达到的后续 ready／会话草稿保持／健康重连断言计作通过，也不据此推定 S23 初次 storage-owned 的根因。修复后的候选与结果应另立记录；本检查点没有生产修复。

## 复用与最终判定

[十二项映射](ACCEPTANCE.md)逐项连接既有证据、本轮批次和设备缺口；[复现步骤](REPRODUCE.md)固定调用参数及预期观察。此前已接受的运行时、SQLite、发送窗口、绑定／授权、写入协调、凭据、保留与备份合同按原候选引用，不因文档整理而重跑，也不把历史多批通过合成一次 E7CF 全量通过。

[附件摘要](LOG-SHA256.json)分别记录获准公开的原始本地副本和 Git 文本规范化后的内容摘要；不收录原数据库、全量应用数据或秘密。新增批次只有在实际取得结果并完成其凭据审计后才纳入本目录。

正常产品的再次锁屏、真正重启首次解锁、本应用 force-stop 以及实际完成通知物理点击，继续引用 [T12 独立验收](../t12/scoped-development-gate-review.md)。这些包含明确区分的真实 MiMo 文字／文件、无客户端观察和不同 APK 条件；T15 的手机／大字体／横屏平板窗口继续引用其[独立验收](../t15/scoped-development-gate-review.md)。

当前不能宣称首版可发布、T17 已验收或 17/17 完成。后续报告必须保留每次失败、准确候选、实际原件和身份、模型边界、系统条件、设置恢复与未测范围。普通启动、自动续跑或主动停止的硬门槛若失败，应记录原批次并定位修复，不放宽断言或换输入身份重发以覆盖失败。
