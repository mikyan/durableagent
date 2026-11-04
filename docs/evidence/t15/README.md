# T15 Console 实施证据（阶段候选）

本分支以已接受的 b06bfc7 为基础。此目录记录实际测试及可见验收，不表示 GitHub #16 已通过最终 gate。T12/T13 接线及协调者的真实 MiMo 401、真实 Termux 文件差异联测仍待完成。冻结产物由根任务安排验证，不覆盖正在使用的设备或已有 Termux。

## 实现边界

正式 React 页面使用现有 Application Interface、原生草稿／发送意图、受管执行与原件收据。独立首页、聊天、会话列表、项目、工具、模型、扩展及设置使用共同导航。右上角加号直接创建默认会话；上下文、模型与 YOLO 同时展示。YOLO 只指应用逐项审批模式，缺失的系统授权及位置核验单列。

当前会话搜索只查询已经加载的历史，明确显示未加载页，按稳定消息 ID 定位；没有全局搜索。页面关闭只释放展示订阅。文件页消费 T10 的已知操作和 diff，不扫描任意命令的全部文件效果，不填入原型示例。

context.get 调用 SDK 的公开 Conversation.context() 与已解析模型。当前计数为已提交消息 UTF-8 字节数 / 3 的粗估，明确排除动态系统指令、工具定义、协议开销、未提交生成及草稿，不是累计用量或服务商精确 token 数。含图片时计数降级为不可用；模型配置上限单列。实际 SDK 集成测试覆盖这些边界。

相机入口由原生 ACTION_IMAGE_CAPTURE 可用性提供。每次使用新的私有 UUID JPEG 与临时 URI 授权，返回后沿既有原生选择／准备链路入稿；取消不把已确认草稿改成保存失败。通知 target 限于当前域精确 URI 与已有稳定 ID，启动和 onNewIntent 只选择，不创建或重发。页面选中偏好仍是普通 WebView 偏好，原生草稿是内容权威。

## 测试结果

| 层次 | 结果与范围 |
| --- | --- |
| UI | [24 文件、90/90](raw/t15-ui-suite03.log)；随后状态摘要保留已知事实的改动 [12/12 及类型检查](raw/t15-compact-status-green.log)。 |
| Runtime | 从 runtime 目录运行 [222/222](raw/t15-runtime-suite02.log)，真实 SDK/SQLite。 |
| Android | 安装的候选 13 [ConsoleApplicationTest 2/2](raw/t15-console-device04.log)：真实初始/更新 Intent、错误域及未知 ID 拒绝、独立草稿，以及受控相机取消。候选 14 只补短状态摘要及设置按钮间距，原生代码未改。 |
| 实际相机 | [系统 Camera2 拍照](raw/t15-camera-admitted.json)返回约 73 KB JPEG，原文字、1 个附件、0 条发送历史；[第二次系统返回取消](raw/t15-camera-cancel.json)保留同一草稿。验证模型只声明文字输入，因此图片明确显示 unsupported，未发送给 LLM。相机画面来自模拟器的合成场景。 |
| UI SIGKILL | [最后完整运行](raw/t15-selection-final03.json)：UI PID 26504 → 26643，Agent PID 26589 未变；最后选中会话与两份完整草稿、空历史都保持。 |
| T06 追踪 | 初始基线同样通过，临时文件名 [selection-red](raw/t15-selection-red.json)不代表 RED。保留 T06 原失败，原因仍未知，没有引入新的原生页面状态系统。 |

真实运行域的截图与公开 Interface 响应保存在 raw/。console 模式仅以明确标注的合成 HTTP 回复经过实际 SDK 和存储产生长正文；hang 模式控制模型传输等待。它们用于布局和执行隔离，不作为真实 MiMo、真实 Provider 写入或 OEM 后台恢复证据。

## 可见验收

| 场景 | 实际观察 |
| --- | --- |
| 412dp 手机 | 候选 14 的[首页](screenshots/phone-home.png)、[导航](screenshots/phone-navigation.png)、[浮条](screenshots/phone-floating-input.png)、[点击定位](screenshots/phone-input-located.png)及[关闭浮条](screenshots/phone-float-dismissed.png)，[实际步骤](raw/t15-phone-final.json)通过。 |
| 360dp 窄屏、真实 IME | [原始尺寸](screenshots/narrow-keyboard-running.png)中上下文、模型、YOLO、发送及停止可见，物理停止有效，后续草稿原文保持。 |
| 360dp + 150% 字体 + IME | [画面](screenshots/narrow-font150-keyboard.png)、[详情](screenshots/narrow-font150-details.png)、[关闭后](screenshots/narrow-font150-closed.png)，[完整步骤](raw/t15-narrow-final01.json)通过。短窗口输入框可内部滚动；发送状态明细可展开。正文不足 100 CSS px 时不覆盖一个浮条，正文恢复高度后仍按可见位置判定。 |
| 1280dp 平板窗口 | 默认[双侧展开](screenshots/tablet-expanded.png)，[两侧收起](screenshots/tablet-collapsed.png)及[重开](screenshots/tablet-reopened.png)都有物理交互和结果断言。 |
| 当前会话搜索 | [输入法下搜索](screenshots/tablet-search-ime.png)，[点击定位结果](screenshots/tablet-search-position.png)，[步骤](raw/t15-tablet-green02.json)通过。分页范围和前后会话切换另由公开 Interface 的 React 测试覆盖。 |
| 实际旋转 | 约 915 × 412 CSS px，侧栏可[滚到下方](screenshots/rotated-navigation-scroll.png)并[打开设置](screenshots/rotated-settings.png)，返回时拍照文字和附件保持；[步骤](raw/t15-rotation-green02.json)。 |
| UI 扩展 | 实际[挂载时间线](screenshots/timeline-mounted-running.png)，[关闭辅助区域后仍运行](screenshots/timeline-closed-running.png)，草稿保持，再明确停止；[步骤](raw/t15-auxiliary-live03.json)。时间线挂载卡片可见，数据组件在同一可滚动区域下方。 |
| 相机 | [返回后的原生 JPEG 选择](screenshots/camera-admitted.png)和[系统取消后的原草稿](screenshots/camera-cancelled.png)。 |

