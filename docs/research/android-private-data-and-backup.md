# Android 私有数据、凭据与系统备份约束

研究日期：2026-11-03。

**结论：API Key 是需要恢复原字符串的业务秘密，不应被称为“直接存在 Android Keystore 里的字符串”。可以让 Keystore 持有不可导出的加密密钥，在本应用私有存储保存 API Key 的密文。首次解锁后的可用性、每次使用密钥的认证要求、当前屏幕锁定限制和系统备份，是 4 个不同的问题。**[S1][S2][S3]

本文仅研究和提出候选政策，不选择加密算法、凭据库实现、SQLite 生产驱动、Room／DataStore 版本或备份机制；没有实现、安装、访问设备或测试恢复。

## 1. 项目依据与研究边界

已完整阅读 [首版需求](../requirements-v1.md) 和 [领域模型与持久化设计](../data-design.md)。本次按委托给定条件研究：Android 16+／ARM64，Kotlin 原生宿主，独立的应用自有 Agent 运行进程，WebView React UI，独立官方 Termux 执行工具；SDK／业务元数据按 SQLite 方向，文字草稿由原生侧保存，发送意图持久化。研究启动时部分文档标签尚未同步；Q19—Q26 已由用户确认，当前决定以 `data-design.md` 为准。本报告不把已定后端方向说成生产驱动已经确定。

继续保持以下边界：

- 本应用运行进程不是外部 Termux。凭据归本应用，不以 Termux 文件、命令参数或环境变量作为默认凭据交付渠道。
- SDK 历史、业务记录、原生草稿、发送意图和外部执行结果有不同权威。一个存储的事务不等于所有来源的共同事务。
- YOLO 表示不增加应用逐操作审批。Android 系统授权、系统身份认证、资源撤权与系统运行限制必须遵守；它们不由 YOLO 关闭。
- 所有网页／AOSP 文本均通过命令行 HTTPS 读取；未使用共享浏览器，未下载二进制，未运行上游代码，未使用真实凭据。AOSP 代码只作为文本检查。

## 2. Keystore 保存什么，不保存什么

### 2.1 “API Key”与“加密密钥”不是同一类对象

Android Keystore 管理用于加密、解密、签名等操作的加密密钥。密钥材料不能由应用导出；应用提交明文或密文，由系统执行获授权的密码操作。这不是一个任意字符串可写可读的秘密键值库。[S1]

因此，适合本项目讨论的结构是：

1. Keystore 保存保护 API Key 的加密密钥。
2. 本应用私有存储保存 API Key 密文及将来解密必需的格式／版本资料。
3. 模型请求需要鉴权时，由凭据所有者解密，按所选 Provider 接口提供原字符串。

以上是职责区分，不选择密码算法、数据格式、文件数量或库。将任意 Provider token 当作 `SecretKeyEntry` 导入，并不能使它变成可取回的原字符串保险箱；Keystore 的用途是受限密码操作，不是这种往返存取契约。[S1]

**安全边界：**不可导出的是保护密钥，不是解密后的 API Key。API Key 输入、解密、交给 Provider 时仍会出现在获授权进程的内存中。Keystore 文档明确说明，受侵害的应用进程仍可能使用其密钥；不能由此承诺运行时被攻陷也不会泄密。[S1]

项目已有“API Key／鉴权 headers 不进入可持久化请求选项”的约束继续有效；SDK generation／compaction 会保存这些选项。凭据密文受保护，不会自动清除请求选项、日志、异常、IPC 或 WebView 中的明文副本。建议只在明确的凭据接口传递秘密，普通设置／会话接口传引用或脱敏状态；具体传递方案待设计。

### 2.2 硬件保护与进程边界

- 是否实际由 TEE／StrongBox 保护，应检查实际生成密钥的 `KeyInfo.getSecurityLevel()`。不能因“Android 16、ARM64”便承诺 StrongBox 或所有密钥均硬件支持；StrongBox 的支持、资源与能力有限。[S1]
- AOSP 的应用 Keystore 命名空间结合调用 UID 与 alias 区分密钥。普通同 UID 的应用自有多进程不自动构成凭据安全隔离；“只有某个模块调用”首先是软件职责限制，不是独立 UID 的访问隔离。[S4]
- 若将来采用 `isolatedProcess` 或不同 UID，必须重新核验凭据接口和访问权限，不能沿用普通私有 Service 进程假设。外部 Termux 也不能仅凭知道 alias 访问本应用密钥。[S4]

