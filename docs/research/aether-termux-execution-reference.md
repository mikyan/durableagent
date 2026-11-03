# Aether：Termux／工具环境与 Android 生命周期参考审计

研究日期：2026-11-03。只读源码研究，不是实施批准。

## 1. 结论

**Aether 是“两种执行环境并存”，不是“把完整 Termux 换包名内嵌”。**

1. **Termux 路线是外部 `com.termux` 应用集成。**安装按钮打开 F-Droid 的 `com.termux` 页面；执行调用外部 `RunCommandService`，使用标准 Termux 私有前缀。没有看到自定义 ID 重建、保留 `com.termux` 的自有 APK fork 或自己的 Termux 包仓库。[1–3]
2. **内置路线是应用私有目录中的 Alpine rootfs + Android PRoot。**用 `ProcessBuilder` 启动 `/system/bin/linker64`、PRoot、guest `/bin/sh`，通过 `apk` 扩展包。它不是完整 Termux，也不是只有几枚工具的固定 bundle；README 的“VM”不能理解成独立内核虚拟机。[4、5]
3. **前台 Service 不是独立运行进程的 owner。**Manifest 没有给它指定 `android:process`；它读取 `Application` 持有的 runtime，维护通知。真正执行命令的进程分别在外部 Termux 或应用创建的 PRoot 子进程中。不能据此证明“UI 进程死亡后，独立应用 Agent owner 继续工作”。[1、6、7]
4. **一次初始化及自动 Service dispatch 已实现，日常零手工启动仍待验证。**首次配置提供完整命令、一键复制并打开 Termux、权限申请及实际执行探针。正常 dispatch 自动调用 `startForegroundService()`，异常后尝试 `startService()`；空的 root 启动开关不阻止这条路径。失败分支的“打开 Termux”只是通用手工 fallback，不能证明正常冷启动必须手工操作。冷启动和重启后的实际结果仍未知；force-stop／撤权须另列阻断。[2，具体行号见 §4.2；3、8]
5. **持久命令目录不等于持久执行核验。**Termux 保存日志、状态和 PID，可按 `run_id` 查询；但没有启动代次、boot identity、幂等接纳收据和可靠存活核验。Alpine 的执行索引只在内存，结束后约 5 分钟删除。[2、4]

这些结论**不改变本项目已定方向**：WebView/Kotlin、React/TypeScript/Vite；应用拥有、独立于 UI 进程的 Pi Durable/Pi AI runtime；完整 Termux 只负责命令。外部 Termux 部署仍未决定。Javet Node 仍是有条件的第一验证候选；SDK `1.5.0` 是设计与验证基线。本文不重做核心 JS／SDK 审计，也不批准生产实现。

## 2. 固定来源与证据等级

执行只读引用查询：

```text
git ls-remote https://github.com/Zhou-Shilin/Aether.git refs/heads/main
849696285d96657bb2f6e77229e795fa6822c2df  refs/heads/main
```

以下 Aether 源码链接全部固定该提交。通过命令行 HTTPS 读取 GitHub tree 元数据及 raw 文本；没有安装、执行上游代码、下载 rootfs／ELF／APK、使用凭据、设备或共享浏览器。大文件分段读取或按明确方法范围提取，未把截断输出当作完整审计。

证据标记：

- **源码事实**：固定源码确实声明或实现的行为；不等于设备上成功。
- **作者声明／测试意图**：README 和测试断言表达的预期；不等于测试通过记录。
- **工程推论**：从实现推得的风险或适配义务。
- **未验证**：运行结果、竞态、平台策略和发布产物一致性。

版本事实：Gradle 默认版本名 `2.1.7`，可被属性覆盖；`versionCode=11`；`minSdk=26`、`compileSdk=36`、`targetSdk=28`、仅 `arm64-v8a`。Alpine 安装代码写入 `alpine-3.23.4-aarch64` 标记。后者是**代码声明**，不是本轮解析归档后确认的实际 rootfs 版本。未找到所审安装链中的 PRoot／loader／libtalloc 精确构建来源、版本及校验清单。[4、5]

