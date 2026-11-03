# 完整 Termux 集成：开源实现先例

研究日期：2026-11-03。状态：研究，不是选型或生产实现。

## 1. 答案先行

**必须先决定：是否接受独立的官方 Termux APK，以及一次明确的初始化和授权。** 这项决定先于传输协议、应用 JS 运行时和最终 `targetSdk`。

源码支持 3 条不同路线。它们的成本不能互相隐去：

| 部署路线 | 实际先例与证据 | 必须明确的成本 |
|---|---|---|
| 独立 Agent APK + 官方 Termux | 官方 `RUN_COMMAND` 提供受控启动。AcodeX 提供外部终端桥的真实实现 | 2 个 UID；首次配置；执行桥维护；文件访问；双方升级与恢复。AcodeX 本身没有证明外部服务全自动启动 |
| 保留 `com.termux` 的融合 APK | Termux:Monet 保留身份、前缀和官方 bootstrap | 不能作为另一应用与现有 Termux 并存。签名、现有数据、附加 APK 和升级归属必须先解决 |
| 自有应用 ID + 内嵌完整环境 | VHEditor 使用 `vn.vhn.vsc`。它重建 bootstrap，并运行自己的 APT 仓库 | 必须维护包构建、依赖闭包、仓库签名、更新和回归测试。不是改一个 `$PREFIX` |

**最重要的新证据是 VHEditor。** 它不是仅预置几个命令的演示。源码和在线索引显示真实的自有前缀包生态。但是，它不是直接复用全部官方二进制包的证据。[V1][V2][V3][V4]

**Acode 的“内置终端”也不是完整 Termux。** 它运行 PRoot + Alpine，并使用 `apk`。它不是有限模拟指令集，但不能据此满足已经确定的 Termux 要求。[A1][A2]

本文不改变固定约束。`pi-durable`、`pi-ai` 和主会话恢复仍属于本应用的独立运行宿主。Termux 只执行命令和工具。WebView、Kotlin、TypeScript、React、Vite 保持不变。

## 2. 取证范围、版本和维护状态

已先读需求、技术设计，以及现有的打包、受管启动、`termux-exec` 研究。本文补充实际集成先例，不重复完整机制说明。

只通过命令行 HTTPS 读取源码、仓库元数据和文本包索引。没有安装软件，没有下载 APK、bootstrap 或 `.deb`。没有执行上游代码，没有连接设备，没有使用凭据。

下表日期来自固定提交的 GitHub 提交页。版本字符串来自源码，不代表本轮测试过发行包。所有 SHA 链接固定本轮取证对象。