## 3. 首次解锁、再次锁屏与后台请求

### 3.1 默认选择应在 CE 与 DE 之间说清楚

官方 Direct Boot 文档区分：[S2]

| 存储 | 开机后首次解锁之前 | 首次解锁之后再次锁屏 |
|---|---|---|
| Credential-encrypted storage（CE，默认凭据加密存储） | 不可用 | 仍可用；通常持续至重启 |
| Device-encrypted storage（DE，设备加密存储） | 可用 | 可用 |

这里“凭据加密”指 Android 用户凭据保护的文件存储，不指 Provider API Key，也不等于应用额外做过字段加密。官方要求将私人数据、密码和授权 token 留在 CE，不为便利而迁入 DE；DE 只用于确实需要 Direct Boot 的数据。[S2]

**可提交用户选择的保守方向：**SDK／业务数据、草稿、发送意图和凭据密文均按应用私有 CE 存放；手机重启后等待首次解锁，不为首版新增解锁前模型执行能力。这与需求的“首次解锁且系统允许运行后尝试继续”一致。应以 `UserManager.isUserUnlocked()` 等真实平台状态判断，不能保存一个永久的“已解锁”布尔值。[S2]

CE 已可用不代表进程被允许启动，也不保证网络、前台服务或厂商后台政策允许执行；本文不验证这些生命周期条件。

### 3.2 Keystore 的 2 个额外限制相互独立

`setUserAuthenticationRequired(true)` 要求符合指定类型／有效期的系统认证；`setUserAuthenticationParameters(timeout, type)` 可指定每次密码操作或认证后的有限有效期。未满足时，密码操作初始化可抛出 `UserNotAuthenticatedException`。[S3]

`setUnlockedDeviceRequired(true)` 要求**当前设备处于解锁状态**，其定义关联 `KeyguardManager.isDeviceLocked()`，不只是显示屏点亮。它与“最近做过强认证”不同，可以分别设置，也可同时设置。Android 16 上，受该限制的秘密密钥操作会被锁屏限制；公钥操作属于不同例外，不应用来推断 API Key 解密可用。[S3]

| 候选政策（尚未选择） | 后台模型调用影响 | 代价／限制 |
|---|---|---|
| CE；保护密钥不另要求用户认证，也不要求当前解锁 | 首次解锁后，再次锁屏不因这 2 个密钥条件阻止解密；仍须满足系统运行条件 | 换取后台连续性；当前获授权应用仍可使用密钥，不是每次锁屏都封锁凭据 |
| CE；保护密钥要求当前解锁 | 锁屏期间无法重新解密；相关请求需等待解锁 | 缩小锁屏期间使用密钥的窗口，但降低无人值守连续性 |
| CE；保护密钥要求最近认证或每次认证 | 认证有效期结束／缺少本次认证时等待用户；不能承诺无限期自动续跑 | 更强用户在场要求；可能需要系统交互，不适合被描述为无条件后台请求 |

注意：这些设置限制的是密钥操作，**不会自动撤销已解密到内存中的 API Key，也不会撤回已发送的模型请求**。如果产品选择“锁屏后不再发起模型请求”，还需单独定义调度门槛及明文存活规则；不能靠提前缓存明文，声称同时满足锁屏保护与无限后台使用。[S1][S3；工程推论]

官方列出的 `setUnlockedDeviceRequired` 在 Android 12—14 上的若干问题已于 Android 15 修复；本项目不据旧问题否定 Android 16 的 API，也不把该修复当作所有 OEM 行为已验收。[S3]

## 4. 密钥丢失、永久失效与恢复不兼容

需要分别建模“暂时不能使用”和“永久不能解密”：

- **暂时受限：**首次解锁前、当前锁定、缺少有效认证等；等待满足条件，不能立刻删除旧密文或当作首次配置。[S2][S3]
- **认证绑定密钥永久失效：**关闭安全锁屏、强制重置锁屏凭据可能使其永久失效；按特定认证配置，新录入生物特征／删除全部生物特征也会使密钥失效。是否允许生物特征变更取决于参数，不是所有密钥都会因所有普通 PIN 变更失效。接口可抛出 `KeyPermanentlyInvalidatedException`。[S3]
- **密钥丢失：**卸载的命名空间清理、清除应用数据、设备重置／更换、应用自身删除密钥等，必须作为不可继续使用旧密文的情境考虑。AOSP 文档说明卸载清理密钥命名空间；Android 16 源码的 `clearApplicationUserDataLIF()` 明确调用 `clearKeystoreData()`，后者清理应用 UID 的 Keystore 命名空间。[S4][S5]
- **只恢复密文：**Keystore 的不可导出属性及设备绑定不提供可移植解密密钥。文件备份恢复成功，不等于原密钥存在。AndroidX `EncryptedSharedPreferences` 文档明确警告：不应备份该加密文件，恢复时加密密钥可能已经不在。[S1][S6]

