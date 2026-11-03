# 外部 Termux 的受管启动：可行边界

调研日期：2026-11-03。仅通过命令行 HTTP 阅读 Termux 官方源码、Wiki 与 Android 文档；未安装软件、连接设备或读取凭据。源码引用为当日读取的 `master`，不是已验证发行版。

> 后续架构澄清（2026-11-03）：用户明确主 Agent 在本应用运行宿主中，Termux 仅作为命令执行端。以下调研证明或限定的是执行接入能力，不应据此把主 Agent 搬入 Termux；外部 Termux 方案本身仍未确认。

## 结论（不是架构选择）

**外部 Termux 存在应用受管启动的官方入口，但首次配置后能否免除重复手动启动，仍须在目标情境验证；`RUN_COMMAND` 不是完整运行监督协议。** 官方支持第三方应用启动命令；后台命令无需显示 Termux 终端。[1][2] 该路线可与既定的 WebView + Kotlin、React + TypeScript + Vite、独立应用运行宿主进程并存：运行宿主负责控制，Termux 负责启动另一个 UID 下的执行进程。它不是“应用自己的 Service 直接拥有 Termux 子进程”。[3][8]

因此，它值得作为“完整 Termux 能力、尽可能广泛安装兼容软件包”的候选，但本调研不证明 Pi Durable/Pi AI 或全部目标软件包已兼容，也不选择此方案。尚无单 APK 要求；采用外部 Termux 将增加独立应用依赖。包前缀、签名及包身份兼容性留给另一份研究。

**后续反例核查（2026-11-03）：**Moose 作者记录过重启后 Termux 没有进程时，调用被 `BackgroundServiceStartNotAllowedException` 拒绝，打开 Termux 后才连通。[15] 记录没有充分说明此前初始化、解锁、停止标记和调用方状态。不能把它解释为只有首次设置才需要手动，也不能据此断言一切冷启动路线不可能。详见[移动 Pi 项目研究](pi-android-reference-projects.md)及[综合研究](android-architecture-synthesis.md)。不重复手动启动仍是验收底线，不是本轮已证明的能力。

