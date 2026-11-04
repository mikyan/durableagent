# T12 自动恢复开发证据

2026-11-04。开发证据已收敛，最终独立集成验收另记，不能仅据本文关闭 [T12](../../specs/v1/tickets/12-automatic-resume.md)。范围为 Android 16／4 KB x86_64 模拟器、真实 SDK 1.5.0、Android SQLite／Service／JobScheduler／NotificationManager，以及明确标注的真实 MiMo 请求。首次解锁／重启、force-stop 与联合 T15 的实际通知目标均已完成所述范围验证；S23／Xiaomi 厂商行为保留到 T17。分批、不同候选的结果不拼成一次完整全绿。

## 已观察到的行为

| 边界 | 证据 | 范围与限制 |
| --- | --- | --- |
| 真实 SDK 等待／恢复 | offline、wake、unlock 的 RED 与 GREEN 日志 | 受控平台条件和模型传输；不是 Android 锁屏或联网实测 |
| 原生预算与完成身份 | 初始缺实现 2/2 失败，首次实现因 SQLite PRAGMA 调用方式 2/2 失败，修正后 2/2 通过，0.929 秒 | 保留两次失败；预算、epoch 与完成身份跨原生重开保持，不代表整机掉电 |
| 完成通知与原生停止 | `54a5f7e` 原生存储／通知窗口 5/5，2.158 秒；应用通知 2/2，31.856 秒 | 实际 NotificationManager；通知窗口使用私有 SQLite 故障位置，不称为实际进程强杀 |
| JobScheduler 解除绑定 | 原主应用 + 同一测试 RED 1/1，68.980 秒；`aedb8d6` + 同一测试 GREEN 1/1，76.059 秒 | 50 秒系统作业退出后，同一已准许的前台运行进程继续；原生停止后 Service 退出，不声称缓存进程立即消失。初始宿主 1 次受控模型请求，加新宿主 1 次；日志 `requests:1` 仅是后者计数 |
| 真实模型／文件中断恢复 | `62a9dbb` 候选 1/1，61.101 秒 | 真实 MiMo 2 次 HTTP，实际执行 1 次；保持 Android 客户端绑定的恢复，不代表无界面 sticky 或重启恢复 |
| 真实 product 无绑定 sticky 恢复 | 同一主应用 + `b56b9bb` 测试夹具 1/1，35.138 秒 | 所有 Activity／客户端关闭后终止原宿主，系统启动新 PID；在任何客户端重连前观察到耐久完成。复用保存凭据、原输入、原执行；进程内计数不是完整 HTTP 总数 |
| 实际通知授权拒绝 | `62a9dbb` 1/1，13.823 秒 | SDK 输入完成、历史可见，完成身份 pending 且无系统完成通知；随后恢复授权 |
| 实际完成渠道关闭 | `62a9dbb` 1/1，9.992 秒 | 通过真实 Android 设置开关将 importance 设为 0；结果仍可查看。恢复为 3，Android 保留 userLockedFields=4 的开关记录，不声称所有元数据完全相同 |
| 真进程 SIGKILL 与 deferred handle | `t12-deferred-crash-host01.log` 3/3 | 主机 Node 的实际进程故障。两次中断沿用原 handle，总计 1 次创建、2 次 poll；耗尽后 interrupted／一次 cancel，不新建请求。不是 Android deferred Provider 实测 |
| 未知外部效果及原生预算暂不可用 | `t12-probe-authority-red02.log` → `green01`，以及 exhausted-stop 日志 | 保留同一工具身份等待，不把未知效果作为可交给模型重发的完成结果；固定工作探测预算不因重开清零 |
| 主机完整回归 | `t12-runtime-stage62-all.log` 246/246，19.675 秒；`t12-runtime-stage31b-all.log` 247/247，20.078 秒 | 后一批包括 host 唤醒重新发布；不代替 Android 原生发布验证 |
| 原生相同 wake 重新发布 | 实际系统 RED 1/1，18.565 秒；最小修复 + 同一测试 GREEN 1/1，7.106 秒 | 真实 JobScheduler 的自有 namespace 冲突，清除后同一输入成功发布，0 模型请求；不是 quota 或任意后台启动拒绝的模拟替代 |
| 首次解锁后再次锁屏／真实离线恢复 | 真实产品 UI 发送一次，外部原生完成核验与最终只读复验通过 | 从普通 Activity 开始，整个准备／锁屏恢复／外部观察均无 instrumentation；原输入在锁屏、联网恢复后完成。前两次公开复验的功能断言通过但退出清理失败，保留失败；修正观察脚本后第三次只读复验连同退出通过，没有重发 |
| 整机重启／真实首次解锁 | 联合 T13 候选 AC63，reboot02 外部完成与公开复验通过 | 原输入离线后实际重启；联网且首次解锁前 user RUNNING_LOCKED、CE 不可读、无 Service／agent。真实 PIN 解锁后系统自行恢复；外部完成证据早于首次重新打开 Activity／SDK。真实 MiMo 文本，无工具，不声称完整 HTTP 次数 |
| 实际 force-stop／用户重开 | AC63，30 秒 stopped interval、明确重开、外部完成和最终复验均通过 | 真实 force-stop 后联网仍保持 stopped=true、无进程、原工作无完成；只有明确 launcher 重开后继续同一原输入。不是绕过 force-stop 的后台恢复 |

## 真实文件与凭据证据

首次 `c73b6bb` 模型直接返回预期文本，没有调用工具。测试于 133.649 秒失败，尚未执行宿主强杀；只读观察确认没有 execution，独立正常 Termux 确认目标文件不存在。没有把这次失败称为恢复成功，也没有重开旧输入补做。

随后候选的实际 HTTP 暴露 12 个工具（包含 bash），`tool_choice` 保持默认，未强制调用。模型实际执行一次命令，文件先出现 `part-one\n`，随后仅终止应用报告的 `:agent` PID 24376。新 PID 24484 继续观察同一 execution `098b9ee4-965c-419e-8430-ca1a35d7c04f`，最终退出码 0、scopeConfirmed=true，没有第二个执行或第二个用户输入。恢复前后各记录一次模型请求，共 2 次。