## 3. 架构、身份、前缀和包来源

| 问题 | 源码事实 | 边界／推论 |
|---|---|---|
| Aether 自身身份 | `applicationId=com.baimoqilin.aether`；namespace 为 `com.zhousl.aether`；debug、nightly 等另有后缀 | Kotlin package 不是 Android UID。不是占用 `com.termux` 的 fork [5] |
| 外部 Termux | 显式 `com.termux/com.termux.app.RunCommandService`；安装链接指向 F-Droid 官方包条目 | 可以说“面向官方外部 Termux 接口”；不能认证用户实际安装者身份 [2、3] |
| Termux 前缀 | 固定 `/data/data/com.termux/files/usr`、`files/home`、`bin/bash`，runner shebang 同样固定 | 不支持任意重命名 Termux、不同前缀；没有可见多用户／work profile 路径协商 [2] |
| 签名检查 | `getPackageInfo(name, 0)` 只检查安装存在，另查 `RUN_COMMAND` 权限；未比对签名证书 | Aether 不要求与 Termux 同签名。接口存在不证明发行渠道、版本和签名可信 [2、5] |
| Termux 包来源 | Aether 未在此路线安装 bootstrap、重建 deb 或设置 apt 源 | 包集合及源由外部 Termux 管理；本轮未取得设备 apt 配置，不能认证全包兼容 |
| Alpine 私有安装 | assets 中引用 `proot.bin`、`loader.bin`、`libtalloc.so.2`、rootfs tar；复制、设执行位、解压到 staging，再替换正式目录 | 自有应用内 PRoot 环境；没有外部 Alpine APK [4] |
| Alpine 软件仓库 | 识别并改写 Alpine 官方 CDN 与清华镜像；按 Cloudflare trace 国家码选择顺序，未知时保留两者 | 源版本分支承自 rootfs 的 repositories；不是固定完整软件供应链 [4] |
| 扩展工具 | profile 有 Python/pip/virtualenv、Node/npm、git/rg/fd、SSH、Chromium 等；使用 `apk add --no-cache --no-chown`，Node 特殊安装函数 | 说明存在包管理能力，不证明全部 Alpine 包，更不证明 Termux 包可直接使用 [4] |

安装解压实现处理普通文件、目录及链接；本轮没有下载归档，也没有完成恶意归档、断电安装及包签名链审计。安装代码没有对上述 asset 内容做独立 hash／签名比对。APK 签名、上游 native 来源和 guest 包签名是不同层次，不能相互替代。[4、5]

`third_party/termux` 是终端 emulator/view 库。交互终端可通过 JNI 建立 PTY、fork、`setsid()`、exec；这不把 Aether 变成完整 Termux 应用，也不证明其 package ecosystem 与 Termux 相同。[14]

## 4. 初始化、权限、冷启动及重启

### 4.1 外部 Termux 调用链

**源码事实：**[1–3、8]

```text
安装入口 → F-Droid com.termux 页面
用户在 Termux 完成首次 bootstrap
Aether 请求 com.termux.permission.RUN_COMMAND
复制配置命令 → 打开 Termux → 用户粘贴运行
刷新 → 实际 bash 探针 → 记录 setup completed
执行 → explicit RUN_COMMAND Intent → PendingIntent 结果
```

完整配置常量会创建 `~/.termux/termux.properties`，更新或追加 `allow-external-apps=true`，最后调用 `termux-reload-settings`。Onboarding 的 `copyTermuxSetupCommandAndOpenTermux()` 把**完整常量**放入剪贴板，再打开外部 Termux；有单独复制入口和状态说明。这是可参考的一次性初始化交互，不是要求人自行拼命令。

