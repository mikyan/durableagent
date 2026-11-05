# T15 候选 16：原生安全边界与省流入口整合

生产源码 `c44d8ceeae3c2bf740891d09f1a4f95ee2dcc2d2`；先以 `cc1b7ec` 修复原生边距与短横屏键盘布局，再合入已接受的 T13 `a0b161c`。未合入尚未接受的 T12。主 APK、测试 APK 与源码冻结于 `D:\durableagent-validation\t15-console-candidate16-c44d8ce`，摘要见 [ARTIFACTS-candidate16.json](ARTIFACTS-candidate16.json)。候选 14/15 的照片、选择器取消、进程恢复及真实 MiMo 401 证据继续对应各自原始源码／APK，不冒充本候选重新执行。

## 原生边界修复

候选 15 的真实 401 测试发现：同一 Activity 内切换验证域时，新的 WebView 顶部 CSS 安全区偶尔为 0，菜单物理顶部约 49.875px，落在实际 132px 状态栏内。初始页面也曾出现相同现象。使用独立 `tools/console-window-insets.mjs` 真实点击回归；它建立全新 input-only 域，先启动新 Activity，再在同一 Activity/PID 内替换两次 WebView，记录实际 DevTools target、窗口原点、状态栏边界与截图，不发送消息或启动运行宿主。