根代理仅在初始阶段用加密 capsule 写入该验证域的持久 CredentialVault。强杀后未再次注入，恢复请求使用 generation 1。凭据审计由根代理保管，公开日志没有密钥或 capsule。

文件 run 为 `e11cbadc-8223-4d56-87ed-0edcce19ee1a`，位于受管默认工作区 `.durableagent-t12-<run>.txt`。应用接口与根代理正常 Termux 独立读取一致：18 字节 `part-one\npart-two\n`，SHA-256 `c9d69e79af57fe32b6481148132da068c4051bab2eed1484b2d85a263b02558f`，inode 625435。见 [设备原始结果](t12-real62-device.log) 与 [独立原件读取](t12-real62-independent-file.log)。

后续 product 实测先由严格只读预检确认产品库不存在，初始配置经正常模型设置 API 创建 `recovery-validation` 并写入持久原生 vault；该步骤 4.325 秒，0 会话、0 HTTP。再次只读预检 0.499 秒，确认配置 version 2／credential generation 1，活动 SDK task 为 0，未打开 Harness 或解析密钥。没有覆盖已有默认值。

真实无绑定 run `9df52e75-a9c0-4d97-8c9e-b885820d1b00` 复用该连接且没有新 capsule。partial 文件确认后关闭 Activity 与客户端，再终止原 `:agent` PID 5051；Android START_STICKY 新 PID 5147 在观察者重新绑定前持久记录完成。原 intent `32c0f7b0-46b8-4ee6-bdef-4823b0197049` 与 execution `43db62eb-b5fc-46a2-b3af-e2a006de5843` 保持，只有一个用户输入及一个执行、scopeConfirmed=true、退出码 0。正常 Termux 独立读取 inode 625467、18 字节，与上面相同 SHA-256。见 [无绑定设备结果](t12-product-unbound01-device.log) 与 [独立读取](t12-product-unbound01-independent-file.log)。初始进程计数 1、重连观察计数 1，但日志明确 `completeRequestCountObserved=false`，不能写成已证明总请求恰为 2。此结果仍不代替整机重启或 OEM 资格。

## 缺陷与修复依据

首次应用通知批次 1/2 通过，完成通知未出现。只读观察表明 SDK 已完成，原生投影仍为 running、outbox 为空；定位为发布读取 100 条发送记录而原生只接受最多 50 条，并同时修正最新答案选择。修复后通过两批七项测试，没有删掉首次失败。

完成通知先持久认领投递尝试，再调用系统通知，然后记录确认。已在系统存在的同身份通知仅补确认；已被用户移除且确认丢失时不重新弹出。认领后、系统发布前退出会留下“投递未确认”，可能没有实际通知；会话耐久结果仍可见。不声称 SQLite 与 Android 通知具有跨系统原子提交。

JobScheduler 的初始缺陷为 `startForeground` 未将只靠作业绑定的 Service 变成 started service，最后解除绑定后运行宿主退出。修复仅在 Android 已接受前台提升后保留 started lifetime；没有制造后台启动豁免。测试的 instrumentation 执行资格也不外推为任意后台或 OEM 准许。

后续实际 JobScheduler RED 确认另一缺陷：原生在系统发布成功前就缓存 `lastWake`。真实自有 namespace 冲突导致 schedule 拒绝后，重试相同 wake 被缓存误判为已发布；清除冲突后 10 秒仍没有正确 job。仅把缓存更新移动到 schedule 成功之后，同一测试通过，保留原 admission，实际 jobId 1721478909、0 模型请求。真实离线条件随后由根代理恢复。

生命周期验证还发现测试设计风险：Android instrumentation 正常开始和结束都可能 force-stop 目标包。未执行的两阶段 instrumentation 生命周期夹具因此删除，冻结 artifact 标记无效；没有把编译成功视为该路径可用。替代方案使用真实 React／CDP 一次发送和正常退出，再用外部只读双快照确认原完成身份，详见 [运行说明](../../../tools/recovery-lifecycle-RUN.md)。这项工具修正不影响先前在同一次 instrumentation 内已观察完成的 bound／unbound 恢复证据，但后者仍保留 instrumentation 运行资格的限制。

实际 later-lock run `6daace13-cf22-42c6-9493-d43e63bbeb0a` 于 12:21:49 UTC 从普通 product 界面完成一次发送；产品 `0d1cd678-787b-46b0-aba1-a20173cc6083`，原 intent `77cbd7d5-cb3d-4292-ab9c-2d228950265d` 已接纳并明确等待实际网络。关闭 CDP、正常退出 Activity 后，同一已启动前台 Service 继续。根代理实际锁屏后恢复网络；没有重开应用、SDK 或 instrumentation 触发继续。

外部观察最初因要求 PID 消失而超时，尽管 Service 已退出但 Android 保留缓存 PID 8394。第二次因要求回滚日志不存在而超时，实际 Android 留下零字节日志。两次 [原始观察的摘要与校验](t12-laterlock01-observer-timeouts.json) 保留；没有修改生产状态来制造成功。修正纯观察条件后，12:29:11 UTC 在 primary user 0 为 RUNNING_UNLOCKED、deviceLocked=true 的前后检查间取得 [稳定原生完成证据](t12-laterlock01-external-completion.json)：双份 36,864 字节数据库一致，SHA-256 `da2bc6af9aac3f696e933b2ca80ed3d711d1a4af152470fe477ee4d01663a92b`，integrity_check=ok，前／中／后回滚日志均 0 字节且无 WAL/SHM，原 product done、完成身份 `answer:28:42`、outbox published=1。Service 始终不存在，缓存进程仍在，未冒称进程死亡或文件锁证明。根代理还观察到对应实际通知与指向原 product 的 PendingIntent，完整系统转储仅本地保留。

其后才真实解锁并打开 UI，只读公开接口确认原 admission、一个用户 entry 38、原 assistant entry 42 的准确 marker、零工具执行。首次只读验证在全部功能断言通过后，因单次 Back 未关闭 Activity 而清理超时，见 [失败记录](t12-laterlock01-verify-cleanup-failed.json)；其中旧脚本的 `passed:true` 只是在清理前赋值，不能当成整段通过。驱动改为最多三次且仅向本 Activity 聚焦窗口发送 Back，并将完整通过标记移到清理之后。第二次仍因 `dumpsys window windows` 未包含焦点字段、且实际焦点使用完整类名而 [清理失败](t12-laterlock01-verify02-failed.json)。改用完整 window 转储并同时识别短／完整类名后，12:47:53 UTC 开始的 [第三次只读复验](t12-laterlock01-verify03.json) 连同正常 Back 退出通过。三次均只读同一原输入，没有重发。此次成功不代表整机重启、force-stop 或 OEM 行为，也不证明完整 HTTP 次数。

