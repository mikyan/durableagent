# T15 Console 候选 14

源码 commit：ce6ac2a983b70f99de51fe6f0fd8eecf42d6493a

此包用于根任务的真实模型／执行环境联测，不是 #16 最终 gate。它以已接受 b06bfc7 为基础，尚未合入未接受的 T12/T13 分支。app-debug.apk、测试 APK 与 source.zip 的固定 SHA256 见 ARTIFACTS.json；evidence/README.md 是完整测试边界和失败记录。

## 已完成

- React UI 全量 90/90；最后摘要改动 focused 12/12、类型检查通过。runtime 222/222。
- 原生 ConsoleApplicationTest 2/2（候选 13，候选 14 原生代码相同）；新旧 Intent 目标只选已有会话、不创建/重发，错误域和未知 ID 拒绝；相机受控取消。
- 真正 Camera2 拍照返回 JPEG 并入草稿，第二次系统取消保持文字与已有附件；当前 text-only 验证模型明确拒绝图片，不把它当真实 LLM 图像输入通过。
- 实际 WebView/ADB 手机、360dp+IME、150% 字体、1280dp 平板窗口、旋转及短侧栏、详情关闭、搜索定位、浮条跳转/关闭；挂载与关闭时间线后运行继续，后续草稿保持，再明确停止。
- 实际 SIGKILL 后最后选中页及两份草稿恢复；UI PID 换新，Agent PID 不变。启动竞争原失败和同一原run读回均保留。

5584 当前已恢复 wm size/density 无 override、font_scale 1.0、accelerometer_rotation 1、user_rotation 0、show_ime_with_hard_keyboard 0。没有清空、卸载主应用或任何已有 Provider。屏幕停留在已完成 console 验证域首页。

## 根任务仍需完成的真实联测

只在根任务持有 lease 的设备上安装升级 -r，不改变已有 Termux 或凭据，不与正在执行的测试重叠。APK 包名 dev.durableagent.probe；测试包 dev.durableagent.probe.test；runner androidx.test.runner.AndroidJUnitRunner。

1. 用真实 MiMo 连接和新的合成无效凭据操作复测 T05 留项：服务端实际 401 后，聊天应有中文鉴权说明、保留失败类别和“检查模型与凭据”入口；点击进入原生凭据对应模型设置，不能重发用户输入。可沿用 T05 的真实无效凭据驱动。不要把生产 Key 写进命令、日志或截图。
2. 使用已有已初始化 Termux 的设备复测真实原件 diff。测试入口：dev.durableagent.probe.FileApplicationTest#originalFilesRoundtripAndPinnedSdkContractsThroughActualTermux。源码已更新为“会话详情 → 文件变更与执行 → 查看文件变更”；公开 files.list 与真实 UI 都校验 +真实修改-after。测试会在其专属 .durableagent-t10-<run> 中运行，不重置旧 Provider。请另捕获可见文件差异面板，不能仅用 DOM 断言代替截图。
3. 同一真实 MiMo 会话检查 context.get 的估算及已解析模型上限、错误提示和导航，不以 debug console 合成回复冒充真实调用。

## 重现本地验证

在本源码工作树运行 UI 的 npx vitest run --maxWorkers=1；runtime 工作目录运行 node --test --test-concurrency=1 test/*.test.mjs。Android 使用现有 Java 17/SDK 配置运行 :app:assembleDebug :app:assembleDebugAndroidTest。

设备原生入口：dev.durableagent.probe.ConsoleApplicationTest。tools/console-device.mjs 参数为显式设备序号、计划 JSON、输出目录；evidence/raw 的每个 JSON 都保留 plan。计划中的 run 是原已存在的合成数据域，复现新数据时须选择新的专用 run；先确认自己的测试执行已停止，不能通过强停别人的活动工作切换域。

tools/console-selection-process.mjs 参数为显式设备序号、输出前缀、fixture。调用者先停止自己已无活动工作的测试宿主，脚本建立专用域；在系统移除当前死亡 Activity 后再启动，避免 singleTop 启动投给即将移除的旧记录。它不提供真实模型凭据、不发送模型输入。

## 合并前剩余接线

等待根任务已接受 T12/T13 再合最新 integration。AgentActivity 接 NativeRecoveryBridge；设置中展示真实通知权限/未确认投递和 Data Saver。product 的 validationRun 仅诊断，同域比较应采用有效 namespace，避免 run/null 造成无必要的 WebView 重建。最终完成合并后的检查和独立 merger；此阶段没有改 GitHub issue 或 PR。
