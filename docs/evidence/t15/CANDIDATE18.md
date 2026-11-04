# T15 候选 18：最终文件差异前景色

源码 `c868f0c60bd3336525ea5024d07181742ef87351`，主 APK SHA-256 `ce24d14f10310f4f0323e19cc91118a804e01a03cd2d3f17be7e884f8b54ea45`，冻结于 `D:\durableagent-validation\t15-console-candidate18-c868f0c`。测试 APK 仍是候选 16 的原始 `b9722ecd598de73d4a158a3b7d7c7c9506bd12b009c8328abef20c8d168f937e`。见 [ARTIFACTS-candidate18.json](ARTIFACTS-candidate18.json)。

相对已完成原生边距／横屏 IME／T13 接线的候选 16，生产变化只涉及文件差异三种前景色。候选 17 实际屏幕已经证明正文／路径改善，但操作关联 summary 仍被异步加载的旧 CSS 影响；本次把 `--blue` 明确应用到 `.file-changes details > summary`。[候选 16](CANDIDATE16.md)和[候选 17](CANDIDATE17.md)的原始失败截图、成功持久事实与来源全部保留。

构建 19 秒通过，非 UI APK entry 与候选 16 全部一致；将生成的 content-hash 文件名归一化后 JS／HTML 相同，仅 CSS 变化。没有重复真实执行写入、模型发送或省流放行，也没有为颜色写镜像测试。实际复核只导航到同一已完成域的文件差异页面。

根任务实际安装最终候选后，retained-diff04 [完整通过](raw/t15-candidate18-retained-diff04-observation.json)。根任务与实现者分别查看[真实 native 屏幕](screenshots/t15-candidate18-retained-diff04-retained-original-diff.png)：差异正文、路径、三角展开标记和“查看操作关联”均清晰可读，原件标识和 `+真实修改-after` 实际可见。前后都是 done、7 个发送意图与 21 条历史值完全相同，历史页无 next；没有新输入或发送。正常 Termux 独立原件读及全部写入／文件契约／省流放行继续引用候选 16，未在主题修复后重新执行这些副作用。

只读驱动单独冻结在候选目录，SHA-256 `9013ed9994b8cce52f11a258824c1705557b1792a53f024a4dfed7de5609c421`；见 [OBSERVER-candidate18.json](OBSERVER-candidate18.json)。此驱动与最终证据在主 APK 构建之后提交，APK／源码边界仍为 c868f0c，不能把后续文档提交当作已重新构建。

5584 的最后动作仍是候选 16 的 focused IME 复核：显示设置回到既有 baseline、ApplicationService 不存在、保留全部数据且模拟器运行。主题复核由根任务独占 5582 完成，实现者未操作该设备。最终工单状态、公开发布审计和独立合并由根任务决定。

根任务的[独立 APK 对比](raw/t15-candidate18-root-entry-comparison.json)再次核对非 UI entry 相同，并按真实 asset 清单归一化名称后核对 JS／HTML 相同；最初 root 比较遗漏 chunk 名称导致的比较器失败也记录在 JSON 中，未将它解释为生产代码变化。最终截图后 root 正常返回并停止自己的空闲宿主，报告 5582 ApplicationService 已不存在。