随后 reboot01 的准备脚本在一次真实 UI 发送后误将全局发送状态刷新错误当作发送失败，见 [原始失败](t12-reboot01-prepare-failed.json)。设备仍实际离线，尚未重启。[只读诊断](t12-reboot01-diagnose.json) 确认原 intent `5bc76f42-a122-4871-b1e0-b96cdd0bf037` 已 acknowledged、UI 行 placed、SDK conversation 43／submission 54／唯一 user entry 53，等待 network-offline；同时状态区仍显示先前刷新错误。这是观察脚本误报，不能归因为该次 freeze 或发送失败。修正脚本只检查原发送行、等待动作结束，并将原行身份与公开 durable intent 对齐；不会自行重试。该输入没有用于补做重启测试。

清理时先一次直接 runtime stop 使用未建立的 stopId，返回 `STOP_MISMATCH`，没有改变原输入；随后读取原 control，经原生 `input.stop` 建立同一会话 generation 1 的停止记录，再用其准确 stopId 确认 runtime stop。[清理结果](t12-reboot01-cleanup02.json) 证明 phase stopped、仍只有原 user entry 53、正常 Back 退出、ApplicationService 不存在，Wi-Fi／移动数据均恢复为 1。该准备失败、诊断及停止均保留，未重新发送，也没有声称执行过重启或 force-stop。

## 联合 T13 的实际重启与 force-stop

已合入验收的 T13 source `2ab45ed380b098d89d70a32b5389caee4c25e3ab` 和 gate record `a0b161c119a3ad0fafd7eb652289ac86f5904e84`，T12 联合候选源码为 `1ad67253cc0fc018c8172b877f46f106405c9554`。无冲突合并后检查了共享恢复／Provider 分支、原生 1 秒动作前 lease wait 与无阻塞配置；没有重复执行发送或把输入重建为新身份。[构建日志](t12-joint-t13-build01.log) 的 main／test assemble 与 lint 通过，0 error／12 warning。相关七个真实 SDK host 测试文件共 85/85，18.656 秒，见 [正确 runtime 工作目录的结果](t12-joint-t13-host02-runtime-cwd.log)。首次从仓库根运行时 79/85，其余 6 项因测试用相对 `validation/...` 子进程路径而 ENOENT；[原失败日志](t12-joint-t13-host01-root-cwd-failed.log) 保留。同一组选项改为规定的 runtime 工作目录后通过，没有改测试或生产实现。

完整命令顺序在 [生命周期运行说明](../../../tools/recovery-lifecycle-RUN.md)。这两次均只安装 main，使用普通产品 React 页面、一次 Create／Send、现有保存的 `recovery-validation`／generation 1／配置 version 2；未运行 instrumentation、未注入新 capsule，也未 force-run job 或发送合成 boot/unlock 广播。原始命令输出以本地 `%TEMP%\durableagent-implementation\t12-reboot02-*` 和 `t12-forcestop01-*` 保留；本文链接的 JSON 为原始记录副本，校验见 LOG-SHA256。

reboot02 的 run 为 `32c5fdca-a0bd-440f-bc8b-8252777adbbb`、product `f0d5fc78-7070-4194-a5a5-d45778e3e9f1`、原 intent `a9106c9e-4f0a-46fb-8569-0bf063d4e7fb`，SDK conversation 57／submission 68／用户 entry 67。[实际离线准备](t12-reboot02-prepare.json) 于 13:09:59 UTC 关闭所有客户端，原 owner PID 14721；重启前唯一 app job 为 product 18012。真实 reboot 后先记录 Android 系统服务尚未就绪的早期读取，再等 `sys.boot_completed=1`。恢复网络后四次、跨度超过 15 秒的 [首次解锁前记录](t12-reboot02-before-first-unlock.json) 均为 user 0 RUNNING_LOCKED、deviceLocked=1、无 Service／agent；加密状态 encrypted/file、CE unlocked users=[]，`adb shell run-as` 读取恢复元数据因 CE 目录不可访问返回 1。两次早期观察器断言错误分别来自 `exec-out` 将错误写 stdout、且未传播退出码，均写入同一记录；从未读到 SQLite 内容，不归为产品失败。

随后依据实际 keyguard 控件输入已有 PIN，user 0 变为 RUNNING_UNLOCKED。没有打开应用或 SDK，外部观察到新 agent PID 2306 自行启动并退出 Service；13:14:53 UTC 已持久完成同一 product，身份 `answer:57:71`、outbox published=1。[外部原件证据](t12-reboot02-external-completion.json) 为两份相同的 36,864 字节恢复库，SHA-256 `00d284b4694b4009bf014473387b9a791707de602da81bf49040c2a531c4b9da`，integrity_check=ok，三次 rollback journal 0 字节／无 WAL/SHM，Service 不存在、cached PID 2306。之后才 [公开只读复验](t12-reboot02-verify.json)：原 admission 相同、只有用户 67、真实 MiMo assistant 71 准确 marker、零执行、正常 Back 退出。不得将这次自然系统调度时间外推为固定恢复时限。

force-stop01 的 run 为 `5b2b1716-4437-49a7-8134-a9c624c6c99e`、product `a1d19357-41ed-487b-a90c-da77950e8482`、intent `f901c34e-119e-43f4-b3b3-ec3d33afb6ad`，SDK conversation 72／submission 83／用户 entry 82。[独立离线准备](t12-forcestop01-prepare.json) 后实际 `am force-stop dev.durableagent.probe`，恢复 Wi-Fi／数据；[30 秒外部区间](t12-forcestop01-stopped-interval.json) 始终 stopped=true、无 agent、无原完成身份，观察者没有启动目标。随后才 [明确 launcher 重开](t12-forcestop01-reopen.json)，原 admission、唯一用户和 marker 答案通过；正常 Back 后 [外部双快照](t12-forcestop01-external-completion.json) 于 13:17:18 UTC 证实 `answer:72:86`／outbox 1，SHA-256 `3fe5ef2062d4998240f86a5904faa30eaae64ff72758e1e0cfa045ea01998e6a`、integrity ok、Service absent／cached PID 5463。[最终只读复验](t12-forcestop01-verify.json) 同样整体通过。Wi-Fi／数据恢复 1，两个 AndroidWifi override 均 none，Activity／Service 退出后归还设备控制权。未改动 Termux；真实 reboot 后执行端 daemon 需通过既有 gateway 恢复，这两次没有工具请求。

