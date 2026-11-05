# Termux 连接与 Console 后续验证

2026-11-06；对应 [#22](https://github.com/mikyan/durableagent/issues/22)、[#24](https://github.com/mikyan/durableagent/issues/24)、[#25](https://github.com/mikyan/durableagent/issues/25)、[#26](https://github.com/mikyan/durableagent/issues/26)。设备、提交和 APK 摘要见 [候选记录](raw/candidate-metadata.json)。各候选的结果分别记录，不拼成一次全量验收。

## S23 上的实际原因与修复边界

用户纠正 Xiaomi 15 使用的是公开 **v0.1.0**。本轮代理只实际连接了 Galaxy S23；不能据其结果推断 Xiaomi 的系统冻结状态已被核验。

S23 上，Termux 在前台时最小通道正常，退到后台后会进入系统 freezer。相同 `:agent` 进程内的只读 ping 随后出现 `CONNECTION_UNCONFIRMED`，与完整 SDK 的原始报错一致。[失败诊断](raw/javet-termux-background08.log)、[冻结观测](raw/s23-freezer-observation16.json)。

最初代码只在监听器不存在时启动 Termux，无法处理仍保留监听器的冻结进程。只修这一点后，最小 ping 能恢复，但仍会在下一条连接的认证阶段，或请求已经发出后的回执读取阶段再次冻结。真实 `file.writeResult` 的诊断明确记录 `operationFrame` 和 `operationWriteAttempted=true`。[原生边界证据](raw/sdk-dispatch-diagnostic15-native.log)。

最终实现保持原配对、执行端 ID、账本和用户操作身份：

- 只读就绪探测可以有界唤醒既有固定服务。
- 仅由原生传输证明业务帧尚未尝试写入的失败，允许重新认证后派发；远端错误码不能充当该证明。
- 业务帧已经开始写入时保留同一 socket、请求和读取位置；等待期间唤醒既有服务，继续接收原回执，不重新发送业务帧。
- 首次就绪唤醒之外，发送前恢复与在途唤醒共用一次额度；原生操作共用 30 秒预算。停止、来源、权限和原配对检查保留，不使用全局 Termux wakelock 或无限保活。

S23 的现有 Termux 未被替换、卸载、清空或升级。本轮初始化使用随 APK 打包的完整脚本，经 Termux 终端执行；脚本曾由 ADB 暂存，不能把这段记录称为完整的复制／粘贴用户流程。

## 已取得的验证

| 范围 | 结果与证据 |
| --- | --- |
| 原报错 | 原完整 SDK 调用稳定失败；[安全错误复现](raw/sdk-safe-failure02.log)保留原失败，不删除或重发原输入。 |
| 冻结后的最小通道 | 首次唤醒修复后通过，4.730 秒；[ping 记录](raw/javet-frozen-green09.log)。单独这一项不代表工具链通过。 |
| S23 实际原文件操作 | `b31642a` 的 `original-roundtrip` 步骤通过：二进制往返、Python 对同一原件修改、追加／截断／flush、重命名后原 reader 继续读取、目录信息、实际 diff、监听及最终 11 字节校验。[原始完整运行](raw/sdk-pending-wake-full17.log)。随后旧依赖产物检查失败，见下文。 |
| S23 SDK 文件契约 | 同一 `b31642a` APK，以 `fileContractsOnly=true` 独立运行，149.956 秒通过。四项分别覆盖范围读取、逐行扫描、重命名后继续读、拒绝缺失路径／非目录；宿主重开新增模型请求为 0。[完整记录](raw/sdk-pending-wake-contracts18.log)。 |
| 真实 MiMo 环境与 bash | `83ff666` 通过 25.756 秒；包含 Provider／UI 的 `f2546a0` 整合包再次通过 35.381 秒。[首次记录](raw/real-mimo-environment13.log)、[整合包记录](raw/final-real-mimo-environment20.log)。 |
| 主机执行核心 | 原生通道、受管执行／文件、继续资格及写入协调的定点回归 66/66。[记录](raw/core-runtime-tests12.log)。 |
| JVM 来源与恢复策略 | 来源 8 项、操作预算 8 项、在途唤醒生命周期 6 项，共 22/22。[结果](raw/core-jvm-tests17.json)。这些策略测试不替代 OEM 实测。 |
| 构建 | `f2546a0` 与最终 `0a820a5` 的 Runtime／UI 构建、Debug APK／测试 APK、`lintDebug` 通过。后者仅修改 Bedrock 预算校验投影，未再次运行不受影响的 MiMo 用例。Provider 未逐项登录或联网调用。 |

真实 MiMo 验证发送两个实际模型请求，明确要求调用一次 bash。测试核对首次实际模型请求中已有 Android／Termux／采用路径信息、模型原样生成的命令且没有覆盖 cwd、唯一完成执行及原始 stdout。返回值包括 Linux、Android API 36、ARM64、Termux 独立 UID 和实际工作区；模型最终 JSON 与这些真实结果一致。应用全程在前台，未手工打开 Termux。此用例使用验证模式强制首轮 bash 选择，不能称为未约束的自主工具选择测试。

文件契约用例采用受控模型选择器，实际 SDK、原生通道和 Termux 效果均真实；它们不是 MiMo 请求。真实 LLM 的证据只来自上一项。

## 其他官方 Termux 版本

独立、无用户数据的 Android 16／x86_64／4 KB 模拟器安装官方 `0.119.0-beta.3`。旧版本白名单会拒绝该安装。新来源核验首次因 HTTPS 的每段 3 秒上限超时；改用剩余总预算后，实际在线摘要核验及仅复用同一安装物的离线证明通过。[修复前](raw/beta-source-diagnostic01.log)、[修复后](raw/beta-source-diagnostic02.log)。

该空白 Termux 的旧基础包无法直接满足当前 Python 依赖，初始化脚本按契约拒绝隐式升级 `ncurses` 并保留环境。仅在这个隔离测试环境中另行执行包升级后，再运行同一随包初始化脚本成功；未对 S23 做同样升级。这证明已有满足依赖的环境可初始化，不证明任意旧基础包都能无升级安装。

实际生产 bootstrap、持久配对及只读命令执行 2/2 通过；同一 Termux 中的真实 Python／SQLite／进程／OpenSSL 能力检查及拒绝、超时清理测试 9/9 通过。[真实工具](raw/beta-actual-tool03.log)、[POSIX 能力](raw/beta-capability-tests04.log)。

## 范围与保留事项

- `sdk-pending-wake-full17.log` 的 **整个 JUnit 结果是失败**：原件往返步骤成功后，`FILE_DEPENDENCY` 读取只存在于旧模拟器的固定 uthash 编译产物，S23 返回 `not_found`。未伪造或复制其他 ABI 的编译产物使其变绿；这项历史依赖检查在 S23 未通过。四项文件契约由既有 `fileContractsOnly=true` 开关单独验证。
- Provider 入口来自固定 SDK 的 42 个 Provider，使用其真实协议与认证实现；类型检查、静态审查和构建不等于 42 个账号／网络协议逐项实测。按用户要求未增加 Provider 联网测试。
- 新消息状态、页面层级与动画仅做类型检查、构建及伴随核心流程的界面操作，不冒称完成新的 UI 测试矩阵。
- Xiaomi 15、ARM64 16 KB、物理平板、长时间后台／所有 OEM 恢复及历史 MiMo01 问题，未在本记录取得的新证据中被一并验收。
- 真实凭据审计仅扫描所列范围内的应用存储归档与应用 UID 日志，以实际凭据 UTF-8／UTF-16 字节及正对照检查，未发现原文；不推断堆内存或闪存已被擦除。[首次审计范围](raw/mimo-environment13-secret-audit.json)、[整合包测试后审计](raw/final-mimo20-secret-audit.json)。公开文件在提交前另做实际凭据和设备序列号字节扫描。

## 静态审查

固定 `0d02a06...f2546a0` 的两轴审查：Standards 无发现；Spec 发现 1 项 Bedrock 图片字节预算误算。`0a820a5` 已修复，按 blob 的 base64 长度创建预算校验投影，保留 SDK 原 payload、深度／循环／应用及模型总额限制。原 Spec 审查者复核修复后确认该项闭合；审查未进行 Provider 调用。
