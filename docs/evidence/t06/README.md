# T06：原生草稿与固定附件输入

本票实现编辑、原生确认保存、恢复、来源核验、本地准备与固定输入。实现契约见 [INPUTS.md](../../../runtime/INPUTS.md)，重现命令见 [Android 说明](../../../android/README.md)，独立跨 UID 来源见 [夹具说明](../../../android/fixtures/input-source/README.md)。原生发送意图与 SDK 接纳映射仍由 T07 完成，本票不宣称两个 SQLite 域之间原子提交。

## 版本、支持与设备范围

Pi 四个包固定 1.5.0；Javet Node Android i18n 6.0.3 / Node 26.13.0，SDK Storage 使用 Node SQLite 3.54.0。草稿采用 Android 平台 SQLite，实测模拟器 3.44.3、S23 3.44.5，独立于 SDK Storage。两者分别持有自己的域，Kotlin 不写 SDK 私有表。

支持 PNG/JPEG 完整画面与 text/plain、text/markdown 的完整 UTF-8 正文（含 BOM）。明确的应用预算为草稿 100,000 个 UTF-16 code units、4 个附件、文本 256 KiB、图片原件 16 MiB/24×1024² 像素、输出边长 1024/1.5 MiB、当前图片 base64 总计 8 MiB、完整 Provider JSON 10 MiB；已知模型更严限制优先。编码前还有独立的原始 transcript 保守预算与 128 层上限。这些是代理收敛的工程政策，不是硬件或 MiMo 的最大能力，也没有实现 PDF/Office/OCR。

设备为 Galaxy S23（Android 16/API 36、ARM64、4 KB）及 API 36 x86_64 的 16 KB 模拟器。S23 在首次解锁后再次锁屏，可验证原生存储、DOM、IPC 与云端请求；不能据此声称物理解锁后的可见 UI 或 Activity RESUMED/recreate 验收。模拟器承担可见 UI、系统选择器和 Activity 重建；后续 T17 仍需真实解锁设备的完整体验验收。

最终组合候选（源码与产物冻结后由独立设备协调者运行）：

| 产物 | SHA-256 |
| --- | --- |
| app-debug.apk | `7bcc427860b851fbbc80c9d671fad207d58e06940884a727902bb848f7328af2` |
| app-debug-androidTest.apk | `d0e5f1d86138d7f5a6d948807f32fd0142ae7051687c9e0559fa71fddb93c93d` |
| 独立来源夹具第二版 | `eb1957cf4c25212bc311055ec700425d27ea6448e2e9f1baf44d1bd0c112ca1e` |

## 验证层次

- 桌面运行核心：[102/102](t06-runtime-frozen-tests.log)，包含 5 个同源输入策略用例、此前模型/恢复/存储的公共边界回归。真实 SDK 与 SQLite；受控模型传输不冒充云端识别。
- React UI：`npm test --prefix ui` 38/38，12 个文件，3.11 秒；typecheck 与 Vite 构建通过。真实 client/controller/React，部分跨到真实 Application/SDK/SQLite；原生平台在桌面由明确的 InputPlatform 夹具代替，设备验证另列。确定性时钟覆盖 250 ms/1 s、切换/发送 flush、在途 coalescing、丢 ACK、CAS/ABA、失败可见及慢准备观察。
- Android 最终统一结果：[模拟器](t06-emu16k-full-final.log) 26 项实际通过＋1 项明确跳过手动 picker（runner 显示 OK 27），50.534 秒；[S23](t06-s23-full-final.log) 所选 25/25、无跳过，28.390 秒。两台均含原生 20 项、六个真实 kill 窗口、实际 Android Node/SQLite 的同源策略 5 项以及两种真实云端挑战；S23 不运行需要 RESUMED 的 Activity recreate 和手动 picker。
- [独立产物检查](t06-final-apk-inspection.json)：23 个运行核心条目与 6 个 UI 资源逐字匹配冻结源码；四个 Pi 包均 1.5.0；两 ABI 的原生库与固定官方 i18n AAR 字节一致，ZIP/ELF 16 KiB 对齐，官方 zipalign 通过。`lintDebug` 15 秒通过，0 errors/7 warnings：3 个已固定依赖有新版、2 个 bundled WebView 开启 JS、1 个 debug fixture receiver、1 个尚待 T15 的图标；未为消除警告改动已测候选。
- 最终 [实际系统选择器](t06-emu16k-system-picker-final.log) 1/1、23.853 秒：实际 React 选择文件→系统 picker→独立 UID 的 fixture-note.txt，自动核验/准备至 ready，固定全文 38 字节与原件 SHA-256 一致，persisted read grants=1，模型请求 0。此路径没有 ActivityMonitor 拦截。
- 最终 [S23 UI PID 终止恢复](t06-s23-ui-process-final.json)：UI 29149→29330，原生 host 29263 保持，两份完整草稿均 saved、提交历史为空，无额外 observer binding。S23 截图因 keyguard/超时不可用，不作可见 UI 验收。
- 模拟器最终 UI 进程脚本曾因额外的“必须选中最后一页”断言失败；同一原 run 的两份草稿随后均完整恢复，详情如下。修订后的 [同 APK 完整脚本](t06-emu16k-ui-process-final-scoped-v2.json) 再次通过：UI 11909→12049，host 11999 保持，两条不同会话的完整正文/saved/空历史均验证；lastSelectedRestored=false 如实记录。[实际恢复界面](t06-emu16k-ui-process-final-scoped-v2-after.png) 可见第二份完整草稿及“草稿已保存”。