根代理在 13:19:02 UTC 对应用 54,121,984 字节及日志 31,656 字节完成 [真实凭据精确匹配审计](t12-reboot-forcestop-credential-audit01.json)：UTF-8／UTF-16LE／UTF-16BE 均零命中，阳性对照通过。审计范围与恢复结果一起保留；没有以“无匹配”代替其他隔离或生命周期保证。

AC63 的 [artifact journal](t12-joint-t13-lifecycle01-artifacts.json) 明确一个打包限制：旧 worktree 中未重新写出的 Python helper 为 CRLF，虽 Git 内容与已验收源码一致、冻结字节也通过对应核验，打包 capability `13af9386…`／setup `cfc66690…` 与已验收 LF 字节的 `10d7375d…`／`bccdfe9d…` 不同。因此此 APK 只用于上述零工具 marker 生命周期，不作本地文件或 helper 资格声明，也没有为迁就它更改设备执行端。现 worktree 已按 HEAD Git blob 精确恢复 LF，[逐文件核验](t12-final-helper-lf-normalization.json) 与 Git 零差异确认后重新生成 capability／setup，完整 hash 已匹配已验收版本；最终联合构建仍须重新冻结及检查。

## 独立审查发现的输出读取预算缺陷

在上述设备候选之后，独立审查复现了 P2：固定命令已有 completed／scopeConfirmed 收据，但 `readOutput` 连续失败时，旧 `holdReceipt` 立即把终态当成已核验，递归重新读取而没有消耗恢复预算。首次有限诊断为 [20 次读取／1 次执行／0 次预算](t12-review-output-retry.log)；随后 [固定独立回归](t12-review-output-retry-regression.mjs) 用 100ms 外部计时器截断，旧实现 [RED](t12-review-output-retry-regression-red.log) 发生 1259 次读取、1 次执行、0 次预算、无等待状态。它使用实际 ManagedExecution／Recovery 方法，但 Harness／writer 为内存诊断 seam，没有真实 SDK、Android 或模型请求；不声称发生重复执行。

修复仅增加持久的结果确认标记，保留外部完成事实；重入或重开先用原 executionId 的同一耐久预算重新核验，再读取原结果，完整结果确认才清除标记。模型继续入口不因 terminal receipt 绕过此标记；自动预算用完后仍停留在可见等待，不交给模型生成替代命令。[同一独立回归 GREEN](t12-review-output-retry-regression-green02.log) 为 1 次初始读取、1 次执行、1 次已耗尽预算检查、external-unconfirmed used=5。源码／设备候选范围分开：这个修复尚不属于已运行的 AC63。

正式 [真实 SDK 回归](../../../runtime/test/recovery-output.test.mjs) 使用公开 Application、实际输入／SDK／执行账本／预算 SQLite，输出和模型传输为受控外部边界。[RED](t12-output-budget-red01.log) 在初始读取连续失败后没有可见预算等待；最终 [两项 GREEN](t12-output-budget-green03.log) 证实初始读加总计 5 次预算内重试，关闭应用并重新打开预算数据库后总读取仍为 6，同一命令效果文件仅一条、模型请求保持 1，普通 wake 不补充额度，原 Stop 和重新打开不复活。明确的新代次发送可以完成独立的新工作；另一个正向用例证明一次读取故障恢复后仍返回原输出、只花 1 次预算，不阻止后续模型回合，完成后重开不再读取。

独立复核还发现第一版标记会让一个已停止、已确认完成的旧代次阻挡下一代次的直接 continuation 检查。[固定诊断 RED](t12-review-stopped-output-new-generation-regression-red.log) 与 [同断言 GREEN](t12-review-stopped-output-new-generation-regression-green.log) 保留；修复只豁免已由停止 fence 覆盖且 terminal／scopeConfirmed=true 的旧记录，未知外部效果继续阻挡。真实 Application 的新代次扩展用例在该 guard 前就 [通过](t12-output-new-generation-public-before-guard.log)，因此该项 RED 只归于独立内存 seam，不拼造公开路径失败。两份有限诊断可从 `runtime/` 运行 `node ../docs/evidence/t12/t12-review-output-retry-regression.mjs` 和 `node ../docs/evidence/t12/t12-review-stopped-output-new-generation-regression.mjs`；正式测试使用 `node --test test/recovery-output.test.mjs`。最终 [完整 runtime 回归](t12-output-final-runtime01.log) 为 260/260，27.865 秒，包括原 deferred、停止与正常完成重开用例。

## 联合 T15 的实际完成通知点击

T15 `75ab2ae` 已合入生产源码 `a8ee9c0`，fixture-only `342c1b7` 增加观察模式。[冻结候选](t12-final-joint01-artifacts.json) main SHA-256 `c233075040a4011fd7462f5d07aa571784f772b807804f96235d6bbd486a3d44`、test `b5e875ea63be2f98b2a013a2d43c65dea805f2fe1868b8226d5325c39f6c10f5`。[构建／lint](t12-final-joint-build01.log) 通过；8 个 Python helper 为 exact HEAD LF，[pins](t12-final-joint-helper-pins.json) 匹配已验收 setup／capability。[根代理独立 APK 检查](t12-final-joint01-root-inspection.json) 为 72 runtime／11 UI／236 matched source paths，另有 411 文件的完整快照，范围不同。本次只安装 main，未运行 instrumentation。

