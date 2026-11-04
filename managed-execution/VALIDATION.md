# T09 验证记录

当前仍在收尾验证，尚未宣布整票完成。实际设备操作由根代理串行执行；实现代理没有并行使用 ADB。以下明确区分实际通过、历史失败与待验收项。

[设备公开证据摘录](evidence/android-development.json) 保存原日志 SHA-256、测试结果及公开 Interface 的结构化证据，未复制凭据或设备标识。根代理保留对应完整日志和冻结产物。

## 环境与冻结产物

本轮使用经用户授权的 Android 16 / API 36、4 KiB page、x86_64 模拟器。官方 Termux 0.118.3 APK SHA-256 为 `3550e61f4d9eb49b712fd1bd9519dc37085a4d8eb597c57a340f0a64859b7144`，签名证书为 `b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`。沿用 [T03 开发验证范围](../termux-probe/validation.md)，不把模拟器证明外推到 S23 OEM 行为或 16 KiB Termux bootstrap。

实际安装并检验 Python 3.14.8、SQLite 3.54.1；初始 Python 能力证明使用 OpenSSL 3.4.1，安装固定 `openssl-tool=1:3.6.5` 后实际库已更新到 3.6.5。Python 的 `os.pidfd_open`／`signal.pidfd_send_signal` 不可用，执行端通过实际 Bionic 接口使用 pidfd。初始能力试验、完整监督测试与 mTLS 试验分别记录，不能把一次 import 或设置 subreaper 标志当作完整证明。

| 冻结候选 | 产品 APK SHA-256 | 测试范围 |
| --- | --- | --- |
| production02 | `74C51AAAB52B9A963608706A967501FA7E8A4FBA403CEEF00F100BB1EFFA8BC0` | 真实 React／SDK／Termux 六场景 |
| production03 | `327D00BE1CE244B79AC1690A47F4DCDC0182EE2BF1A093C1F783D7D753C9E444` | 独立原生控制、SDK conformance 与恢复扩展 |
| production04 | `96BECAA1BE6BF78AF9E4974FEE0CF46385FF735C396FF765840BA99E156D9AE8` | 最终资源预算与同环境完整输出读取候选 |

02 完整矩阵采用只修正测试路径比较的测试 APK `61F13CC8D7E39B760FA49030E9015CC05C253BC3648FEE34F5116918E9734E4F`。03 原测试 APK 为 `650327C86062CF656C8D5442FA0B1B2CAE7E900B126C090C7CFADAE656861B6D`。二者使用的执行端源码为 `42DC6866D388484E9726C42256E822D8D880B8B38F2273B39AE124EB9000AD73`，传输源码为 `C20F4EF5BD53BEA4CAF01BD00C9276790FA2DF1640A2896663EAC662FFD691E8`，完整初始化资产为 `423EFD8F8ED407E843D2AC1A80ADB6409E9A0C7E89FF03A8623F5AA2167564C1`。

04 测试 APK 为 `2480A5D8751EF3ACE65EA2E8BEB7CDE469A568373D4CD390FD7AD86C5BC7938C`，执行端源码为 `71689C55DF8735939A1E7B2BCB98A0746FF8F91A8241B0BF463F4293F8C5A7D4`，初始化资产为 `0A533399F3D1982344DE9E544922EB3B1BB43D6DBD8D778D439C8B4CA5C53327`，传输源码不变。升级前根代理持有写入 gate，确认 29 条公开回执全部终态，以 pidfd 仅停止核验过身份的自身 daemon；停止前后公开快照摘要一致，未清理账本或配对。

## 已实际通过

