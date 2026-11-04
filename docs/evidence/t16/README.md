# T16 保留、迁移与容量故障

实施分支 `codex/t16-retention` 基于 `27a580c`。本文件记录本票已完成的主机与独立 Android 验证，并保留未覆盖的 OEM、远程云、36.1 和硬故障边界。GitHub 的工单验收与最终集成仍由根代理记录。

## 已运行的主机证据

`runtime/test/retention.test.mjs` 通过真实 Pi Durable 1.5.0、Chord 1.5.0 和 Node SQLite 验证：

- 固定旧版 `app.configuration` 由 `Session.commit` / `defineDoc(version:1)` 写入。新类型读取只做内存迁移；故障事务后旧类型及原 entry 仍可读取；成功提交后旧类型被拒绝，新类型保留原模型及工作位置。
- 实际 `PRAGMA max_page_count` 容量限制导致 SDK 提交失败。首次观察到 SDK 的 `AggregateError("SQLite transaction failed and rollback failed")` 未分类；沿异常链及聚合子错误分类后返回 `STORAGE_CAPACITY`。原生发送意图仍可核验，停止后重开不复活，旧会话保留。
- 通过 SDK 公共 document API 保存更新版本的配置后，当前应用拒绝开放调度、返回可行动的版本不兼容状态；原新版字段仍由对应类型读取，模型请求数为零。

后续共享检查扩展为七项：另覆盖实际 compaction 与 fork 保留原 history、未访问的 future admission、未知应用记录阻止执行但兼容历史可读、损坏的当前版本配置不能被当作新安装。全部通过公共 SDK Interface，不直写 SDK 内部表。主机先运行 178/178；随后增加真实子进程 SIGKILL 的迁移提交前/提交后两项，独立运行 2/2，最终完整重跑 180/180（18.385 秒，`host-runtime-final-180.log`）。UI 最终 75/75（6.39 秒，`host-ui-final-75.log`）。

这些主机检查不证明 Android、掉电或厂商迁移行为。原生公开持有/维护的首轮 RED 为缺少 API 的编译失败，没有记成设备行为失败。

## Android 原始失败与修复范围

根代理在新空 API 36 / 4 KB 模拟器 `5584` 使用独立包 `dev.durableagent.retention` 执行，均为合成数据：

- candidate01：32 项中 31 通过、1 失败，10.923 秒。三个初始 retention 用例通过。跨 UID 撤权回归因外部 provider 仍针对主包而失败；专用 source fixture 加固定目标 allowlist 后，精确用例独立通过，未把不同批次拼成全绿。
- 迁移 RED01 在迁移断言前因 fixture 的 stop 字段错误失败；修正为公开 `actionId` / `expectedControlVersion` 后，RED02 到达目标断言：注入迁移中断却成功。原始两轮日志分别保留。
- 内容容量 RED01 在 `content.beforeWrite` 注入 ENOSPC 后仍得到 ready，预期 failed。修复后保留旧冻结表示，新的准备结果明确报告容量不足。
- candidate02：50 项中 49 通过、1 失败，6.401 秒。迁移 1 项及 retention 4 项全部通过。剩余旧 schema 回归期望版本 4、实际版本 6，属于测试预期更新；该断言已修正，后续完整批次单独报告。
- candidate04：3 个方法中 1 通过、2 失败，107.639 秒。实际 Android / Javet / SDK / SQLite 的七项共享政策全部通过。纯文本交接到达目标 RED：没有附件对象时，SDK 持有的固定输入仍可丢弃；随后增加固定 token 的独立持有表。原生桥只读用例两轮都在 control54 等待 future seed 时超时，尚未进入重开，不能算已证明桥的错误。起初误读行号为重开超时，现根据源行和冻结 APK 核对纠正：APK 的 validation fixture 新文件存在，但 `dist/application-bridge.js` 缺少入口函数。Gradle 只打包旧 dist 是两轮前置失败的直接原因。

构建已增加可增量的 runtime/UI 编译依赖：源文件、配置和 lockfile 是 inputs，dist 是 outputs，打包必须等待对应 npm build。保留原 generateExecutionSetup；后续冻结还逐字比较 APK 内的编译入口与本次 dist，不能只检查源码或 APK 文件时间。