旧完成通知实际已不存在，原因未确定；没有编辑 outbox 或重发旧输入。按授权以保存的 MiMo 配置进行一个新 marker-only React 发送：run `1dae17ae-06d4-496a-b5ae-5baf569d1a26`、product `1ccb7b54-f5eb-4f0d-bae1-bf4f75d7daeb`、intent `a002c586-47d5-4e9a-8206-74848f67a22b`，SDK conversation 87／submission 98／user 97／assistant 101。[实际离线准备](t12-notification01-prepare.json) 后关闭客户端并恢复网络；没有重开 Activity／SDK，[外部稳定证明](t12-notification01-external-completion.json) 得到 `answer:87:101`／outbox 1，再做 [公开只读基线](t12-notification01-baseline.json)。没有观察完整 HTTP 次数，不宣称恰好一个请求。

普通 UI 切到旧会话 `a1d19357-41ed-487b-a90c-da77950e8482`，保存未发送测试草稿后 Back，见 [另一会话基线](t12-notification01-background.json)。实际展开系统通知栏，确认「会话 1ccb7b54 · 点击查看已保存结果」，[一次真实控件 tap](t12-notification01-physical-tap.json) 为 (587,810)，无合成 intent／PendingIntent 反射。[整段只读目标验证](t12-notification01-target.json) 通过：实际 selectedConversation 正确，原历史、唯一 intent／admission 相同，零执行，另一会话草稿／历史／意图完全相同；正常 Back 退出。根代理独立目视通知及目标截图。最终 Activity／Service 不存在，网络 1/1，AndroidWifi overrides none。命令入口为 [运行说明](../../../tools/recovery-lifecycle-RUN.md) 和驱动 prepare／verify／background／notification；系统原始转储只本地保存。

[凭据精确审计](t12-notification01-credential-audit.json) 14:04:49 UTC 对 app 55,791,104 字节、log 148,150 字节 UTF-8／UTF-16LE／UTF-16BE 零实际 key 命中且阳性对照通过。此为 C233 通知目标的成功范围；新增全量审查问题的后续修复、固定回归及最终候选另见下文；该次审计不代表整票完成。

## 候选对应关系

| 源码／用途 | 主应用 SHA-256 | 测试 APK SHA-256 |
| --- | --- | --- |
| `54a5f7e` 通知窗口及应用；后为 Job RED 主应用 | `07F9D07FFAC566B7D0CFE9D937081B038C33238105169923AA89E1BC3EFB1D9B` | 通知候选保留在原 artifact；Job 测试见下一行 |
| `aedb8d6` Job GREEN | `4F35EBDDD47E6ED29CBDD9634D9B7FD86D4240752E47420AB573AFE6BE496474` | `F7DC4920FC3D16C9306AB27D655DCD03B9815C86E6406A2ADF5E3C9DFCB69B00`，与 RED 相同 |
| `62a9dbb` 真实 bound 恢复／受限通知／只读产品预检 | `225AE61F621132A43B24D72E395CBA7E1294B545A48C0C3D46E8BB281F742A13` | `8130DD1A813601B041839457604A981094A0AA388CF0DA37CE5D06625FB91F3F` |
| 同一 `62a9dbb` 主应用，后续 `b56b9bb` test-only 产品初始配置／无绑定恢复 | 同上 `225AE61…` | `54AAFA20969DC594D38DEF43C0DAEEBAEBDD167A736E25412F81BA0406D050C0`；不声称后来开发主应用修改已在此运行 |
| `31b2ed8` 原生 wake RED | `065AFF69F8CB5BECA2805BF210E39DD39EB0590810913C1A1F2916471A953B2D` | `3C4C8E842F7A028A5A686865A57A3EE8E3E7C33FAA098BDF9EED81645760C3AC` |
| `3a0927e` 原生 wake GREEN | `071E1C2DD0C47BDE84FC8D1AEBF80A37C9270863AA995D466CB5EA2EDBA56E2A` | 同一 `3C4C8E…`，未放宽断言 |
| `1ad6725` 联合 T13；marker-only reboot／force-stop | `AC63EC62ED95E857CD3869E66113345AF5EC7D22A30B9BE5628315E0C742B9EF` | `340534B2404988E554FBFEE7D424A92EECC911A0FAFADCE382D02501E33D1328`；构建而未在这两项生命周期中运行，helper 打包范围限制见上 |

大型 APK 与冻结源码保存在根代理的本地验证目录，不加入公开仓库。本文所列日志校验见 [LOG-SHA256.json](LOG-SHA256.json)。构建成功、源码快照或 ELF 检查不能代替该候选的实际设备结果。

## 未完成的门槛

- 联合 T13／T15、通知目标及全量审查发现项已完成下述开发修复与验证；最终独立合并审查仍为 T12 的关闭门槛。
- 最终联合构建、8 份 LF helper 字节、源码／打包对应与实际 native 最小回归集均已完成；后续 UI 提示候选保留组件完全一致证明，实际 force-stop 提示产品门槛由 T17 执行。
- T17 OEM 矩阵；本文模拟器与分批验证不替代 Galaxy S23／Xiaomi 厂商行为。

## 宿主重开后重新发布同一唤醒

全量审查提出的 restoreRunning 缺口已由实际 Android JobScheduler／公开 Application 验证：[同一固定测试 RED](t12-wake-reopen-red01-device.log) 15.590 秒。先用自有 jobId 冲突让一次实际离线发送的 wake 持久但发布失败，正常关闭旧宿主并确认 Service 消失；移除冲突后建立不同 instance 的新宿主，仍无法重新发布相同 wake。没有第二次发送或模型请求。根因是 restoreRunning 把持久计划预置为 lastWake，而持久化不等于系统发布成功。最小修复只取消此预置，缓存仍仅在 schedule 成功后更新。

[同一测试 APK GREEN](t12-wake-reopen-green01-device.log) 7.332 秒，run `c0c6d0f0-118d-40f9-99e5-0f757e0967ed`，原 admission 保持、new owner、实际 jobId 1999245591、modelRequests 0，finally 停止自己的输入并恢复网络。RED [冻结值](t12-wake-reopen-red01-artifacts.json) main C233；GREEN [冻结值](t12-wake-reopen-green01-artifacts.json) main `02bb43d457f41baeda26eba3c569caa140b6f2f108d5a071ac4adc4630e78a6d`；两者 test 均 `add94483522761419b900b300c3fdac6008f9f809e9357106498a46ed2e69f5a`，断言未改。命令为实际网络关闭后 `am instrument -w -e class dev.durableagent.probe.RecoveryJobApplicationTest#aReopenedOwnerRepublishesItsPersistedWakeWithoutAnotherInput -e actualNetworkOffline true dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner`，结束恢复 Wi-Fi／移动数据。该显式宿主重开测试不冒称进程自然死亡；先前无 instrumentation 的产品生命周期证据仍按原候选限定。最终 native 修改后的既有 Job lifetime 回归已在 1623 候选通过，见文末。