`inspectSetup()` 顺序检查应用存在、权限，然后执行 `printf '__aether_termux_ready__'`，等待 4 秒并验证输出。`Ready` 不是只检查一个“配置完成”布尔值。但这个探针只证明当时能够执行简单 bash；没有核验 `nohup`、`pkill`、`base64`、文件操作、包管理、目标 workspace 和后代清理能力。

每次 dispatch 指定 `bash -s`，脚本由 stdin extra 传入，设置 working directory、background=true 和返回 PendingIntent。先 `startForegroundService()`，异常后尝试 `startService()`。代码既没有认证外部 Service 的版本能力，也没有持续连接协商。[2]

### 4.2 对新体验要求的裁定

本项目要求：正常使用只允许首次初始化手工工作；命令必须完整、说明运行地点、易复制，并在之后实际验证。日常反复打开终端或输入命令不合格。force-stop 和撤权是明确阻断，不能绕过。

- **可借鉴／有实现：**完整配置命令、复制并打开 Termux、授权、实际 ready probe、保存曾配置状态。[2、8]
- **已实现自动 dispatch：**[`TermuxBashTool.kt` 577–599 行](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L577-L599)检查安装及权限后直接 dispatch；[647 行、713–719 行](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L713-L719)实际启动 Service，先 `startForegroundService()`，异常后 `startService()`。这里没有“Termux 必须已运行”的检查，也不读取 root 启动开关。
- **空方法和注释的准确范围：**[92–96 行](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L92-L96)的 `setRootBackgroundLaunchEnabled(enabled)` 忽略参数，原注释是 `Root setup can configure Termux files, but command dispatch should not auto-launch Termux when it is not already running in the background.` 注释措辞宽于实际代码，不能覆盖明确存在的 Service 启动调用。**源码能确认的是：该 root 辅助开关不启用额外启动逻辑；不能确认作者在注释中只指 Activity 启动，也不能据此声称普通自动 Service 启动被禁止。**
- **通用手工 fallback：**[664–676 行](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L664-L676)在等待超时后提示打开 Termux、粘贴配置命令；[OnboardingScreen.kt 1335–1345 行](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/ui/OnboardingScreen.kt#L1335-L1345)为 DispatchFailed 提供打开按钮。这些是失败后的交互，不是正常冷启动必需步骤的证据。
- **冷启动裁定：未验证，不是已判失败。**本轮没有设备执行证据证明自动 Service dispatch 在普通进程回收、冷启动或重启后成功，也没有证据证明这些场景必然需要手工打开。只有当正常场景确实反复落入手工 fallback，才违反本项目体验要求。
- **合法阻断必须单列：**缺少／撤回 `RUN_COMMAND` 权限会在 586–592 行提前返回；force-stop 不应与普通进程死亡混为一谈，也不能绕过。所查代码没有专门识别 force-stop 的分支。[698–708 行](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L698-L708)仅给通用权限／external-apps／电池限制提示。错误文案分类及曾配置状态改写仍不足以准确区分所有原因。[2、8]

### 4.3 Alpine 与 reboot

Alpine 的 `initialize()` 从 assets 安装，进程通过 `ProcessBuilder` 按需启动，无须用户开外部终端。一般 `inspectSetup()` 只检查 ABI、assets、host 文件、linker、guest `/bin/sh` 与 `/etc/alpine-release` 存在；不实际执行 shell。包 profile 安装后另运行版本或 `command -v` 检查。这是较好的局部 ready 分层，但仍不是完整工具契约。[4]

Manifest 注册 BOOT_COMPLETED、时间变化和升级 receiver。实际 handler 调用 `scheduledTaskManager.rescheduleAll()`；它是**重新安排定时任务**，不是重连旧命令或恢复旧 PID。Application 初始化也会重排任务。未见此链条自动启动／重建 Termux 执行监督器。[1、7]

冷启动、划走 UI、系统杀进程、重启、force-stop 必须分别验收。`START_STICKY`、定时 alarm 与“保存过设置”均不能替代执行核验。平台／OEM 是否允许后台启动，以及 Android 高 target 下的运行合法性，本轮没有验证。

## 5. 前台 Service 是否拥有独立进程

**答案：没有这样的实现证据，当前 Manifest 反而指向同一个默认进程。**[1、6、7]

- `AetherApplication.runtime` 懒创建 `AetherAppRuntime`；该对象创建 Termux/Alpine runtime、router 和 `SessionExecutionManager`。
- `AetherForegroundService.onCreate()` 取得 `context.aetherRuntime`，组合聊天、执行和设置 flows，决定更新通知或自行停止。
- Service 返回 `START_STICKY`；`onDestroy()` 取消的是自己的通知监听 scope。
- Manifest 中该 Service `exported=false`、类型 `dataSync`，没有 `android:process`；没有此 Service 专有 IPC owner 或恢复账本。
- 应用的 PRoot 确实是另一个 Linux 子进程；外部 Termux 确实属于另一个应用。这两件事都不等于 Service 拥有独立 Android runtime 进程。

**工程推论：**可借鉴前台状态与通知接线，不能把它直接作为本项目“UI／Agent 进程隔离”模板。`targetSdk=28` 是其可写私有目录执行路线的重要条件；不能把这条实现未经验证地搬到现代 target。[5]

## 6. 流式输出、取消和后代清理

### 6.1 Termux

**源码事实：**[2]

- 普通 managed 执行分配 `run-<wallclock>-<counter>`，创建 `~/.aether/bash-runs/<id>`，写 command、working directory、state、PID、child PID、exit code、时间和日志。
- `nohup runner.sh` 启动；runner 用 bash 执行 command，`stdout` 与 `stderr` 合并到 `combined.log`。`stderr.log` 主要用于 runner 错误，不是原始 stderr 的独立实时通道。
- 普通执行有约 45 秒观察窗口，返回 running 后可以用 `fetchExecution(run_id)` 继续查询；默认 tail 12 KiB，最大 64 KiB。
- `executeStreaming()` 每 250 ms 请求从 offset 开始的最多 65,536 字节日志，base64 返回、解码后调用 `onData`。这是文件轮询，不是 Termux 原生长期双向流。
- managed execute 和 streaming 的 coroutine cancellation 在 `NonCancellable` 中尝试 kill；streaming 的超时也调用 kill。低层 `executeCommand()` dispatch 超时／取消只删除等待者，没有对应命令停止协议。
- kill 脚本对 child PID、runner PID 发 TERM，等 1 秒，再发 KILL。名为 `kill_pid_tree()` 的 helper 实际只做 `pkill -P pid` 与 `kill pid`，不是递归遍历；没有 pkill 时只杀指定 PID。错误被吞掉，最后仍写 `cancelled`、143。

**工程推论／明确缺口：**

1. 不能保证孙进程、脱离会话进程或重归属进程消失。没有 PID start-time／boot identity 校验，旧 PID 重用可能使查询或停止针对错误进程。
2. state 文件代表 runner 最后写入，不代表当前存活。snapshot 不检查 `kill -0` 或 `/proc` 身份。runner 被强杀或设备重启后可能留下永久 `running`。
3. streaming 在读到“非 running”后立即退出，没有保证 offset 已到日志末尾；终态出现时积压超过一个 chunk 可能丢尾。此为代码推论，未跑复现。
4. launch 和 inspect 的 managed dispatch 未显式设等待超时；某些 callback 丢失路径可能超出标称观察窗口。取消清理本身也可能等待外部返回。
5. `cancelled` 是写入的结果，不是已确认全部后代死亡的收据。

### 6.2 Alpine

**源码事实：**[4]

- `execute()` 将 PRoot `Process` 放入 `ConcurrentHashMap`，stdout/stderr 落文件；每秒输出 tail，约 45 秒后可以返回 running。
- kill 只对持有的 Process 调 `destroy()`，等待 800 ms 后 `destroyForcibly()`；没有显式枚举后代或独立执行组核验。
- 普通 `execute()` 的 cancellation catch 尝试调用 suspending kill，但没有像 Termux 那样包 `NonCancellable`。
- 同步 `executeCommand()` 支持 wait timeout 和销毁；安装进度分支另有 stdout/stderr reader threads。
- map 只在内存；reaper 在退出后约 5 分钟移除记录。日志文件本身不构成重建索引。

**推论：**PRoot 是否因被杀而带走全部 guest 后代，必须针对所打包 PRoot 实测。不能把 `Process.destroyForcibly()` 当成进程树证明。Alpine 的 coroutine 已取消时，cleanup 能否真正进入也未验证。

用户 pause 的 UI 链还会先把工具状态写成 cancelled／Stopped by user，随后取消 job，并异步尝试 kill 已知 run IDs；kill 结果未作为 UI 终态前置条件。这进一步说明“界面已停止”不等于“外部执行已核验停止”。[9]

## 7. 认证、文件命名空间与原始文件

### 7.1 命令与传输身份

Termux 命令通道依赖 Android 的显式 Service、`RUN_COMMAND` 权限、Termux 的 external-apps 设置，以及一次性 PendingIntent。结果 receiver 不导出；API 31+ PendingIntent 为 mutable，以便外部填入结果。关联键是内存中的整数 execution ID；没有额外密码或网络命令服务器。进程死亡后 pending map 消失，重启整数计数从固定初值开始；晚到返回的代次隔离需要另行设计。[1、2]

**不能把“没有共享密码”写成“完全无认证”。**这里有 Android 授权机制；但应用没有验证对端证书，也没有 caller／execution epoch 的应用层认证。

附件传输另有网络通道：Aether 绑定 `127.0.0.1` 随机端口，生成 UUID 路径 token，只接受一次正确 GET；Termux 用 curl/wget/Python 下载。错误时回退为分块 base64 命令。它不是任意网络可访问的公开 command API；但 loopback 不等于同 UID 认证，token 是 bearer capability，没有 TLS 或 peer-UID 检查。错误首请求即可使单次服务器结束；本轮未做攻击测试。[10]

### 7.2 文件身份

| 路线 | 实际文件 | 原始文件语义 |
|---|---|---|
| Termux workspace | Termux 私有 HOME 的 `.aether/workspace` 或 session workspaces；文件操作通过命令桥 | Aether 无直接跨 UID 文件路径权限；相同字符串不能成为统一 FileSystem.id 的证明 [2、10] |
| Alpine workspace | Aether `filesDir/runtimes/alpine/workspace` bind 到 guest `/workspace` | Kotlin 和 guest 可指向同一实际文件；仍需受控路径映射 [4、11] |
| 从用户 URI 导入 | `ContentResolver.openInputStream()` 后复制到 workspace uploads | 是副本，不是对任意外部原始文件的原位修改；导出另选 destination URI [10、11] |
| Alpine SAF provider | 打开 rootfs／workspace 的真实 host file descriptor，支持创建、修改、重命名、删除 | 此方向确实直接修改 guest 使用的文件；并非把任意 SAF 文档挂成 POSIX 文件系统 [12] |

Alpine provider 排除 `/dev`、`/proc`、`/sys`，按 guest namespace 解析符号链接，检查 tree grant 子路径；`openDocument("w")` 明确加入截断。值得参考，但路径竞态和恶意符号链接并发替换尚未验证。[12]

附件导入在首选 runtime 失败时可以尝试另一 runtime。**推论：**本项目若复用这种体验，必须把实际 namespace 和文件 owner 返回给 SDK；不能只保留“默认 runtime”的身份。SDK `1.5.0` 的 `FileSystem.id` 表示文件命名空间，不是授权令牌或复制同步保证。

## 8. 持久执行核验：已有零件与缺失的闭环

**已有：**Termux run 目录、command/cwd 元数据、日志、exit code、fetch/kill 工具；RuntimeShellTool 可给返回的 run ID 加 runtime 前缀，router 解析前缀；旧终态目录清理策略。Alpine 有运行中 Process 句柄和落地日志。[2、4、13]

**没有在所查执行链发现：**

- 宿主先持久提交 execution key，再让 executor 原子接纳相同 key 的去重协议。
- 接纳／启动／完成／停止各阶段的稳定收据、checksum、持久原子状态转换。
- 用户停止 intent 的跨进程持久提交，以及重启时“先核验停止，再决定是否恢复”。
- Termux 的真实进程身份、boot ID、PID start-time 和子进程归属核验。
- Aether 重开后扫描命令账本并重新关联 SDK task 的 reconciliation。
- 丢失 callback 后区分“没有执行”和“执行成功但没有收到回复”。
- Alpine 从磁盘恢复 run metadata 与存活进程关联。

Termux launch 用 `mkdir -p` 并重写元数据／日志，不是相同 ID 的原子只启动一次。fetch 只读状态文件，不纠正过期 running。run ID 在调用开始时生成，不是 SDK task 的稳定外部执行键。聊天历史里保留 run ID 可以支持手工／工具查询，但不构成上述保证。[2、9]

结合本地 `pi-sdk-1.5-delta.md`：SDK 的 `Storage.commit()` 收据不是 Termux 收据；deferred 进度不是 durable intent；SDK abort／close／restart limit 也不是外部进程清理。不能把任意 Bash 标为 safe 来补偿这个缺口。本项目必须保留独立执行核验 Seam。

## 9. 作者声明、测试证据与缺失门槛

README 声称内置自动安装 Alpine、可运行 shell/tool、支持可选 Termux、系统 Files 直接修改 Alpine 文件。前两节已找到对应实现，但没有由此推导可靠运行保证。[15]

`AlpineRuntimeInstrumentedTest` 包含应用进程启动 shell、读取 Alpine release／aarch64／pwd、Python profile 安装和执行、guest workspace 文件可见性、二进制／符号链接导出等断言。**这些是作者编写的测试意图，不是本轮测试成功或设备日志。**没有发现可据以认证冷启动、reboot、进程死亡恢复、完整 Termux 包兼容和全部后代清理的通过记录。[16]

必要门槛，均未执行：

1. **一次初始化后免重复手工：**Termux 未运行、Aether 冷启动、设备重启、后台触发均自动检查并合法恢复；禁止把“打开 Termux”作为日常 fallback。force-stop／撤权必须明示阻断。
2. **安装与供应链：**固定外部 Termux 渠道／版本／签名、前缀、多用户策略；若选择内置环境，需固定全部 native 构建、rootfs 来源、包版本及许可证。不能由少数版本命令外推全部包兼容。
3. **现代 Android：**目标 API、后台 Service 启动、通知、Doze／OEM、ABI、16 KB page、私有目录执行限制；不能用现有 target 28 代替本项目验证。
4. **ready 分层：**应用／权限／bootstrap／执行探针／文件能力／必要包／停止能力独立判定，错误不能全部映射成配置缺失。
5. **流与停止：**终态前排空日志、分块 UTF-8、输出上限、backpressure、超时、kill 失败、孙进程／daemon／脱离组、PID 重用。
6. **核验与文件：**所有 crash 窗口的持久去重、boot generation、收据重连、durable stop、原始文件权限／namespace／复制同步／并发冲突。
7. **进程所有权：**应用 Agent owner 真正独立于 UI 进程，唯一可写 SDK owner；Service／通知只是生命周期部件。

## 10. 可复用许可

- 根 README 明示 **GPL-3.0**，根 `LICENSE` 是 GNU GPL version 3 正文。未看到 TermuxBashTool、AlpineRuntime、WorkspaceFileBridge 等 Aether 执行代码另给宽松例外。因此不能把这些 Kotlin／生成 shell 代码当 MIT／Apache 代码直接复制。[15、17]
- `third_party/termux/LICENSE.md` 写明 termux-app **GPLv3 only**，并提到来自 Terminal Emulator for Android 的 Apache 2.0 例外；它没有逐文件证明整套 emulator/view 都是 Apache。复用 JNI／terminal 代码前仍须逐文件追溯及保留通知。[14、17]
- rootfs、PRoot、loader、libtalloc 和后续 apk 包的许可证不能由 Aether 根 GPL 文本一概代替。未检查二进制的对应源代码、包内 license 和完整 SBOM；这些是分发前阻断项。

**工程裁定：**可以参考接口拆分、一次初始化交互、执行状态模型的优缺点。要复制实现或分发衍生代码，必须先完成 GPL 与组件许可证评估。本文不是法律意见。

## 11. 固定源码索引

以下全部使用提交 `849696285d96657bb2f6e77229e795fa6822c2df`。

1. [AndroidManifest.xml](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/AndroidManifest.xml)：权限、queries、receiver、provider、前台 Service。
2. [TermuxBashTool.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt)：93–147 setup；150–271 managed/stream；603–732 Intent、等待和权限；950–1237 runner/kill/snapshot；1333–1478 pending map、环境及固定前缀。[TermuxResultReceiver.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxResultReceiver.kt)。
3. [AetherApp.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/ui/AetherApp.kt#L1534-L1568)：外部打开／安装；725–736 权限申请。
4. [AlpineRuntime.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/AlpineRuntime.kt)：60–101 sources/paths；154–220 初始化；394–516 profile/ready；519–719 执行／停止；721–871 PRoot/env/install；1215–1377 验证／map/reaper/profiles。
5. [app/build.gradle.kts](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/build.gradle.kts)：版本、身份、SDK、ABI、signing config；[assets 树](https://github.com/Zhou-Shilin/Aether/tree/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/assets/runtimes/alpine/arm64-v8a)只用来确认文件清单，未下载内容。
6. [AetherForegroundService.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/AetherForegroundService.kt)。
7. [AetherApplication.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/AetherApplication.kt)；[ScheduledTaskRescheduleReceiver.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/ScheduledTaskRescheduleReceiver.kt)。
8. [OnboardingScreen.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/ui/OnboardingScreen.kt#L1258-L1346)；[AetherViewModel.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/ui/AetherViewModel.kt#L532-L604)。
9. [SessionExecutionManager.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/SessionExecutionManager.kt#L377-L419)：pause／异步停止；2786–2832 终态与 run ID 提取。仅检查相关执行片段，没有全面审计整个会话算法。
10. [WorkspaceFileBridge.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/WorkspaceFileBridge.kt)：449–590 导入／fallback；880–936 下载／提交；993–1088 loopback token server。另检查路径、读写和导出方法定位。
11. [RuntimeWorkspaceFileBridge.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/data/RuntimeWorkspaceFileBridge.kt)。
12. [AlpineDocumentStore.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/AlpineDocumentStore.kt)；[AlpineDocumentsProvider.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/AlpineDocumentsProvider.kt)。
13. [RuntimeShellTool.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/RuntimeShellTool.kt)；[RuntimeRouter.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/RuntimeRouter.kt)；[TermuxRuntime.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/runtime/TermuxRuntime.kt)。
14. [third_party/termux/LICENSE.md](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/third_party/termux/LICENSE.md)；[termux.c](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/third_party/termux/terminal-emulator/src/main/jni/termux.c)；[TerminalSession.java](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/third_party/termux/terminal-emulator/src/main/java/com/termux/terminal/TerminalSession.java)。JNI 只检查进程启动／停止相关位置。
15. [README.md](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/README.md)。
16. [AlpineRuntimeInstrumentedTest.kt](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/androidTest/java/com/zhousl/aether/runtime/AlpineRuntimeInstrumentedTest.kt)：只读测试源，未运行。
17. [LICENSE](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/LICENSE)。

本地约束输入：`docs/research/runtime-candidate-review.md`、`docs/research/pi-sdk-1.5-delta.md`。本文只写本文件；没有改变其他报告或项目代码。
