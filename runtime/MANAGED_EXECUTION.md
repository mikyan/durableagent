# 受管执行（T09）

`ManagedExecution` 是固定核心的工具环境与执行收据协调器。SDK 仍拥有任务调度、工具调用、结果与重放；Termux 执行端拥有命令接纳、启动、输出、退出与停止证据。UI 只接收数据，不获得任意命令、目录或进程控制入口。

## 接线与身份

`ApplicationOptions.execution` 安装固定 Bash 包装、惰性的 `LocationAdapter` 与 `EffectAuthority`。启动先打开原生输入权威和 SDK 存储，核验所有未决执行，再发布 ready、恢复发送和 SDK 进展。没有完成 Termux 初始化时，文字会话和纯应用工具仍可使用；真正的执行在能力核验处拒绝。

`wrapTool()` 只供固定核心中所有效果均经过此环境的工具使用，不提供给扩展。它为一次 SDK 工具调用创建环境；其中每次 `exec()` 依次采用稳定 ordinal。持久关联键是 SDK task、call 和 ordinal，执行身份另用随机 UUID。包装体必须在重放中保持调用次序和最终参数；不一致明确失败。相同命令文本的新显式操作产生新身份。

首次下发前通过 SDK immediate commit 保存应用执行意图，包括固定命令形式、cwd、环境继承、超时、产品控制归属、真实 SDK 会话／任务／调用、不可变位置 binding、位置版本及当前原生控制代次。首次可访问时核验并固定实际工作区身份。控制归属取 `controlProductId`，不能从 fork 的位置来源 `sourceProductId` 推断；控制代次不能永久写入位置 binding。

请求由执行端再次固定最终参数与摘要。`prepare` 接纳；`start` 只接受该身份和最终摘要。开始前再次检查原生控制、SDK 任务和实际位置。相对 cwd 相对于采用的环境目录解析。Termux 还将 cwd 的 realpath/dev/ino 固定进最终摘要，启动时打开并核验目录 fd，避免路径置换将命令重定向。

应用记录位于 session 范围的 `app.managed-execution-intent` 与 `app.managed-execution-index`，不依赖终态 task memo 的保留时间。`attach()` 绑定实际 Harness，使任务退休后的取消／查询事实仍能提交。这里不另外实现任务调度器。

## 恢复与占用

`query` 的 `NO_RECEIPT` 不等于确认未启动：此前的接纳可能仍在途中。同一尚未结算的 SDK 调用可以用原身份再次接纳；不同身份不能绕过已有 unknown。显式按原身份取消可先持久化 tombstone，令迟到的 prepare 被拒绝；已接纳且监督丢失的执行不能被转换为确认未启动。

传输错误只把应用事实标为 `CLIENT_CONFIRMATION_LOST`，不猜测远端是否停止。`execution.list` 在同一存活宿主内重新查询未决执行并持久保存最新事实。UI 的原生查询／取消先展示自己的回执，再独立触发这个核心核验；Node 忙时不等待它才显示原生结果。

终态收据只证明外部效果事实，不代表输出已读取。结果确认失败会另存 `confirmationPending`，保留原 completed／scopeConfirmed 收据；后续重入及宿主重开先以原 executionId 取得耐久恢复预算并重新核验，再读取原结果。完整结果成功返回前不清除此标记；额度耗尽保持可见等待，不把读取失败返回给模型诱发替代命令。模型继续入口也尊重该标记。已经被原生停止 fence 覆盖、且终态作用域已确认的旧代次不会阻挡用户明确的新代次；未知外部效果仍按原规则阻挡，不因停止代次变化被视为已完成。

`EffectAuthority.withSnapshot()` 在同一个核心串行范围内核验收据，并把真实未决 `pendingBindingIds` 与 `pendingControlProductIds` 交给位置修改事务。unknown 保持 `known=false`。断线、SDK 工具结束或当前位置指针释放，都不自动释放未决外部效果。

`ExecutionEnv.cleanup()` 的范围是该 binding 与实际 SDK 会话的所有者；它阻止本宿主继续为该所有者接纳新命令及 SAF 原件写入，并按各自持久身份查询和请求取消。清理会分别尝试命令及原件记录；任一作用域未确认都保留占用并失败。只有终态且 `scopeConfirmed` 才确认完成清理；不以 Provider 字节匹配替代作用域证据，也不影响共享 binding 的另一 SDK 所有者。普通取消只针对一次执行。T11 负责完整会话停止 fence，T10 负责工作区互斥。

## 输出与公开 Interface

每页保留执行身份、命名空间、连续 sequence、stdout/stderr 来源和原始 bytes。两个增量 UTF-8 decoder 各自保留跨片段字符。SDK 自己维护有界工具输出窗口、精确丢弃计数及最终历史；当前适配器不主动省略片段，因此 skipped 为零。输出持续由有界页拉取，不积存在一次最终回调中。

在同一次读取中按游标续取并拒绝身份不符、重复或缺口。SDK 任务重放有一个新的输出 buffer，因此先从同一执行的持久 spool 重新填充该 buffer，再继续读取；这不重新启动命令。原始 spool 每执行有上限。完整输出引用只能通过同一 `ExecutionEnv` 的 `readBinaryFile`／`readTextFile` 读取：必须命中当前应用登记的执行，命名空间一致、输出完整且终态，逐页读取后校验长度和 SHA-256。T10 的实际原文件能力和与命令共用的写占用见 [FILES.md](FILES.md)。

| Interface | 输入与结果 |
| --- | --- |
| `execution.list` | `{id,cursor?}`；核验后返回最多 20 条 `{executions,nextCursor}` |
| `execution.readOutput` | `{id,executionId,cursor}`；只能读取本控制归属已登记执行，每页最多 16 KiB 原始 bytes |
| 原生 `execution.connect` | `{}`；真实 Android 权限与固定 bootstrap，确认配对实例 |
| 原生 `execution.copySetup` | `{}`；复制 APK 内带哈希的完整初始化命令 |
| 原生 `execution.query` / `execution.cancel` | `{executionId}`；固定认证查询／取消，独立于 Node owner 线程 |

原生 Javet 边界与 WebView 边界分离；只有受信任 bundle 可以触达 UI 方法，WebView 没有 prepare/start 接口。命令通道是本机 mTLS，核验协议、配对实例、账本 epoch、进程／连接挑战和每条请求身份；客户端超时不会自动重发 mutation。

## 验证边界

`test/managed-execution.test.mjs` 使用真实 SDK 与两个实际 SQLite 权威，在外部传输边界控制执行端响应；四个恢复窗口使用真正独立的 Node 子进程 SIGKILL 与文件效果。它不能代替 Termux 设备验证。

`test/recovery-output.test.mjs` 通过公开 Application／SDK 和实际 SQLite 输入、执行账本及恢复预算验证完成后的输出失败：跨宿主重开维持同一总预算、耗尽可见等待、原停止与明确新发送，以及输出恢复后只返回原结果。执行端和模型传输仍是受控边界，不是新增 Android／真实模型实测。

Android 的 `ExecutionApplicationTest` 通过真实 React、原生发送意图、SDK 与 Termux 演示六个基本场景，另有 Node 忙时原生取消与四个未修改的 SDK shell conformance cases。`ExecutionRecoveryTest` 检验实际 `:agent` 死亡、原执行恢复及完整 raw 输出同环境读取。`ExecutionRealProviderTest` 需要根代理安全提供既有加密测试凭据，实际调用 MiMo；凭据不进入测试源码或工具输出。精确实测范围以 T09 验证记录为准，不把尚未运行的测试当成通过。