## 多条待发送意图的原顺序

独立审查发现 native/UI 的 latest-first 分页被直接用于恢复，导致两个明确输入变成 SECOND、FIRST。公开真实 SDK／SQLite 回归先 [RED](t12-pending-order-red01.log)，覆盖两条及 52 条；初版修复后两条通过，但 52 条实际生成超过原 10 秒测试预算，见 [原失败](t12-pending-order-green01.log)。最终回归改为两个有效输入之间夹 50 条已停止的另一会话输入，既真实跨页又验证停止 fence；同一最终测试在原生产源码再次 [RED](t12-pending-order-red02.log)，两个用例均准确得到倒序。修复收集全部页的未接纳身份，再按原生 durable sequence 反向处理，逐项仍重新读取身份与停止事实；没有按可能相等／倒退的 createdAt 排序，UI 仍 latest-first。

[整个 submission suite GREEN](t12-pending-order-green02.log) 15/15，7.480 秒；两条原输入顺序正确，跨页取消输入没有历史，完成再重开 receipt 不变。独立固定诊断也 [GREEN](v1-review-pending-order-regression-green.log)。首个脚本写入用了错误 cwd，因此根本没有注册新测试，[空选择器输出](t12-pending-order-fixture-path-error.log) 保留且不算 RED/GREEN。这些是受控模型传输下的真实 SDK／SQLite 公开接口结果，并非 Android 实际进程杀死。

## Retry-After 与保留的 SDK 重试额度

审查用生产 ModelConnections／真实 SDK 的合成 HTTP 429 复现 `Retry-After:120` 被 1 秒固定退避忽略。公开 Application／真实 SQLite 测试的初始 [三项 RED](t12-retry-after-red01.log) 同时显示等待截止时间过早和停止前已发第二个请求。修复使用 app session 中按不可变 connection ID 保存的 not-before：原始响应到达时立即建立当前宿主的保守门禁，await 持久 max deadline 后才把响应交给 Provider。只保存合法秒数／HTTP-date 转换的时间，不存任意 header／body／凭据。Provider 内部 maxRetries 保持 0，SDK 原输入、task、retry/restart 计数不改。

SDK 1.5.0 没有支持的 built-in retry deadline override，因此该门禁等待位于已准备的请求阶段，普通等待在 HTTP 45 秒 timeout 之外，可被 Stop／close 取消。它不是新增重试循环；最终 credential await 期间若另一个响应延长 deadline，只重建一个尚未发送 HTTP 的 provider invocation，已发送请求绝不在此重试。宿主在门禁等待中崩溃仍可消耗 SDK 原有、更严格的 interrupted/restart 额度；不宣称无成本 sleeping task。Recovery 将当前门禁的期限与 SDK wake 取最早，并保留原 active 事实。

[首批三项 GREEN](t12-retry-after-green01.log) 覆盖秒数／日期、owner close/reopen 后原绝对期限、原 admission／唯一用户、Stop 后到期不复活。[相关模型 suite](t12-retry-after-green02.log) 27/27，含原 deferred／compaction／凭据轮换及反射防护。审查随后指出两个边界，并补固定公开 [RED](t12-retry-after-review-red01.log)：真实 storage.commit 尚被阻塞时另一个 credential resolve 完成会过早请求；已准备的 A 等待时选择 B 会隐藏 A 的截止时间。修复分别将内存保守 fence 提前到 commit 前，以及通过公开 getTask 的原 checkpoint 读取实际 prepared model／poll／compaction。最终 [八项 GREEN](t12-retry-after-green03.log) 还覆盖并发延长、B 的独立后续 prepare，以及反复限流跨 reopen 最终仍只有初次加原 3 次重试、耗尽不补额度。

实际 overflow 压缩路径还产生了 [显示 RED](t12-retry-after-compaction-red01.log)：SDK 已移除 live.generation，但 blocking child 仍在限流等待。使用公开 child checkpoint 的 attempt／until 后 [GREEN](t12-retry-after-compaction-green01.log) 1.558 秒；通过普通两次发送、真实 SDK context overflow 和 compaction HTTP 请求触发，未写入 SDK 内部状态。第二次已准备的压缩 attempt 为 2，外部 HTTP 仍只有 seed／overflow／首次 compaction 共 3 个。独立原固定 6 秒诊断也 [GREEN](v1-review-retry-after-fixed6s-green.log)：120 秒期限内请求保持 1、phase waiting。独立聚焦审查于 `da85f5f` 关闭该项。

源码 `ebf9676` [完整 runtime](t12-review-fixes-runtime01.log) 271/271；其后补压缩用例、纯 canonical 提取 `0e207f2`、native channel 40 秒单次调用预算后 [完整 runtime](t12-review-fixes-runtime02.log) 272/272，28.620 秒。canonical 仅将四份同义递归对象键排序提为同一纯函数，现有 identity／receipt 回归验证行为不变。各项合成传输用于可控限流及并发边界；前文真实 MiMo 与 Android 证据按各自候选保留，不将这些 host 测试冒称新的真实 API 限流实测。


## 已配对执行器自动重开与保留的取消通道

自动重开修复来源 `d1e994e`，连接占满修复与夹具收敛来源 `374d74d`。此前普通 native `ping`／query／工具入口只使用保存的 socket，监听器退出后须手动 Connect。新的原生入口先在输入库 lease 之外验证保留的 client、pin、executorId、ledgerEpoch；仅明确的 TCP connection absent 可以通过固定 RUN_COMMAND 启动 `serve-existing`。10 秒绝对 readiness 期限覆盖首次 ping、可中断锁获取和启动后的轮询，关闭／中断会阻止后续原操作。未知 TLS／身份错误仍 fail closed。原始操作只发一次，未知回应绝不通过连接恢复重发。Node 单次调用预算为 40 秒，native stop sweep 45 秒。

