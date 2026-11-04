# 原生草稿与固定输入（T06）

`input-protocol.ts` 定义共享数据契约。React 的 `input.*` 消息在 `AgentActivity` 内先路由到 `NativeInputBridge`，不进入 ApplicationService 的 Node owner 队列。保存使用独立原生执行器；来源读取和转换使用另一个执行器。原生平台 SQLite 与 SDK 的 SQLite 域分开，应用私有 CE 的 `noBackupFilesDir/input-v1/` 保存草稿、必要内容和持有关系。已知会话目录与能力只是核心发布的公开缓存，不是第二份 SDK 会话登记，也不允许离线凭空创建 SDK 会话。

代理细化：界面原生工作线程在进入元数据操作前最多等待 1 秒取得跨进程锁，以容纳宿主的短事务发布。等待发生在事务与动作开始之前，不重跑动作、COMMIT 或响应；持续占用仍返回可见的 `INPUT_STORAGE_BUSY`。来源 I/O 不持有该锁，主界面不执行这段等待，直接使用存储的其他调用者仍默认立即返回忙碌。

等待时长是每个存储实例的线程可见设置；配置本身不获取全局存储锁，因此新建界面桥不会因旧工作线程正在等锁而被挡住。每次操作只在开始时读取一次等待时长，后续配置不会延长该次期限。

`revision` 标识作者的文字与有序附件选择；`stateVersion` 排序所有公开状态提交，包括准备结果和来源核验。写入携带期望 revision、稳定 operationId 及内容。事务提交返回后才确认保存；同操作身份的重试不重复创建，内容不一致拒绝。save/clear/freeze 保留该次固定回执；select/prepare 在同一操作身份下返回该任务最近记录的已提交快照，可能包含并发提交的文字；它不保证是当前全局最新状态，`input.inspect` 才读取当前状态。UI 仅在没有新本地编辑时采用完整新快照，有新编辑则保留并继续显示待保存。清空仍递增 revision，UI 另以 edit epoch 防止旧发送/保存确认清掉后来输入的相同文字。UI 自动保存初值是最后编辑后 250 ms、连续编辑最多等待 1 s；每会话只有一次写入在途，切会话与发送有 flush 屏障。未确认编辑不承诺突然终止时零丢失。

来源 URI、实际访问情况、准备任务、不可变表示与持有关系分别记录。URI 不暴露到 WebView；来源需要重新实际打开核验，不以文件名、mtime 或 size 代替内容身份。转换在 SQL 事务和元数据锁之外运行；写完整暂存文件并 sync、同文件系统发布后，短事务挂接 ready 表示与持有。移除或重新选择后的旧任务不能挂回。固定 token 的持有独立于草稿，清草稿不会删除旧 token 仍引用的内容。GC 仅处理经过持有核验的应用自有对象，不删除用户原件。

`freeze` 在原生侧固定本次文字与有序表示，返回 metadata/token，不表示 SDK 已接纳。内容摘要使用 SHA-256：先写 UTF-8 `input-v1\n`，随后逐字段写入 `<UTF-8字节数>:<字段UTF-8字节>`；字段依次为文字、表示数量，再逐表示写入 kind、mimeType、sha256、byteLength 十进制字符串、range。会话身份/revision/对象身份另由原生 token 记录绑定。文字中的孤立 UTF-16 surrogate 拒绝保存，合法中文与 emoji 保持原样。

代理细化的支持与应用预算如下，均不表示设备或云端最大能力：

| 对象 | 当前规则 |
| --- | --- |
| 草稿文字 | 100,000 个 UTF-16 code units；超限拒绝，不截断 |
| 当前附件 | 最多 4 项 |
| UTF-8 文本 | text/plain 或 text/markdown 完整正文最多 256 KiB；严格解码且保留 BOM；没有 PDF/Office/OCR 转换 |
| PNG/JPEG 原件 | 最多 16 MiB，解码头尺寸不超过 24 × 1024² 像素 |
| 图片表示 | 完整画面按方向解码；边长最多 1024 且服从已知模型更严限制；PNG 保留透明度，JPEG 明示重新编码质量；最多 1.5 MiB |
| 当前固定输入 | 图片 base64 合计最多 8 MiB；base64 大小是 `4 × ceil(字节数/3)` |
| 最终 Provider 请求 | 完整序列化 JSON（含历史、转义、base64）最多 10 MiB，或模型声明的更小 maxRequestBytes；同时检查实际模型的历史图片数量、尺寸和 base64 限制 |

另有独立的编码前保守检查：按原始 transcript（含元数据）的 JSON 字符/转义成本累计到 10 MiB，嵌套最多 128 层，超出时不进入 Provider encoder。它使用有界遍历，不先构造另一份大 JSON；其估计不等于实际 Provider body 字节数，可能更早拒绝。它减少编码阶段的额外分配，不承诺 SDK 载入完整历史时的全部内存峰值；最终序列化 body 仍独立精确核验。

能力缓存不解密凭据、不联网。固定 SDK 1.5.0 的 MiMo 目录声明 text/image，通用兼容连接只声明已知的 text。`input.ts` 在显式发送时通过可信原生 adapter 读取固定对象，核验长度/hash/digest/会话与当前能力后构造 SDK 的 text/image 数组；图片必须使用真实 base64 字节，不能用 URI/path 充当正文。UI 历史只收图片 MIME、长度与 SHA-256，纯图片消息也有可见摘要。

SDK 的 `transform-messages` 会把不支持的图片替换成占位文字。因此应用在 Provider invoke 前先检查原 transcript 的模态，再在最后 fetch 前检查实际序列化 body；两者都先于真实凭据解密及 HTTP 传输。模型改变、历史增长或重试时重新核验，不修改旧固定版本。超限/不支持明确失败，不能以占位文本当作图片已经送达。

T06 沿用显式发送入口接入固定 token；SDK 确认后仅按相应 revision 清空。未确定接纳时保留 token 和草稿，不自动重发。原生发送意图、SDK 原子接纳映射、丢确认后的可靠恢复与持有交接是 T07 的后继门槛，本票没有用两个独立数据库承诺跨库原子事务。

验证使用真实 Android SQLite、受控 DocumentsProvider、实际 React 和固定 Pi SDK；模型传输故障可以受控，但不能据此称云端图片识别通过。共享 `validation/input-policy.mjs` 同时在桌面和 Android Node 运行。实际设备通过项、原始失败与平台范围见 [T06 验收证据](../docs/evidence/t06/README.md)。云备份与 D2D 配置继承已排除的九个域；OEM 实际迁移仍由 T16 验收。
