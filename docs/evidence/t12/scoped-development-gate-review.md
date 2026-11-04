# T12 限定开发验收与独立合并审查

2026-11-04。T12 的十二项条件在下述证据范围内通过独立开发验收，合入集成分支；T17 的最终产品组合与目标硬件验收仍未完成。本记录不表示首版已可发布，GitHub issue 随完整交付 PR 合并关闭。

## 固定对象与独立检查

- 接受的 owner 提交：`df68812ec39acdbc1a9c703fb70397a3f0227244`；原集成：`75ab2ae21fe88b74c760a567110da04f2e5011b1`；独立合并：`06227b9cf490db28c2b09652c412edb7c7a2d927`。双方合并前干净，原集成是 owner 祖先，合并无冲突且合并树与 owner 相同。
- 原生／运行时最终修复：`374d74df91a4c6ae6e8acb8e8bd5f0598cc9c93c`。实际 native 回归 main SHA-256 `1623ac04a17e3934173c16d527c611733b52e82251a2bc7bd1895df7c19ad526`；test `3d99bb4cdb82b76cf328919025ab6ab96d4577ba5442b2d90d3f8bb518ecc938`，与自动启动 RED03 相同。
- 最后 UI 提示修复：`4c526920af7b7208b220f2b4805d9f8f577164e2`；最终 main `e7cf5a6ddff4bc435f513fc727e2ac1f12b93801aefb6570fb8e4457b650bfc0`，test 不变。[组件对照](t12-final-ui01-root-artifact-delta.json)证明 20 个非 UI／非签名 APK 项与 1623 逐字节相同；[包核验](t12-final-ui01-root-inspection.json)对应 74 个 runtime、11 个 UI 和 238 个源码项，setup／capability／原生 pin 与 16 KiB 打包检查通过。E7CF 没有重跑上述 native 矩阵，16 KiB 打包检查不等于该页大小运行通过。
- Merger 重新计算精确 owner HEAD 的 [160 项证据 Git blob 摘要](LOG-SHA256.json)，全部匹配；直接读取最后 native 日志、升级三份快照和独立审查关闭记录，没有运行新的测试或设备命令。
- Root 对精确 owner tip 的本地公开审计覆盖 1,433 个文件和 734 个未发布 Git objects，实际密钥／私有设备序号的 UTF-8、UTF-16LE、UTF-16BE 匹配为零，阳性对照通过。审计值不进入本文；合并后公开发布仍由 root 核验。

## 最终定点验证

| 对象 | 实测结果 | 证明范围 |
| --- | --- | --- |
| 普通请求自动重开 | [1/1，1.230 秒](t12-autostart-green01-device.log) | 精确终止空闲自有 listener，独立确认 socket 消失，普通 ping 自动启动既有执行端；无 Connect，原 executor／ledger／pairing 保持，process epoch 改变 |
| 同一 wake 的发布／重开 | [2/2，15.889 秒](t12-final-wakes01-device.log) | 原 owner 与新 owner 均重新发布原未成功发布的系统作业；同 admission、0 模型请求 |
| Job 解除绑定后的宿主 | [1/1，56.318 秒](t12-final-job01-device.log) | 50 秒作业绑定自然结束后，同一前台宿主继续；原生停止后 Service 退出。日志 requests1 仅指新 owner，另有初始 owner1 |
| 原件已追加后的恢复 | [1/1，10.448 秒](t12-final-original01-device.log) | 在 execution-before-result 强杀 owner，仍用原 execution／operation；原件恰好 `local\n`，同 intent 新增执行为0。模型传输受控 |
| Termux 实际契约 | [45/45，19.989 秒](t12-observe-python-full02-result.log) | 真实 SQLite、mTLS、进程／SIGKILL、文件与同身份效果；明确保留预期未知 fixture，不宣称已全部清理 |
| 主机与 UI | [runtime 272/272](t12-review-fixes-runtime02.log)、[最终提示 controller 7/7](t12-force-stop-message-green01.log) | Runtime provenance 为注明的事后对应；提示测试经真实 ApplicationClient 异步错误，不等于实际 Android force-stop UI 流程 |

实际 helper [升级02](t12-observe-helper-upgrade02-result.log)持有 132 个既有非阻塞锁，仅替换两份自有脚本及 installation manifest 的对应摘要，备份原件并保留 Termux properties。安装前、安装后、serve-existing 后的完整账本逻辑／schema／pairing／保留文件树快照相等；138 条执行记录包括两条早期 T13 `accepted_not_started` 均保持，没有派发、取消或改终态。首次升级01被 guard 拦截的失败记录继续保留；baseline 启动不被当作自动重开测试。

## 十二项验收映射

以下“通过”仅表示已列证据足以解除本票开发依赖；不是把不同候选拼成最终 APK 全量测试。详细前置、原始失败和重现命令见[完整证据](README.md)。

