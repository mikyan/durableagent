# T15 候选 15：取消选择后继续保存

主 APK 来源 `b2bc5bd3d941943e1415795da6a77400c6f8dd12`，包含 `df31204` 的待保存草稿修复；实际通过使用的测试 APK／外部驱动来源为 `9480a87212682458a2cd5ca702e5fa401ff2619a`，其间仅测试变化，生产代码无差异。以已接受 `b06bfc7` 为基础，未合入未接受的 T12/T13。固定 APK／源码摘要见 `ARTIFACTS-candidate15.json`；旧候选 14 和其设备证据保持原范围。

2026-11-04 实际第三轮完整通过，见 [设备记录](raw/t15-picker-cancel-device03.json)：UI PID 5486→5703，直到重新打开草稿时 Agent PID 5603 保持；之后开始原生观察 instrumentation 会按 Android 行为停止目标包，不能把后续观察的生命周期冒充原服务连续运行。原生只读观察 1/1（0.093 秒）、不打开 Harness 的 SDK 存储观察 1/1（0.582 秒）通过；草稿 revision 2、完整文字、零附件／发送意图／SDK 提交／任务／历史。没有使用重置后的进程计数宣称累计 HTTP 请求数。

## 实际文件选择器／进程死亡回归

根任务独占设备，并先关闭自己先前已无活动工作的验证宿主。只升级安装本候选主 APK 与测试 APK，保留应用数据。不执行 Termux 初始化、安装、替换或连接，不注入模型凭据。

从候选源码运行：`node tools/console-picker-cancel-process.mjs <明确设备序号> <新的绝对输出前缀>`。

驱动建立唯一 fixture 会话，不发送消息：先保存原草稿，再通过真实菜单打开 Android `ACTION_OPEN_DOCUMENT`。核对实际前台包是系统解析的文档选择器后，通过保留的 WebView 向 React 编辑框输入后续文字；这是受控并发编辑注入，不声称用户可在被完整遮挡的窗口内物理键入。等待真实 WebView 自动保存时间窗，确认选择器仍在前台、草稿待保存且原生仍为旧文字，然后按系统 Back 取消。

取消后必须在没有再次编辑、发送或手动保存的情况下确认原生新文字。接着只 SIGKILL 已核对的 UI PID，等待死亡 Activity 记录移除后重开同一域，要求新 UI PID、保留的 Agent PID、完整草稿及空历史。最后运行只读辅助用例 `ConsolePickerObservationTest#savedCancelledPickerDraftRemainsUnsentWithoutOpeningOwner` 核对原生草稿和零发送意图，再用既有 `FileNativeObservationTest#inspectRetainedSdkHistoryWithoutOpeningHarness` 核对完整范围的 SDK 提交／任务／历史为空。驱动记录选择器、保存后及重开后三张真实屏幕截图与 JSON／原生观察日志；失败也保留同一输出，不能覆盖或重跑原失败域。

辅助用例的显式参数为 `pickerRun`、`pickerConversation`；它不打开运行宿主，不自行创建测试数据或发起模型请求，不应单独拿随机参数启动。没有参数时跳过，不能把跳过视为设备通过。

首轮保留 [失败记录](raw/t15-picker-cancel-device01.json)：使用 `dumpsys window windows` 查不到 Android 16 的全局焦点，真实选择器虽已打开却未进入后续编辑；改为读取完整 `dumpsys window`。第二轮 [失败](raw/t15-picker-cancel-device02.json)已完成保存和 UI 强杀恢复，但原辅助测试错误要求 instrumentation 启动后仍是同一 Agent PID；[系统事件](raw/t15-picker-cancel-device02-instrumentation-process-events.log)明确记录因启动 instrumentation 而停止目标包。修正测试改为在此前证明同一 Agent，在此后只读持久事实；生产 APK没有改变。两次失败不重写为通过。

## 真实 MiMo 401：安全选择器与输入

2026-11-04 已用上述冻结主 APK 在保留数据的 Android 16 模拟器完成 [实际服务请求](raw/t15-real-auth02.json)。新的 `models` 隔离域 `4c3b2b42-895a-40e6-8cdf-d5b82600872a`、会话 `b38c520e-f0aa-43cb-ba1f-6942ebca5052` 只点击发送一次，MiMo 返回真实 `401 / Invalid API Key`；未使用用户 Key 或凭据胶囊。页面中文提示、原始失败原因、回到设置及原连接卡片的四张截图已逐张视觉检查，见 `screenshots/t15-real-auth02-*.png`。点击“检查模型与凭据”前后，公开 `input.listSends` 和 `history` 完全相同：一个已确认意图、一条持久用户消息；没有为了导航重发输入。`context.get` 为估算 19 tokens、模型上限 1048576，不代表成功生成或服务商精确计数。

可复现驱动为 `node tools/console-real-auth-failure.mjs <明确设备序号> <新的绝对输出前缀>`，调用者须先正常关闭自己已空闲的验证宿主。驱动只新建本应用 Activity 任务，不 force-stop 包、不重置数据；实际点击控件，通过 CDP 输入文字及选择下拉项，使用公开 Interface 观察持久结果。输出前缀不允许覆盖，失败也留存，不自动重复发送。

