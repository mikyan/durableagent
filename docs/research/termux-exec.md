# termux-exec：Android 架构边界

研究日期：2026-11-03。仅用命令行 HTTP 阅读 Termux 官方文档、源码及 Android 官方资料；未做设备验证，未安装或执行下载代码。

## 普通执行路径

- `termux-exec` 是执行兼容层，不是完整 Linux 环境。动态链接器通过 `LD_PRELOAD` 预先加载共享库，以同名导出符号替换 libc 执行函数。当前文档区分 `libtermux-exec-direct-ld-preload.so` 和 `libtermux-exec-linker-ld-preload.so`；安装时选用 `libtermux-exec-ld-preload.so`，旧名 `libtermux-exec.so` 是兼容链接。两种库都能支持下述可选模式，不能把库名等同于模式开关。[1][2]
- 当前 direct 入口实际导出 `execl`、`execlp`、`execle`、`execv`、`execvp`、`execvpe`、`fexecve`、`execve`。拦截器处理路径、参数、环境后，最终调用 `syscall(SYS_execve, ...)`；它不拦截程序自己发起的直接系统调用。[1][3][4]
- 对绝对执行路径及 shebang 解释器路径，把 `/bin/*`、`/usr/bin/*` 前缀映射到 `$TERMUX__PREFIX/bin/*`。源码先规范化绝对路径；相对路径按当前目录转为绝对路径，不做同样的前缀替换。这不是整个文件系统的路径虚拟化。[1][4]
- 对读取到的 `#!` 脚本头，解析解释器和可选参数，再构造“解释器、可选参数、脚本、原参数”的执行参数。不会修改脚本文件，也不会安装缺失的解释器。当前解析要求读取的头部包含换行；可选参数作为一个字符串传递，不是 shell 命令解析。[4]

## 单独的可选模式：`system_linker_exec`

- Android 10 起，针对 `targetSdkVersion >= 29` 的普通不受信任应用，SELinux 限制直接执行应用可写私有目录中的文件。不是“所有 Android 10 应用均不能执行任何下载文件”；旧目标 SDK 的兼容域另有豁免。Android 官方明确说明该 `execve()` 限制，也说明相关 `dlopen()` 可写映射限制。[1][5]
- 此模式改为执行 `/system/bin/linker64 /absolute/program ...`，32 位使用 `/system/bin/linker`；脚本则把解释器作为 linker 的程序参数。内核看到被执行的是系统 linker，linker 再加载应用目录内的 ELF。Android 10 才加入这种直接调用 linker 的能力；普通路径替换本身不解决上述限制。[1][4][6]
- `TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE` 支持 `disable`、`enable`、`force`。当前文档默认 `enable`，意为“需要时启用”，不是无条件启用：检查 Android 版本、有效 UID、SELinux 域及程序/解释器是否位于配置的应用数据目录；`force` 仍受版本及路径条件约束。[2]

## 限制与接入条件

- **调用覆盖**：直接 `execve` 系统调用绕过共享库拦截，需要调用方适配；不能声称所有执行入口自动兼容。[1][3][4]
- **静态和特权程序**：静态程序自身不会通过动态预加载获得这些钩子；不等于已加载钩子的父进程不能处理启动它的请求。官方另明确指出静态 ELF 不能使用 `system_linker_exec`。Bionic 在 `AT_SECURE` 下忽略 `LD_PRELOAD`，例如 setuid/setgid 安全执行；不能扩大为“所有 UID 0 进程都禁止预加载”。[1][6]
- **子进程与环境**：库必须已加载到发起执行的进程；只在现有 shell 中设置变量不会立即加载，取消变量也不会卸载现有库。后续进程需要继承或明确传入合适的 `LD_PRELOAD`，环境清理会中断覆盖，不能只配置交互 shell。[1][2][4]
- **源码/文档差异**：当前 `shouldUnsetLDVarsFromEnv()` 在非本机 ELF **或**多数 `/system/` 程序执行时移除 `LD_PRELOAD`/`LD_LIBRARY_PATH`；`/system/bin/sh`、两个 linker 是后者的例外。usage 文档将条件写成组合关系，架构判断应以实际部署源码为准。[2][4]
- **动态链接要求**：需要兼容的 ABI、Android linker 和可解析的依赖；linker 仍检查 ELF、PIE、依赖及命名空间。此机制不是 glibc/musl 或任意 Linux ELF 的通用加载器。linker 模式还改变 `/proc/<pid>/exe` 等可观察身份；`TERMUX_EXEC__PROC_SELF_EXE` 只辅助适配当前进程的软件，不透明修复所有进程检查。[1][2][6]
- **自定义应用前缀**：`TERMUX__PREFIX` 可提供有效绝对路径；无效或缺省时回退编译值。必须同时配置适合宿主的应用数据路径、预加载库、解释器及依赖。当前文档规定前缀缓冲区 90 字节、应用数据路径缓冲区 69 字节（含终止符）；不能假定改包名或设置一个变量就能搬迁全部 Termux 包。[1][2]

## 它不提供什么

它调用已有解释器，因此不提供 shell；它提供库及辅助工具，不提供完整包环境。[1][4] 它不授予 root 或广泛 Android 权限，不创建新的安全沙箱：原应用 UID、SELinux 和 Android 原生代码沙箱仍适用。上述结论是执行机制及平台边界的架构推论，而不是权限提升功能。[4][7] 它不提供后台存活保证；Android 仍管理进程生命周期并可终止进程。[8] 因而它仅处理特定执行兼容问题，**不能据此宣称解决所有较高目标 SDK 的兼容性、安全策略或后台运行限制**。[5][6][7][8]

## 一手来源与版本注意

起点仓库现在跳转到 `termux/termux-exec-package`。技术文档的一些 `v2.4.0` 源码链接返回 404；本次沿当前仓库树查到实际入口和实现。Termux 引用使用可变 `master`，不能当作已部署版本证明；Android linker 引用固定 `android-10.0.0_r1`。

1. [Termux technical docs（指定起点）](https://github.com/termux/termux-exec/blob/master/site/pages/en/projects/docs/technical/index.md)：库、路径映射、执行限制、linker 模式及已知问题。
2. [Termux usage docs](https://github.com/termux/termux-exec-package/blob/master/site/pages/en/projects/docs/usage/index.md)：模式、环境变量、前缀及限制。
3. [TermuxExecDirectLDPreloadEntryPoint.c](https://github.com/termux/termux-exec-package/blob/master/app/termux-exec-direct-ld-preload/src/termux/api/termux_exec/service/ld_preload/direct/TermuxExecDirectLDPreloadEntryPoint.c)：实际导出函数。
4. [ExecIntercept.c](https://github.com/termux/termux-exec-package/blob/master/lib/termux-exec_nos_c/tre/src/termux/api/termux_exec/service/ld_preload/direct/exec/ExecIntercept.c)：路径、shebang、环境、参数与系统调用实现。
5. [Android 10：Removed execute permission for app home directory](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)：目标 SDK 相关限制。
6. [AOSP Bionic linker_main.cpp，Android 10](https://github.com/aosp-mirror/platform_bionic/blob/android-10.0.0_r1/linker/linker_main.cpp)：直接加载程序、`AT_SECURE`、PIE、依赖与命名空间。
7. [Android Application Sandbox](https://source.android.com/docs/security/app-sandbox)：UID、原生代码与平台权限边界。
8. [Android Processes and app lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle)：进程重要性及终止机制。
