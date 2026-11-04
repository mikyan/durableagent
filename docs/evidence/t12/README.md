# T12 自动恢复开发证据

2026-11-04。开发仍在进行，不能据此关闭 [T12](../../specs/v1/tickets/12-automatic-resume.md)。范围为 Android 16／4 KB x86_64 模拟器、真实 SDK 1.5.0、Android SQLite／Service／JobScheduler／NotificationManager，以及明确标注的真实 MiMo 请求。首次解锁／重启、再次锁屏、force-stop 与通知目标界面尚待实测；S23／Xiaomi 厂商行为保留到 T17。分批、不同候选的结果不拼成一次完整全绿。

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
| 首次解锁后再次锁屏／真实离线恢复 | 真实产品 UI 发送一次，外部原生完成核验通过 | 从普通 Activity 开始，整个准备／锁屏恢复／外部观察均无 instrumentation；原输入在锁屏、联网恢复后完成。公开结果核对也通过，但首次验证脚本的单次 Back 清理超时，整段脚本未算全绿 |

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

其后才真实解锁并打开 UI，只读公开接口确认原 admission、一个用户 entry 38、原 assistant entry 42 的准确 marker、零工具执行。首次只读验证在全部功能断言通过后，因单次 Back 未关闭 Activity 而清理超时，见 [失败记录](t12-laterlock01-verify-cleanup-failed.json)；其中旧脚本的 `passed:true` 只是在清理前赋值，不能当成整段通过。驱动已改为最多三次且仅向本 Activity 聚焦窗口发送 Back，并将完整通过标记移到清理之后。原输入不重新发送；新一轮只读复验仍待记录。此次成功不代表整机重启、force-stop 或 OEM 行为，也不证明完整 HTTP 次数。

## 候选对应关系

| 源码／用途 | 主应用 SHA-256 | 测试 APK SHA-256 |
| --- | --- | --- |
| `54a5f7e` 通知窗口及应用；后为 Job RED 主应用 | `07F9D07FFAC566B7D0CFE9D937081B038C33238105169923AA89E1BC3EFB1D9B` | 通知候选保留在原 artifact；Job 测试见下一行 |
| `aedb8d6` Job GREEN | `4F35EBDDD47E6ED29CBDD9634D9B7FD86D4240752E47420AB573AFE6BE496474` | `F7DC4920FC3D16C9306AB27D655DCD03B9815C86E6406A2ADF5E3C9DFCB69B00`，与 RED 相同 |
| `62a9dbb` 真实 bound 恢复／受限通知／只读产品预检 | `225AE61F621132A43B24D72E395CBA7E1294B545A48C0C3D46E8BB281F742A13` | `8130DD1A813601B041839457604A981094A0AA388CF0DA37CE5D06625FB91F3F` |
| 同一 `62a9dbb` 主应用，后续 `b56b9bb` test-only 产品初始配置／无绑定恢复 | 同上 `225AE61…` | `54AAFA20969DC594D38DEF43C0DAEEBAEBDD167A736E25412F81BA0406D050C0`；不声称后来开发主应用修改已在此运行 |
| `31b2ed8` 原生 wake RED | `065AFF69F8CB5BECA2805BF210E39DD39EB0590810913C1A1F2916471A953B2D` | `3C4C8E842F7A028A5A686865A57A3EE8E3E7C33FAA098BDF9EED81645760C3AC` |
| `3a0927e` 原生 wake GREEN | `071E1C2DD0C47BDE84FC8D1AEBF80A37C9270863AA995D466CB5EA2EDBA56E2A` | 同一 `3C4C8E…`，未放宽断言 |

大型 APK 与冻结源码保存在根代理的本地验证目录，不加入公开仓库。本文所列日志校验见 [LOG-SHA256.json](LOG-SHA256.json)。构建成功、源码快照或 ELF 检查不能代替该候选的实际设备结果。

## 未完成的门槛

- 整机重启首次解锁、force-stop 等待用户重新打开；外部真实产品验证脚本已准备，尚未执行。再次锁屏的原工作已完成，仍需记录修正清理后的完整只读复验。
- 通知点击返回正确会话以及完整 Console 接线，须与 T15 联合验证。
- 尚未验收的 T13 共同恢复接线，须先通过 T13，再合并 T12；不能借 T12 绕过其门槛。
- 最终联合构建、源码／打包对应核验、独立合并审查，以及 T17 OEM 矩阵。