## 最终候选的真实输入链路

| 实际结果 | 16 KB 模拟器 | ARM64 S23 |
| --- | --- | --- |
| PNG 随机图内挑战→模型回复 | Q7AH→Q7AH | 2XZZ→2XZZ |
| UTF-8 随机正文挑战→模型回复 | NTLHWBL5→NTLHWBL5 | HL7ALG82→HL7ALG82 |
| PNG 固定/请求图片字节 | 8,095，SHA-256 一致 | 7,697，SHA-256 一致 |
| UTF-8 固定/实际序列化 text part | 77 字节，含 BOM/中文/emoji/LF，SHA-256 一致 | 同左 |
| 准备之前至显式发送前请求数 | 0 | 0 |
| 每个挑战的显式请求/重开后额外请求 | 1/0 | 1/0 |
| 两来源线程 held，三次选择提交＋文字 revision4 | 全部回执 195 ms | 全部回执 132 ms |
| 真正 Node busy loop 内原生保存 | ACK 时 busyEnded=0；观测距 loop 起点 1,103 ms | 同条件，1,052 ms |
| input-only 页面恢复/保存 | nativeOwners=0、modelRequests=0 | nativeOwners=0、modelRequests=0 |

随机答案只在图像/文件正文中，普通 prompt 和通用文件名均不含答案。先 select/prepare/freeze，再将原来源改成不同内容，随后才显式发送旧 token；没有用新原件替代固定版本。模型答案、固定表示 hash 与实际 SDK 编码后请求字节三者均验证。文本分支复用已加密保存的同一连接凭据，不创建额外明文文件。每个分支后真实关闭并新建宿主，最终两份完整历史均保持，模型请求不重放。

上述 busy 时差是从 loop 起点到观测 ACK 的总时间，包含页面输入/IPC/测试观测，并非单独 SQLite 提交延迟；250 ms/1 s 的发起保存政策由确定性 UI 用例核验。图片/文本挑战通过真实 MiMo 中国 Token Plan `mimo-v2.6-flash`，并未推断其他模型或服务也通过。

模拟器 [原 UI 终止脚本失败](t06-emu16k-ui-process-final-failed.json) 发生在额外的 selectedConversation 必须等于第二会话的断言：重开默认选中第一会话。协调者未新建 run、未编辑或发送，而是 [读取原失败 run 的两份草稿](t06-emu16k-ui-process-final-recovered.json)，完整文字、saved、空历史全部保持。原因尚未确证；T06 承诺草稿耐久，不承诺强杀后最后选中页面偏好的耐久性。此体验限制保留给 T15，没有将原失败改成成功。可移植脚本现将 lastSelectedRestored 记录为观察值，仍强制断言新 UI PID、同一 host、逐份完整正文/saved/空历史；产品 APK 没有改变。

修订脚本的新验证域还出现过 [首个创建等待超时](t06-emu16k-ui-process-final-scoped-failed.json)。协调者只读公开 list/input.list，确认该新域实际已创建一条会话、编辑器 enabled、text 为空且 saved；其 ID 恰好等于上一域遗留的全局 UI selected/pendingCreation 身份。脚本错误地把跨 validationRun 的旧偏好当成本次已经观察的会话 ID。修订后仅与本 run 前一条已观察 ID 比较，仍要求两条不同 ID，不清偏好或数据，也不改产品的稳定创建身份。这个验证域夹具问题不当作草稿保存失败，旧失败仍保留。

## 秘密与私有数据审计