| 项目 | 检查版本 / 固定提交 | 提交日期与维护信号 | 许可事实 |
|---|---|---|---|
| 官方 `termux-app` | [`8629e632fcb95da272221be327db653fb24befe9`](https://github.com/termux/termux-app/commit/8629e632fcb95da272221be327db653fb24befe9)；Gradle 默认 `0.118.0` | 2026-09-26；未归档。默认版本号不是最新发布状态证明 | `GPLv3 only`；部分终端代码有 `Apache-2.0` 例外。[T4] |
| 官方 `termux-packages` | [`3ac3b7bb73a18513eaef5d6ea8ee6ec7d95a96e1`](https://github.com/termux/termux-packages/tree/3ac3b7bb73a18513eaef5d6ea8ee6ec7d95a96e1) | 本轮固定包构建源码；未据此验证仓库全部包 | 构建基础设施为 `Apache-2.0`。包脚本和补丁随对应包的许可。[T5] |
| Acode | [`6962af1e805b8996e743df97cad4df3ecef687e5`](https://github.com/Acode-Foundation/Acode/commit/6962af1e805b8996e743df97cad4df3ecef687e5)；`1.13.5` | 2026-10-29；未归档 | 根许可为 MIT。SFTP 子目录另列许可，不能把全部依赖算作 MIT。[L1][L2] |
| AcodeX 插件 | [`faa9153e9a3cc8494ab7c560a2c6b02dae1306cc`](https://github.com/bajrangCoder/acode-plugin-acodex/commit/faa9153e9a3cc8494ab7c560a2c6b02dae1306cc)；提交标记 `v3.4.0` | 2026-08-30；未归档 | MIT。[L3] |
| Rust `acodex_server` | [`ee2cbfe9bf988d2052ef1363c8815276cc84469d`](https://github.com/bajrangCoder/acodex_server/commit/ee2cbfe9bf988d2052ef1363c8815276cc84469d)；`axs 0.2.17` | 2026-10-18；未归档。该次提交增加许可证 | MIT。[L4] |
| VHEditor | [`5ea1a25fdc37a5ebbb208dd77b015276d4a00d04`](https://github.com/vhqtvn/VHEditor-Android/commit/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04) | 2026-06-25，仓库显示时区 `+07:00`；未归档 | GPLv3；许可文件另说明包含 MIT 的 `code-server` 二进制。[L5] |
| VHEditor 包分支 | [`f920b020fce83e2b02c23a41226f8e75c71eb422`](https://github.com/vhqtvn/termux-packages/commit/f920b020fce83e2b02c23a41226f8e75c71eb422) | 2026-11-03；未归档；在线仓库也有当日索引 | 必须逐包处理许可，不能由 APK 根许可代替 |
| Termux:Monet | [`8f19256797216b4b2f73803c268b5e115711a6b7`](https://github.com/Termux-Monet/termux-monet/commit/8f19256797216b4b2f73803c268b5e115711a6b7)；`0.119.0-b1+monet36` | 2024-09-14；**已归档**。只能作为身份和集成先例 | 仓库提供 GPLv3 文本。[L6] |

维护活动只证明有人更新对应仓库。它不证明 Android 兼容性、更新安全性或长期支持。

## 3. 外部环境：AcodeX 实际证明了什么

### 3.1 安装与启动不是一回事

**源码事实：** 插件的 `installServer.sh` 转到 Rust `acodex_server/install.sh`。后者从 `releases/latest` 下载对应架构的 `axs`，写入 `$PREFIX/bin/axs`，再建立兼容命令链接。脚本明确要求随后运行 `axs`。[X1]

这不是 bootstrap 安装器。它依赖已经存在的 Termux 和 `$PREFIX`。它也不负责官方命令包升级。

**源码事实：** 当前插件同时区分 `external axs` 和 `builtin` 后端。`AcodeX.js` 对内置后端调用 `isInstalled()`、`isAxsRunning()`、`startAxs()`，并等待就绪。外部后端使用配置的主机和端口。本次查看的接入路径未提供 `RUN_COMMAND` 启动外部 Termux 的闭环。[X2]

**结论：** AcodeX 是外部执行桥的先例，不是“外部 Termux 无需重复手工启动”的成品证明。内置后端的自动启动属于 Alpine 路线，不能移算到外部 Termux。

### 3.2 流、停止和恢复边界

**源码事实：** `src/terminal/mod.rs` 注册以下入口：[X3]

- `POST /terminals` 创建 PTY。
- `GET /terminals/{pid}` 建立 WebSocket。
- `POST /terminals/{pid}/resize` 改变终端尺寸。
- `POST /terminals/{pid}/terminate` 停止终端。
- `POST /execute-command` 执行命令。
- `GET /status` 返回就绪响应。

`handlers.rs` 用 PTY 读取线程产生输出。它维护 scrollback，并在连接时重放尾部。停止入口从会话表移除记录，再调用 `child_killer.kill()`。[X4]

**限制：** PTY 输出不是可靠分离的 `stdout` 和 `stderr`。`Sessions` 使用内存中的 `DashMap`。磁盘 scrollback 不等于持久执行状态。PID 也不是跨重启的稳定执行 ID。上述代码不能证明进程树取消、结果核验或不重复执行。[X3][X4]

**安全与更新：** 默认绑定 `127.0.0.1`，允许选择其他地址。路由设置 CORS，但已查看路由没有应用身份认证。CORS 和 loopback 都不能代替认证。安装脚本追随 `latest`，未见固定摘要校验。服务启动还会后台检查更新。这些行为需要重新设计，尤其必须纳入省流策略。[X1][X3][X5]

### 3.3 官方启动入口可补足哪一段

官方固定提交的 `RunCommandService` 确实接受第三方命令。`EXTRA_BACKGROUND` 可以选择 `APP_SHELL`。服务检查 `allow-external-apps`，再启动 `TermuxService`。[T1]

官方 bootstrap 安装仍在 `TermuxInstaller.setupBootstrapIfNeeded(Activity, ...)` 中完成。该实现加载 APK 携带的 ZIP，建立符号链接，再把 staging 目录改名。[T2]

**推论：** 首次初始化和授权之后，官方入口提供启动执行桥或 `sshd` 的候选路径。是否能满足正常使用不必每次打开终端，仍需验证。后续[Moose 冷启动核查](pi-android-reference-projects.md)记录了一次重启后的启动拒绝，不能把该缺口归为已解决的首次设置问题。必须实现就绪检查、版本检查、重连、退出检测和受控重启；AcodeX 没有替我们完成这些工作。

首次安装、bootstrap、`com.termux.permission.RUN_COMMAND` 和 `allow-external-apps=true` 仍是显式前置条件。系统禁止后台启动、权限撤销和强行停止仍可能阻塞。细节沿用[受管启动研究](termux-managed-startup.md)，不承诺无条件自动恢复。

## 4. 单 APK、自有 ID：VHEditor 是更强的先例

### 4.1 可以追到完整的前缀与包源链

1. **应用身份：** `app/build.gradle` 设置 `applicationId "vn.vhn.vsc"`。普通构建使用 target 28；另有 `GPLAY_BUILD` target 30 分支。这些是历史代码分支，不是本项目选型或当前 Play 合规证明。[V1]
2. **原生路径：** `TermuxService.java` 设置 `/data/data/vn.vhn.vsc/files`，并派生 `usr` 和 `home`。[V2]
3. **bootstrap：** Gradle 固定 `bootstrap-2025.12.11-r1+apt-android-7`，从作者的 `termux-packages` 发布页获取文件，并核对 SHA-256。安装器从 `libtermux-bootstrap` 读取 ZIP，设置权限、建立链接，再改名 staging。[V1][V2]
4. **重建：** 包仓库的 `patch-repo.sh` 把 `com.termux` 替换为 `vn.vhn.vsc`，配置作者的仓库。bootstrap 工作流先运行补丁，再调用 `vh-generate-bootstraps.sh`。后者拉取 `apt`、`termux-exec`、`termux-tools` 等包和依赖。[V3]
5. **实际 APT 配置：** `setupCodeServer.kt` 把随包提供的 `vhnvn.gpg` 放入 `trusted.gpg.d`，并重写 `sources.list` 为 `https://vsc.vhn.vn/termux-packages-24/ stable main`。[V4]

最后一步很重要。只看包仓库未经补丁的 `packages/apt/build.sh`，会误以为应用仍使用官方源。实际应用初始化覆盖了这个配置。

### 4.2 它不是受限工具箱，但也不是官方仓库直用

**在线元数据事实：** 本轮读取该仓库的 `Release` 和 `binary-aarch64/Packages.gz`。[V5]

- `Release` 日期为 `2026-11-03 07:55:32 +0000`。
- 架构列表为 `arm aarch64 x86_64 i686 all`。
- 本轮 aarch64 索引有 4,147 个条目，4,112 个不同包名。
- 样本包含 `apt 2.8.1-2`、`bash 5.3.9`、`git 2.56.0`、`python 3.14.8`。
- 另有 `nodejs 26.13.0`、`nodejs-lts 24.22.2`、`clang 20.1.8-3`、`openssh 10.6p1-3`。
- `Packages.gz` 的本轮 SHA-256 为 `4d3e3bb40889c45b26a08f84756dcd2469a00fe8c82780fc3a9e99b85a869fd3`。

这些数量只描述一次索引。它们不是已安装、完整依赖闭包或官方覆盖率的证明。没有下载或运行这些包。

`InRelease` 返回 404，但 `Release.gpg` 的 HEAD 返回 200。因此，不能把缺少 `InRelease` 写成“没有仓库签名”。本轮未做 GPG 验证，也未验证发布包与源码构建的对应关系。

**结论：** 自有 ID + 广泛包安装是实际存在的工程路线。它的代价是运行一个持续更新的 Termux 衍生发行环境，不是免费取得官方包源兼容性。

### 4.3 生命周期和可借鉴范围

`CodeServerService` 管理会话。`SessionsHost.kt` 调用 `TermuxSession`，接入终端客户端，并提供按 command ID 停止的方法。它也有服务退出时清理会话的路径。[V6]

这证明应用可以管理本 UID 下的终端环境。它没有证明任意子进程树都能终止。`boot.sh` 中甚至把 `SIGKILL` 列入 shell trap；不可捕获的信号不能靠这段 trap 完成清理。[V7]

VHEditor 的整体产品运行 `code-server`。本项目不能因此迁移为完整桌面后端。可以借鉴 bootstrap、前缀、APT 和生命周期代码，不照搬它的主运行架构。

## 5. 保留 `com.termux`：Termux:Monet 的意义与风险

**源码事实：** Monet 的 Gradle 保留 `com.termux` namespace 和组件占位值。Manifest 保留对应 `sharedUserId`。其安装器直接读取官方 `termux-packages/releases/latest/download/bootstrap-<arch>.zip`，再执行 bootstrap 安装和第二阶段。[M1][M2]

这是一种保留官方身份和路径的 UI 分支。它不是自有 ID 下重定位官方包的先例。它也没有提供本项目要求的 Agent 宿主。

**负面证据：** 检查的安装器使用可变 `latest`。已查看下载路径未见固定摘要验证。仓库已经归档。不能把这份旧实现直接当作推荐基础。[M2]

**签名事实：** Monet 的 release 配置使用 `testkey_untrusted.jks`。官方说明 GitHub Termux 使用公开测试签名，而 F-Droid 使用另一签名。我们没有读取密钥文件，也没有检查 APK 证书。因此，不能仅由 Gradle 文件断言任意现有 APK 可以覆盖升级。[M1][T3]

**部署规则：** 同一 `com.termux` 不是 2 个可并存的独立应用。相容签名仍需满足安装更新条件。不相容签名不能普通覆盖。官方共享 UID 附加 APK 还需要匹配签名。[T3]

必须先征得用户对替换、备份、数据迁移和附加 APK 迁移的同意。不能默认卸载现有 Termux。也不能为方便覆盖安装而把公开测试密钥作为本产品可信身份。

## 6. Acode 内置环境：可借鉴，但不是 Termux 等价物

**源码事实：** `ProcessManager.createProcessBuilder()` 启动 `init-sandbox.sh`。后者运行 PRoot，以 `$PREFIX/alpine` 为根目录。`init-alpine.sh` 使用 `apk update`、`apk upgrade`、`apk add`，并启动 `axs`。[A1][A2]

`$PREFIX` 来自 Acode 的 `getFilesDir()`。PRoot 和 `axs` 可由 APK 的 native library 目录提供。脚本把 `/sdcard`、`/storage` 和应用自己的 public 目录绑定到环境中。[A1][A2]

**分类：** 这是可安装 Alpine 软件包的 Linux 用户态环境。它既不是几个模拟命令，也不是完整官方 Termux 包生态。源码没有证明它可以原样安装官方 Termux `.deb`。

`Executor` 使用 Android Service 和 `Messenger` 管理执行。`ProcessUtils.killProcessTree()` 尝试对负 PID 发 `kill -9`，再调用 `destroy()`。该代码依赖进程组与 PID 获取正确，不能单靠函数名称证明进程树取消。[A3]

可以借鉴应用管理的启动、流式终端和错误反馈。不能据此把已经确定的 Termux 环境替换为 Alpine。

## 7. SSH/SFTP 与专用执行桥：只比较已有证据

| 能力 | 标准 SSH/SFTP 的实际先例 | 专用执行桥的实际先例 |
|---|---|---|
| 认证 | Acode `Sftp.java` 核验主机密钥，并保存信任状态 | `axs` 已查看路由只有 CORS，没有应用身份认证 |
| 执行与流 | Acode 打开 SSH session channel，申请 PTY，订阅 data / extended data / close 事件 | `axs` 用 HTTP 创建 PTY，再经 WebSocket 传输 |
| 退出状态 | Acode 读取 channel exit code；未收到时返回空值 | `axs` 的交互会话保存退出成功布尔值；不能视为完整命令结果契约 |
| 停止 | Acode `closeShell()` 关闭 channel 和 client | `axs` 按 PID 调用 `child_killer.kill()` |
| 文件 | Acode 使用 SFTP 输入流、`put`、目录和属性 API | 已查看的 `axs` terminal 路由不是通用文件 API |
| Android 启动 | SSH 协议不初始化 Termux，也不启动 Android Service | 执行桥协议同样不能代替 Android 启动入口 |
| 持久恢复 | 普通 SSH channel 不能证明断线后继续跟踪同一次执行 | `axs` 的内存会话和 scrollback 也不能证明这一点 |

以上 SSH/SFTP 结论来自 Acode 的 `Sftp.java`，不是协议宣传。[S1] Termux 官方包构建实际提供 OpenSSH 和 `openssh-sftp-server`。安装脚本生成 host key，并安装默认带 `down` 文件的 `sshd` 服务目录。**安装包不等于守护进程已经启动。**[S2]

**推论：** 两条路线都可以研究。SSH/SFTP 可复用认证、文件操作和成熟库。专用桥可以表达执行 ID、取消确认、日志游标和结果核验。但是，这些专用语义必须由我们实现。

关闭连接不是可靠的进程树取消契约。两条路线都需要明确停止确认、孤儿检测和结果不明状态。本文不选择传输协议，也不要求采用本地 HTTP。

## 8. 文件角色必须分开

这里区分 3 种存储角色，不增加产品实体：

1. **SDK 状态：** 会话与恢复状态由本应用运行宿主管理。外部 Termux 不直接打开同一个 SDK 数据库。
2. **工具使用的工作区：** 构建和依赖安装可能需要可执行文件、符号链接和 POSIX 文件语义。外部部署时，Termux 私有目录可以提供这类能力，但另一 UID 不能直接把它当成本地目录。
3. **已授权的原始用户文件：** 工具必须实际读取、修改这些文件，或通过明确的原文件访问适配完成操作。只编辑导入副本不满足要求。

**共享 `/sdcard` 不是跨 UID 文件访问的完整解法。** 官方文档说明共享模拟存储使用 `noexec`，且不支持通常的符号链接等 POSIX 文件语义。`~/storage` 链接不会改变目标文件系统。Acode 的 PRoot 绑定也不会自动授予 Android 权限或消除这些限制。[F1][A2]

SFTP 可以操作 Termux 身份能访问的文件。它不会自动取得本应用的 SAF 授权。Acode 的 SFTP 下载代码把远端输入流写入 `ContentResolver` 输出流，这只是明确的数据传输路径。它不是把任意文档 URI 变成通用 shell 路径。[S1]

VHEditor 安装器创建共享目录链接，也不能证明任意原始文件均可访问。[V2] 原文件访问和存储布局仍由专项研究决定。

## 9. 阻塞项、负面发现与下一轮问题

### 必须先问用户

1. 是否接受独立官方 Termux APK，以及一次初始化和授权？这不是接受重复手工启动。
2. 如果必须单 APK，是否明确接受占用 `com.termux`、替换现有安装，以及数据和附加 APK 迁移？
3. 如果必须单 APK 且不能占用 `com.termux`，是否接受自有前缀仓库的持续维护成本？VHEditor 说明这个成本真实存在。

随后才确定实际执行程序所属 APK 的 target、bootstrap、包源、应用运行时和协议。不能先选一个协议，再隐去它需要另一安装或自有仓库的事实。

### 必须公开的成本

- 官方外部环境：APK 与包管理分属不同更新渠道。我们还维护执行桥及协议兼容矩阵。
- 融合环境：我们承担 APK 更新、签名连续性、上游安全修复和数据迁移。保留官方源不等于保留官方 APK 更新能力。
- 自有前缀：我们承担包构建、索引、密钥、镜像、依赖闭包、ABI 和系统回归。不能只重建 bootstrap。
- 所有路线：必须维护停止语义、输出背压、断线重连、结果核验和省流策略。不能把环境常驻当作恢复机制。
- 分发时必须核对 GPL 对应源码与许可通知。MIT、Apache、终端库和每个命令包也有各自义务。本文不是全部依赖的许可证审计。

### 仍需设备测试

必须覆盖首次初始化、已有 Termux 共存或迁移、权限撤销、APK 升级、包安装和升级、构建依赖、ABI、页大小、长输出、取消进程树、两侧分别死亡、重启和强行停止。

必须分别验证工作区的符号链接和执行能力，以及已授权原文件的修改。必须确认停止不会被恢复逻辑重新启动。没有任何源码检查可以替代这些测试。

### 本轮负面结果

- 未找到“改成任意应用 ID，就原样使用全部官方 Termux 包”的已验证先例。
- 未找到本轮先例已经同时满足本项目的恢复正确性、原文件访问和应用内 Agent 约束。
- `NeoTerm/NeoTerm` 检查的当前树仅有 README 和 LICENSE，不能按名称当作完整实现证据。固定树为 [`08bc9c1829cfa305bd5c2b8974f936c8dd17615e`](https://github.com/NeoTerm/NeoTerm/tree/08bc9c1829cfa305bd5c2b8974f936c8dd17615e)。
- UserLAnd 入口仓库的固定树引用 `UserLAndLibrary@83fbd299935929e553f775440aad43f8a347b277`。本轮访问该子模块固定树返回 404。因此没有用 README 宣称它满足完整 Termux。入口树为 [`b6d110a06e6510355a443058baa6c1713f1c7115`](https://github.com/CypherpunkArmory/UserLAnd/tree/b6d110a06e6510355a443058baa6c1713f1c7115)。
- GitHub REST API 达到匿名限额。后续改用公开 Git HTTPS 引用、HTML 元数据和 raw 文件。没有使用凭据。
- 官方仓库 `Packages.gz` 的本轮对比请求发生 TLS 握手超时。因此，没有计算 VHEditor 与官方包数量的覆盖率。单次网络错误不是服务不可用的结论。

## 10. 一手来源

以下代码链接固定提交。在线 APT 元数据和 Wiki 可变，已在正文注明日期和限制。

[T1]: https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/src/main/java/com/termux/app/RunCommandService.java
[T2]: https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/src/main/java/com/termux/app/TermuxInstaller.java
[T3]: https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/README.md#installation
[T4]: https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/LICENSE.md
[T5]: https://github.com/termux/termux-packages/blob/3ac3b7bb73a18513eaef5d6ea8ee6ec7d95a96e1/LICENSE.md
[X1]: https://github.com/bajrangCoder/acodex_server/blob/ee2cbfe9bf988d2052ef1363c8815276cc84469d/install.sh
[X2]: https://github.com/bajrangCoder/acode-plugin-acodex/blob/faa9153e9a3cc8494ab7c560a2c6b02dae1306cc/src/AcodeX.js#L2900-L2937
[X3]: https://github.com/bajrangCoder/acodex_server/blob/ee2cbfe9bf988d2052ef1363c8815276cc84469d/src/terminal/mod.rs
[X4]: https://github.com/bajrangCoder/acodex_server/blob/ee2cbfe9bf988d2052ef1363c8815276cc84469d/src/terminal/handlers.rs
[X5]: https://github.com/bajrangCoder/acodex_server/blob/ee2cbfe9bf988d2052ef1363c8815276cc84469d/src/main.rs
[V1]: https://github.com/vhqtvn/VHEditor-Android/blob/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04/app/build.gradle
[V2]: https://github.com/vhqtvn/VHEditor-Android/tree/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04/app/src/main/java/com/termux/app
[V3]: https://github.com/vhqtvn/termux-packages/blob/f920b020fce83e2b02c23a41226f8e75c71eb422/patch-repo.sh
[V4]: https://github.com/vhqtvn/VHEditor-Android/blob/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04/app/src/main/java/vn/vhn/vhscode/service_features/setupCodeServer.kt#L72-L82
[V5]: https://vsc.vhn.vn/termux-packages-24/dists/stable/Release
[V6]: https://github.com/vhqtvn/VHEditor-Android/blob/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04/app/src/main/java/vn/vhn/vhscode/service_features/SessionsHost.kt
[V7]: https://github.com/vhqtvn/VHEditor-Android/blob/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04/app/src/main/res/raw/boot.sh
[M1]: https://github.com/Termux-Monet/termux-monet/blob/8f19256797216b4b2f73803c268b5e115711a6b7/app/build.gradle
[M2]: https://github.com/Termux-Monet/termux-monet/blob/8f19256797216b4b2f73803c268b5e115711a6b7/app/src/main/java/com/termux/app/TermuxInstaller.java
[A1]: https://github.com/Acode-Foundation/Acode/blob/6962af1e805b8996e743df97cad4df3ecef687e5/src/plugins/terminal/src/android/ProcessManager.java
[A2]: https://github.com/Acode-Foundation/Acode/tree/6962af1e805b8996e743df97cad4df3ecef687e5/src/plugins/terminal/scripts
[A3]: https://github.com/Acode-Foundation/Acode/tree/6962af1e805b8996e743df97cad4df3ecef687e5/src/plugins/terminal/src/android
[S1]: https://github.com/Acode-Foundation/Acode/blob/6962af1e805b8996e743df97cad4df3ecef687e5/src/plugins/sftp/src/com/foxdebug/sftp/Sftp.java
[S2]: https://github.com/termux/termux-packages/blob/3ac3b7bb73a18513eaef5d6ea8ee6ec7d95a96e1/packages/openssh/build.sh
[F1]: https://github.com/termux/termux-packages/wiki/Termux-execution-environment
[L1]: https://github.com/Acode-Foundation/Acode/blob/6962af1e805b8996e743df97cad4df3ecef687e5/license.txt
[L2]: https://github.com/Acode-Foundation/Acode/blob/6962af1e805b8996e743df97cad4df3ecef687e5/src/plugins/sftp/LICENSE.md
[L3]: https://github.com/bajrangCoder/acode-plugin-acodex/blob/faa9153e9a3cc8494ab7c560a2c6b02dae1306cc/License.md
[L4]: https://github.com/bajrangCoder/acodex_server/blob/ee2cbfe9bf988d2052ef1363c8815276cc84469d/LICENSE
[L5]: https://github.com/vhqtvn/VHEditor-Android/blob/5ea1a25fdc37a5ebbb208dd77b015276d4a00d04/LICENSE.md
[L6]: https://github.com/Termux-Monet/termux-monet/blob/8f19256797216b4b2f73803c268b5e115711a6b7/LICENSE

补充的直接证据：

- [官方包前缀与仓库身份常量](https://github.com/termux/termux-packages/blob/3ac3b7bb73a18513eaef5d6ea8ee6ec7d95a96e1/scripts/properties.sh#L2164-L2189)。
- [官方 APK 固定 bootstrap 与摘要](https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/build.gradle#L167-L242)。
- [VHEditor bootstrap 工作流](https://github.com/vhqtvn/termux-packages/blob/f920b020fce83e2b02c23a41226f8e75c71eb422/.github/workflows/bootstrap_archives.yml)。
- [VHEditor bootstrap 生成器](https://github.com/vhqtvn/termux-packages/blob/f920b020fce83e2b02c23a41226f8e75c71eb422/scripts/vh-generate-bootstraps.sh)。
- [VHEditor 本轮 aarch64 文本索引](https://vsc.vhn.vn/termux-packages-24/dists/stable/main/binary-aarch64/Packages.gz)。
- [AcodeX 插件安装入口](https://github.com/bajrangCoder/acode-plugin-acodex/blob/faa9153e9a3cc8494ab7c560a2c6b02dae1306cc/installServer.sh)。
- [Monet Manifest 的身份、权限和 Service](https://github.com/Termux-Monet/termux-monet/blob/8f19256797216b4b2f73803c268b5e115711a6b7/app/src/main/AndroidManifest.xml)。