这里引用 `EncryptedSharedPreferences` 只是验证恢复风险；它已废弃，本文没有选择它。其废弃提示也不表示普通 `SharedPreferences` 自动具有字段加密。[S6][S12]

**可选的保守恢复政策：**密钥确定丢失／失效时，显示凭据不可用并要求重新配置 API Key；禁止静默改存明文、空 token 继续重试或换一个新保护密钥后谎称旧密文可解。无需因此删除会话历史或新草稿。API Key 重填后的 Provider／端点核验与原请求恢复由业务策略处理，不承诺模型零重复计费。

同名 alias 新建出来的密钥不是原密钥。密文损坏、版本不兼容和密钥缺失也不应全部被归类为“用户未填写”。跨设备凭据迁移需要另外选择可移植恢复机制，不随“使用 Keystore”自动获得。

## 5. Auto Backup 与设备迁移不是一个开关

### 5.1 默认行为会覆盖普通私有数据

Auto Backup 默认包括常见内部文件、数据库、SharedPreferences 和应用专属外部文件。私有目录、SQLite 或 DataStore 本身都不是“不会离机”的保证。DataStore 默认位于 `files/datastore/`，同样进入默认备份范围。[S7][S10]

官方云端 Auto Backup 每应用限额为 25 MB，只保留最新备份，实际运行受设备设置与调度条件影响；不应把它作为实时耐久确认或完整 Agent 恢复机制。恢复可以发生在安装之后、应用首次可供用户启动之前，不能假设新安装时一定没有旧数据。[S7]

### 5.2 Android 16／target 36 应按现代配置评估

- 使用 `android:dataExtractionRules` 指向的 `<data-extraction-rules>`，分别表达 `<cloud-backup>` 与 `<device-transfer>` 的包含／排除规则。[S7][S8]
- 不能只配置旧 `android:fullBackupContent` 就认为 D2D 受控。Android 12+ 新格式存在时，旧配置在这些系统上被忽略；旧系统兼容不是本项目首版门槛。[S8]
- 官方明确指出：部分厂商设备上，`android:allowBackup="false"` 会禁用云备份，却**不会禁用 D2D**。所以它不能被描述为“数据绝不离开设备”。[S7][S8]
- 某一模式没有规则，例如省略 `<device-transfer>`，不等于关闭该模式；默认仍包含可备份内容。规则应显式覆盖各通道，而非用缺省表示拒绝。[S7]
- `<include>` 会改变对应模式的默认包含集合，`<exclude>` 优先；文件、数据库、偏好、外部文件及 DE 对应域都要按实际布局盘点。不要假定只排除 `file` 域便覆盖所有数据库／偏好路径。[S7]
- `disableIfNoEncryptionCapabilities` 只对云备份条件生效；它不是 D2D 禁用开关，也不是将 Keystore 密钥迁移到新设备的能力。[S7]

`getNoBackupFilesDir()` 是持久私有文件的候选位置，不是缓存生命周期的同义词。Android 备份指南说明 no-backup／cache 目录不纳入其备份范围，即使尝试 include 也不包含；现代迁移缺省规则也排除这些目录。`Context` API 的文字较窄，直接描述远程自动备份，因此评估 D2D 时必须同时看备份指南。[S7][S9]

**不能保证所有 OEM 的迁移软件、厂商云或以后新增的通道都服从相同排除规则。**使用 no-backup 位置、显式云／D2D 排除与 `allowBackup=false` 可以构成待验证的保守防线，但不是本轮已经选定的机制，也不是绝对不可提取承诺。

查阅当日 Auto Backup 文档还列出 Android 16 QPR2／API 36.1 的 `<cross-platform-transfer>`。Android 16+ 不等于所有设备都是基础 36.0；未来升级时需要重新盘点转移通道。本项目没有 iOS 配套应用，本文不新增跨平台迁移需求，也不把 36.1 配置直接当作基础 API 36 已可用。[S7]

### 5.3 可以交给用户选择的数据政策

以下是保守候选，不是已接受的产品决定：