**后续正面实现证据：**[Aether 的固定源码](https://github.com/Zhou-Shilin/Aether/blob/849696285d96657bb2f6e77229e795fa6822c2df/app/src/main/java/com/zhousl/aether/termux/TermuxBashTool.kt#L713-L719)已在调用方先使用 `startForegroundService()`，异常后尝试 `startService()`；还提供完整配置命令、复制入口和实际执行探针。这是自动 dispatch 的实现证据，不是冷启动／重启验收结果。空的 root 设置开关和手工排障按钮不能证明普通自动启动被禁止，详见 [Aether 执行研究](aether-termux-execution-reference.md)。

## 已存在的能力与首次配置

- 显式调用组件 `com.termux/com.termux.app.RunCommandService`，action 为 `com.termux.RUN_COMMAND`；可传可执行路径、参数、工作目录、初始 `stdin`。`EXTRA_BACKGROUND=true` 选择非终端后台命令；缺省为终端会话。命令入口始于 `0.95`，结果回传始于 `0.109`。[1][2]
- 首次必须安装 Termux，并完成 bootstrap 初始化；当前源码在可见的 `TermuxActivity` 中执行 `setupBootstrapIfNeeded()`，`RUN_COMMAND` 不负责安装环境。[2][4]
- 调用应用必须声明并取得用户授予的 `com.termux.permission.RUN_COMMAND`，它是 `dangerous` 权限。Termux 内还必须设置 `~/.termux/termux.properties` 的 `allow-external-apps=true`。这是显式信任授权，不可承诺首次全静默配置；未授权时不能借同一个入口修改配置绕过检查。[1][2][5]
- 按官方集成说明，调用方 target SDK ≥30 时添加 `<queries><package android:name="com.termux" /></queries>`。不必因此申请广泛的 `QUERY_ALL_PACKAGES`。[6]
- 共享存储权限只在使用相关路径时需要。终端界面自动弹出可能需要悬浮窗授权；后台命令不因此需要悬浮窗。电池限制豁免依设备而定，不等于永久存活。[1]

## 启动与 Android 生命周期

“后台命令”不等于“无通知的 Android 后台服务”。`RunCommandService` 在 Android 8+ 进入前台，并用 `startForegroundService()` 转交 `TermuxService`；后者持有运行任务和前台通知，可以独立于 Termux Activity 存活。[2][3]

集成必须分别处理普通应用打开时启动、应用已在后台时启动、进程死亡后恢复、设备重启。Android 8 的服务限制与约 5 秒前台提升要求仍适用。Android 12+ 对后台启动前台服务有限制；**跨应用调用该 API 时，此项限制仅在双方 target SDK 均 ≥31 时适用**。当日 Termux 主线配置为 `targetSdkVersion=28`，不能把新应用 target SDK 较高误写成必然阻断，也不能把旧 target 当成所有 Android/OEM 限制的豁免。[7][9]

自动启动终端 Activity 还受 Android 10+ 的界面启动限制，不应把此路径作为无人工重复启动的必要环节。[1][10] `TermuxService` 返回 `START_NOT_STICKY`，不会提供自动重启监督。[3] 应用自身运行宿主的前台服务类型、通知、启动合法性仍须单独设计；外部 Termux 不替它满足这些规则。[7]

## 结果、持续流与取消

| 项目 | 已有能力 | 必须补充的集成 |
|---|---|---|
| 完成结果 | `EXTRA_PENDING_INTENT` 回传结果 Bundle；后台模式有分离的 `stdout`、`stderr`、退出码与 Termux 内部错误。终端模式回传合并 transcript。官方约束将输出合计截断至约 100 KB，并附原始长度。[1][11] | 独立执行 ID、显式目标、适当的可变 `PendingIntent`、超时和重复结果处理；不要直接照搬 Wiki 中旧 `IntentService` 生命周期示例。[1][9] |
| 持续通信 | `AppShell` 收集输出并等待进程结束后处理结果；`EXTRA_STDIN` 是初始输入，不是后续写入句柄。结果目录也是完成结果出口，不是流式订阅。[3][11][12] | 另建认证的本机 RPC/流协议，支持日志、事件、就绪握手、交互输入、重连与背压。长期进程的高流量输出应重定向或经专用通道处理，不能依赖最终回调缓存。[12] |
| 取消 | 已查看的公开 `RUN_COMMAND` 接口没有按执行 ID 取消的命令；`TermuxService` 未导出。取消结果 `PendingIntent` 只放弃接收结果，发送端捕获异常后忽略，不会取消进程。[1][5][11] | 在 Termux UID 内提供按任务 ID 取消、优雅停止、超时强制终止及子进程组清理。可通过自己的控制协议，或另一次 `RUN_COMMAND` 执行受控停止命令；不得粗暴结束全部 Termux 会话。[2][3][8] |

Termux 拥有实际 `Process`，应用运行宿主只有协议上的控制权。[12] Termux 服务退出时会清理会话及部分期待结果的插件任务；不是所有派生进程都保证被清理。源码也明确警告：系统杀进程时回调可能永远不来。必须通过心跳、超时与状态核对识别中断，而非把缺少回调当作仍在运行。[3]

## UID、私有数据与监督器方案（待实现）

Android 的 UID/SELinux 隔离同时覆盖原生与解释执行代码。普通独立应用不能直接读写 Termux 私有目录；反过来，Termux 进程也不能直接使用应用私有数据库路径。`RUN_COMMAND` 授权允许在 Termux 上下文执行，不会合并 UID 或授予直接文件系统访问。[1][8]

可研究如下连接，而非声称现成可用：

`WebView UI → 应用独立运行宿主 Service → RUN_COMMAND 启动适配器 → Termux 内执行进程`

随后由运行宿主与执行进程建立认证通道。监督器必须实现幂等启动、版本协商、就绪检测、重连、退出检测、受控重启及任务取消。仅发送 Intent 成功不能代表运行时就绪。用户后续已明确 Pi Durable/Pi AI 在本应用运行宿主中，主会话状态由本应用拥有；持久化布局和桥接数据交换仍需设计，不能让两侧直接共享同一路径并并发操作 SDK 数据库。工作区、结果文件和凭据须通过授权的文件共享或自定义协议传递；结果目录可写不等于另一 UID 可读。[1][8]

本机网络通道是待设计方案，不是 `RUN_COMMAND` 自带能力。必须限定监听范围并验证调用者，避免把“本机地址”当成授权；不得把执行入口直接暴露给任意 WebView 内容。Termux 命令拥有该环境已有的数据和权限，不能把这层边界误当成对每个工具的细粒度隔离。[1][8]

## 尚未验证／验收要求

未做设备或端到端测试。必须覆盖具体 Termux 发行版、Android/OEM、双方 target SDK、首次安装和权限撤销、前后台冷启动、锁屏/省电、两侧进程分别死亡、升级/重启、长输出、孤儿进程及停止后的恢复语义。Termux 官方提醒 Android 12+ 的 phantom process／CPU 限制；不能把前台服务或 wake lock 写成可靠存活保证。[13] Android 13+ 用户可停止运行前台服务的整个应用，且系统不发送停止回调；恢复策略必须尊重用户停止意图。[14]

**验收底线：首次引导后，正常应用使用不要求再次手动启动终端或后端；平台禁止恢复时应明确显示阻塞原因。** 若目标还包括所有锁屏、重启或强制停止情形下的无条件自动恢复，现有资料不足以承诺。

## 一手来源

1. [Termux：RUN_COMMAND Intent（参数、设置、结果及隐私）](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)
2. [RunCommandService.java](https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/RunCommandService.java)
3. [TermuxService.java（启动、结果、停止与生命周期）](https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/TermuxService.java)
4. [TermuxActivity.java：onServiceConnected](https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/TermuxActivity.java)
5. [Termux AndroidManifest.xml（权限与导出边界）](https://github.com/termux/termux-app/blob/master/app/src/main/AndroidManifest.xml)
6. [Termux Libraries：Target SDK 30 Package Visibility](https://github.com/termux/termux-app/wiki/Termux-Libraries#target-sdk-30-package-visibility)
7. [Android：后台启动前台服务的限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)；[Termux gradle.properties](https://github.com/termux/termux-app/blob/master/gradle.properties)
8. [Android：Application Sandbox](https://source.android.com/docs/security/app-sandbox)
9. [Android 8：Background Execution Limits](https://developer.android.com/about/versions/oreo/background)
10. [Android：后台 Activity 启动限制](https://developer.android.com/guide/components/activities/background-starts)
11. [ResultSender.java（回调、截断及文件结果）](https://github.com/termux/termux-app/blob/master/termux-shared/src/main/java/com/termux/shared/shell/command/result/ResultSender.java)
12. [AppShell.java（Process、stdin、输出收集与退出）](https://github.com/termux/termux-app/blob/master/termux-shared/src/main/java/com/termux/shared/shell/command/runner/app/AppShell.java)
13. [Termux README：Android 12+ 风险提示](https://github.com/termux/termux-app/blob/master/README.md)
14. [Android：用户停止前台服务应用](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping)
15. [Moose 固定记录：重启后冷启动与冻结恢复的区别](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/docs/termux-recovery.md#L53)
