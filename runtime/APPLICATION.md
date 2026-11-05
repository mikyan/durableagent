# T04 应用会话基础

本切片的公开入口是 `Application.request()` 与仅由宿主调用的 `start()/close()/disconnect()`。业务实现见 `src/application.ts`，数据协议与随包扩展描述见 `src/application-protocol.ts`。React 构建只导入数据协议；SDK、SQLite、Provider transport 与凭据留在运行进程。验收记录见 [T04 evidence](../docs/evidence/t04/README.md)。

## 数据与调度权威

`app.configuration` 是 session document，保存一次初始化的默认模型和稳定默认工作区记录；`app.product-conversations` 是产品登记 document。产品会话身份来自创建动作的 `creationId`，关联到 SDK conversation。标题、产品可见性和工作区引用由应用 document 保存，消息、模型引用和运行状态读取 SDK 权威。

`Harness.createConversation({agent, init})` 在一个 SDK 创建提交中写入 conversation、初始 AgentDoc 模型和产品登记。SDK 已经在调用 `init` 前暂存了新 conversation，因此发现同一 creationId 时必须抛出专用重复创建信号，使整次创建提交回滚，再在提交外读已有产品身份。不能只跳过登记。创建不隐含首次输入。内部 conversation 没有显式产品登记，故不会出现在产品列表。

一个 Application 使用一个已验收的 SqliteStorage/Session。Android 在打开 Node、迁移或 Harness 之前取得 T02 的 OS 文件锁；UI 绑定与该锁的生命期无关。两个产品会话共享 Storage，但各自读取自身 conversation 的历史与状态。验证数据使用独立的随机域，不清空用户数据。

启动先提供有效同步 Models/settings getter，再 Harness.open。测试实际记录 open 阶段调用 settings getter；该回调不访问未完成初始化的 Harness。随后装载并提交应用配置，发布 ready，最后 resume。SDK 的默认睡眠定时器只在调度启用后工作；不使用空 onWake 回调，也不复制 SDK 调度器。已到期的持久重试在配置门槛关闭时仍产生零模型请求，放行后才继续。

存储错误会使整个 Session 失败，应用动作门槛关闭，现有订阅收到失败状态；不自动重试写入或重建数据库。新版配置无法被旧代码读取时保留原数据并返回原因。正常关闭完成 SDK 与 DB 关闭、密钥审计后，原生才释放 Node 和 OS lease。

## 应用 Interface

所有请求包含 protocol、connectionId、requestId、method 和数据 payload。协议版本目前为 1。status 可在启动中读取；其余动作在配置未完成、宿主未就绪或存储失效时返回可识别错误。原生不接受任意 JS、SQL、文件或 SDK 方法。

| 动作 | 输入 | 结果 |
| --- | --- | --- |
| status / list | 无 | 启动状态及扩展身份／产品会话摘要 |
| create | creationId；可选 title | 同一产品身份及本宿主已观察的存储版本 |
| open | id | 当前完整展示快照 |
| history | id；可选 cursor、limit | 按时间顺序的一页消息及不透明下一页位置 |
| send | id、text、actionId | SDK input 接纳结果与 submissionId |
| stop | id、actionId | SDK abort 完成结果 |
| subscribe / unsubscribe | id、subscriptionId／subscriptionId | 初始快照及可取消的状态更新 |

create/send/stop 的成功结果来自 SDK 操作完成。`storedSeq` 是当前宿主实际收到的 stored publication 序号，未知时为 null，不伪造为 0。历史 entries 来自持久 SDK entries；流式 generation progress 单独标记 `persisted:false`，即使 SDK 可能已经保存其中某次部分进度，也不将该帧当成最终消息或耐久收据。

运行状态映射 SDK 的 live.run、generation.retry/deferred、runFailure 与已保存 assistant entries，区分 idle/running/waiting/failed/done/stopped。历史游标封装 SDK 不透明游标并绑定产品身份，防止跨会话误用；页内时间顺序与 live window 的顺序统一。

连接代次与每个订阅的单调 revision 防止旧页覆盖当前页。核心在首次 await 前记录挂载 token；disconnect、unsubscribe 和同名订阅替换会使未完成的挂载失效。迟到 watch 会停止，取消观察从不调用 abort。watch 终止失败也会通知界面，不让旧的 running 状态永久留在屏幕。

已保存消息超过 4,000 UTF-16 code units 时默认折叠为前 1,000 单元预览，并明确提供“展开完整消息／收起长消息”。预览避免截断代理对，并把控制字符标为可见符号；展开使用完整原文且独立滚动。完整历史仍在 controller 和 SDK 中，不将折叠结果写回存储。这样大历史重连无需一次布局数十万字符，仍能按需查看完整单条内容。

## Android 与传输边界