| 数据 | 候选政策 | 原因与代价 |
|---|---|---|
| API Key 密文与设备绑定资料 | 排除自动云备份与 D2D；密钥丢失／换机后重新填写 | 避免恢复无法解密的秘密；不提供无感凭据迁移 |
| SDK 运行状态、待确认发送意图、原生停止记录、执行核验记录 | 在没有一致恢复协议之前不自动迁移为可执行状态 | 旧快照可能重放已发请求、复活已停止工作；放弃系统自动搬迁恢复 |
| 历史、文字草稿、必要输入内容、业务元数据 | 首版可选择全部仅本地保存；也可另立一致的非执行数据恢复方案 | “不自动过期”只描述当前安装内的保留，不等于卸载、清除数据或坏机后可恢复 |
| 非敏感外观偏好 | 若用户需要，可单独讨论允许备份 | 必须与凭据、发送状态分开，不靠“全部私有文件”默认包含 |
| 外部 Termux 与授权原文件 | 本应用规则不被宣称为它们的统一备份控制 | 它们属于不同应用／资源域；恢复本应用记录不证明外部结果、文件授权或工具环境也恢复 |

即使只允许历史恢复，也应先验证引用、凭据状态、附件可用性与外部事实，再讨论执行恢复。旧发送意图不能因为文件恢复而直接被当作一个新的用户发送动作。

## 6. 原生草稿与发送意图：3 类存储的适用性

以下比较针对**本应用原生侧的记录**，不替换 SDK 的唯一写入所有者，也不决定 SDK 的 Android SQLite 驱动。

| 方向 | 官方能力 | 对本项目的判断（工程推论） |
|---|---|---|
| 原生 SQLite；可进一步比较 Room 封装 | `SQLiteDatabase` 提供事务；Room 封装 SQLite，提供查询验证与迁移支持。[S14][S16] | 多会话草稿、稳定提交身份、版本条件、状态迁移与关联查询更自然；是发送意图记录的优先比较方向，但不是已选驱动或 schema |
| Multi-process DataStore | 原子读改写；`updateData()` 在数据耐久写盘后完成，失败抛异常。跨进程读只返回已持久数据，写入串行，提供写后读一致性。[S10][S11] | 小规模草稿／小型整体状态可用；一个有限发送意图集合也可在同一对象内事务更新。不能说它没有事务或完全不能存发送意图 |
| SharedPreferences | 单批 Editor 修改有原子替换语义，但不支持跨进程；`apply()` 先改内存、异步写盘、不报告失败；`commit()` 同步写盘并返回结果。[S12][S13] | 不适合本项目跨进程耐久发送状态的权威库；也不宜以 `apply()` 返回或监听回调作为“草稿已耐久保存”的确认 |

### 6.1 DataStore 的边界

- 官方把 DataStore 定位于小数据集，不支持部分更新与引用完整性；大型／复杂数据建议比较 Room。草稿或意图集合增长时，整体对象更新、查询和迁移代价必须实际测量。[S10]
- 每个文件每个进程只能有一个 DataStore 实例；同一文件不可混用单进程与多进程实现。2 个进程都直接访问时，双方必须使用兼容的多进程配置；不能把普通 singleton 当作跨进程 singleton。[S10]
- `updateData()` 的事务只覆盖其数据存储操作，不会把其他 DataStore 文件、SDK SQLite、Keystore、模型网络请求和 Termux 副作用纳入一个共同事务。[S11；工程推论]
- 官方的损坏处理器示例可用默认值替换损坏文件；对未发送长文本或待确认发送意图，不应机械照抄“损坏就清空”。必须明确呈现失败，避免静默丢失不可重建记录。[S10；工程推论]
- 采用 DataStore 不等于已额外加密；其默认位置仍需备份排除策略。[S10]

### 6.2 SQLite 的边界

- 原生侧可以有独立记录所有者，经应用 Interface 接收 UI 保存／发送动作；“应用有 2 个进程”不强迫 2 个进程直接同时写同一物理库。具体 IPC 与所有者部署待设计。
- 在同一原生事务中记录发送意图、固定输入关联并按草稿版本条件处理旧草稿，是可比较的方向；若草稿和意图分处 DataStore 与 SQLite，则不能声称它们天然原子提交。
- `setTransactionSuccessful()` 只是标记成功，提交发生于事务结束；UI 耐久确认应建立在实际提交结果上，不能仅在入队或标记成功时发出。[S14]
- 原生 SQLite 外键约束默认并非自动强制；需要按连接配置。不能因“使用 SQL”就宣称引用完整性已实现。[S14]
- Android 文档明确说明，未指定 synchronous mode 时，平台可采用厂商指定且因设备而异的默认值。因此必须单独验收进程崩溃、系统重启和突然掉电的耐久边界，不把默认提交等同于所有硬故障下零丢失。[S15]
- Kotlin／Room 方案不自动证明 SDK Adapter 的 `STRICT`、JSON、行数与事务契约通过；本研究未选运行时数据库驱动或日志／同步参数。

