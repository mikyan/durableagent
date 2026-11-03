# Android 原始文件访问与工具工作区：不能用共享目录掩盖差异

研究日期：2026-11-03。仅用命令行 HTTP 阅读 Android、AOSP 和 Termux 一手资料；未连接设备、运行上游代码、安装软件或修改设备。本文记录约束和验证要求，不选择存储布局，也不新增产品实体。

## 结论

**完整 Termux 的接入不能仅理解为一个 `bash(command)` 调用，也不能用 `/sdcard` 统一目录来自动解决跨应用文件访问。** 工具看到的文件、可执行代码和原始用户文件必须具有明确的访问语义。

已有产品约束不变：工作区是文件目录，不是安全沙箱；未关联项目的会话共用默认工作区；应用必须能修改已授权原始文件，而不是只处理上传副本。

## 1. 已核验的事实

### 1.1 两个应用的私有目录并不互通

Android 应用私有内部存储由系统隔离。允许另一应用访问文件的常规机制是具有授权的 `FileProvider`／文档 URI 或其他显式接口，不是直接取得对方私有目录的路径。[A1]

Termux 官方文档也区分独立 UID、私有目录、通过 SAF 的授权和 `RUN_COMMAND` 授权。`RUN_COMMAND` 可以让调用方请求在 Termux 上下文中执行，但它不把两个应用变成同一 UID。[T1]

**推论：** 如果主 Agent 在本应用、工具在外部 Termux，本应用的 `node:fs` 或 Kotlin `File` 不能仅凭相同字符串路径直接读写 Termux 工作区。需要由有权访问的一侧执行操作，或使用明确的文件授权和适配。

### 1.2 共享存储不是通用 POSIX 工作区

Termux 官方执行说明指出：常见共享／模拟外部存储（例如 `/storage/emulated/0`、`/sdcard`）使用 `noexec`，不支持硬链接或符号链接。这会影响软件构建和依赖目录。解释器读取脚本与内核直接执行脚本／本机程序不是同一种操作。[T2]

此处的 `noexec` 有固定 AOSP 源码佐证：

- Android 14 `vold/Utils.cpp` 的 `MountUserFuse()` 使用 `MS_NOEXEC`（第 1635–1637 行）。
- 同一版本 `sdcard/sdcard.cpp` 的 `sdcardfs` 挂载及重新挂载使用 `MS_NOEXEC`（第 122、143 行）。
- `VolumeManager.cpp` 对 `Android/data`、`Android/obb` 的相关挂载也明确使用该标志（第 737–749 行）。[A2]

这些是挂载及文件系统约束，不能与 Android 10 针对高目标 SDK 的私有应用目录 `execve()` 限制混为一谈。选择较低 `targetSdk` 不会因此让共享目录获得完整 Unix 文件系统特性。[A2][A5]

**推论：** 共享目录可以存放并处理照片、文档等数据，但不能被默认当作所有工具安装、项目依赖、构建输出与二进制运行的唯一位置。需要执行位、链接或其他 POSIX 行为的场景必须单独验证；不能凭某个纯脚本示例成功就宣称完整兼容。

### 1.3 SAF URI 不是 Bash 文件路径

Android SAF 返回文档或目录 URI。应用通过 `ContentResolver`、文件描述符及 Provider 支持的操作访问文档。官方示例支持修改原文档，不要求只能操作导入副本。[A3]

权限可按系统提供的标志持久化，但文档移动、删除或授权撤销会使原访问失效。Provider 能力旗标会影响可写、创建、删除等实际操作。[A3]

**推论：** 不能把任意 `content://…` 字符串作为普通 Bash 路径，也不能凭通用“URI 转真实路径”函数许诺完整支持。若采用中转文件，必须明确原对象身份、回写、冲突与失败语义，不能把只修改副本视为满足原始文件要求。

### 1.4 “所有文件访问”也不是跨应用私有目录权限

`MANAGE_EXTERNAL_STORAGE` 可以扩大对共享存储的读写和直接路径访问，但仍不允许访问其他应用的私有／受保护目录。它也不会让 SAF 获取本来不允许的目录授权。[A1][A4]

**推论：** 可以研究直接共享存储路径和文档 URI 的不同 Adapter，但不能承诺一次授权后，本应用、外部 Termux 和所有文档 Provider 自动拥有同一文件视图。各应用实际具备的授权必须分别核验。

## 2. 应明确的 3 种存储角色

