# T17 最终组合复现

使用 [README](README.md) 的固定主／测试 APK、已有官方 Termux、配对及受管脚本。本文件记录复现步骤；只有关联原始日志、真实结果及范围的场景才算已执行。所有新结果当前见 README 的逐批状态，不以本文件存在代替通过。

## 执行条件

执行者持有目标设备独占租约，只使用新 UUID 的专用测试原件。记录实际 Android／ROM、ABI、页大小、WebView、应用版本与签名、Termux 版本／渠道、安装 APK 摘要和初始网络／通知／窗口状态。当前授权模拟器为 API 36／4 KB；目标手机结果应另立批次，不能改写模拟器行。

场景沿总 spec 已接受的应用 Interface 与 Android／Termux 边界，不另造业务测试入口。模型真实调用复用已有公开连接的已保存凭据；不要把 Key 放入命令、日志或仓库。若缺少该连接或凭据，记录前置缺失。不要为了复现而替换、卸载、清空、迁移 Termux，或重新初始化既有 ledger／pairing。

先确认没有其他活动 SDK 工作或未核验的外部作用域。T12 升级保留的两条旧 `accepted_not_started` 记录是明确已识别的早期 fixture，保持原样，不重新打开其验证域、授予、派发或取消。只终止已验证归属的测试作用域；失去归属证明即停止故障注入。

以下命令中的 `$adbPath`、`$testDevice`、`$newLogPath` 由执行者绑定到已授权设备及全新的绝对日志路径；不同方法独立记录，不覆盖旧批次。安装匹配 APK 后先核对实际摘要，禁止用旧 test APK 混跑。不要通过显式 Connect、打开 Termux 或粘贴 setup 预热“自动执行端重开”的被测路径。

MiMo01 使用 E7CF／3D99；MiMo02 使用主 APK 不变、仅添加测试诊断的 E7CF／B17，固定源码摘要见[该批元数据](t17-real-mimo02-artifacts.json)。测试入口相同，新增诊断读取自身失败，不能把 MiMo02 当作生产修复后的补验。以下源码链接指向本分支基线，不自动代表另一个 test APK 的诊断源码。S23 目前只完成前置及原位 APK 安装，首次产品进入受阻、未进行受管 setup，没有满足这里“已有配对与受管脚本”的执行前置。

MiMo03、最终停止与最终切网使用 E7CF／C251；[来源记录](t17-observer-green01-root-artifacts.json)在运行后从冻结 APK 和源码副本重建，不能声称预先已有同刻 manifest。C251 修正的是测试观察器，生产代码未变。实际结果、每批原身份和模型边界见 README；这些通过并未解决 MiMo01 的未决失败。

后续真实 MiMo 停止批次使用 E7CF／7FEB；当前产品候选已更新为 DD7，旧批次不能换记为 DD7 通过。DD7／相同 7FEB 的显式重连回归已在暖机通过，首次更新后的初始状态读取失败仍保留。MiMo04 使用 DD7／22FB、实际 `timeoutMs=30000`，1/1、37.467 秒通过且独立原件／审计已补齐。MiMo01 实际工具上限为 30 秒、MiMo02／03 为 60 秒，后两次成功不是等参数复现；无客户端耐久完成等待仍维持原 120 秒。

## 1. 真实 MiMo、无项目原文件与无 UI 宿主恢复

入口：[RecoveryRealApplicationTest](../../../android/app/src/androidTest/java/dev/durableagent/probe/RecoveryRealApplicationTest.kt)。仅选择这一方法：

```powershell
& $adbPath -s $testDevice shell am instrument -w -r -e class 'dev.durableagent.probe.RecoveryRealApplicationTest#realFileResumesOriginalExecutionAfterOwnerDeathUsingItsPersistedCredential' -e realProvider true -e productUnbound true -e productConnection recovery-validation dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object -FilePath $newLogPath
```

`productUnbound=true` 必须保留：使用正常产品域及已保存连接，不进入测试凭据导入分支。只创建本批新会话与新测试路径，保持原产品默认模型配置；本会话显式选择既有 `recovery-validation`／`mimo-v2.6-flash`。

MiMo04 使用 22FB 测试 APK，并在上述相同 selector 及产品连接参数上额外传入 `-e bashTimeoutSeconds 30 -e recoveryDiagnostic true -e recoveryWaitMs 120000`。杀 owner 前从固定 request 只读核实模型实际选择了 30000 ms、完整命令及回执摘要匹配。模型未遵守时保留失败并停止该测试输入，不篡改请求或重发。来源和实际记录见 [TIMEOUT30](../recovery-diagnostics/TIMEOUT30.md)；观察器不启动模型、SDK Harness 或执行通道。

观察步骤与通过条件：