### 6.3 SharedPreferences 不能靠旧跨进程标志补救

`MODE_MULTI_PROCESS` 已废弃；官方明确其行为不可靠，不能协调并发修改，不应使用。单进程 `commit()` 的同步返回也不会为它补上跨进程读改写隔离。不能把“Editor 一批修改原子”误写成“跨进程读取旧值再写新值的状态迁移原子”。[S9][S12][S13]

### 6.4 无论选哪种存储都必须保留的产品语义

这些来自项目需求，而非新审批机制：

1. 已保存草稿永不因恢复而自动发送；保存确认之前仍可能只有 UI／待写入状态。
2. 发送意图必须源于明确发送动作，固定会话、内容版本与稳定身份；重试不读取后来编辑的新草稿。
3. 迟到保存、清空或 SDK 确认不能覆盖新版本草稿。
4. 原生意图已提交不等于 SDK 已接纳；SDK 已接纳也不等于模型或 Termux 副作用恰好一次。
5. 原生记录与 SDK 接纳之间需要核验和幂等／去重协议，不靠跨库事务幻想消除间隙。
6. 用户停止／取消、凭据不可用及系统限制仍约束恢复；损坏处理和备份恢复不能偷偷重建一条可执行发送。

## 7. 已具备依据、可供用户选择的保守方向

可以现在询问政策，不必先实现保险箱：

- **可用时段：**采用 CE，重启后首次解锁才具备恢复私有数据的前提，不新增 Direct Boot 模型调用。
- **凭据保护：**接受“Keystore 保护加密密钥、私有存储保存 API Key 密文”，并接受明文仍短暂进入请求进程；具体算法与实现留后续。
- **认证取舍：**优先满足锁屏后台续跑，还是增加当前解锁／最近认证要求并明确等待状态；这是真实安全与可用性选择，不以 YOLO 代答。
- **丢失处理：**保护密钥失效／丢失后要求重新配置 Provider 凭据，不静默降级为明文，也不自动删除业务历史。
- **首版备份：**可选择私有执行数据与凭据不参加自动云／D2D 迁移，明确本地保留不构成备份；是否允许非执行历史或偏好恢复另问。
- **原生耐久记录：**发送意图优先比较原生 SQLite；小规模草稿可比较 Multi-process DataStore；不使用 SharedPreferences 作为跨进程投递状态权威。是否合库、通过 IPC 单写、采用哪个封装均未确定。

用户选择政策之后，仍需通过下一节验证，才能锁定具体参数和交付承诺。

## 8. 需要后续授权与目标设备验证的内容

本轮**没有执行**下列测试，也不授权现在操作真实手机或真实秘密。将来应使用独立测试数据与假 token，在小米 15／Galaxy S23 的实际 Android 16 ROM 上验证；破坏性测试需另行同意。

| 验证面 | 必须核验的问题 |
|---|---|
| 用户解锁生命周期 | 重启未解锁时不碰 CE；首次解锁后恢复；再次锁屏是否按所选政策等待；进程重启后状态是否一致 |
| Keystore 能力 | 实际密钥安全级别、硬件可用性、所选认证参数与锁屏方式、凭据读取延迟；不只检查设备型号 |
| 凭据异常 | 区分暂时不可用、永久失效、alias 缺失、密文损坏；在独立测试安装中核验清数据、卸载重装、认证设置变化 |
| 系统备份／OEM 迁移 | 云、D2D、目标 ROM 的厂商迁移入口是否带出假秘密、草稿、发送意图；缺失密钥时是否阻止错误恢复；升级后的新通道 |
| 原生存储 | 2 进程并发、进程被杀、保存未完成、低空间、异常写入、迁移与损坏；验证已确认内容及错误可见性 |
| 提交边界 | 原生提交前后、SDK 接纳前后中断；迟到确认、新草稿、取消／停止和旧备份恢复不能生成错误重发 |
| 数据泄漏 | 用合成标记检查 SDK 请求持久化、日志、错误、IPC、WebView 与 Termux 调用；不使用真实 API Key |
| 硬故障耐久性 | 日志／同步参数与实际存储行为；单纯杀应用不能替代断电／文件损坏耐久性证明 |