这是复用 API 36、4 KB 模拟器的真实 WebView 与窗口变化，并非购买/接入了一台物理平板。原有 SAF fixture 原件及未知收据均未重置。尚未完成真实文件差异及真实 401 的 T15 新外壳截图，不用空白文件面板替代它们。

## 保留的失败及修正

- [IME 原始失败](screenshots/red-keyboard-covered.png)：WebView 的 layout/visual viewport 都保持约 915 CSS px，键盘覆盖停止区，物理点按误入键盘。现在 Activity 用实际 IME WindowInsets 给 WebView 剩余测量高度；短窗口再收紧输入框、可展开状态区，保留明确状态。
- [大字体详情关闭按钮越界](screenshots/red-large-font-close.png)：详情改为 main 的独立子面板，限高并内部滚动，关闭栏保持可达。
- [平板重开按钮被系统栏遮挡](screenshots/red-auxiliary-reopen.png)：初次计划虽执行完点击，截图仍未重开，不计通过。补安全区域间距和实际重开断言。
- [短横屏侧栏下方入口不可达](screenshots/red-short-navigation.png)：整个侧栏可滚动，保留最小会话区。
- 状态摘要遇到刷新错误时曾覆盖已知的外部停止待核验状态；[RED](raw/t15-compact-status-red.log)后改为保留已知事实并追加“状态读取未确认”。
- UI 全量曾有 [2 项取消返回约定失败](raw/t15-ui-suite02.log)。保留 DraftCoordinator 的取消结果约定，由页面把取消视为正常操作；[26 项 focused](raw/t15-cancel-contract-green.log)和后续全量通过。不是删除旧断言。
- 独立预审复现附件选择期间编辑、等待自动保存后再取消，会使草稿一直停在待保存。实际 DraftCoordinator／ApplicationClient 的公开输入协议回归先 [RED](raw/t15-picker-cancel-edit-red01.log)，释放选择器写入等待后继续保存，随后 [GREEN](raw/t15-picker-cancel-edit-green01.log)。测试核对重新读取后的完整文字、原有取消返回约定及没有创建发送意图；完整 UI [91/91](raw/t15-picker-cancel-edit-suite01.log)和[类型检查／构建](raw/t15-picker-cancel-edit-build01.log)通过。[候选 15](CANDIDATE15.md)随后通过真实 Android 文档选择器／系统返回取消、保留 React 并发编辑注入和 UI SIGKILL 重开；[实际记录](raw/t15-picker-cancel-device03.json)、[系统选择器](screenshots/picker-cancel03-picker.png)、[重开后的已保存草稿](screenshots/picker-cancel03-reopened.png)及两个只读观察证明完整草稿和零意图／SDK 提交／任务／历史。此前两次驱动失败分别保留，不改写此前相机系统取消的范围，也不把背景编辑注入称为可物理键入被覆盖的窗口。
- SIGKILL 的[第一轮](raw/t15-selection-final-failed.json)未能重新启动 UI：[系统日志](raw/t15-selection-launch-race-system.log)显示死进程的旧 Activity 在启动请求后才移除。随后[重开同一原运行域](raw/t15-selection-recovered.json)确认最后选中页与完整草稿；新脚本等待当前任务的 Activity 记录清理再启动。第二轮等待误匹配系统保留的历史旋转来源，原[失败](raw/t15-selection-final02-failed.json)同样保留；最终仅匹配当前任务 Hist 记录。此问题不解释 T06 原失败。
- 初次 runtime 命令从仓库根目录执行产生 [5 个子夹具路径失败](raw/t15-runtime-suite01.log)，正确目录的结果才是 222/222。早期两次平板计划有并发驱动干扰，未计作验收；当前所列计划串行运行。

## 余下 gate

1. 合入根任务已接受的 T12/T13 后，接 NativeRecoveryBridge、通知权限/投递未确认状态和 Data Saver 面板，保持各自原生事实权威。
2. 根任务在其执行设备上验证新外壳的真实 MiMo 401 中文操作提示、真实受管原件 diff，并覆盖合并后跨功能流程。
3. 合并最新 integration、必要检查及独立 merger。GitHub 状态与远端发布由根任务处理。

## 固定产物

候选 14 的代码来源为 ce6ac2a；[构建、源码及 APK 摘要](ARTIFACTS.json)与[复现／真实联测说明](RUN.md)已固定。APK 不进入 Git。测试辅助与本目录证据另以文档提交追加，不改变安装包源码。

候选 15 的主 APK 为 b2bc5bd（包含 df31204），实际第三轮测试辅助为 9480a87；[固定摘要](ARTIFACTS-candidate15.json)和[边界／安全联测说明](CANDIDATE15.md)分开列明，生产包未因测试驱动修正而重建。