`serve-existing` 与 worker 通过 SQLite `mode=rw` 打开既有账本，要求原目录、writes.lock、v1 schema 和完整两项身份存在；不运行建表／补身份／bootstrap。明确配对入口保留原行为。三个 existing-only 合同先 [RED](t12-existing-executor-red01.log)，后 [GREEN](t12-existing-executor-green02.log)，覆盖保留身份和取消墓碑、缺失账本不得创建、损坏 schema／identity 不修补。Windows 上这些是 SQLite／文件构造合同；真正 Linux worker／TLS／文件效果另由下面的 Termux 全套验证。

实际 Android 首次 [RED01](t12-autostart-red01-device.log) 0.469 秒，仅杀死精确固定 argv 匹配的自有 listener PID 6290，socket 确认消失后普通请求失败。为使最终测试同时识别旧 `serve` 和新 `serve-existing`，一次正常 Termux 脚本只恢复旧固定 `serve` 为 PID 12712，未调用 Connect／bootstrap；[恢复记录](t12-observe-old-listener01-result.log) 证明五张账本表逻辑摘要与 pairing 文件前后相同。随后 [RED02](t12-autostart-red02-device.log) 是新测试调用 Kotlin 默认参数 ABI 导致的 NoSuchMethodError，发生在杀进程之前，不算行为 RED。恢复兼容的两参数 overload 后，[固定最终测试 RED03](t12-autostart-red03-device.log) 0.246 秒，精确杀死 PID 12712、独立确认 listener absent、普通请求仍 CONNECTION_UNCONFIRMED。三次失败均保留；RED03 的 test SHA 为 `3d99bb4cdb82b76cf328919025ab6ab96d4577ba5442b2d90d3f8bb518ecc938`，后续 GREEN 必须使用同一字节。

独立审查还指出 readiness ping 竞争普通四个任务槽会挡住保留的取消通道。真实 Termux／mTLS [RED](t12-observe-transport-red01-result.log) 0.706 秒：四个 hold 已占满，echo 拒绝后 ping 无成功 value。最小修改在完整 client／hello／session 认证之后、ordinary/control admission 之前回复固定 ping，仍受全局 12 socket 上限约束；同一测试字节 `6bb54c99124b7d93baf78a6c7f9800b537ce6cfa275cc0858e073ea2e08fc353` [GREEN](t12-observe-transport-green01-result.log) 0.893 秒，后面的 query、cancel 及取消耗时断言均执行通过。不按任意远端 CHANNEL_BUSY 字符串推定身份有效。

候选八份 Python 的真实 Termux 全套首次 [full01](t12-observe-python-full01-result.log) 45 项／18.387 秒，两个失败均为预期 unknown 的死亡窗口测试被通用 tearDown 拒绝。生产行为断言已通过，未因此修改生产逻辑。夹具仅在这两项全部断言通过后标记 exact executionId；tearDown 必须发现未确认集合与显式集合完全相等且全部 unknown 才允许保留，不删除原件，也不声称 scopeConfirmed。其他意外 unknown 仍失败。[full02](t12-observe-python-full02-result.log) 45/45、19.989 秒，含真实 SQLite／mTLS／子进程／SIGKILL／原件写入／重复身份不重复效果及不可变源码能力。full01、full02 的四个预期未知目录均保留；不将保留解释为已完成清理。

`374d74df91a4c6ae6e8acb8e8bd5f0598cc9c93c` 的 [最终构建与 lint](t12-autostart-final-build02.log) 通过，八份 Python 与 HEAD blob 完全一致且为 LF，[安装资源合同](t12-autostart-assets01.log) 通过。冻结目录 `D:/durableagent-validation/t12-autostart-final02`，[包清单](t12-autostart-final02-artifacts.json) main `1623ac04a17e3934173c16d527c611733b52e82251a2bc7bd1895df7c19ad526`，test 仍为同一 `3d99bb4c…`。[包检查](t12-autostart-final02-apk-inspection.json) 74 runtime 模块、11 UI、238 源码对应项及原生 pin／16 KiB alignment／setup 均通过；416 是冻结器较广的源码清单，不与包检查计数混同。

受控升级只替换我们部署的 runner `be8b68ec…` → `a65ecba8be5119b414ecfdc4b1d514b02515e95b89daac8a197f37983eb15111`，transport `c20f4ef5…` → `16f7ece1f961ad3920343c19b19e63658f9590ef0c594a2fb03cbb0fb243d9cc`；file helper `13467b5d…` 不变。新 capability 摘要 `91821135…` 与 setup `1bb16dab…` 是该有意源码升级结果，不能继续沿用旧 pin。具体原件备份与账本／配对／原文件树前后核对见 [升级清单](t12-helper-upgrade01-manifest.json)。实际受锁升级及最终原生 GREEN 在下节单独记录；构建本身不代替设备结果。

可复查命令：在新的自有 probe 中通过实际 Termux terminal 运行 `python -m unittest test_executor test_transport test_production_wire test_file_service test_local_capabilities -v`；包安装后运行 `am instrument -w -e class dev.durableagent.probe.ExecutionTransportTest#actualOrdinaryOperationRestartsPairedExecutorWithoutExplicitConnect -e executionProduction true dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner`。实际 native GREEN、原件一次效果及三项 wake/Job 回归见下节。

升级首次 [preflight](t12-observe-helper-upgrade01-result.log) 被已有非终态 receipt 的保护条件拦下，发生在 before.json、原件备份和任何 staging／替换之前；原 helper／账本／配对未改。当时根代理继续只读盘点具体身份和状态；随后按下述精确身份保留方案处理，没有改表、忽略未知效果或重复启动旧批次。


## 最终受锁升级与原生回归

只读 [inventory01](t12-observe-upgrade-inventory01-result.log) 定位两个 `accepted_not_started`，其余 136 条已终态；[inventory02](t12-observe-upgrade-inventory02-result.log) 固定了两条 request／receipt／prepared 的原字符串 SHA，sequence1、输出0、无启动／取消事实。它们分别来自 T13 的原失败 local-product 与 React08，未重开旧 validation 域、未发送、未授予、未取消。升级02只允许这两个精确记录，其他记录只准 completed／stopped／not_started，不允许 unknown 或其他非终态。