candidate05 完整构建自动执行 runtime/UI 编译成功，APK 内 41 个编译 runtime 文件及 11 个 UI 文件逐字等于本次输出。紧接着只请求两项编译任务，均 `UP-TO-DATE`，证明未变更时可增量复用。原生六类完整 51/51 通过（7.614 秒），包含纯文本持有 GREEN 及旧版本断言回归。只读 RED03 此时才到达目标：seed 与完整重开成功，状态为 `failed / APP_FORMAT_UNSUPPORTED / domainOwned=false / nativeOwners=0`，断言要求保留只读宿主失败（11.734 秒）。随后 bridge 仅吞下已建立安全只读状态的启动拒绝，原生 gate 仅在该状态下继续把请求交给 Application；Application 仍拒绝全部运行及发送操作。

candidate06 使用相同测试 APK `A89A5356…81A5`，生产 APK `620BAB36…E861`，只读完整原生桥 GREEN 1/1（10.221 秒）：兼容历史与原 frozen digest 保留、发送被拒绝、新模型请求 0、只读域仍有唯一宿主，并可完整关闭。新生产改动仅限 bridge/Service 只读 gate，51 项原生存储代码未变，没有把它们改写成在 06 再次运行。包内 41 个编译文件/11 个 UI 文件与本次输出相同；根代理另独立核对全部 56 个 runtime 文件、11 个 UI 文件、153 个来源、固定依赖、16 KB 原生布局和 setup 材料。

页面 DOM 另出现实际 RED：原生草稿暂不可用时，安全的 SDK 只读历史列表仍禁用。修复后精确 app/controller 8 项通过；最新全量 UI 75/75、主机 runtime 180/180（包含两项 SIGKILL）通过。`frozen-artifacts.json` 保存候选 APK 身份，candidate03 未执行，没有合并进设备通过计数。

原生迁移注入位于 SQLiteOpenHelper 的真实迁移事务内，验证旧版本回滚、原草稿/冻结 digest/发送意图/停止屏障保留后再成功升级。它不等同于整机突然掉电。内容 ENOSPC 为真实平台错误类型的指定写入边界注入；SDK 容量测试另以真实 SQLite max_page_count 限制触发。

## 材料与来源盘点

| 权威/材料 | 当前安装布局 | 保留及备份边界 |
|---|---|---|
| SDK history、entries、submissions、tasks、documents；产品、项目、模型定义、接纳映射、位置绑定及执行索引 | CE `files/application` 中 SDK SQLite、WAL、SHM | 无应用 TTL/物理删除；包括未知执行、旧连接及 fork 祖先。排除 file/root 云与 D2D |
| 原生会话投影、草稿、准备、冻结输入、发送意图、停止事实、位置编辑屏障、内容持有与隔离记录 | CE `no_backup/input-v1/input.sqlite`、WAL、SHM | 保留未决/未知材料；冻结输入持有与 SDK 交接独立提交。no_backup 加显式全域排除 |
| 附件输入表示、临时转换文件及锁文件 | CE `no_backup/input-v1/{objects,staging,jobs}` | 来源 URI 不清理；仅无持有且版本未变的对象可隔离回收，运行 job 的临时文件仍持有 |
| 模型凭据密文 | CE `no_backup/credentials-v1` | AES-GCM 密文；Android Keystore 持有不可导出保护密钥。密钥缺失不造同名密钥假装恢复 |
| 受管执行配对与初始化记录 | CE `no_backup/execution-*` 下 pairing/bootstrap SQLite | 保留环境身份和核验关联；不因清理缓存删除 |
| 随包运行代码展开副本、WebView 缓存/界面暂态 | CE `files/application-bundles`、平台 cache 等 | 可重建，不作为接纳或执行证据；本票不增加不受控目录递归清理 |
| Termux 执行账本、原始输出、固定文件计划的 hash 暂存、用户工作区和原文件 | 独立 Termux UID 的执行目录（含 `file-capabilities/blobs`）/ 获授权文档提供者 | 本应用不删除/迁移其记录，也不能以本应用备份配置声称已控制其系统备份；未知文件效果持有的 chunk/blob 不作缓存回收 |
| 调试/故障/迁移测试数据 | 明确 run/namespace 的 CE 验证目录；另独立安装 | 合成标记；不混入生产真实凭据；同样受相应 APK 的备份规则约束 |

