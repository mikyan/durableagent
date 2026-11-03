# 首版 spec 与纵向工单

设计基线：2026-11-03；整理：2026-11-04。1 份总 spec、17 张纵向工单，当前仅准备实施，没有产品或设备验收结果。

[总 spec](spec.md) 是收敛后的行为契约；GitHub Issues 是执行状态与阻塞关系的权威。`ready-for-agent` 表示说明完备，执行仍须后续明确授权。

## 交付与依赖

| 工单 | 独立可验证的交付 | Blocked by |
|---|---|---|
| T01 | [验证应用内运行宿主能够运行 Pi SDK 1.5.0](tickets/01-runtime-compatibility.md) | 无 |
| T02 | [验证会话提交在 Android SQLite 上可确认与恢复](tickets/02-sqlite-contract.md) | T01 |
| T03 | [验证首次配置后的官方 Termux 受管启动](tickets/03-termux-managed-startup.md) | 无 |
| T04 | [创建会话、接收文字回复并在重连后查看持久历史](tickets/04-durable-conversation.md) | T01、T02 |
| T05 | [配置模型凭据并按会话独立选择模型](tickets/05-models-and-credentials.md) | T04 |
| T06 | [保存草稿并准备稳定的附件输入](tickets/06-drafts-and-attachments.md) | T04、T05 |
| T07 | [让一次发送在中断后可靠接纳且不误重发](tickets/07-reliable-submission.md) | T04、T06 |
| T08 | [让会话使用稳定项目位置并拒绝忙时改绑](tickets/08-projects-and-bindings.md) | T07 |
| T09 | [从会话执行命令并在失联后核验同一次执行](tickets/09-managed-execution.md) | T03、T04 |
| T10 | [真实原文件操作与同工作区写入协调](tickets/10-files-and-workspaces.md) | T08、T09 |
| T11 | [用户停止后旧工作不再复活](tickets/11-stop-fencing.md) | T07、T09 |
| T12 | [在条件恢复后继续未完成会话](tickets/12-automatic-resume.md) | T05、T10、T11 |
| T13 | [省流模式约束受控工具且保留本地工作](tickets/13-data-saver.md) | T09、T11 |
| T14 | [随包扩展提供真实界面能力与明确的跨会话转交](tickets/14-extensions-and-routing.md) | T05、T07、T08 |
| T15 | [完成 Console 基线的手机与横屏平板体验](tickets/15-console-experience.md) | T05、T06、T08、T10、T11、T14 |
| T16 | [在容量、迁移及恢复故障下保住必要工作数据](tickets/16-retention-and-migration.md) | T05、T07、T09 |
| T17 | [在目标设备验收真实文件工作、恢复与停止闭环](tickets/17-device-acceptance.md) | T12、T13、T14、T15、T16 |

T01 与 T03 是独立验证起点；T02 验证选定宿主的实际存储契约。后续按阻塞已解除的前沿推进，不能把 SDK 或参考项目的成功记录当作本项目通过。

## 用户能力覆盖

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

Q27—Q35 已接受，常规工程细节由代理收敛。运行时、驱动、受管启动及设备兼容仍为待验证事实。当前授权是文档、spec、GitHub 仓库和 issue 发布；生产实现、验证工程、安装 SDK／APK／运行时、真实模型调用和设备操作在后续指令中启动。

不把安排验证视为已经通过，不把 ready-for-agent 视为绕过依赖或设备许可。重要路线失败先保留证据，复审其影响；不静默改变已接受的产品承诺。
