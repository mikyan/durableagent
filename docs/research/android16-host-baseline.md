# Android 16 应用内宿主验证基线

日期：2026-11-03。范围：Android 平台规则及 Javet Android Node 的首轮验证条件；不是生产策略、运行时选型或实施方案。

## 结论先行

**将本应用的 `compileSdk = 36`、`targetSdk = 36` 作为首轮验证基线有依据，无须为了独立 Termux 把本应用降到它的 target。** Android 官方直接给出这组 Android 16 配置；Javet 的 Android 默认加载路径是 APK 原生库加载，不是从可写目录启动 Node 可执行文件。[1][3–6] 这只说明可以开展验证，不表示 Javet、Pi SDK 或长期后台运行已经通过。

**前台 Service 不等于无限运行许可。** `specialUse` 只能作为需要真实用途论证的候选；`dataSync` 不能被当作常驻 Agent 的通用类型。目标 API 36 同时承接 Android 12–15 的启动、类型、通知及超时规则，并受到 Android 16 的作业配额变化影响。[9–15]

### 已知输入，不是本轮设备实测

- 用户已接受“本应用 + 独立官方 Termux”。两者不是同一 APK，也不合并应用身份。
- 用户确认 Xiaomi 15、Galaxy S23 都运行 Android 16；Xiaomi Pad 9 仍是计划设备。此前资料中“实际 OS 未知”的表述不再适用于这 2 部手机；ABI、页面大小及具体固件仍未测。
- Pi Durable / Pi AI `1.5.0` 主 Agent 必须留在本应用。运行宿主由 Service 管理，且必须与 WebView UI 进程分离。Termux 负责外部命令环境，不能接管主 Agent。
- Javet Android Node 是第 1 个验证候选，没有批准最终运行时或实现。
- 正常使用只允许首次初始化需要手工操作；届时必须提供完整可复制命令及就绪检查。这是验收要求，不是现有实现能力。

## 1. SDK 基线与应用身份

| 分类 | 事实或判断 |
| --- | --- |
| 官方事实 | Android 16 对应 API 36；官方设置页分别给出 `compileSdk = 36` 和 `targetSdk = 36`，后者选择 Android 16 的目标版本行为。[1] |
| 官方事实 | `minSdk` 控制最低安装 API；`targetSdk` 表达应用针对的 API 及相关兼容行为，不是最低安装版本。[2] |
| 官方事实 | Android 默认给各应用分配不同 UID，以内核沙箱隔离资源；原生代码也受同一沙箱约束。[7] |
| 工程推论 | 两个独立 APK 可以采用不同 target。本应用不能继承 Termux 的兼容待遇；Termux 的低 target 也不要求本应用降低 target。应按实际执行进程、文件位置及具体规则分别分析。[2][3][7] |
| 条件判断 | 先以 36/36 暴露真实兼容问题，比未经验证就为可写目录执行而降 target 更符合当前 JNI 候选路线。此判断不批准生产 SDK 策略，也不意味着只检查 Android 16 新增规则即可。[1][3][9] |

Javet 固定源码 `5d51b4eb0bfd4869436c906ce0748b325f445959`（源码版本 `6.0.3`）的 Android **library** 模块写有 `compileSdk = 30`、`minSdk = 24`。这是被查库的构建配置，不是本应用必须使用的 target，也不是本应用兼容 API 24 的证明。[6] 本文不重新调查或固定 Termux 的具体 target 数值。

## 2. 必须分开的 3 种机制

### A. APK 原生库加载

**源码事实：**被查 Javet Android 默认 listener 返回 `isDeploy = false`、`isLibInSystemPath = true`；loader 因而走 `System.loadLibrary(...)`。Android Node workflow 把 SO 放入 `jniLibs/arm64-v8a` 与 `jniLibs/x86_64`，再构建 AAR。[4–6]

**平台事实：**Android 使用 APK 中的 `lib/<abi>/lib<name>.so` 原生库布局；原生库可以按打包方式直接从 APK 加载或由安装器解压，且需要满足 ABI、ELF 和打包对齐要求。[16][17]

**推论：**此路线在本应用进程内嵌入 Node，不需要先把独立 `node` 程序写入 `filesDir` 再 `execve()`。因此，“高 target 禁止可写目录执行”不是排除 Javet 的充分理由。安装器管理的原生库部署也不能与应用自行复制文件到可写目录混为一谈。

