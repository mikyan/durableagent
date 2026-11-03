# T02：验证会话提交在 Android SQLite 上可确认与恢复

## What to build

在 T01 通过的运行宿主内，用真实 SDK SQLite Storage 保存一段文本会话和应用元数据，关闭或终止进程后重新打开并核验已确认提交。交付可复用的存储契约验收结果，证明后续会话功能有合格的耐久底座。

## Acceptance criteria

- [ ] 选定并记录实际 SQLite 引擎／驱动版本与构建选项，运行 SDK 1.5.0 的真实迁移和读写；STRICT、json_valid、部分索引、UPSERT 及绑定类型均满足契约，不删除约束绕过失败。
- [ ] 数据库与事务句柄均正确实现 runCounted；trigger 等额外写入不污染 changes 语义，计数查询不与其他写入交错。
- [ ] 事务内只使用事务句柄，无关读写和其他事务排队；事务结束后句柄失效，提交或回滚完成之前不返回成功。
- [ ] 回调错误且回滚成功保留原错误；回滚失败、COMMIT 失败、提交后通信中断明确区分，不将结果不明显示成未发生或允许直接重做。
- [ ] 多 batch 提交中，第 N 个业务检查拒绝只保留此前成功 batch；数据库错误按实际事务结果处理；持久收据顺序、可见性及已发收据有效性符合 1.5.0 契约。
- [ ] 会话、输入、历史、任务和应用 document 通过 SDK 的存储 conformance cases；产品元数据与其对应 SDK 记录在需要时共同提交，原生输入记录和 Termux 副作用不被声称包含在该事务内。
- [ ] 同一存储域只有一个活动可写 SDK Session；并发启动、UI 重连和宿主退出后重开均不能产生第二写入者，不能以 WAL 或 readOnly 标志代替所有权验证。
- [ ] 在提交前、写入中、提交后但确认前终止宿主，重开后核验同一记录的真实状态；已确认提交可恢复，未确认提交不会靠重复逻辑写入猜测结果。
- [ ] 明确并验证所选 journal／同步策略与耐久确认含义；进程崩溃和设备掉电分别记录。掉电未验证时不得宣称零丢失，默认 NORMAL 设置不能冒充此保证。
- [ ] 测试 schema 1→2、应用 document 版本不匹配和迁移中断；保留原数据并报告阻塞，不静默清库，也不将新库交给旧 SDK 直接降级打开。
- [ ] 注入 deferred 进度丢失，证明展示可以回退而输入接纳、执行 intent 和必要恢复记录不丢失；观察通知不冒充持久收据。
- [ ] 交付引擎、运行时、设备条件和故障窗口的验收报告；不满足事务／提交／恢复契约时本票失败，停止依赖交付并比较合格驱动，不静默改用未选存储路线。

## Blocked by

- T01：应用内运行宿主与 SDK 兼容验证。

## Implementation notes

- 已确认：所有产品会话共享一个 SDK Storage，普通业务元数据复用 SDK document／必要 entry，主存储以 SQLite 为目标；原生控制、凭据与草稿具有独立职责。
- 自主细化：优先保留 SDK 的 SqliteStorage，适配已存在的 SqliteDatabase Seam；通过原生宿主的排他运行所有权避免多实例打开。具体引擎由验证结果决定，不增加另一个消息正文库。
- SDK Session 负责提交权威；Adapter 负责真实事务和耐久确认。存储失效关闭执行入口，重开后先核验，不在失败 Session 上无限重试。
- 全库 schema、document 值版本、应用协议版本分别处理；本票验证兼容和故障机制，长期迁移／保留／备份产品闭环交给 T16。

## Test seam

主要从 SDK Session／Storage 的公开行为验证一次会话保存与重开；数据库边界补充事务、runCounted 和故障注入契约。复用 SDK registerStorageConformance 对应固定版本的案例，补充 1.5.0 批次收据和 deferred 进度用例；不测试内部表布局作为产品契约。

## Scope and execution boundary

不在此票建设全部应用表、凭据存储或备份功能。工程、依赖安装、数据库故障实验及设备操作均须后续明确执行授权；本次仅形成 spec，ready-for-agent 不构成执行或破坏设备数据的许可。故障实验只使用专用测试数据。

## Sources

- [ADR 0007：共享 SDK Storage](../../../adr/0007-shared-sdk-storage-for-conversations.md)
- [ADR 0008：SDK document 与 SQLite](../../../adr/0008-sdk-documents-and-sqlite.md)
- [SDK 1.5.0 存储差异](../../../research/pi-sdk-1.5-delta.md)
- [数据权威及真实存储 Interface](../../../research/pi-sdk-1.5-data-authority.md)
- [document 迁移与启动约束](../../../research/pi-sdk-1.5-data-policy.md)
- [旧基线存储契约与 conformance](../../../research/pi-sdk-android-contracts.md)
