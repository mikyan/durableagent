# T12 自动恢复开发证据

2026-11-04。开发仍在进行，不能据此关闭 [T12](../../specs/v1/tickets/12-automatic-resume.md)。范围为 Android 16／4 KB x86_64 模拟器、真实 SDK 1.5.0、Android SQLite／Service／JobScheduler／NotificationManager，以及明确标注的真实 MiMo 请求。产品无界面 sticky 恢复、首次解锁／重启、再次锁屏、force-stop 与通知目标界面尚待实测；S23／Xiaomi 厂商行为保留到 T17。分批、不同候选的结果不拼成一次完整全绿。

## 已观察到的行为

| 边界 | 证据 | 范围与限制 |
| --- | --- | --- |
| 真实 SDK 等待／恢复 | offline、wake、unlock 的 RED 与 GREEN 日志 | 受控平台条件和模型传输；不是 Android 锁屏或联网实测 |
| 原生预算与完成身份 | 初始缺实现 2/2 失败，首次实现因 SQLite PRAGMA 调用方式 2/2 失败，修正后 2/2 通过，0.929 秒 | 保留两次失败；预算、epoch 与完成身份跨原生重开保持，不代表整机掉电 |
| 完成通知与原生停止 | `54a5f7e` 原生存储／通知窗口 5/5，2.158 秒；应用通知 2/2，31.856 秒 | 实际 NotificationManager；通知窗口使用私有 SQLite 故障位置，不称为实际进程强杀 |
| JobScheduler 解除绑定 | 原主应用 + 同一测试 RED 1/1，68.980 秒；`aedb8d6` + 同一测试 GREEN 1/1，76.059 秒 | 50 秒系统作业退出后，同一已准许的前台运行进程继续；原生停止后退出。初始宿主 1 次受控模型请求，加新宿主 1 次；日志 `requests:1` 仅是后者计数 |
| 真实模型／文件中断恢复 | `62a9dbb` 候选 1/1，61.101 秒 | 真实 MiMo 2 次 HTTP，实际执行 1 次；保持 Android 客户端绑定的恢复，不代表无界面 sticky 或重启恢复 |
| 实际通知授权拒绝 | `62a9dbb` 1/1，13.823 秒 | SDK 输入完成、历史可见，完成身份 pending 且无系统完成通知；随后恢复授权 |
| 实际完成渠道关闭 | `62a9dbb` 1/1，9.992 秒 | 通过真实 Android 设置开关将 importance 设为 0；结果仍可查看。恢复为 3，Android 保留 userLockedFields=4 的开关记录，不声称所有元数据完全相同 |
| 真进程 SIGKILL 与 deferred handle | `t12-deferred-crash-host01.log` 3/3 | 主机 Node 的实际进程故障。两次中断沿用原 handle，总计 1 次创建、2 次 poll；耗尽后 interrupted／一次 cancel，不新建请求。不是 Android deferred Provider 实测 |
| 未知外部效果及原生预算暂不可用 | `t12-probe-authority-red02.log` → `green01`，以及 exhausted-stop 日志 | 保留同一工具身份等待，不把未知效果作为可交给模型重发的完成结果；固定工作探测预算不因重开清零 |
| 主机完整回归 | `t12-runtime-stage62-all.log` 246/246，19.675 秒 | 当时 runtime 源码快照；后续唤醒重新发布及原生修改须定点补验 |

## 真实文件与凭据证据

首次 `c73b6bb` 模型直接返回预期文本，没有调用工具。测试于 133.649 秒失败，尚未执行宿主强杀；只读观察确认没有 execution，独立正常 Termux 确认目标文件不存在。没有把这次失败称为恢复成功，也没有重开旧输入补做。

