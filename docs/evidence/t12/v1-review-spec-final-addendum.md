# Spec 轴最终修复补记

只读窄范围复核；未运行测试、ADB、模型请求，未修改仓库或 Git。原完整审查基线仍为 c8071d5...a8ee9c0，本补记只核对既有发现的最终修复。

- **原 P1 自动执行端启动：关闭，固定对象 374d74df91a4c6ae6e8acb8e8bd5f0598cc9c93c。** 满足 spec.md:19「随后普通冷启动和恢复由应用管理」。ExecutionAccess 普通请求先调用 ensureExisting，再取得停止／输入租约并发送原操作；只在连接确实缺席时启动 serve-existing，保留配对与执行权威，不重新初始化、不重放原操作。serve-existing 使用既有数据库 mode=rw，缺失或损坏时拒绝，不创建或修复账本。最终 ping 已脱离普通任务信号量，不妨碍独立控制通道。已读取相同回归的实际设备 RED（0.246s，CONNECTION_UNCONFIRMED）与 GREEN（1.230s）：真实监听器消失后普通请求恢复成功，explicitConnectCalled=false、pairingUnchanged=true、executorId/ledgerEpoch 不变、processEpoch 更新。此证据绑定 main1623/test3D99，不能移称为后续 UI 候选的整机验证。
- **新增中文恢复说明：代码与定向测试关闭，固定对象 4c526920af7b7208b220f2b4805d9f8f577164e2。** 对应 spec.md:50 要求强行停止等情况分别说明以便正确处理，以及 T12 的「force-stop 不尝试绕过」。ExecutionCoordinator 按 TERMUX_FORCE_STOPPED 显示「请手动打开 Termux 一次，再返回本应用；无需重新初始化」，保留错误种类、既有执行行，不触发自动启动或重发。已读取实际 RED 与 7/7 GREEN 日志；这不是实际 Android force-stop UI 验证。
- **原 Retry-After 与待接纳发送顺序：保持关闭。** 分别见 da85f5f2fef23995fb51aeff158fb8775c15f8c2 与 08cbe61，以及此前 v1-review-retry-after-fix-review.md 的证据和范围限制。

另已读取最终原生回归日志：wake 2/2（含 owner reopen，同接纳身份、0 模型请求），job 1/1（停止后宿主退出），原工作恢复 1/1（同一 intent 增加执行数为0）。upgrade02 的精确保留数据核验由 root 报告；本次只读了其 manifest 与 root-review 记录，未重新操作设备或核验全量设备数据。

**最终结论：原 Spec 轴三项代码发现均已关闭；本次窄范围没有新增代码阻塞。** UI-only 最终冻结、T17 真实 force-stop 流程、最终候选实测与 OEM 条件仍按实际验收状态推进，不宣称17张票全部完成。