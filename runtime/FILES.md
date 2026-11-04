# 原文件与写入协调（T10）

`ManagedExecution` 为固定核心的 SDK `read`、`write`、`bash` 工具提供同一个已采用位置的 `ExecutionEnv`。`ManagedFiles` 负责 Termux 文件读取，`FileWrites` 保存写入计划及原件证据；`ManagedDocuments` / `DocumentWrites` 通过 Android 的真实文档能力操作 SAF 原件。`WorkspaceCoordinator` 只有持久占用的冲突判断与证据核验，不复制 SDK 任务调度器。

## 原件能力与位置

新安装的默认工具工作区为 Termux 私有目录 `/data/data/com.termux/files/home/.local/share/durableagent-execution/workspace`。所有未关联项目的新会话采用同一默认位置；项目采用 T08 的不可变 binding。既有目录配置不会在连接执行端时被静默重写。文件操作核验原 binding 的实际目录身份，不把它改为当前全局目录。

Termux 路径的解析、打开、读取和写入全部由经过认证的 Termux 执行端完成，Android 不用自身 UID 的本地文件 API 猜测这些路径。显式绝对路径可以访问执行端已获授权的其他位置；工作区不是安全沙箱。SAF 资源保留真实 `content://` URI 与原生 `resourceId`，从不被产品转换成虚构 shell 路径。跨入口测试中独立 Provider 公开的专用原件路径只用于测试验证。

`ManagedFiles` 的二进制 reader 持有实际打开的 FD：路径之后重命名、替换不改变该 reader 的对象。显式关闭后访问是 `invalid`；远端 handle 丢失是 `unknown`，不会重新按同一路径打开。目录 reader 同样保持打开的目录身份。监听采用有界快照轮询；失联或服务 epoch 改变报告 `overflow`，不能声称缺口期间没有变化。

文件 Interface 支持二进制/文本/行读取、元数据与 canonical path、write/append/truncate/flush、普通文件 rename、目录遍历和轮询监听。单次完整读写与截断上限16MiB，传输页32KiB；大型文本输出和 diff 明确报告限制。目录或 symlink rename、独立 mkdir/remove/temp helpers 未提供，返回 `not_supported`。写入不存在的文件时，只由已监督的 helper 在核验的现存祖先下建立所需父目录。硬链接能力取决于设备；目标 Termux 实测拒绝创建硬链接，不宣称完整 POSIX 兼容。

## 持久身份与效果

每个文件写入在 SDK immediate commit 中保存 task/call/ordinal 对应的固定 operationId、binding、实际位置身份、内容摘要与参数。Termux 的文件 operationId 与监督该 helper 的 executionId 分开；两者的关联在排队/派发之前保存。原生 T11 file effect 以独立身份登记和最终核验，不能拿命令停止收据直接宣布文件结果已知。

已完成的同一身份查询和重放只返回原回执，不覆盖之后的用户修改。内容变化前置冲突拒绝写入。命令终态已确认而文件结果丢失时，可以只读核验实际原件；同时拥有匹配内容和已确认执行 scope 才结算该原件效果。若缺少中断前内容，diff 明确不可得。`stopped` 仅在同时具有 `neverStarted=true` 和 `scopeConfirmed=true` 的匹配命令证据时才能确认该文件未写入；普通 stopped 不够。

SAF 原件写入单独保存原生 immutable receipt，prepare、stage、start/query/cancel 都核验固定身份。Provider 调用在原生 I/O worker 中运行。宿主死亡、调用超时或匹配的读回 bytes 都不能证明 Provider 已停止；未知 scope 保持占用，绝不自动重写。原生 `document.verify` 只增加当次读取观察，不改变 primary receipt 的终态或 scope。

## 一个协调域

所有应用受控文件写入使用持久 `device-files` 域。已知 Termux 局部写入按 canonical path、真实对象/祖先身份和新建父目录范围判断冲突；同对象别名和父子范围冲突。普通文件 rename 取得环境级占用。任意 shell 范围未知，取得环境级独占，与所有局部写入及其他环境占用双向冲突。SAF 无法排除与 Termux 指向同一原件，也采用该共同环境占用。

冲突队列按持久顺序授予。已排队的环境写入阻止后到局部写入越过它；没有冲突的局部范围可以并行。确定无副作用的读取、查询和纯聊天不取得写占用。停止尚未授予的工作不会让它随后写入。

占用不会因 SDK idle、断线、lease 时间或进程退出过期。恢复只通过关联的执行/原件证据核验，未知继续阻挡。T08 在配置修改事务中读取 pending binding 与 control-product 证据，拒绝修改仍被任务或未决外部效果使用的位置。其他应用仍可能修改文件；这些应用记录不是跨应用文件锁。

`ExecutionEnv.cleanup()` 关闭本宿主中该 binding 与实际 SDK 会话的所有者，同时核验命令和 SAF 原件操作。关闭后到达的 prepare 回包也不能再 start；取消和查询始终使用原 operationId 与摘要。只有终态且作用域已确认才报告清理完成，已确认未开始的排队原件可释放占用。Provider 仍运行或未知时保留屏障并返回失败；不同 SDK 所有者不受影响。此生命周期关闭不同于 T11 的一次停止/控制代次变化。

## 公开 Interface 与记录

| Interface | 契约 |
| --- | --- |
| SDK `ExecutionEnv` | 原件文件能力与命令共用已采用位置；文件方法返回 SDK `Result` 错误类别 |
| `files.list {id,cursor?}` | 本控制归属的20条 Termux 原件变化及下一游标、最近20条 SAF 变化、最近20条范围未知命令与限制标记 |
| 模型 `document_list` / `document_read` / `document_write` | 发现用户已选原件、读取原件与摘要、基于该摘要的条件写入；模型不获得 URI→path 映射 |
| 原生 `document.select/list/describe` | 真实系统选择器、当前授权和原件位置/能力；不是附件快照 |
| 原生 `document.query/verify` | UI 进程直接查询原操作收据/只读核验，独立于 Node；不提供新写入接口 |

`files.list` 展示原件标记、位置、binding、文件/执行关联和状态。只有有界的真实前后文本产生 diff；二进制、缺少前值、过大文本以及任意 shell 范围都明确不可得。界面不通过缓存成功掩盖原件权限/可用性变化。原生只读核验结果必须匹配 operation/resource/namespace/requestDigest/URI 与单调 sequence。

应用记录都是 v1 session scope：`app.workspace-writes`、`app.managed-file-intent` / `app.managed-file-index`、`app.managed-document-intent` / `app.managed-document-index`，另引用既有受管执行记录。T16 格式目录识别它们；这些效果、占用与证据不进入附件 GC，也不删除用户或 Termux 原文件。未来格式关闭调度并保留数据。旧 diff 只在公开读取时投影到 `available:boolean`，不改历史 scope/sequence/identity。

## 验证边界

主机测试使用真实 SDK/Harness/SQLite，模型 HTTP 和外部执行通道是可控系统边界。它们能证明队列、重放、摘要与错误契约，不能证明设备文件权限。实际原件、跨 UID FD、Provider 故障、Termux helper、依赖构建及真实 MiMo 的独立证据见 [FILE-VALIDATION](../managed-execution/FILE-VALIDATION.md)。原失败记录与后来局部通过分开；未运行的用例不算通过。最终 OEM 覆盖仍是 T17。