随后候选的实际 HTTP 暴露 12 个工具（包含 bash），`tool_choice` 保持默认，未强制调用。模型实际执行一次命令，文件先出现 `part-one\n`，随后仅终止应用报告的 `:agent` PID 24376。新 PID 24484 继续观察同一 execution `098b9ee4-965c-419e-8430-ca1a35d7c04f`，最终退出码 0、scopeConfirmed=true，没有第二个执行或第二个用户输入。恢复前后各记录一次模型请求，共 2 次。

根代理仅在初始阶段用加密 capsule 写入该验证域的持久 CredentialVault。强杀后未再次注入，恢复请求使用 generation 1。凭据审计由根代理保管，公开日志没有密钥或 capsule。

文件 run 为 `e11cbadc-8223-4d56-87ed-0edcce19ee1a`，位于受管默认工作区 `.durableagent-t12-<run>.txt`。应用接口与根代理正常 Termux 独立读取一致：18 字节 `part-one\npart-two\n`，SHA-256 `c9d69e79af57fe32b6481148132da068c4051bab2eed1484b2d85a263b02558f`，inode 625435。见 [设备原始结果](t12-real62-device.log) 与 [独立原件读取](t12-real62-independent-file.log)。

## 缺陷与修复依据

首次应用通知批次 1/2 通过，完成通知未出现。只读观察表明 SDK 已完成，原生投影仍为 running、outbox 为空；定位为发布读取 100 条发送记录而原生只接受最多 50 条，并同时修正最新答案选择。修复后通过两批七项测试，没有删掉首次失败。

完成通知先持久认领投递尝试，再调用系统通知，然后记录确认。已在系统存在的同身份通知仅补确认；已被用户移除且确认丢失时不重新弹出。认领后、系统发布前退出会留下“投递未确认”，可能没有实际通知；会话耐久结果仍可见。不声称 SQLite 与 Android 通知具有跨系统原子提交。

JobScheduler 的初始缺陷为 `startForeground` 未将只靠作业绑定的 Service 变成 started service，最后解除绑定后运行宿主退出。修复仅在 Android 已接受前台提升后保留 started lifetime；没有制造后台启动豁免。测试的 instrumentation 执行资格也不外推为任意后台或 OEM 准许。

## 候选对应关系

| 源码／用途 | 主应用 SHA-256 | 测试 APK SHA-256 |
| --- | --- | --- |
| `54a5f7e` 通知窗口及应用；后为 Job RED 主应用 | `07F9D07FFAC566B7D0CFE9D937081B038C33238105169923AA89E1BC3EFB1D9B` | 通知候选保留在原 artifact；Job 测试见下一行 |
| `aedb8d6` Job GREEN | `4F35EBDDD47E6ED29CBDD9634D9B7FD86D4240752E47420AB573AFE6BE496474` | `F7DC4920FC3D16C9306AB27D655DCD03B9815C86E6406A2ADF5E3C9DFCB69B00`，与 RED 相同 |
| `62a9dbb` 真实 bound 恢复／受限通知／只读产品预检 | `225AE61F621132A43B24D72E395CBA7E1294B545A48C0C3D46E8BB281F742A13` | `8130DD1A813601B041839457604A981094A0AA388CF0DA37CE5D06625FB91F3F` |

大型 APK 与冻结源码保存在根代理的本地验证目录，不加入公开仓库。本文所列日志校验见 [LOG-SHA256.json](LOG-SHA256.json)。构建成功、源码快照或 ELF 检查不能代替该候选的实际设备结果。

## 未完成的门槛

- 真实 product 命名空间无绑定 sticky 恢复；已有只读预检证明当时产品库尚不存在，初始配置与后续验证尚未计为通过。
- 实际断网恢复、整机重启首次解锁、首次解锁后再次锁屏、force-stop 等待用户重新打开；两阶段真实产品夹具已编译，未执行。
- 通知点击返回正确会话以及完整 Console 接线，须与 T15 联合验证。
- 尚未验收的 T13 共同恢复接线，须先通过 T13，再合并 T12；不能借 T12 绕过其门槛。
- 最终联合构建、源码／打包对应核验、独立合并审查，以及 T17 OEM 矩阵。