| 条件 | 结论及证据 |
| --- | --- |
| 1. 按原生控制／唯一 owner／同步 bootstrap／open／配置／就绪顺序恢复 | 通过。真实 Application／SDK／SQLite 的 recovery 与既有 T02/T05/T07 契约、原生恢复桥和最终 wake/Job 回归覆盖顺序与调度资格；普通执行入口的既有执行端 readiness 在输入 lease 之前核验，无重新初始化路径。 |
| 2. UI 重连仅观察，同发送核验，草稿不自动发送 | 通过。真实无绑定、later-lock、reboot、force-stop 保持原 intent/admission；C233 notification01 的原历史及另一会话草稿／意图不变。待接纳顺序修复通过两条及真实分页回归，按 durable sequence 恢复，不按时钟排序。 |
| 3. 条件恢复后继续原工作、等待原因可见 | 通过。离线 host 合同、真实 MiMo bound/unbound 原件恢复、正常产品锁屏与重开，以及最终普通 listener-death 自动重开共同覆盖；未知 TLS／身份及系统 force-stop 不被当作普通缺席重启。 |
| 4. 重启首次解锁、再次锁屏及合法资格 | 通过。AC63 的真实 reboot02 在 RUNNING_LOCKED／CE 不可读时无 Agent，实际 PIN 解锁后在任何 Activity／SDK 重连前完成原请求；later-lock01 为普通产品真实 MiMo。两项是零工具文字与各自候选范围，不外推 OEM 或固定唤醒时间。 |
| 5. force-stop、前台用途／退出、原生通知与可见性 | 通过。真实本应用 force-stop01 在联网30秒内保持 stopped/无进程，明确重开后继续原输入；最终 Job lifetime、原生持续通知停止、拒绝通知授权及关闭渠道分别通过。Termux 强停已有平台拒绝与中文说明合同；最终真实产品提示／重开流程由 T17 验证。 |
| 6. 完成复用、运行重连、未启动受当前资格、未知效果暂停 | 通过。T09/T10 真实执行证据、T12 unknown/probe authority/output预算回归与最终原件恢复保持原 execution；升级保留两条准备记录。缺失／损坏 ledger 的 existing-only 构造拒绝而不修补，未知副作用不交给模型盲重发。 |
| 7. 原位置、当前授权与未决占用 | 通过。继承已接受 T08/T10 真实绑定／原件／授权／写入协调；恢复的同身份结果确认及未知效果预算不按 idle、租期或连接超时释放原占用。最终原件回归保留原 binding/operation。 |
| 8. close/crash/deferred 与后续模型选择 | 通过。真实 Node 进程强杀保留 deferred handle 和原 SDK 预算，相关模型 suite 27/27；Retry-After 同连接持久期限、prepared A 切 B 和真实 SDK 压缩子任务等待均有固定 RED/GREEN。没有新的 Android deferred Provider 实测声明。 |
| 9. 可见有界重试，预算跨重开、遵守 Retry-After | 通过。原生预算与实际 Application/SQLite 输出结果确认预算跨重开不补额度；限流数值／日期、并发 commit 与停止保持正确。独立120秒期限用例仅观察6秒内一请求，短期限另证明可继续，不称完整120秒云限流实测。 |
| 10. epoch wake、重复触发、重开且不复活停止 | 通过。host epoch／early-wake／停止回归与原生预算覆盖；最终同 owner、新 owner 两项实际发布测试保持原接纳和零模型请求，Job 退出绑定后仍按原合法前台生命周期工作。 |
| 11. 终态与不可恢复原因分开，不以新身份逃避额度 | 通过。normal close、实际进程 crash/restart_limit、凭据及存储失败沿 T05/T16 与 recovery-crash 合同；unknown/output 额度耗尽保持原工作等待，Stop 不复活，新显式代次不被已确认旧结果误阻挡。 |
| 12. 真实原件中断继续、一次效果、完成通知与停止 | 通过。real62 与 product-unbound01 使用保存的真实 MiMo 凭据和真实 Termux，一次执行得到18字节 `part-one\npart-two\n`，正常 Termux 独立核对。最终1623另验证原件追加一次；C233正常产品真实物理通知点击准确回到会话，原输入／草稿不变。通知去重窗口、拒绝授权／关闭渠道及停止分别记录，不称一条万能场景。 |

## 审查结论与保留边界

[完整两轴汇总](v1-code-review-aggregate.md)、[自动启动聚焦审查](v1-autostart-fix-review.md)与 [Spec 最终补记](v1-review-spec-final-addendum.md)保留最初发现和修复证据。Standards 原两项、Spec 原三项及随后中文恢复说明缺口均关闭；所有修复由同一 owner 完成。Merger 未发现新的合并阻塞，也未因无新增生产差异而重复整个矩阵。

范围是 Android 16／API36／4 KB x86_64 模拟器、固定 Pi SDK 1.5.0、Javet i18n6.0.3 和既有官方 Termux 环境。S23 后续完整组合／锁屏重启／可见 Activity、Xiaomi 15、物理平板、ARM64 16 KB 与 OEM 限制仍未取得最终证据。T17 需要最终候选的真实 MiMo／文件／恢复／停止／切网组合及实际 Termux force-stop 产品流程；已有同组件定点结果可按来源复用。不会宣称全部17票通过、PR ready 或完成真机发布验收。

T12 的开发依赖现已解除。T01—T16 共16票在各自范围通过；T17 保持未完成，Draft PR 保持草稿。原始失败、保留未知 fixture、历史候选边界与用户原数据均不因本次接受而删除或改写。