真实私有 Key 仅由设备协调者在内存中取用，经现有密文胶囊与原生 vault；没有进入本目录或本票源码。最终 [S23 字节审计](t06-s23-final-byte-audit.json) 扫描 40,953,344 字节应用数据及 327,615 字节应用 UID 日志；[模拟器审计](t06-emu16k-final-byte-audit.json) 为 38,833,152 与 471,129 字节。两台 UTF-8/UTF-16LE/UTF-16BE 原始字节在任意偏移均无精确 Key，偏移 0/1 阳性对照通过。传输使用 base64 并检查 tar 完整尾部，排除不可变运行时包；不声称扫描堆内存或闪存残留。

## 实际故障与修正

1. 初始平台 SQLite 的 `execSQL(PRAGMA synchronous=FULL)` 只影响一个连接；[模拟器初测](t06-emu16k-native-first.log) 3/3 失败，读回 WAL/1/FK1；[S23 初测](t06-s23-native-first.log) 3/3 通过。改用 `execPerConnectionSQL` 覆盖当前与未来连接，严格读回 pool 与实际写事务 WAL/FULL2/FK1：[模拟器第二轮](t06-emu16k-native-second.log) 8/8、1.177 秒；[S23](t06-s23-native-second.log) 8/8、0.786 秒。没有将 NORMAL 放宽为可接受值，也没有归因为 16 KB 页。此 API 的连接范围见 [Android 官方说明](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase#execPerConnectionSQL(java.lang.String,%20java.lang.Object[]))。
2. 最终准备提交与失败状态提交均故障时，仅检查 PID 活着会让同进程任务永久 preparing。[两台 RED](t06-emu16k-native-recovery-red.log) 中该项失败；同轮 selection receipt 用例本就通过，不伪称也是 RED。改成发布 job 前取得的每任务 OS lease，覆盖排队与执行；释放后 inspect 能恢复失败。后续同进程回归通过。
3. 第三轮并非全绿：[模拟器](t06-emu16k-native-third.log) 16/18、[S23](t06-s23-native-third.log) 17/18。六个真实独立原生 PID 中断窗口均通过；剩余为模拟器 quota 配置未约束写连接，以及跨 UID 来源授权夹具失败。专用测试将 max_page_count 同样配置至每个连接，实际触发 SQLite 容量错误并保留先前提交。第四轮定点日志仍包含来源失败：[模拟器](t06-emu16k-native-fourth-targeted.log)、[S23](t06-s23-native-fourth-targeted.log)，不拼成整套成功。
4. 独立来源夹具看不见目标 package，targetUid 解析失败，所谓 grant 并未产生可读权限。仅给独立夹具增加固定目标的精确 package query 后，原测试不变即通过：[模拟器](t06-emu16k-native-fourth-external-fixed.log) 0.382 秒、[S23](t06-s23-native-fourth-external-fixed.log) 0.300 秒。断言是实际 SecurityException→OS grant/完整 38 字节读取→revoke→SecurityException，而非任意异常都算拒绝；已固定材料重开后仍保持原字节。此 direct grant 结果不代替系统选择器。
5. 选择来源的 metadata 调用也可阻塞。[模拟器](t06-emu16k-native-selection-red.log)、[S23](t06-s23-native-selection-red.log) 在 held metadata 时等待 COMMIT 回执失败。所有 provider/grant/metadata/content 调用移到初始“来源未知、准备中”提交之后，同一用例 [模拟器](t06-emu16k-native-selection-green.log) 1.535 秒、[S23](t06-s23-native-selection-green.log) 1.436 秒通过；另一个 store 同时保存的新文字保留。
6. 单纯早回执仍不能解决来源池饱和：两个已提交任务占满两线程时，第三个选择也不能排到来源池后才提交。[有效 RED](t06-emu16k-source-pool-red-matched.log) 明确记录前两次 ACK/revision1、2/metadata entered，然后 select-2 回执超时。改为独立短写执行器 admitSource，取得已提交回执后再排来源续作业；lease 跨越排队、取消和执行。更早的 [labelled 失败](t06-emu16k-source-pool-red-labeled.log) 是 ActivityMonitor 漏匹配 category/MIME，实际打开系统选择器、停在 select-0，未到目标边界，不当作此问题的 RED。
7. UI 原先只在 prepare 返回后才观察状态；现于请求时明确显示“等待回执”，独立 inspect 已提交进展，超时不假定失败或完成，并保留有界自动观察及手动刷新。初始 selection preparing 回执释放文字保存，核验成 selected 后只对该新选择自动准备；移除后的旧任务不重新挂回。
8. select 的任务回执可能携带并发提交的新文字。真实 DraftCoordinator 回归先捕获旧文字仍标 saved，再修复无新本地 edit 时采用回执全文；有新 edit 时仍保护本地输入。TextDecoder 默认移除 UTF-8 BOM 的回归也先失败，改为严格解码同时保留 BOM，完整字节不变。

第一完整候选 [模拟器](t06-emu16k-full-first.log) 是 4 项实际通过＋1 项明确跳过选择器，30.445 秒；[S23](t06-s23-full-first.log) 所选 3/3、20.53 秒。真实 busy loop 内原生保存 ACK 分别在 539/1307 ms，busyEnded 仍为 0；input-only 0 native owners/0 model requests。真实图片挑战分别 TWML/23AP 被正确读取、固定对象与实际请求图片 hash 一致、原件改写后仍用旧版本、显式请求各一次、重开零请求。这些是旧候选分层证据，不替代最终结果。旧候选另有 [实际系统选择器](t06-emu16k-system-picker-first.log) 1/1、31.365 秒：选择外部 UID 根目录和 fixture-note.txt，完整 38 字节、read grant、0 请求；日志中早期等待提示曾指向本包根目录，以实际选取及 hash 为准。

## 工单逐项映射

| # | 可观察验证入口 | 范围 |
| --- | --- | --- |
| 1 | twoDraftsRestoreAfterActivityRecreationAndFreshHostWithoutSend；UI-process 脚本 | 两份已确认 Unicode 草稿、重建/进程终止/重开、无发送 |
| 2 | nativeDraftsSaveThroughRealUiWhileNodeBusyAndNotStarted；原生固定/GC 用例 | 真正 JS busy loop 与无 Node 页面；草稿库和必要材料不依赖 SDK |
| 3 | UI drafts/controller 公共边界；真实 busy ACK | 250 ms/1 s 是发起保存政策；COMMIT 后才 saved，不保证每次按键零丢失 |
| 4 | duplicateOperationReplaysItsReceiptAndStaleCallbacksCannotReplaceNewerDrafts；UI epoch/冲突/并发回执用例 | revision 条件写、操作身份、清空不归零、旧回执不能覆盖新编辑 |
| 5 | actualSystemPickerImportsSyntheticText；真实图片/文本挑战 | 实际 picker 与准备范围；默认准备 0 模型请求 |
| 6 | sourceLoss、changedSource、realCrossUidGrantRevocation 用例 | 实际打开核验、删除/变更/拒绝访问；固定字节仍可恢复 |
| 7 | preparedTextFreezePinsExactBytesAfterSourceChangesAndDraftIsCleared；真实云端两挑战 | 固定 hash/bytes 与原件更新隔离，明确新选择才新版本 |
| 8 | metadata/source pool held 用例；同进程 orphan recovery；UI prepare timeout | durable preparing 与临时请求状态分开，未准备不能 freeze/接纳 |
| 9 | 原生图像/文本预算；共享 input policy 5 项 | 原件、解码、输出、base64、历史与最终请求分别限制；拒绝发生在凭据解密/transport 前 |
| 10 | 原生 pins/clear/gc/discard；真实进程中断恢复 | 必要内容不放可清缓存，GC 只删除证明无引用的应用对象，不删用户原件 |
| 11 | realSqliteQuotaFailure；NativeInputCrashTest 两方法六窗口 | 专用真实 SQLite FULL，真实独立 PID kill；不冒充硬断电/闪存取证 |
| 12 | inputFilesAreCeNoBackupAndBothBackupModesExcludeEveryPrivateDomain | CE/no_backup，九域×cloud/transfer 排除；真实 OEM 迁移留 T16 |

## 限制与保留边界

本地双遍 hash 可检测观察到的来源变化，不对任意外部 provider 承诺原子快照；固定成功后，后续使用私有不可变对象。外部 provider 的取消是合作式，不能保证恶意或永久阻塞的 metadata 调用立即返回；有界来源池与独立 admission/save/inspect 保持草稿提交可用。未完成任务在释放/进程死亡后通过 lease 恢复，不把 PID 存活等同任务仍执行。

保存、材料、SDK Storage 没有虚假的跨库事务。发送结果未知时保留输入与 pin，不自动重发；T07 将完善 durable intent、接纳映射与持有交接。桌面策略、模拟器平台、S23 锁屏 DOM 与真实云端结果各自列明，不互相替代。