**待测：**实际选定 AAR、传递依赖、加载路径、符号与 Android/Bionic 链接兼容、页面对齐、JNI 初始化和 SDK 入口。被查 listener 在 Android 上还默认允许抑制加载错误；因此“loader 返回”或界面显示成功不能充当就绪证明，必须实际创建 Node runtime 并执行验证。[4][5]

### B. 可写目录中的 `execve()`

**平台事实：**Android 10 对相应目标版本应用禁止直接对应用主目录内文件调用 `execve()`；官方要求二进制代码随 APK 提供，并另述 `dlopen()` 可执行映射与可写文件描述符的限制。[3]

**推论：**本应用 target 36 不能假定“下载／解压 Node 到私有可写目录，再 `chmod +x`”可以工作。APK 内 JNI 库加载成功也不能证明 Node 的 `child_process` 能执行那里任意文件。反过来，该规则不等于“Android 禁止所有子进程”；若以后比较应用自有可执行文件路线，必须另验合法打包、启动、链接和进程管理，不能直接沿用 JNI 结论。

### C. 两个 APK 的规则分别适用

**推论：**经 Termux 自有组件执行的命令属于其应用环境；本应用启动的进程不会因路径中出现 Termux 或使用 IPC 就自动获得其 UID／target。跨应用访问仍需合法权限及接口。[2][7]

**重要限定：**“各自 target”不等于所有交互规则只看一方。Android 官方明确说明：一个应用用 `startForegroundService()` 启动另一应用的 Service 时，Android 12 的该项后台启动限制仅在**双方**均 target 31 或以上时适用。[11] 这不是对任意跨 APK 冷启动、权限或组件访问的全面豁免。具体官方 Termux 版本与调用路径仍须另验。

## 3. Service 与 WebView 进程分离

**平台事实：**Service 默认仍在应用默认进程；只有定义适当的 `android:process` 才会分离。以冒号开头的进程名建立应用私有进程。`android:isolatedProcess` 则是另一个概念，会使用没有自身权限的特殊隔离进程。[8]

**本轮判断：**Service 管理的应用私有运行进程与 WebView UI 进程分离，符合平台机制；但普通 Service、独立进程和前台 Service 是不同维度。前两者不会自动赋予后台长期执行资格。此处不选择进程名、IPC 或隔离权限模型，也不写 Manifest。

宿主必须在 UI 销毁／重建后保持明确状态；进程死亡后必须依据持久化状态恢复，而不是将“进程曾启动”当作任务仍在执行。用户可以通过系统任务管理器停止整个前台服务应用，系统不保证发出停止回调。[15] 因而分进程不是不死保证。

## 4. Android 16 上适用的前台 Service 边界

### 4.1 类型与 `specialUse` 的诚实用途

**事实：**target 34 或以上须声明适当 FGS 类型、`FOREGROUND_SERVICE` 和对应类型权限。`specialUse` 用于其他类型没有覆盖的**有效前台服务用途**；需声明 `FOREGROUND_SERVICE_SPECIAL_USE`，并在 Service 中用 `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE` 说明具体用途。若提交 Google Play，声明及用途接受审核。[9][10]

**条件判断：**用户明确启动、能感知且可停止的持续 Agent 会话，可以进一步评估是否满足 `specialUse`。说明必须描述实际任务、为何其他类型不适合、为何需要前台执行；不能只写“AI 常驻”“永不停止”或借类型逃避超时。平台文档没有保证本产品一定符合用途或通过商店审核。侧载也不消除操作系统规则。本文不选择发布渠道或生产 FGS 类型。

官方仅允许对用户可感知的工作使用 FGS。[14] 因此，正在执行任务与空闲等待未来任意工作的宿主，必须分别论证；不能仅凭运行时常驻需求统一认定为有效 FGS。

### 4.2 通知与启动

- **事实：**启动 Service 后须及时调用前台提升 API，并提供通知；通知优先级至少为 `PRIORITY_LOW`。[12]
- **事实：**Android 13 起，`POST_NOTIFICATIONS` 不是启动 FGS 的前提，但 FGS 仍必须提供通知。若用户拒绝通知权限，FGS 提示仍在系统 Task Manager 中出现，却不出现在通知抽屉。[13]
- **验收含义：**“有通知对象”不等于用户能看到通知抽屉通知。首次设置和就绪检查必须区分通知权限、通知渠道状态及实际可见性；不得声称 FGS 可以隐形运行。
- **事实：**target 31 或以上一般不能从后台启动本应用 FGS，只有规定例外；不满足时会抛出 `ForegroundServiceStartNotAllowedException`。从可见 Activity 的用户操作启动是优先验证路径。[11]
- **事实：**重启广播有条件例外，但部分类型受额外禁止；target 35 或以上的悬浮窗权限例外还要求存在可见悬浮窗。[9][11] 不能把定时器、恢复回调、UI 解绑或进程重启一概当作合法启动资格。
- **判断：**`specialUse` 的类型页写“无运行时前提”，不等于免除后台启动限制、通知、用户停止或系统资源管理。[10–15]