首轮 [记录](raw/t15-real-auth01.json) 在打开设置前失败，未建立连接、未输入凭据、未发送模型请求。复用 Activity 切换验证域时，新 WebView 的顶部安全边距为 0，菜单中心落入 Android 状态栏；[重新创建 Activity 后](raw/t15-domain-insets-after-recreate.json)恢复为 51px。第二轮使用全新的 Activity 才开始请求。这个 inset 问题未在此轮生产 APK 修复，不能把 401 通过视为其修复；[原截图](screenshots/t15-domain-insets-before.png)和前后 DOM 测量保留供恢复路径继续检查。

旧临时 `t05-real-invalid-credential.mjs` 含无条件 `am force-stop`，不要直接运行。根任务关闭自己旧验证宿主后，用新的 UUID 启动 `AgentActivity`，`validationMode=models`、`validationRun=<新 UUID>`。不使用用户真实 Key，不消费 RSA 胶囊，以下连接只存在于新隔离验证域。

1. 等 `[data-testid=application][data-status=ready]`。手机先打开 `button[aria-label="打开会话列表"]`，再点 `[data-testid=open-model-settings]`。
2. `[data-testid=connection-name]` 输入“真实服务鉴权失败验证”，点 `[data-testid=add-connection]`。读唯一 `[data-testid=connection-card]` 的 `data-connection-id`。当前表单默认协议为 MiMo 中国套餐；确认公开 `models.get` 中此连接的协议为 `mimo-cn`、端点为 `https://token-plan-cn.xiaomimimo.com/v1`。
3. `[data-testid=credential-input]` 输入明确无效的 `synthetic-invalid-mimo-device-validation-000`，点 `[data-testid=credential-save]`，等 `[data-testid=credential-status][data-state=configured]`。这只表示原生密文保存，不表示认证成功。
4. `[data-testid=default-model]` 选择 `JSON.stringify([connectionId,"mimo-v2.6-flash"])`，点 `[data-testid=default-model-apply]` 并等操作完成。点 `button[aria-label="返回会话"]`、`[data-testid=create-conversation]`，在 `[data-testid=message-input]` 输入“验证真实服务在无效凭据下给出明确错误。”；等草稿已保存后只点一次 `[data-testid=send-message]`。
5. 等 `[data-testid=conversation-status][data-phase=failed]`。`.failure-notice strong` 应有“鉴权失败”及 `401`，正文应有中文“模型服务拒绝了当前凭据”，`details` 保留原始失败原因；拍摄可见截图。若服务返回其他状态，保留事实，不伪造 401 或反复发送直到碰到预期。
6. 记录原会话的公开 `input.listSends` 与 `history`；点 `.failure-notice` 中“检查模型与凭据”按钮，确认进入相同连接设置、既有意图／历史不增加。输入框／截图／公开历史不得出现合成 Key 的原文。可用公开 `context.get`（`{id:conversationId}`）核验估算与模型上限，但失败请求不代表一次成功模型输出。

## 真实 Termux 文件差异

只在根任务已有的、已初始化且当前连接的执行环境运行：

`dev.durableagent.probe.FileApplicationTest#originalFilesRoundtripAndPinnedSdkContractsThroughActualTermux`

不加 `fileContractsOnly=true`（该参数跳过本次所需 roundtrip），不运行任何 setup。用例自己生成唯一 run，以实际 SDK 和受控模型选择器依次发送 `FILE_ROUNDTRIP`、`FILE_DEPENDENCY`、`EXEC_CONFORMANCE_SETUP` 及四个 `FILE_CONFORMANCE_<0..3>`。这些是实际 Termux 文件效果，不能称为真实 MiMo 请求。它只在专属 `.durableagent-t10-<run>`／`.durableagent-t09-<run>-conformance` 内工作，不重置 Provider 原件。

首个 `fileEvidence` 的 `case=original-roundtrip` 记录 run、conversationId 和原件 diff。该冻结测试已改为真实外壳入口“会话详情 → 文件变更与执行 → 查看文件变更”，要求 `.file-changes` 含 `+真实修改-after`。另从可见面板抓取截图并查看，否则 DOM 通过仍不等于视觉通过；测试结束后可在同一完成域只打开记录和面板，不重发旧输入。随后用例核验宿主重开零新模型请求。

## 仍未完成

实际 diff 可见截图、已接受 T12/T13 接线、上述 WebView inset 恢复检查和最终独立合并门槛仍由根任务安排。本候选不是整票完成，不改写旧设备通过范围或 OEM 缺口。5584 保留数据冷启动后完成选择器与真实 401 两轮验证；结束时尺寸／密度无 override，字体 1.0、自动旋转 1、user_rotation 0、show_ime_with_hard_keyboard 0、stay_awake 7，见 [401 后恢复记录](raw/t15-auth02-restored.json)。当前停在该 401 域的 input-only 页面，自己的空闲 ApplicationService 已正常停止，模拟器保留运行与全部数据。