1. 实际模型请求提供 bash 且使用默认 tool choice；只接纳一个输入、启动一个受管执行。
2. 新原件先出现精确 `part-one\n`。记录原意图／admission、binding、execution 和当前 `:agent` PID。
3. 关闭 Activity 与全部客户端，只终止已核验的本应用原 owner。不要终止 Termux 或命令 worker。
4. 新 owner 的 PID 改变；在任何客户端重新绑定前出现原会话耐久完成记录。随后原意图为 done，仍是同 execution，exitCode 为 0 且 scopeConfirmed。
5. 原件精确为 `part-one\npart-two\n`，共 18 字节。正常 Termux 另行只读核对路径、inode、字节及 SHA-256。
6. 原历史只有一个用户输入，工具输出及最终回复来自实际文件结果。只读打开已完成会话并保存实际可见截图，前后意图与历史保持，无新发送。

模型没有调用工具就直接回答、前置缺失、超时或 instrumentation skip 都不能算通过。保留失败批次；不要重发原输入制造成功。本方法的运行器仍存活，开始／结束会影响目标进程，只证明此条件下的能力组合。正常 boot／锁屏／系统资格沿 T12 的独立无 instrumentation 记录，不由此推定。

## 2. 已完成效果与执行端自动重开：引用既有同组件证据

E7CF 的原生／runtime 与 1623 字节一致，T12 已通过以下两个固定方法，本轮没有新生产差异时直接引用：

- [ExecutionTransportTest](../../../android/app/src/androidTest/java/dev/durableagent/probe/ExecutionTransportTest.kt) 的 `actualOrdinaryOperationRestartsPairedExecutorWithoutExplicitConnect`：真实空闲 listener 退出、socket 确实缺席、普通请求自动重开、原身份及配对保持；需要参数 `-e executionProduction true`。
- [ExecutionRecoveryTest](../../../android/app/src/androidTest/java/dev/durableagent/probe/ExecutionRecoveryTest.kt) 的 `actualOwnerDiesAfterOriginalAppendAndRecoveryDoesNotAppendAgain`：在真实原件已追加、结果尚未保存的窗口终止 `:agent`；同 execution／operation 恢复，原件只有 `local\n`，同意图没有新增执行。模型传输受控，不加 `realProvider`。

原始日志、固定 APK 与失败都在 [T12 gate](../t12/scoped-development-gate-review.md)。这些分别是空闲执行端与在途 Agent 的故障，不写成在途 Termux worker 已被终止；需要后者时单独设计可核验作用域、记录故障与结果，不能换称已测。

## 3. JS 忙时系统通知停止、独立作用域和新代次

入口：[StopExecutionTest](../../../android/app/src/androidTest/java/dev/durableagent/probe/StopExecutionTest.kt)。确认实际通知授权可用：

```powershell
& $adbPath -s $testDevice shell am instrument -w -r -e class 'dev.durableagent.probe.StopExecutionTest#notificationStopsOnlyOwnedTermuxScopeDuringBusyJsAndNewGenerationIsIndependent' dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object -FilePath $newLogPath
```

这是受控模型与真实 SDK／Termux／NotificationManager。夹具取得真实通知 action 的 PendingIntent 并发送，不是物理点击通知栏。它在实际 JS busy 时提交原生停止，在原 execution 上核验 stopped／scopeConfirmed；只做固定 sleep 的独立作用域当时仍运行且未被取消。停止屏障后接纳新的显式代次，核对延迟文件不存在、后续未发送草稿完整，再投递旧 action，不能停止新代次。必须保存独立作用域最终 cleanup receipt，不能只记目标成功。

不要把两次显式用户输入合成同一恢复请求，也不要从 JS PID 消失推定外部作用域已经停止。一般文件写入队列保持既有串行约束，独立 sleep fixture 不被包装成绕过应用队列的第二个普通 shell 工具。

## 4. 下载进行中切网，返网不重放

入口：[DataSaverExecutionTest](../../../android/app/src/androidTest/java/dev/durableagent/probe/DataSaverExecutionTest.kt) 的 `actualMeteredTransitionStopsTheDownloadingChildWhileJavascriptIsBusyWithoutReplay`。使用[合成下载服务器](../../../android/scripts/data-saver-download-server.py)，仅监听本机 `127.0.0.1:18763`，模拟器访问 `10.0.2.2`。记录实际使用服务器／控制器源码摘要，只关闭本批创建的服务。

控制器应串行执行：

1. 保存原 Wi-Fi metered override，查询 Android 当前 known／unmetered 事实，确认与计划一致。
2. 启动合成服务器和上述单个 instrumentation 方法；模型传输受控。
3. 收到本批唯一 `T13_EXECUTION_WAIT_METERED` 后，在夹具窗口内修改真实 Android 网络事实为 metered，并查询结果。不能只凭命令退出码推定成功。
4. 收到 `T13_EXECUTION_WAIT_UNMETERED` 后，恢复原 override 并再次查询。所有退出路径均在 `finally` 恢复原设置。
5. 核对同一个 execution 因 network_policy 被确认停止，确认发生时 JS 仍 busy；返回非计费网络后无新执行／模型请求；最终显式停止收敛。
6. 服务器仅一个打开／关闭请求，记录其写出字节和原生从受限事实到 scopeConfirmed 的时间。写出量不是客户端接收量，不支持切换瞬间零流量结论。