### 4.3 为什么不能用 `dataSync` 承诺无限运行

**事实：**`dataSync` 描述上传、下载、备份等数据传输相关工作。target 35 或以上的应用在后台运行此类 FGS，每 24 小时合计最多 6 小时，同类型所有 Service 共享额度；用户把应用带回前台会重置计时。超时触发 `Service.onTimeout(int, int)`，必须在数秒内停止，否则发生系统异常。额度耗尽后不能靠另开一个同类型 Service 规避。[10][18]

**事实：**target 35 或以上还不能从 `BOOT_COMPLETED` receiver 启动 `dataSync` FGS。[10]

**结论：**Agent 使用网络或有数据库同步，不足以把整个常驻宿主归类为 `dataSync`。它不是无限后台计算通行证。`specialUse` 没有被上述 6 小时规则列入，但“未列入该超时”不等于永久存活保证。[10][15][18]

### 4.4 Android 16 的新增作业影响

**事实：**Android 16 中，与 FGS 同时执行或由其启动的后台作业仍受各自作业运行配额限制；涉及 `JobScheduler`、`WorkManager`、`DownloadManager`，且这项变化不取决于 target。[9][19]

**推论：**不能声称“用 FGS 包住 WorkManager 就能无限运行”。这也不是给 Service 内所有代码新增统一的 6 小时上限；必须区分作业配额与特定 FGS 类型超时。

## 5. “首期只支持 Android 16”是什么意思

| 维度 | 可以表达的含义 | 不能据此推导的结论 |
| --- | --- | --- |
| 支持范围 | 首轮仅在用户 2 部 Android 16 手机上承诺经过验收的行为 | 所有 Android 16 机型、厂商后台行为或未来系统均已兼容 |
| `minSdk` | 如需安装层面排除旧系统，`minSdk = 36` 是可讨论的门槛；如保留较低值，需另行说明旧系统未支持／未验证 | Android 16-only 自动要求 `minSdk = 36`，或库的 `minSdk = 24` 自动要求本应用支持 Android 7；较低 minSdk 不能替代旧系统测试。[2][6] |
| 版本上限 | 支持矩阵可以先只承诺 Android 16 | `minSdk = 36` 表示“只允许 Android 16”；它也允许更高 API。`targetSdk` 不是版本上限，不应为了文字上的 only 机械加入 `maxSdk`。[2] |
| ABI | `arm64-v8a` 是手机验证候选；必须读取实际 ABI 并核对所有 SO | API 36 决定 CPU ABI、保证 32 位兼容或证明任意 Linux ARM64 二进制可用。[16] |
| 模拟器 | Javet 被查 Node workflow 同时构建 `x86_64`；可以单独评估 x86_64 验证构建 | x86_64 开发构建自动扩大生产设备支持承诺，或模拟器成功替代两部真机的后台及 JNI 验收。[6][16] |
| 未来平板 | 待确认计划设备准确型号、实际 OS、ABI、页面大小及 UI 行为后扩展验证 | “Xiaomi Pad 9”已经纳入已验证 Android 16／ARM64 集合 |

Android 16 并不决定设备使用 4 KB 还是 16 KB 页面。原生依赖须核对 ELF 与 APK 对齐，并在相应页面环境验证；仅设置 target 36 或更新构建工具不能修复不兼容的预编译 SO。[17]

平板还涉及 UI 独立验收：target 36 在最小宽度至少 600dp 的显示环境默认忽略方向、可调整大小与宽高比限制，官方列有例外及暂时退出机制。[20] 本文不据此决定布局策略或退出选项。

## 6. 仍然有条件的验收门槛

以下是后续获得实施及设备测试授权后的检查项，不是本轮已完成事项：

