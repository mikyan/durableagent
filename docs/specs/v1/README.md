# 首版 spec 与纵向工单

设计基线：2026-11-03；整理：2026-11-04。1 份总 spec、17 张纵向工单。用户已调用 `implement-spec`；T01—T11、T13、T14 与 T16 已在各自记录的范围内验收并合入集成分支，共 14 张。T03 的限定开发门槛由已有 S23 矩阵及用户授权的 Android 16 模拟器补验共同通过；T08 稳定项目绑定、T09 受管命令、T10 原文件／写入协调、T11 停止控制、T13 省流策略和 T14 明确跨会话转交均有 Android 与真实 MiMo 证据。T12 自动恢复与 T15 Console 界面继续实施，T17 最终设备验收仍待前置通过。S23 锁屏／重启、解锁后的可见界面与 Activity 重建仍须补齐，完整产品尚未验收。

2026-11-04 用户补充：暂不方便解锁 S23，先继续其他开发；目前仅有 Galaxy S23 可用，随后明确同意用 Android 模拟器测试。标准 4 KB 模拟器通过实际锁屏恢复、整机重启首次解锁及六次冷启动／进程死亡检查；这些补验用于 T03 开发前置条件。T17 的 Xiaomi 15 实测仍缺少设备，三星／小米厂商行为与最终真机条件没有被删除或冒称通过。