- **真实初始化与配对：** 在应用点击复制，取得完整 30,529-byte 命令；在官方 Termux 用实际粘贴快捷键和 Enter 运行，校验脚本 manifest；返回应用，实际 Android RUN_COMMAND 授权界面选择 Allow，连接成功。生产 bootstrap 测试 1/1，1.03 秒。没有以 `pm grant` 替代该流程。
- **认证边界：** 实际跨 UID Keystore mTLS 的 Unicode 往返、错误服务端 pin、未配对客户端拒绝通过。非受信 WebView error-document 无法使用特权入口；这是实际 error-document 的验证，不宣称远程页面成功加载。NO_RECEIPT 的原生取消先实际 RED（缺少 receipt），03 修正后 1/1、0.65 秒，持久 tombstone 拒绝迟到的接纳。
- **会话六场景：** production02 完整测试 1/1，40.593 秒。成功命令输出 32 bytes、exit 0；失败命令输出 17 bytes、exit 7；大输出 1,200,000 bytes，74 页，每页最多 16 KiB；原生 UI 取消确认 `stopped/scopeConfirmed`；超时确认 `stopped/cancelReason=timeout`；Activity 重建后同一执行身份完成；完成后新宿主重开不新增模型请求。
- **输出窗口：** 大输出的 SDK 公共历史保留尾部 2,000 行，准确报告丢弃 98,000 行／1,176,000 bytes，并给出同一命名空间完整输出引用。stdout／stderr 和中文字符经实际命令通道、SDK 与历史展示保持正确。
- **Node 忙时控制：** production03 实测 1/1，34.456 秒。Node owner 开始 15 秒忙循环后，196 ms 时查询已返回，519 ms 时取得确认停止回执；两次原生观测的 busy ended 均仍为零。忙循环后另一次真实 SDK 命令确认延迟效果文件不存在。
- **固定 SDK 契约：** `createEnvConformance()` 的四个未修改 shell case 均在四个实际采用的空目录通过，总 45.39 秒：两种命令形式的流来源、missing／empty argv、窗口尾部与丢弃计数、timeout 与 abort 区分。最后通过真实命令移除测试创建的四个空目录。T10 文件契约未被冒称通过。
- **实际 Android 宿主死亡：** production03 的四窗口测试 1/1、38.474 秒，分别在应用意图持久化、执行端接纳、输出 checkpoint 和 SDK 结果提交前强杀真实 `:agent` 进程。每项以新 PID／实例重新打开，在原执行身份上恢复；再用真实 SDK／Termux 命令确认文件恰好一次效果，重复原发送意图新增执行数为零。
- **真实 MiMo：** production03 加测试 APK `2686B543CF29ED20BC5B8A65959DD7BE60145729BB0BE180EC0AD0AD82561F02`，实测 1/1、20.055 秒。真实 UI 输入经两次 HTTP 请求产生一个工具结果、一个完成执行和精确 56-byte 中文 stdout；公开输出页与工具历史共同核验。凭据仅由原生既有加密 capsule 消费，未进入源码或日志。
- **执行端恢复与取消：** GREEN11 完整 21/21、15.447 秒；cwd 固定后的 GREEN12 执行端 19/19、16.146 秒；增强 production wire 1/1、1.045 秒。包括真实进程、文件效果、取消与接纳竞争、guardian SIGKILL 后 unknown／拒绝重放、启动提交前后中断、有界大输出与 raw SHA、配额停止、实际丢弃首次已开始执行的 start 响应后同 ID 只有一次效果、cwd 被置换或原先缺失时拒绝启动。
- **主机真实 SDK：** runtime 全套 157/157、17.744 秒；其中 ManagedExecution 17 项使用实际 SDK、独立原生／SDK SQLite 和外部传输测试接缝，四窗口使用真正 Node 子进程 SIGKILL 与真实文件效果。另有 UI 62 项与完整 TypeScript／Vite／Android 构建通过。主机测试不替代跨 UID 的实际 Termux 证明。
- **最终资源预算：** GREEN13 实际执行端 21/21、18.377 秒；同源传输三项与增强生产 CLI wire 一项共 4/4、3.025 秒。原先只有 raw 字节额度，实际细碎输出与超大继承环境两项先 RED；现在每执行／全局块数与最终参数 JSON 同时有界。真实子进程逐字节输出并等待公开读取后的确认，验证小预算停止、重开后的全局额度、未出现延迟效果；原 1.2 MB 与 16 MiB 配额测试保留。

## 保留的失败与修正

1. 初始 mTLS 失败来自 Android Keystore EC TLS 签名所需 digest 配置；加入 `DIGEST_NONE` 与 SHA-256 后实际认证矩阵通过。
2. Android 不提供 `/proc/<pid>/task/<tid>/children`，早期实现把空枚举错误当作停止证明，真实延迟效果仍发生。修正为同 UID `/proc/stat` 关系、pidfd 与现场重新核验，最终以活着的 subreaper 的 `waitpid ECHILD` 证明范围结束；原文件效果断言未放宽。
3. 持续输出曾令 SQLite 读取／取消写入饥饿：一次数据库锁等待 5 秒，一次取消耗时 3.468 秒，超过原 2 秒阈值。健康查询改用 WAL 读，写者在 SQLite 前排队取得跨进程 flock；保持原断言，连续五次与全套回归通过。
4. 接纳前强杀留下空 raw 文件，阻断同 ID 恢复；改为持久接纳后由 worker 分配。启动前 cwd 路径置换与原缺失目录后来出现也曾错误执行；现固定实际目录身份并使用已核验 fd。
5. 02 首轮会话矩阵失败是测试将 `JSONObject.toString()` 中被转义的斜线与原始输出路径比较。只读公开诊断 1/1、0 新模型请求证明三个已完成场景的内容、回执与路径正确。测试改为比较公开 `entries[].text`，产品代码未为此改变；原失败日志保留。

## 待收尾

04 同一 ExecutionEnv 完整 raw 读取仍等待实际 Android 验证。曾对 03 的旧测试 APK 指定新增 raw selector，返回 `OK (0 tests)`，明确不计通过。完成后还须独立审查与合入最新 integration。

已知平台边界继续有效：Android/OEM 可冻结监督者与命令；墙钟等待结束、回调、连接关闭或 PID 消失都不能单独证明效果已停止。S23 最终 OEM 矩阵、用户锁屏／开机体验以及 pinned x86 Termux 的 16 KiB bootstrap 问题保留给 T17；不能用本轮 4 KiB 开发验证覆盖它们。