1. **交付物与宿主：**固定 Javet 交付物及校验信息；核对全部 ABI／SO、加载路径、实际 Node 创建、JNI 关闭重建及跨 UI 生命周期行为。分别检查 APK 安装、库加载和子进程执行，不能合并为一个“启动通过”。
2. **SDK：**在本应用运行进程中验证 Pi Durable / Pi AI `1.5.0` 的真实入口、模块加载、存储迁移、网络流、取消及恢复。本文不重新审计 SDK，也不以简单 JS 表达式通过替代这些验收。
3. **后台：**逐一验证可见界面启动、退后台、熄屏、UI 重建、宿主死亡、重启、用户停止及权限撤回。记录系统实际拒绝原因；不能把用户停止理解为允许立即自动复活。
4. **双 APK：**检查独立官方 Termux 的选定发行版本、权限、命令启动与回执；执行环境就绪与主 Agent 就绪必须分开。对双 APK 冷启动是否满足正常使用要求，目前没有设备证据。
5. **首次初始化体验：**未来交付必须提供有执行位置、顺序、预期结果和失败提示的完整可复制命令；并能检查权限、配置、连接、命令返回及主 Agent 状态。正常使用不得要求反复打开 Termux、粘贴命令或手动重启后台宿主。用户日常在本应用点击启动任务不等于重新初始化。
6. **支持范围：**分别记录两部手机的 API／固件、ABI、页面大小、通知和后台限制实况。x86_64 模拟器、未来平板及非 Android 16 系统必须有独立验收范围。

**未决项：**生产 target/minSdk、生产 ABI 集合、最终运行时及版本、FGS 类型和启停策略、重启后的合法恢复路径、发布渠道、设备设置要求及初始化命令。本文不伪造尚未确定包名、桥协议或交付物的安装命令；完整初始化配方仍是后续交付门槛，不是本研究的已完成产物。

## 7. 证据与操作边界

本轮仅用 HTTPS 读取 Android 官方文档、AOSP 官方说明及 Javet 固定源码；原始响应仅在内存处理。没有下载可执行交付物、安装软件、运行上游代码、访问设备或凭据，也没有使用共享浏览器。只写入本文。官方网页可变，访问日期见文首；固定源码事实不等于发布 AAR 或设备实测事实。

## 一手来源

1. Android 16 SDK 设置：https://developer.android.com/about/versions/16/setup-sdk
2. Android `<uses-sdk>`，最低／目标／最高 API 的含义：https://developer.android.com/guide/topics/manifest/uses-sdk-element
3. Android 10 可写主目录执行限制：https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission
4. Javet 固定源码，默认 Android 加载策略：https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/src/main/java/com/caoccao/javet/interop/loader/JavetLibLoadingListener.java
5. Javet 固定源码，`System.loadLibrary`／`System.load` 分支：https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/src/main/java/com/caoccao/javet/interop/loader/JavetLibLoader.java
6. Javet 固定源码：[Android Node workflow](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/.github/workflows/android_node_build.yml)、[Android library Gradle](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/android/javet-android/build.gradle.kts)、[Android 源码复制及补丁脚本](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/scripts/python/patch_android_build.py)（只读，未执行）。
7. AOSP 应用沙箱：https://source.android.com/docs/security/app-sandbox
8. Android `<service>` 的 process／isolatedProcess：https://developer.android.com/guide/topics/manifest/service-element
9. Android FGS 各版本变化：https://developer.android.com/develop/background-work/services/fgs/changes
10. Android FGS 类型、`specialUse` 及 `dataSync`：https://developer.android.com/develop/background-work/services/fgs/service-types
11. Android FGS 后台启动及跨应用限制：https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
12. Android FGS 启动与通知优先级：https://developer.android.com/develop/background-work/services/fgs/launch
13. Android 通知运行时权限：https://developer.android.com/develop/ui/views/notifications/notification-permission
14. Android FGS 可感知用途：https://developer.android.com/develop/background-work/services/fgs
15. Android 用户停止 FGS 应用：https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping
16. Android NDK ABI 与原生库打包：https://developer.android.com/ndk/guides/abis
17. Android 16 KB 页面兼容、ELF 与 APK 对齐：https://developer.android.com/guide/practices/page-sizes
18. Android FGS 超时：https://developer.android.com/develop/background-work/services/fgs/timeout
19. Android 16 全部应用行为变化：https://developer.android.com/about/versions/16/behavior-changes-all
20. Android 16 目标版本行为变化／大屏：https://developer.android.com/about/versions/16/behavior-changes-16