`AgentActivity` 从 `https://appassets.androidplatform.net/assets/ui/` 加载打包 React；只允许本地资产，禁用 file/content 访问和外部导航，页面 CSP 禁止网络。唯一 JS bridge 是 `DurableNative.postMessage`；原生回调为 `__durableReceive`。`ApplicationService` 在 `:agent` 进程持有一个 NodeI18n runtime，所有 JNI 操作归同一 HandlerThread。

原生 Messenger 对大请求及所有响应采用最多 48,000 UTF-16 code units 的分片，并逐片确认；每个 peer 最多一个尚未确认的出站分片。输入文本上限为 100,000 code units，包含 JSON 转义后的请求上限为 650,000。响应 envelope 上限为 8 Mi code units（16 MiB UTF-16）；每 peer 待发送队列最多 64 项／16 Mi code units。只合并尚未发送的 conversation 状态投影，动作回执不合并。超限或 30 秒确认超时会显示连接失败，保留存储原文，绝不静默截断。接收端也检查顺序、总量与期限。最后一个连接离开 peer 后会清理对应传输、计时器和订阅；仍有同 peer 连接时不误删共享传输。

界面进程或 WebView renderer 消失后不重发动作。renderer 退出时移除并销毁旧 WebView、返回已处理，并显示用户主动“重新打开”的原生入口；不自动循环重建，不关闭 Agent。正常 service 断连同样提示重连。WebView 调试仅在 debuggable APK 启用。

私有数据政策继续使用 allowBackup=false/fullBackupContent=false，并在 cloud-backup 与 device-transfer 两通道显式排除 root、file、database、sharedpref、external 及四个 device_* 域。各域根不同，单个 root 排除不能代替其余域；依据 [Android Auto Backup 文档](https://developer.android.com/identity/data/autobackup)及 [Android 16 固定 AOSP BackupAgent 源码](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-16.0.0_r1/core/java/android/app/backup/BackupAgent.java)。这是补齐已有私有数据政策的配置，不是 T16 的真实备份／迁移验收。

## 实现范围

普通启动没有模型 fixture、示例消息或诊断按钮。真实 Provider 配置由 T05 承接；未配置模型时动作返回 MODEL_UNAVAILABLE。debug instrumentation 可从原生 Intent 明确选择 fixture/hang/real 和随机验证域；页面无权选择模式。MiMo 验证沿用 T01/T02 的 AndroidKeyStore 加密 capsule，消费后删除；真实 Key 只在最终目标已检查的 fetch 中设置，不进入 SDK options、应用 document 或 DB。关闭前后都审计 DB/WAL/SHM。

这里的默认工作区是稳定记录，不在每次创建会话时新建目录；工具环境、项目位置绑定及草稿由后续票接入。T04 不声明 T07 的完整发送意图恢复、T11 的无响应 JS/外部命令停止、T12 的锁屏或进程死亡自动续跑，也不声明 T17 的完整设备矩阵。SDK input requestId 去重仍有其原生语义，不额外承诺同 ID 不同 payload 的完整冲突协议。

## 复现

```powershell
npm ci --ignore-scripts --prefix runtime
npm ci --ignore-scripts --prefix ui
npm test --prefix runtime
npm test --prefix ui
npm run build --prefix ui
# JAVA_HOME 指向 JDK17；ANDROID_HOME 指向 SDK36。
./android/gradlew.bat -p android :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
# 安装配对 APK 后，通过获授权的设备协调者执行：
adb -s DEVICE shell am instrument -w -r -e class dev.durableagent.probe.ApplicationTest dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

默认设备套件的 realProvider 用例显式跳过。先用验证公钥加密并提供 capsule，再加 `-e realProvider true`，可运行真实 MiMo 的两会话、两请求与零请求重开检查。测试凭据的安全提供步骤沿用 [T01 记录](../docs/evidence/t01/README.md)，禁止明文文件或命令行 Key。

另有真实 UI 进程重建脚本 `android/scripts/application-ui-process.mjs`。需要 Node 24、debug APK、可用 ADB 与设备操作授权；ADB 路径取 `ADB`、`ANDROID_HOME` 或 PATH。运行 `node android/scripts/application-ui-process.mjs DEVICE OUTPUT_PREFIX fixture`，或在安全提供 capsule 后将最后参数改为 `real`。脚本先停止本验证应用，再以随机专用数据域启动，通过 CDP 点击实际新建／发送控件，记录两个完成历史；随后只 SIGKILL UI PID，验证 Agent PID 不变，重新进入并核对两个会话的 message IDs／原文。无额外观察绑定，不读取原生内部业务接口，也不以进程未变冒充请求次数指标。输出 JSON 与截图；默认不记录 device serial。它不删除数据，不操作 Termux。
