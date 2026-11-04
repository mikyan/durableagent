# 本地执行端（T09）

本目录是 Termux 内的命令执行端。会话、模型与工具调度仍由应用内的 SDK 管理。T09 尚在实现与设备验证中；这里的测试结果不能代替整票验收。

## 初始化

1. 使用 T03 已验证的官方 Termux 0.118.3，完成首次打开。
2. 应用首页或会话页的“本地执行”区域点击“复制初始化命令”，到 Termux 粘贴运行。
3. 返回应用点击“连接执行环境”，按 Android 系统界面授予 RUN_COMMAND 权限。

APK 中的 `execution-setup.txt` 由 `tools/build_execution_setup.py` 在 Gradle preBuild 时生成。它包含完整的两个生产 Python 脚本、压缩载荷 SHA-256 与安装器，不下载未固定的脚本。初始化只安装缺失的 `python=3.14.8`、`openssl-tool=1:3.6.5`；若已有不同版本，保留并停止，不降级。依赖安装使用原有包源、禁止移除包、保留已有配置。

脚本固定安装在 `$HOME/.local/share/durableagent-execution`。安装器保留账本、密钥、工作区和其他文件，只更新自身 manifest 记录且内容仍匹配的脚本。运行中的服务或 guardian 持有锁时拒绝更新；符号链接、无归属脚本和用户修改均拒绝覆盖。中断安装只允许恢复同一已记录载荷。Termux 属性文件原内容会备份保留，末尾追加有效的 `allow-external-apps=true`。

配对使用 Android Keystore 中不可导出的客户端密钥，以及仅在 Termux 生成并保存的服务端密钥。RUN_COMMAND 只携带公钥证书、一次性挑战与固定 bootstrap/serve 启动器。既有配对不可自动重置或覆盖。

## 执行与恢复

`durable_executor.py` 保存稳定执行身份、固定请求与最终参数摘要、接纳／启动／退出收据和有界输出。`execution_transport.py` 提供仅监听 `127.0.0.1:47193` 的双向 TLS、固定协议版本、实例身份及每连接挑战。占用端口明确失败，不扫描其他端口。

重复 start 仅核验同一个执行；服务重启不会自动运行待接纳命令。query/cancel 有独立的有界控制容量。取消未知但未接纳的执行会保存 tombstone，拒绝同身份随后到达的 prepare；已接纳后失去监督的执行继续保持 unknown，不能据此重放。

UI 只提供初始化、连接、核验及取消已登记执行；不接受任意命令或路径。`stop_requested` 表示请求已发送，`unknown` 表示停止或结果仍未确认。应用本地的 `CLIENT_CONFIRMATION_LOST` 也不等同于执行端确认未启动。取消成功后，UI 独立刷新 SDK 的收据索引；Node 宿主阻塞时，已收到的原生回执仍立即显示。

Android／OEM 可以同时冻结执行进程与监督者。超时和断线只产生可观察证据；不能把墙钟等待结束、回调收到、PID 消失或连接关闭当成所有副作用已停止的证明。T11 的会话停止 fence、T10 的工作区互斥另行实现。

## 资源预算

默认每次执行最多保留 16 MiB 原始输出与 4096 个输出块；整个执行端最多保留 128 MiB 原始输出与 32768 个输出块。块计数来自持久 `outputCursor`，在同一个写事务内与字节预算一起检查。达到任一预算后标记 `captureIncomplete`、请求 `output_limit` 取消，并等待受管范围停止的证据；不会把丢失的输出宣称为完整输出。全局预算用满后拒绝新的接纳，既有记录保留。

128 MiB 是原始输出的预算，不是整个目录的磁盘上限。原始文件和 SQLite 输出块各保留一份数据，另外还有索引、WAL、收据和请求元数据；独立的块数量上限防止大量单字节输出把元数据开销放大到远超原始字节预算。执行记录与接纳前取消 tombstone 各最多 4096 条；请求最多 32 KiB，包含继承环境的最终参数 JSON 最多 64 KiB。预算不足明确拒绝，不清理或覆盖未知执行来腾出空间。

本地 `Executor(..., limits=...)` 构造允许测试或部署收紧块数量／最终参数上限，并将同一组限制传给固定 worker；它不能提高编译上限，也不通过 bootstrap、serve 或网络协议开放配置入口。设备测试用 4／6 个块的小预算，真实子进程每写一个字节都等待测试端从公开输出入口观察后给出确认，验证单执行上限、重开后的全局上限与副作用未发生。正常大输出与原字节配额测试保持原断言。

## 验证入口

- Termux 临时目录：`python -m unittest test_executor test_transport test_production_wire -v`，含真实 SQLite、mTLS、子进程、文件效果和 SIGKILL 窗口。wire 测试需端口 47193 空闲。
- 安装器临时目录：将 `tools/execution_setup_installer.py` 与 `tools/test_execution_setup.py` 放入同一 Termux 测试目录，运行 `python -m unittest test_execution_setup -v`。只操作测试创建的临时目录，不执行生产安装入口。
- 主机：`python -m unittest discover -s tools -p test_execution_asset.py -v`，以及 `ui/` 的 Vitest、typecheck 和 build。
- Android：`ExecutionUiTest.setupButtonCopiesTheCompletePackagedCommandWithoutNode` 核验实际按钮复制的剪贴板与 APK 资产逐字相同；`ExecutionTransportTest` 验证原生存储、身份、回调与 TLS 边界。生产 bootstrap 测试要求已经完成真实初始化与权限流程。

精确冻结产物与实际运行范围见 [T09 验证记录](VALIDATION.md)，应用内身份／恢复接线见 [ManagedExecution](../runtime/MANAGED_EXECUTION.md)。通用 CPython 文档不构成 Termux 设备能力证明。