完整命令形式为：

```powershell
& $adbPath -s $testDevice shell am instrument -w -r -e class 'dev.durableagent.probe.DataSaverExecutionTest#actualMeteredTransitionStopsTheDownloadingChildWhileJavascriptIsBusyWithoutReplay' dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

该命令必须与读取标记和恢复设置的主机控制器一起运行，单独运行而不切网会超时，不能算省流测试通过。

## 5. Termux force-stop 的实际产品流程

仅在专用测试设备没有无关工作且原执行均已可核验后进行。保存原 executor／ledger／pairing、选定已完成的会话／执行、原件摘要以及意图／历史快照。

从普通 Console 的“核验状态”确认原执行，然后实际对 Termux 执行 Android force-stop。保持本应用可见，重复普通核验应展示“Termux 已被系统强行停止。请手动打开 Termux 一次，再返回本应用；无需重新初始化。”保留原状态，不创建新输入／执行。记录 package stopped、无执行端和等待观察区间，确认没有自动绕过。

之后明确以用户式动作打开 Termux 一次，再返回本应用；不运行 setup、不手工启动 daemon、不点 Connect。再次普通核验应自动恢复同一配对执行端，原执行／历史／意图／原件不变。保留错误及恢复界面的实际可见截图、平台事实和本轮没有新增发送的证据。

强行停止与明确重开是本场景的一部分，不能标为“普通冷启动无需手动打开 Termux”的成功证据；普通执行端自动恢复由第 2 节独立证明。在途命令若尚存在，不以此次整包 force-stop 冒称已取得逐 execution 的正常 scopeConfirmed。

实际通过批次见[摘要](t17-termux-force-stop-summary.json)，使用 MiMo03 的已完成原 execution，先后 146 条 ledger 计数、配对 SHA 均保持。可见中文说明使用实际 Android 点击普通核验取得；57.3 秒 stopped 观察和明确手开后的恢复分别记录。导航脚本的 selector／滚动区域／DOM 序列化失败保留在执行者本地，不改称产品失败。

## 6. 显式重连 RED 与 DD7 暖机回归

目标主 APK E7CF，测试 APK 7FEB；[运行后重建摘要](t17-native-reconnect-red01-artifacts.json)固定 APK 与冻结 `HostReconnectApplicationTest.kt` 的源码字节，但源码提交身份尚未记录。入口：

```powershell
& $adbPath -s $testDevice shell am instrument -w -r -e class 'dev.durableagent.probe.HostReconnectApplicationTest#renderedReconnectReopensFailedNativeOwnerAfterActualLeaseClearsWithoutResetOrSend' dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner | Tee-Object -FilePath $newLogPath
```

此方法建立专用 fixture 会话与草稿，持有真实 OS 存储域 lease，确认页面出现 storage-owned 以及持有时重连不替换 owner，再释放 lease 后点击渲染按钮。该 click 由页面 DOM 触发，不是物理 Android 触摸。E7CF 实际在源码第 54 行“释放后重连应 ready”的 10 秒断言失败，整批 17.588 秒、1/1 失败。后续会话／草稿保持及健康 owner 复用断言没有执行通过。该 RED 不请求真实模型或发送业务输入，不清空数据；S23 初次 storage-owned 的实际触发原因仍未知，不能将本夹具当作手机根因证明。

修复后使用 DD7／相同 7FEB、相同测试源码及断言：第一次更新后独立运行在初始五秒 native status 读取超时，尚未触及 lease／重连特性；随后新 UUID 暖机运行 1/1、11.407 秒通过，包括原会话／草稿／零发送和健康 owner 保持。结果与范围见[原生重连记录](../native-reconnect/README.md)，不能把暖机结果写成冷启动或 S23 初始错误已修复。

## 结果记录与退出

每批保存：主／测试 APK 摘要、源码／平台范围、前置、具体 selector／参数、完整测试结果、run／会话／intent／execution／control generation、故障前后 PID、真实或受控模型边界、原件字节／摘要、独立观察入口、可见截图、恢复的设置及失败清理结果。不要将原始密钥、认证 header 或私有设备序号放入公开材料。

必须确认实际运行了选择的方法，`OK (0 tests)`、assumption skip、只构建或 ADB 传输退出码 0 都不是验收通过。保持分批结果；一个重测的成功不能删除原失败或扩大原候选范围。最终证据由根任务完成精确秘密审计后纳入摘要清单，再经独立合并审查。T17 的目标硬件与未测场景未满足前，不标记全票通过或 PR ready。