`allowBackup=false`、`fullBackupContent=false`、cloud/D2D 各九个域排除及 `PrivateDataBackupAgent` 的全通道 full-backup 拒绝共同约束生产路径。Agent 拒绝恢复内容写入，并留下 `unsupported-restore`，运行宿主检测后保持关闭；不会把任意恢复成功当成工作可执行。

Android 16 QPR2 / API 36.1 的 iOS cross-platform channel 需要实际配对的 bundle/team；本项目没有 iOS 配对目标，不能伪造匹配身份。无条件 `onFullBackup` 不依赖已知 transport flag；实际 36.1 导入/导出及任意 OEM 工具尚未验证。[官方 Auto Backup 文档](https://developer.android.com/identity/data/autobackup)。

## 独立 Android 验证边界

生产形状 APK 通过 `-PvalidationApplicationId=dev.durableagent.retention` 构建；主包默认仍为 `dev.durableagent.probe`。debug provider 的 manifest 与代码 authority 同时随安装身份变化，不会误用主验证应用的 provider。

`backup-fixture` 的两种 flavor 只包含合成标记，不连接模型/Termux：

- `rules` 设置 `allowBackup=true`，直接编译生产的同一份 exclusion XML；特意不使用生产的拒绝 Agent，以观察 XML 是否实际执行。
- `control` 设置 `allowBackup=true` 且允许域备份。只有实际恢复了正对照，才能将 rules 标记缺失解释为排除行为。
- `no_backup` 在两者中都应排除。file/root/database/sharedpref/external 与相应 DE 域分别报告，不用一个目录代表全部域。

全部备份实验仅由根代理在新空模拟器上执行，不能在已配真实凭据的主验证安装或已有 Termux 上启用全局备份/清数据。LocalTransport 仅证明本机 cloud-rule 通道；GMS D2D test mode 是单设备测试模式，不证明实际两部 OEM 设备迁移。厂商云、三星/小米迁移及未来通道仍需具备设备后的证据。[官方备份测试文档](https://developer.android.com/identity/data/testingbackup)。

已实际完成 LocalTransport 清除/恢复闭环：seed 与 backup 后两个 fixture 的 11 个合成域仍在；仅清除这两个新测试安装后，11 域全部不存在；显式 token 1 restore 两包后，control 的 CE/DE/external 共 9 域恢复，no_backup 和凭据形状标记未恢复，rules 的全部 11 域均未恢复。两个恢复断言通过。control 的 12,800 字节 tar 含 9 域标记；rules 与生产形状 retention 没有 archive。生产包报告 `Backup is not allowed`；rules 原始 preflight 为 `-1002`（transport rejected），没有改写成备份成功。正对照恢复及排除包无内容共同给出本地规则证据，不代表远程云或 OEM 迁移通过。

GMS D2D 首轮手动恢复未通过：initialize 返回 `-1000`；随后 control backup 成功且生成 D2D token，rules/retention preflight 拒绝。手动 `bmgr restore` 返回 `-1000`，control 恢复断言失败。此轮 rules 为空不能证明 D2D 恢复排除有效，原日志保留。

第二轮按官方单机 D2D 同签名重装的自动 restore 流程成功完成正负对照（`d2d-reinstall02/`）。两个 fixture 的 11 域写入同批唯一 nonce `1793769018305630600`，并逐域核验。initialize 仍返回 `-1000`，保留该失败；随后 control backup Success、rules 拒绝。仅卸载这两个合成 fixture，切回 cloud transport，重装同签名 APK：control 共 9 个 CE/DE/external 域全部匹配本批 nonce，no_backup/credential 不存在，恢复断言通过；rules 11 域全无，排除断言通过。系统设置已恢复 backup disabled / GMS cloud / 无 test mode 与 local test params。此结果限定为 GMS 单设备 D2D 测试模式，不代表两部 OEM 真机、整机复制或远程云验证。

进程终止、整机重启、突然掉电和介质故障是不同范围。当前主机测试及 SQLite FULL 配置不能声称所有硬故障零丢失。

## T16 验收对应

| 工单要求 | 实现与实际证据 | 边界 |
|---|---|---|
| 扫描后新增引用与原生/SDK 交接 | 原生 OS lease 下重新核验、提交 quarantine 后才 unlink；显式 token/object holds 在 SDK admission 前提交。NativeRetentionTest 的 late owner、隔离中断、附件和纯文本交接均在 51 项批次通过 | 不释放无法跨来源证明已结束的旧持有；可能多保留材料 |
| 正式历史、fork、输入、意图和控制事实不按时间删除 | SDK 没有应用 TTL/删除任务；实际 compaction + fork + SQLite 重开检查保留 entry；原生维护只按持有关系，迁移/维护后 stop 与意图仍在 | 不增加模拟“保留时钟”来代替现有无 TTL 的算法；没有无限容量承诺 |
| 仅回收可重建或已证明无引用的材料 | candidates 不是删除授权；每次 reclaim 再查原生草稿/frozen/显式持有。staging 必须无 durable job 且能获得任务 OS lease；不遍历 SDK/Termux/SAF/用户原件目录 | T10 未知文件效果、T11 未决停止事实均保留 |
| 原生、SDK、内容三处容量/写入失败 | 原生真实 max_page_count 及保存边界，SDK 真实 max_page_count，内容 ENOSPC；51 项原生与 7 项 Android SDK 政策通过，原数据与意图保留 | 内容 ENOSPC 是指定平台错误边界注入；不是让用户设备磁盘耗尽 |
| 旧版迁移、只读与提交差异 | Native v4 固定布局→v6 事务中断回滚/重试；固定 SDK config v1→v2 的纯迁移、失败提交及成功提交，稳定关联/意图/停止保留 | 原生旧布局为本应用表，SDK 样本全部通过公共 Session/defineDoc 写入 |
| 不兼容/损坏/更新记录保留并关闭执行 | 全 app.* 当前记录兼容目录在 Harness.open 前检查；未知 kind/version/策略关闭调度。安全产品目录与公开 entry 只读展示，candidate06 原生桥 GREEN | 不能安全核验目录时不提供只读视图 |
| 不因恢复重放旧意图或未知效果 | 保留 T07/T09 接纳与 DispatchGate/停止核验；容量故障先 stop 再重开检查不复活；未知 SDK 文档时模型请求为零 | 自动恢复后继归 T12，外部最终停止/文件事实归 T11/T10 |
| 凭据分类与不降级 | 51 项原生组合包含 CredentialVaultTest：缺 key、永久失效/暂不可用、AEAD 损坏、格式不兼容、原密文保留、真实 Keystore 与明文扫描 | 永久失效/暂不可用用外部 Cipher 故障边界；不破坏真实用户密钥 |
| 私有域盘点与云/D2D/其他通道规则 | 上表盘点全部已启用来源；production compiled XML 同 rules fixture，Agent 全 full-backup 拒绝及不支持恢复标记关闭运行 | 36.1 cross-platform 无配对 iOS 目标，实际该通道与 OEM 工具未验 |
| 独立安装实际备份/迁移 | LocalTransport 正负对照清除恢复；GMS 单设备 D2D 同签名重装、唯一 nonce 恢复对照；所有失败先例保留 | 仅合成新安装；不是远程云或双 OEM 真机证明 |
| 用户可见保留/缺失说明，无假删除功能 | “本机数据”区分当前安装/升级与卸载/清数据/丢机/换机；压缩不等于删除，不提供新归档/隐藏/安全擦除交互 | Termux/用户原文件/任意厂商工具明确在该备份规则控制之外 |
| 提交、秘密扫描与耐久范围记录 | 各 RED/GREEN 原日志、冻结 hash、包内编译比对；host SIGKILL 提交前后；凭据明文/合成标记 archive 检查 | T16 未做整机 reboot/硬掉电/OEM 迁移，不能拿进程测试代替 |