这是实现分析，不改变 `GLOSSARY.md` 的产品模型，也不要求现在决定物理目录。

| 角色 | 必须保持的语义 | 不能假定的事情 |
|---|---|---|
| 应用的 Agent 状态 | 主会话、SDK 检查点与恢复控制由本应用拥有；同一 SDK storage 有唯一所有者 | 不能把会话数据库放到公共目录，让 UI、内核、Termux 各自直接写 |
| 工具执行所需工作区与环境 | 保留满足所需工具的路径、链接、执行与依赖行为；未关联项目会话仍共用默认工作区 | 不能默认 `/sdcard` 等同于 Termux 私有 POSIX 目录；也不能因参考项目使用每会话目录而更改需求 |
| 用户授权的原始文件 | 身份可追踪、访问经过系统授权，实际修改可回到原对象 | 不能把缓存副本当作原对象；不能声称所有 URI 均可供任意 CLI 直接使用 |

如果工具的文件 Interface 和 Bash 对同一环境中的同一路径看到不同文件，调用者就必须承担隐藏的命名空间差异。应在文件／执行 Module 内解决或显式表达，不能把不一致藏在一个相同的环境标识后面。具体 SDK 契约见 [SDK 专项研究](pi-sdk-android-contracts.md)。

## 3. 需要进入后续设计和验证的场景

1. **工具安装与构建**：安装兼容工具、创建带链接的依赖目录、运行生成的二进制；不能只测试 `echo` 或 Python 纯脚本。
2. **真实共享文件**：对已授权目录中的真实图片／文本做读取和修改，检查其他应用看到的是同一结果。
3. **文档 URI**：测试 Provider 支持的原位修改，以及不支持某操作时的明确错误；不宣称通用 POSIX 映射。
4. **跨 UID 一致性**：同一文件先由文件工具读取，再由 Bash 修改，再由文件工具复查；验证路径和结果一致。
5. **中断窗口**：原对象已修改而应用尚未保存完成记录时中断，核验实际结果后再恢复，不盲目覆盖或重放。
6. **权限变化**：撤销授权、移动／删除原文档、存储暂不可用、重新解锁后，必须正确区分缺权限、缺文件和暂时不可用。
7. **并发与外部修改**：会话写入串行策略只能约束本应用控制的执行，不能被表述为阻止其他应用或用户手工修改文件的全局锁。
8. **已有 Termux 数据**：若采用外部环境，执行权限并不只覆盖新工作区。不得把工作区约定宣传成对 Termux 其他文件的安全隔离。

目前没有执行上述测试。共享存储、SAF、Termux 私有工作区和原始文件访问的具体组合仍待决定。

## 4. 证据边界

- Termux Wiki 与 Android 开发文档为检索日可变资料；挂载结论另用固定 `android-14.0.0_r1` 源码核对。
- 这不证明所有 Android/OEM、USB 存储或文档 Provider 都有相同特性。应按实际设备、授权和挂载验证。
- Wiki 个别文字存在疑似笔误，例如文件属性修改的描述；本文不据其作出通用 `chmod` 行为承诺。
- 没有读取用户手机文件，也没有授权或执行卸载、迁移、权限变更。

## 一手来源

- [A1] [Android：应用专属存储](https://developer.android.com/training/data-storage/app-specific)。
- [A2] AOSP Android 14 固定源码：[vold/Utils.cpp](https://android.googlesource.com/platform/system/vold/+/refs/tags/android-14.0.0_r1/Utils.cpp#1635)、[VolumeManager.cpp](https://android.googlesource.com/platform/system/vold/+/refs/tags/android-14.0.0_r1/VolumeManager.cpp#737)、[sdcard.cpp](https://android.googlesource.com/platform/system/core/+/refs/tags/android-14.0.0_r1/sdcard/sdcard.cpp#122)。
- [A3] [Android：使用 SAF 访问文档和其他文件](https://developer.android.com/training/data-storage/shared/documents-files)。
- [A4] [Android：管理存储设备上的所有文件](https://developer.android.com/training/data-storage/manage-all-files)。
- [A5] [Android 10：应用主目录的执行权限限制](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)。
- [T1] [Termux 文件系统布局](https://github.com/termux/termux-packages/wiki/Termux-file-system-layout)。
- [T2] [Termux：外部存储的执行和特殊文件特性限制](https://github.com/termux/termux-packages/wiki/Termux-execution-environment#file-execution-and-special-file-features-not-allowed-in-external-storage)。