实际环境为 Android 16/API 36、x86_64、4KB 页、WebView 133.0.6943.137。Android 的[官方说明](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)将完整 systemBars CSS 支持列为更晚版本；[133 对应源码](https://chromium.googlesource.com/chromium/src/+/refs/tags/133.0.6943.137/android_webview/java/src/org/chromium/android_webview/AwDisplayCutoutController.java?format=TEXT)读取 DisplayCutout 对象。不能把该环境下偶然出现的 CSS padding 当成可靠系统栏契约，也没有测出并声称某个 Chromium 缓存缺陷。

最终由现有原生 FrameLayout 从首次 inset 分发开始统一处理 `systemBars | displayCutout`；左右上 padding 取实际边界，底部取系统安全边界与可见 IME 的最大值。传给子 View 的已处理类型清零，并清除 DisplayCutout 对象，避免 native 和 CSS 重复留白或新 WebView 二次缩小。没有硬编码状态栏／键盘尺寸；已删除试验性 onPageFinished／visual callback 重分发。物理点击转换相应改用实际 WebView 原点加 CSS 坐标乘 DPR。

[独立范围评审](raw/t15-insets-native-owner-review.md)未发现具体阻断；该评审只覆盖 build04 原生变化及两次菜单实测，明确不冒充完整 T15 验收或后续 IME／最终 APK 对应检查。

| 留存记录 | 实际结果与意义 |
| --- | --- |
| window-insets-red01 / red02 | 原 APK 失败；red02 的复用 Activity 菜单被状态栏遮挡。 |
| build01、green01 / green02 | onPageFinished.requestApplyInsets 首轮通过、第二轮失败，不能接受。 |
| build02、green03 / green04 / green05 | 直接分发 root insets；green03 是旧 CDP target 超时，修正驱动后 green04 通过，green05 冷启动后的第二次复用仍失败。 |
| build03、visual01 / origin-red01 | visual-state 回调仍失败；后者虽名称含 red，实际通过，只说明现象间歇。 |
| build04、native01 / native02 | 最终原生边界所有者分别 COLD、WARM，两轮各三个阶段通过。 |
| 候选 16、joint01 | 冻结最终 APK COLD 加两次同 Activity 新 WebView，通过。 |

上述 JSON／日志全部按原名留存于 `raw/t15-window-insets-*`，失败没有被覆盖。native01、native02 与最终 joint01 中，WebView 原点 Y=132px、CSS 顶部 padding=0，菜单物理顶部为 181.875px，真实点击均打开抽屉；这同时验证不重复留白。截图位于 `screenshots/t15-window-insets-*`。本范围不等同于全部 OEM、WebView 版本或字体倍率矩阵。

## 实际键盘与横竖屏

`tools/console-insets-layout.mjs` 建立唯一 fixture 域，只创建并自动保存一条 `原生边距回归草稿 🌍`。使用真实系统 IME、物理点击和旋转，核对发送、详情、草稿与上下文信息都在实际系统栏和 IME 之间；返回竖屏后通过公开 Interface 读取完整草稿、零发送意图和零历史。

- layout01：失败留有原始日志和竖屏记录；清理命令返回码 255 掩盖了原异常，未补造丢失的外层记录。
- layout02：Android 16 的 IME dump 新增 visibleFrame，原解析器失败；修正可选字段并保留失败。清理对明确的 `Service stopped` 返回值单独处理，并等待服务记录消失。
- layout03：真正布局 RED。横屏键盘下原生可见高度 320px，发送按钮底部 396.25px 超过 IME 顶部 394px，元信息被遮挡。
- layout04：短宽视口 `min-width:600px / max-height:200px` 使用紧凑 header、输入行和元信息行；保留 44px 发送控件及可滚动附件／状态内容。实际横竖屏、完整草稿、零意图／历史全部通过。回到竖屏的截图保留一次“草稿存储正在提交，请稍后重试”提示，持久草稿正确；没有将该屏幕描述为所有提示皆消失。

本候选的合并后 IME 复核结果及结束状态见下方追加记录。早期布局失败、最终布局屏幕与 JSON 保存在 `raw/t15-insets-layout*`、`screenshots/t15-insets-layout*`。

## 已接受 T13 的 Console 接线

聊天上下文栏显示“省流等待 · 查看”，点击后进入设置页当前会话的等待操作；设置和工具页保留完整策略面板。导航保留 activeId；只放行按钮仍使用原生 operation 的固定 identity、最终 digest 与限制周期，全局策略保持开启。返回聊天保留草稿与历史。合并时同时保留 `context.get` 和通知目标的初始会话选择，不用一个分支覆盖另一个。

新增公开 ApplicationClient／真实 Coordinator 的组件回归先 RED 后 GREEN，核对等待入口、当前会话、精确一次放行、返回草稿不变、没有 send 或全局关闭调用。`t15-t13-console-red01.log`、未成功写入实现时的 green01 失败、真正 green02（10/10）全部留存。

设备用例 `DataSaverExecutionTest#actualReactSingleGrantKeepsGlobalPolicyAndTheNextIdentityWaiting` 改为真实 Console 入口与可信 pointer：创建会话→设置开启省流→返回聊天→一次输入等待→可见入口→固定 identity 放行→返回同一会话。第二个显式输入仍等待另一 identity，返回后明确停止。测试没有用 JS click／隐藏 DOM 或直接策略 API 替代入口点击；实际模型为该用例既有受控 fixture，真实执行由 Termux 完成，不称为 MiMo 成功请求。该实际联合验证由根任务在其独占 5582 执行，结果见下方设备记录，不因测试已编译就宣称通过。

## 构建、指纹与范围

联合构建主 APK 和 Android test APK 成功（2m53s）；UI 27 文件 99/99，通过 `--maxWorkers=2`；公开应用及 Data Saver 运行时 33/33。日志分别为 `raw/t15-joint-build01.log`、`t15-joint-ui-suite01.log`、`t15-joint-runtime-suite01.log`。更早原生修复的默认高并发 UI 运行有一次模型页面启动超时（90/91），相同代码降低并发后 91/91；短横屏修改后又 91/91，均保留日志，不隐藏首次失败。

合并后八个受控 Python 文件按 HEAD Git blob 的二进制字节恢复 LF，工作树无逻辑差异；不运行任何 Termux setup。最终 APK 内 setup SHA-256 为 `bccdfe9de7ff1179542aef37e7bc1bdf448ba7df6fcd6806368e84ee83e103b2`，capabilities 为 `10d7375d4565a83647d278efdea74cd71fe280896609987d12bb19a1e7302b1b`，与已接受版本完全一致。不能因 Windows checkout 换行差异要求用户升级执行环境。

冻结对应、联合真实 Termux 可见 diff 和省流放行结果由根任务独立核对后决定整票验收；本记录不自行更改工单状态。此次不使用用户密钥、不安装／替换 Termux、不清空设备数据，不以模拟器结果补写 Galaxy S23 或 Xiaomi 15 的 OEM 通过范围。

## 冻结候选的最后复核

同一冻结 APK 升级安装到独占的 5584 后，`t15-window-insets-joint01` 冷启动及两次原 Activity 新 WebView 全部通过。随后 `t15-insets-layout-joint01` 使用新域 `a265bfd6-f001-479a-8eec-f91bc6ca2667`、会话 `71b86d4b-f620-4048-8d9d-ffe3a1437be1` 完成真实竖屏 IME、横屏 IME、回竖屏。三张实际屏幕逐张视觉检查：控件、草稿保存状态、上下文与省流入口完整可见，本轮没有重现 layout04 的暂时存储忙提示。原生横屏可见高度 320px、原点 (132,74)、IME 顶部 394px；发送控件底部约 322.75px，位于可用区域。公开原生记录保留完整草稿及零发送意图／历史，清理无异常、ApplicationService 不存在。

[结束状态](raw/t15-joint-restored.json)确认 1080×2400、density 420、无 size/density override、字体 1.0、自动旋转 1、user_rotation 0、show_ime_with_hard_keyboard 0、stay_awake 7。模拟器保留运行和全部数据，停在该新域的 input-only 页面；不复用旧模拟器运行状态冒充本次冷启动，不触碰根任务独占的 5582。

根任务独立检查最终候选的 70 个 runtime 文件、11 个 UI 文件、221 个源文件及原生 16KB 对齐／pin，通过；原始记录为 [APK／源码对应](raw/t15-candidate16-root-inspection.json)。此处的二进制检查不冒充 16KB 运行时实测。

根任务在其独占设备上的实际 Console 单次放行 [1/1，通过 17.317 秒](raw/t15-candidate16-grant01-device.log)：运行域 `9c1fb740-2d2f-4d11-bb46-9c697103e495`，会话 `fe12860f-271d-42e7-a78c-8da77fa6838d`。真实可信 pointer 覆盖可见创建、上下文省流入口、设置开关、返回、等待入口、精确放行、返回后第二个输入仍等待，以及明确停止。第一次执行完成，第二个不同 identity 保持等待后停止，全局省流仍开启，总共 3 次既有受控模型请求。根任务逐张检查等待与下一次等待的两张真实截图；后者滚动后顶部行被裁切、旧完成行在下方，按实际屏幕保留，不将其描述成所有行同时完整可见。前后网络 override 都恢复为 None。未消费真实 MiMo 凭据或修改执行环境。

根任务的完整 `FileApplicationTest#originalFilesRoundtripAndPinnedSdkContractsThroughActualTermux` 在同一最终候选通过 1/1（65.2 秒），包括原件往返、独立依赖产物、四个固定 SDK 文件契约和宿主重开后零新模型请求。保留域 `ba1a5cb4-544e-4e3f-8a16-20558aa14ca1`、会话 `6c0b2a18-d008-46b7-aea6-3bdfc1d7187d`，详见 [设备日志](raw/t15-candidate16-file-roundtrip01-device.log)。此前通过既有生产网关恢复实际 Termux daemon（2.926 秒），复用同一 executor／ledger，没有重新安装执行组件。

另由正常 Termux 路径独立只读观察该域原件 `change.txt`：[结果](raw/t15-candidate16-independent-file-read.log)为 19 字节、`真实修改-after\n`、SHA-256 `e2a6658f4505bef21e5d7df7e4911130eecd466a54a82635aa0d25cda9fd451e`，核对路径在原域内且不是符号链接。这条独立原件读证据与 React diff DOM 通过分开记录，不以应用自己的显示反证原件。

最后的可见差异观察使用新增测试驱动 `tools/console-retained-file-diff.mjs`，生产 APK 不变。调用者显式提供设备、上述已完成 run／conversation 和新输出前缀；驱动只打开原域，要求当前选择一致，真实点击“会话详情 → 文件变更与执行 → 查看文件变更”，只滚动已渲染的目标 diff，捕获 native 屏幕。前后公开 open 必须都是 done，发送意图与 history 页完全相同。该驱动没有创建会话、输入、发送、setup 或 force-stop 步骤；history 请求仍受公开接口最多 50 条的分页约束，不能把一页相等冒充另外进行过全历史遍历。

首次补拍 retained-diff01 在已成功物理打开详情后失败：测试选择器误匹配 HistoryNavigator 内部的同名 `.detail-actions`，未进入文件面板。原始驱动、完整日志／观察 JSON／计划及实际详情页失败截图留存，不修改生产页面，也没有新输入或发送。修正为外层 `.details-panel > .detail-actions > button:first-child`，并在详情已展开时不再次切换关闭；仍观察同一已完成域，新的输出前缀保留第一次失败。

第二次 retained-diff02 真实导航与公开 Interface 不变检查通过：前后 done、7 个发送意图和 21 条历史完全一致，历史页无 next。实际差异段位于可见滚动区域，root 与实现者都逐张查看 native PNG 后判为视觉失败：旧浅色文件组件的正文深绿和关联／路径深色文字落在 Console 深色背景上，可读性不足。保留通过的持久事实与失败的原截图，不将 DOM 通过冒充 UI 验收。

后续生产提交 `4b7c468` 仅将文件差异正文改用 `--text`、操作关联 `--blue`、路径 `--muted`，不改变原生、运行时、行为或几何。后续候选只需在相同已完成域只读复核该页面；本候选的真实 Termux 写入、省流放行与生命周期证据保留原来源。