设备通过某次测试只能支持记录的系统构建、配置和通道，不构成所有 OEM、所有迁移工具或未来版本都遵从规则的承诺。

## 9. 一手资料与证据限制

以下网页查阅日期均为 2026-11-03；在线文档会更新，不将示例里的依赖版本自动采用为本项目版本。引用 AOSP `android-16.0.0_r1` 是固定源码事实，不是目标厂商 ROM 的运行报告。

- **[S1] Android Keystore system**：不可导出、应用进程中的密码操作、安全级别、认证与 StrongBox 边界。https://developer.android.com/privacy-and-security/keystore
- **[S2] Support Direct Boot mode**：CE／DE、首次解锁后再次锁屏、`isUserUnlocked()`、私人数据不得为便利迁入 DE。https://developer.android.com/privacy-and-security/direct-boot
- **[S3] KeyGenParameterSpec.Builder**：`setUserAuthenticationRequired`、`setUserAuthenticationParameters`、`setUnlockedDeviceRequired`、`setInvalidatedByBiometricEnrollment` 的各自限制与失效条件。https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder
- **[S4] AOSP Keystore**：APP domain、调用 UID、访问控制与卸载时的命名空间清理。https://source.android.com/docs/security/features/keystore
- **[S5] AOSP Android 16 清应用数据与 Keystore 清理**：`PackageManagerService.clearApplicationUserDataLIF()` 与 `AppDataHelper.clearKeystoreData()`。https://android.googlesource.com/platform/frameworks/base/+/android-16.0.0_r1/services/core/java/com/android/server/pm/PackageManagerService.java ；https://android.googlesource.com/platform/frameworks/base/+/android-16.0.0_r1/services/core/java/com/android/server/pm/AppDataHelper.java
- **[S6] EncryptedSharedPreferences API**：已废弃及恢复时密钥缺失警告；仅用于风险佐证，不作为实现推荐。https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences
- **[S7] Back up user data with Auto Backup**：默认范围、25 MB、恢复时机、no-backup、现代数据提取规则、D2D 与 36.1 新通道。https://developer.android.com/identity/data/autobackup
- **[S8] Android 12 behavior changes：Backup and restore**：厂商 D2D 对 `allowBackup=false` 的例外、新旧 XML 规则区别。https://developer.android.com/about/versions/12/behavior-changes-12#backup-restore
- **[S9] Context API**：`getNoBackupFilesDir()` 与废弃的 `MODE_MULTI_PROCESS`。https://developer.android.com/reference/android/content/Context
- **[S10] DataStore guide**：小数据集定位、多进程一致性、实例约束、损坏处理、默认备份位置。https://developer.android.com/topic/libraries/architecture/datastore
- **[S11] DataStore API**：`updateData()` 原子读改写、耐久写盘完成与异常语义。https://developer.android.com/reference/androidx/datastore/core/DataStore
- **[S12] SharedPreferences API**：不支持多进程、同步／异步及耐久限制。https://developer.android.com/reference/android/content/SharedPreferences
- **[S13] SharedPreferences.Editor API**：`apply()` 与 `commit()`、单批修改原子性和最后写入覆盖。https://developer.android.com/reference/android/content/SharedPreferences.Editor
- **[S14] SQLiteDatabase API**：事务结束／回滚和外键约束配置。https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase
- **[S15] SQLiteDatabase.OpenParams.Builder API**：`setSynchronousMode()` 及厂商指定默认值。https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase.OpenParams.Builder
- **[S16] Save data in a local database using Room**：SQLite 封装、SQL 验证和迁移；不据此选择 Room 版本。https://developer.android.com/training/data-storage/room

资料优先级：具体 API 契约与专门备份指南高于其他教程的示例片段。查阅时 DataStore 页面备份示例出现 `<device-to-device>`，但专门备份指南及 Android 12 行为文档的配置名称为 `<device-transfer>`；本文采用后者，不复制前者成为生产配置。[S7][S8][S10]

限制：未审计生产凭据实现、IPC、Provider 或所有泄漏通路；未访问 Google／厂商备份账户；未做目标设备、备份恢复、加密、数据库崩溃或突然断电实验。研究结论支持提出设计选项，不证明这些选项已经实现或被用户接受。