[受锁升级02](t12-observe-helper-upgrade02-result.log) 实际 Termux exit0。132 个既有 installation／server／writes／owner lock 使用非阻塞独占和 O_NOFOLLOW，不创建锁；原 runner、transport 和 installation.json 三份原件均另存到唯一 probe 的 originals 并 fsync。安装清单严格符合原四字段／三份旧 pin，仅替换其中两个文件 SHA；未改 Termux properties。安装前、安装后、释放锁并启动 `serve-existing` 后的三份 schema／全表 logical／pairing／保留文件树快照完全相等，138 条 execution 与两条未启动记录仍原样保留。原安装清单 SHA `9c07032d…`，新清单 `3ad49b70…`；完整值及备份路径见日志。该次只启动 baseline PID15251，不作为自动重开通过证据。独立脚本检查见 [root review](t12-helper-upgrade02-root-review.json) 和 [精确升级清单](t12-helper-upgrade02-manifest.json)。

在冻结 main1623／同一 test3D99 上，固定实际 [自动重开 GREEN](t12-autostart-green01-device.log) 1/1、1.230 秒。测试精确终止 PID15251并独立确认 socket absent，再发普通 ExecutionAccess.ping；无需 Connect 即重新启动固定 listener。processEpoch 从 `2a545e31-f2d4-4689-bf9b-0fb73baf3f09` 变为 `577167c2-94c9-4879-bdb0-69ce4d4add70`，executorId `a0578db8-1bd2-4158-8e78-b27216f25c6a`、ledgerEpoch `c156417c-ec2d-4528-99d1-78d257676c18` 和配对完全保持。该项证明实际 listener 死亡后的普通请求自动恢复；不冒称新的 OEM 重启或 Android force-stop 测试。

同候选的 [两个实际离线 wake 回归](t12-final-wakes01-device.log) 2/2、15.889 秒，覆盖原 owner 与重开 owner 的同一未发布计划恢复；均保持原 admission，零模型请求。网络 finally 恢复。[Job lifetime](t12-final-job01-device.log) 1/1、56.318 秒，run `6c4e7ded-93b1-457e-882c-e4e979b5b32f`，系统 job 的 50 秒绑定自然释放后 PID15922仍为前台宿主；原生 Stop 后 Service 退出。日志 requests1是新 owner 的受控模型请求，另有初始 owner1，不能当作完整请求总数1。

[实际原件 append 恢复](t12-final-original01-device.log) 1/1、10.448 秒。run `bb01b7b1-53af-4a0b-854b-ae87ce2a516a` 在结果提交前强杀 SDK owner，PID16130→16221，仍沿用 execution `5c6c03ff-13da-4c02-8473-b7280f6e491c` 与 operation `eb7492f2-2415-4eb4-ac35-dbde2e5a7b66`。原件回执 completed／scopeConfirmed，同环境独立 read 恰好 `local\n`，SHA `efb83f2a277e9f49b38efd505f5cbb93885e721b6bd16b788937c9396174c006`；重交同一 intent 新增执行为0。这是受控模型传输下的真实 SDK、Termux worker 和原文件效果，非新增真实 MiMo 调用。

结束 [基线](t12-final-baseline01.json) 为 ApplicationService 不存在、Wi-Fi／移动数据1、两个 AndroidWifi override 均 none，设备租约已返根代理。[根代理精确凭据审计](t12-final-native-credential-audit.json) 15:24:46 UTC，对 app57,926,656字节、日志159,117字节的 UTF-8／UTF-16LE／UTF-16BE 全 offset 零实际 key 命中，阳性对照与 tar 完成校验通过；范围不包括 heap／flash forensics。

## 最终 UI 提示候选的组件对应

聚焦审查最后指出，异步 `TERMUX_FORCE_STOPPED` 原样传递到 ExecutionCoordinator 时只显示通道错误，没有说明恢复操作。`4c52692` 仅按原 ApplicationFailure.code 显示“Termux 已被系统强行停止。请手动打开 Termux 一次，再返回本应用；无需重新初始化。”，不改原 code、receipt 或自动 dispatch。一个真实 ApplicationClient 异步 response 的 UI 合同先 [RED](t12-force-stop-message-red01.log)，再 [整个 coordinator 文件 GREEN](t12-force-stop-message-green01.log) 7/7；它还断言原 receipt 不变、只有 list／query，没有 Connect 或重发。[UI typecheck／build](t12-force-stop-message-ui-build01.log) 与 [APK build／lint](t12-final-ui-build01.log) 均通过。该模拟原生 response 的 UI 合同不冒称 Android force-stop 实测。

最终冻结 `D:/durableagent-validation/t12-final-ui01`，源码 `4c526920af7b7208b220f2b4805d9f8f577164e2`，[main](t12-final-ui01-artifacts.json) `e7cf5a6ddff4bc435f513fc727e2ac1f12b93801aefb6570fb8e4457b650bfc0`，test 仍为同一3D99，capability91821135／setup1bb16dab不变。[root 独立检查](t12-final-ui01-root-inspection.json) 的74runtime、11UI、238源码对应以及 native pin／16 KiB打包通过；16 KiB打包不等于16 KiB运行验证。[root APK delta](t12-final-ui01-root-artifact-delta.json) 证明20个非UI非签名项与已实际验证的1623逐字节相同，test APK相同，仅UI生成项改变。[owner 对照](t12-final-ui01-ui-only-comparison.json) 同时保留源码组件比较及首次只读脚本打印差异后多余PY token导致的 NameError；其后完整断言通过，没有改变任何候选产物。根代理已安装 E7CF 作为后续产品验证准备，未重复上述 native 回归；实际中文 force-stop 提示的产品门槛留给 T17。

最终聚焦 [Standards 复核](v1-autostart-fix-review.md) 与 [Spec addendum](v1-review-spec-final-addendum.md) 已关闭各自发现项，包括源码、固定 RED/GREEN、最终实际 native／原件范围及中文提示合同。[两轴汇总](v1-code-review-aggregate.md) 保留初始发现与修复后的范围。它们是独立源码／证据复核，T12 最终集成验收与 T17 的实际产品组合结果由根代理另行记录。