[总 spec](spec.md) 已发布为 [GitHub #1](https://github.com/mikyan/durableagent/issues/1)。[公开仓库](https://github.com/mikyan/durableagent) 保存设计、原型和后续代码；GitHub Issues 是执行状态与原生阻塞关系的权威。`ready-for-agent` 表示说明完备，不能代替前置票的实测通过证据。

## 交付与依赖

| 工单 | GitHub | 独立可验证的交付 | Blocked by |
|---|---|---|---|
| T01 | [#2](https://github.com/mikyan/durableagent/issues/2) | [验证应用内运行宿主能够运行 Pi SDK 1.5.0](tickets/01-runtime-compatibility.md) | 无 |
| T02 | [#3](https://github.com/mikyan/durableagent/issues/3) | [验证会话提交在 Android SQLite 上可确认与恢复](tickets/02-sqlite-contract.md) | [#2](https://github.com/mikyan/durableagent/issues/2) |
| T03 | [#4](https://github.com/mikyan/durableagent/issues/4) | [验证首次配置后的官方 Termux 受管启动](tickets/03-termux-managed-startup.md) | 无 |
| T04 | [#5](https://github.com/mikyan/durableagent/issues/5) | [创建会话、接收文字回复并在重连后查看持久历史](tickets/04-durable-conversation.md) | [#2](https://github.com/mikyan/durableagent/issues/2)、[#3](https://github.com/mikyan/durableagent/issues/3) |
| T05 | [#6](https://github.com/mikyan/durableagent/issues/6) | [配置模型凭据并按会话独立选择模型](tickets/05-models-and-credentials.md) | [#5](https://github.com/mikyan/durableagent/issues/5) |
| T06 | [#7](https://github.com/mikyan/durableagent/issues/7) | [保存草稿并准备稳定的附件输入](tickets/06-drafts-and-attachments.md) | [#5](https://github.com/mikyan/durableagent/issues/5)、[#6](https://github.com/mikyan/durableagent/issues/6) |
| T07 | [#8](https://github.com/mikyan/durableagent/issues/8) | [让一次发送在中断后可靠接纳且不误重发](tickets/07-reliable-submission.md) | [#5](https://github.com/mikyan/durableagent/issues/5)、[#7](https://github.com/mikyan/durableagent/issues/7) |
| T08 | [#9](https://github.com/mikyan/durableagent/issues/9) | [让会话使用稳定项目位置并拒绝忙时改绑](tickets/08-projects-and-bindings.md) | [#8](https://github.com/mikyan/durableagent/issues/8) |
| T09 | [#10](https://github.com/mikyan/durableagent/issues/10) | [从会话执行命令并在失联后核验同一次执行](tickets/09-managed-execution.md) | [#4](https://github.com/mikyan/durableagent/issues/4)、[#5](https://github.com/mikyan/durableagent/issues/5) |
| T10 | [#11](https://github.com/mikyan/durableagent/issues/11) | [真实原文件操作与同工作区写入协调](tickets/10-files-and-workspaces.md) | [#9](https://github.com/mikyan/durableagent/issues/9)、[#10](https://github.com/mikyan/durableagent/issues/10) |
| T11 | [#12](https://github.com/mikyan/durableagent/issues/12) | [用户停止后旧工作不再复活](tickets/11-stop-fencing.md) | [#8](https://github.com/mikyan/durableagent/issues/8)、[#10](https://github.com/mikyan/durableagent/issues/10) |
| T12 | [#13](https://github.com/mikyan/durableagent/issues/13) | [在条件恢复后继续未完成会话](tickets/12-automatic-resume.md) | [#6](https://github.com/mikyan/durableagent/issues/6)、[#11](https://github.com/mikyan/durableagent/issues/11)、[#12](https://github.com/mikyan/durableagent/issues/12) |
| T13 | [#14](https://github.com/mikyan/durableagent/issues/14) | [省流模式约束受控工具且保留本地工作](tickets/13-data-saver.md) | [#10](https://github.com/mikyan/durableagent/issues/10)、[#12](https://github.com/mikyan/durableagent/issues/12) |
| T14 | [#15](https://github.com/mikyan/durableagent/issues/15) | [随包扩展提供真实界面能力与明确的跨会话转交](tickets/14-extensions-and-routing.md) | [#6](https://github.com/mikyan/durableagent/issues/6)、[#8](https://github.com/mikyan/durableagent/issues/8)、[#9](https://github.com/mikyan/durableagent/issues/9) |
| T15 | [#16](https://github.com/mikyan/durableagent/issues/16) | [完成 Console 基线的手机与横屏平板体验](tickets/15-console-experience.md) | [#6](https://github.com/mikyan/durableagent/issues/6)、[#7](https://github.com/mikyan/durableagent/issues/7)、[#9](https://github.com/mikyan/durableagent/issues/9)、[#11](https://github.com/mikyan/durableagent/issues/11)、[#12](https://github.com/mikyan/durableagent/issues/12)、[#15](https://github.com/mikyan/durableagent/issues/15) |
| T16 | [#17](https://github.com/mikyan/durableagent/issues/17) | [在容量、迁移及恢复故障下保住必要工作数据](tickets/16-retention-and-migration.md) | [#6](https://github.com/mikyan/durableagent/issues/6)、[#8](https://github.com/mikyan/durableagent/issues/8)、[#10](https://github.com/mikyan/durableagent/issues/10) |
| T17 | [#18](https://github.com/mikyan/durableagent/issues/18) | [在目标设备验收真实文件工作、恢复与停止闭环](tickets/17-device-acceptance.md) | [#13](https://github.com/mikyan/durableagent/issues/13)、[#14](https://github.com/mikyan/durableagent/issues/14)、[#15](https://github.com/mikyan/durableagent/issues/15)、[#16](https://github.com/mikyan/durableagent/issues/16)、[#17](https://github.com/mikyan/durableagent/issues/17) |

T01 与 T03 是独立验证起点；T02 验证选定宿主的实际存储契约。后续按阻塞已解除的前沿推进，不能把 SDK 或参考项目的成功记录当作本项目通过。

执行代码汇入[草稿 PR #19](https://github.com/mikyan/durableagent/pull/19)。[T01 运行时](../../evidence/t01/README.md)、[T02 存储](../../evidence/t02/README.md)、[T03 受管启动](../../../termux-probe/validation.md)、[T04 会话](../../evidence/t04/README.md)、[T05 模型及凭据](../../evidence/t05/README.md)、[T06 草稿及附件](../../evidence/t06/README.md)与 [T07 可靠发送](../../evidence/t07/README.md)已有实测证据；相关 issue 等完整交付 PR 合并后关闭。T03 保留固定 x86_64 Termux 在 16 KB 模拟器上 bootstrap 对齐失败的记录，4 KB 补验不被称为修复该问题。T06 的最后选中页恢复偏好限制与原始失败保留。T07 的 Runtime 118 项、UI 53 项通过；模拟器首批 36/38，两个观察读取冲突经仅测试修正后 2/2，六个双库实际进程中断窗口、真实 MiMo 同意图补确认一请求／主动新动作两请求、重建零额外请求、固定附件回归与实际 UI 进程恢复均有证据。S23 仅有早期原生子集 11/11，新完整组合尚未实测。S23 锁屏下的 DOM 证据不能代替解锁后的可见界面验收，T17 仍保留真机门槛。

## 用户能力覆盖

T13 的[完整证据与十一项映射](../../evidence/t13/README.md)及[独立合并审查](../../evidence/t13/scoped-development-gate-review.md)记录了 runtime 245 项、UI 88 项，实际受控本地操作、未知命令等待、Provider 独立读写许可和运行中切网的分批结果。实际下载切网03在 JS 忙碌时于受限事实后 368 ms 确认停止原执行的子进程作用域，恢复网络没有重放；一次 GET 的 256000 字节仅为宿主写出量。FEDF 候选完整 SDK 原件流程 1/1（11.962 秒，六次受控请求、重开零新请求）和真实 MiMo 1/1（24.901 秒，四次实际请求）通过，独立读取核对 44 字节原件。最终 0AE 只变更实例等待配置及两项测试，其直接设备证据为同测试原生 2/2（8.932 秒）与 React09 1/1（19.688 秒）：一次可信指针放行固定操作，新操作重新等待，全局省流保持启用，显式停止有效。冻结源文件 371 项与证据摘要 157 项经独立核对；不同 APK、早期失败、UI07 旧帧与 UI09 下一行顶标裁切均保留，不拼成最终 APK 完整全绿。范围为 Android 16／4 KB 模拟器及受控工具策略，16 KB 打包检查不代表该页大小执行，T17 OEM 门槛继续保留。

T10 的[完整证据及十二项映射](../../../managed-execution/FILE-VALIDATION.md)与[独立合并审查](../../../managed-execution/evidence/scoped-file-development-gate-review.md)记录了最终 runtime 221 项、UI 81 项、实际 Termux 文件契约 14 项和四个 SDK 文件契约的分批通过结果。主应用通过真实系统选择器获得原件授权，原生 Provider 与 Bash 对同一共享原件的写入协调、两个方向的队列、纯工具继续、排队停止及实际宿主强杀恢复均有证据。真实 MiMo 六次请求完成写入、读取和 Bash 独立读取，根代理另从正常 Termux 打开原件逐字节核对。独立审查发现并修复 SAF 绕过环境 cleanup 的缺口，真实 SDK 回归与交错验证通过。Production07 最终 APK 经源码、打包内容及 16 KB 对齐核验，没有冒称重跑 Android 矩阵；此前模型验证预算、位置身份改变和原生测试准入失败分别保留。范围为 Android 16／4 KB 模拟器及所测 Provider，不代替 T12 自动恢复或 T17 OEM 验收。

T11 的[完整证据](../../evidence/t11/README.md)与[独立合并审查](../../evidence/t11/scoped-development-gate-review.md)记录了 runtime 183 项、UI 76 项，以及真实通知、JS 忙碌时宿主重建、旧停止屏障、新代次和真实 MiMo 的分批验证。Full01 原生批次为 23/24，通过修正前置条件后的同应用测试补齐 v6 迁移；第二停止遗漏缺陷由同一测试完成 RED→GREEN。Full02 实际通知 1/1、真实 MiMo 1/1，通过独立 Termux 原件读取确认延迟写入未发生。最初通知停止失败的具体原因仍未知，没有被后续成功改写。最终 APK 仅增加局部 lint 标注，源码差异经独立核验，未冒称该 APK 重跑过设备测试。正式原生版本升至 v7 并保留 T16 数据；后续 T10 联合协调、T12 恢复与 T17 OEM 门槛继续保留。

T16 的[完整证据](../../evidence/t16/README.md)与[独立合并审查](../../evidence/t16/scoped-development-gate-review.md)记录了主机 runtime 180 项、UI 75 项，Android 原生 51 项、共享 SDK 七项及只读重开一项的分批通过结果。实际迁移事务回滚、容量故障、SDK 迁移前后进程强杀、纯文字及附件持有、格式不兼容时保留历史并禁止执行均有证据。LocalTransport 与 GMS 单设备 D2D 测试通过正负对照；D2D 重装后九个对照域匹配本批唯一标记，排除包十一域为空。初始失败及旧编译产物造成的两次故障注入前置失败均保留，Gradle 已在打包前编译 runtime／UI。原生正式版本由 v4 升至 v6；后续 T11 必须迁移该正式版本。范围仍为 Android 16／4 KB 模拟器，不代表 OEM、远程云、API 36.1、整机迁移或硬掉电验收。

T09 的[执行证据](../../../managed-execution/VALIDATION.md)与[独立合并审查](../../../managed-execution/evidence/scoped-development-gate-review.md)记录真实 React／SDK／官方 Termux 六场景、四个 SDK shell 契约用例、四个真实宿主强杀窗口、JS 忙时独立原生查询／取消，以及同环境读取并核对 1.2 MB 原始输出。真实 MiMo 明确执行各用两次模型请求；最终 runtime 171 项、UI 73 项通过。最后六场景 1/1 通过，独立文件核验确认成功／重连各一次效果、取消／超时没有延迟效果。05 候选第六个输入的原始模型错误未保留；已修正所有异常被误报停止的分类，06 通过不被当作已定位原始原因。固定脚本实际升级保留执行记录与配对；范围仍为 Android 16／4 KB 模拟器，不替代 T10 文件能力、T11 会话停止、T12 自动恢复或 T17 OEM 验收。

T14 的[完整证据](../../evidence/t14/README.md)与[独立合并审查](../../evidence/t14/scoped-development-gate-review.md)记录实际 SDK registry、原生四个与 SDK 两个进程强杀窗口、十二项共享策略、53 条历史的真实 React timeline 分页与 renderer 恢复。真实 MiMo 正常确认和确认丢失各用三次请求，来源历史和模型请求不包含目标草稿，同意图核验与重开不增加请求。最终 runtime 147 项、UI 67 项通过；第二轮 Android 为 17/18，原生夹具修正后定点通过，最终 debug 关闭修复同一测试 RED→GREEN，最终三项通过。各候选范围和初始失败分别保留，不拼成一次完整全绿；16 KB x86_64 模拟器结果不代替三星／小米行为。

T08 的[完整证据](../../evidence/t08/README.md)与[独立合并审查](../../evidence/t08/scoped-development-gate-review.md)记录了原生 17 项及四个真实进程强杀窗口、先前完整 Runtime 131 项与 UI 58 项、最终定点 17 项以及 Android 完整候选 3/3。最终共享策略 16 项通过；真实 MiMo 两次显式输入产生两次位置工具调用、四次模型请求，Activity 重建不增加请求，受控宿主重开不重发。初始工具未调用、只读观察占用与夹具草稿冲突失败均保留。位置工具只验证采用的配置传入实际 SDK 工具，真实 Termux 目录访问与写入协调仍由 T09/T10 验证；没有新增 S23／Xiaomi 实测声明。

| 用户故事 | 主要交付票 |
|---|---|
| 1—5：会话与项目 | T04、T08 |
| 6—12、64：手机／平板与会话导航 | T15 |
| 13—17：草稿和附件 | T06 |
| 18—21：可靠发送 | T07 |
| 22—23：位置绑定 | T08 |
| 24—26：初始化与启动 | T03 |
| 27—29：命令执行 | T09 |
| 30—35：原文件、协调与效果核验 | T09、T10 |
| 36—42：停止与续跑 | T11、T12 |
| 43—45：省流 | T13 |
| 46—53：模型与凭据 | T05 |
| 54—57：保留、迁移与删除范围 | T16 |
| 58—62：跨会话与真实扩展 | T14 |
| 63：可验证的交付顺序 | T01、T02、T03、T17 |

## 测试 Seam 与交付界限

主要通过应用 Interface 测试创建、保存、提交、观察、配置和停止；内部使用真实 SDK 与受控 Adapter。SQLite、原生密钥、跨 UID 文件、Termux 冷启动、系统生命周期与备份排除保留必要的契约／设备验收。当前没有可复用的生产测试套件。

每张行为票贯通自己的最小界面、公开动作、持久化与测试，不按数据库／Kotlin／前端横向拆票。T15 完成已批准 Console v2 的整体体验，T17 汇总目标设备证据。

## 状态与授权

Q27—Q35 已接受，常规工程细节由代理收敛。用户于 2026-11-04 调用 `implement-spec`，并提供 Galaxy S23，开始首版实现及设备验证；代码与工单沿用已授权的公开 GitHub 仓库。已使用受控传输与真实 MiMo 请求完成运行时、SQLite 契约验证；其余功能、受管启动完整矩阵与最终设备兼容继续按工单验收。

不把安排验证视为已经通过，不把 ready-for-agent 视为绕过依赖或设备许可。重要路线失败先保留证据，复审其影响；不静默改变已接受的产品承诺。
