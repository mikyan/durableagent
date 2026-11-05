# T15 候选 17：真实差异面板文字对比度

主 APK 与源码提交 `4b7c4683cd448b5c453388c662289a5765f46a20`，冻结在 `D:\durableagent-validation\t15-console-candidate17-4b7c468`。主 APK SHA-256 `8dae4e47d04b71592749b6770061b57f294f791f7caf48926a8a528062a6ba3e`。测试 APK 与候选 16 完全相同，仍来源 `c44d8ce`；导航补拍驱动在后续文档／测试提交，不冒充主 APK 构建时已存在。完整摘要见 [ARTIFACTS-candidate17.json](ARTIFACTS-candidate17.json)。

候选 16 真实 Termux diff 的导航、持久事实与独立原件读均通过，但 root 和实现者查看实际屏幕后发现差异正文及关联／路径在深色背景上过暗；[失败截图](screenshots/t15-candidate16-retained-diff02-retained-original-diff.png)保留。此提交只修改三条前景色：文件 diff 正文使用已有 `--text`，关联使用 `--blue`，路径使用 `--muted`。没有调整几何、动作或原生处理。

[构建](raw/t15-candidate17-build01.log)通过，21 秒。与候选 16 对比，所有非 UI APK entry 字节相同，包含 DEX、原生库、runtime.zip、setup、capabilities；[内容 hash 文件名归一化检查](raw/t15-candidate17-ui-delta.json)显示 JavaScript 和 HTML 内容一致，仅 CSS 有变化。因只有颜色变化，不新增镜像实现的测试、不重复真实 Termux 写入／模型请求／省流放行；候选 16 的 99 项 UI、33 项运行时及实际执行结果保持各自原始来源。

可见页面复核复用已完成域 `ba1a5cb4-544e-4e3f-8a16-20558aa14ca1`、会话 `6c0b2a18-d008-46b7-aea6-3bdfc1d7187d`，运行 `tools/console-retained-file-diff.mjs <独占设备> <run> <conversation> <新的绝对输出前缀>`。该驱动只做可见导航与公开只读观察，不重发已完成输入。

实际 retained-diff03 的导航、done、7 意图与 21 条历史保持不变检查通过。实现者查看[实际 native 截图](screenshots/t15-candidate17-retained-diff03-retained-original-diff.png)确认差异正文和路径已清晰；操作关联 summary 仍为深绿，故保留为视觉部分失败，不标最终通过。同 specificity 的 `.file-changes details` 被延后加载的 execution.css 覆盖；后续 `c868f0c` 将颜色明确应用到 `.file-changes details > summary`，仍是颜色修正。
