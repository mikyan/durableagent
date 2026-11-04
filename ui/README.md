# 会话、设置、草稿、可靠发送与项目 UI（T04—T08）

React 页面只使用 `runtime/src/application-protocol.ts`、`model-protocol.ts`、`input-protocol.ts`、`submission-protocol.ts`、`project-protocol.ts` 中的数据协议及共享扩展描述符，登记 ID 不由 UI 与核心分别硬编码。独立 UI 扩展入口为 `src/extensions/conversation.tsx`、`src/extensions/models.tsx` 和 `src/extensions/projects.tsx`；运行宿主的 Agent 入口不进入此构建。页面不持有 SDK、数据库或通用原生调用能力，也没有示例会话或模型传输。API Key 仅经下述原生窄写入接口提交，公开查询不返回 Key。

## 构建与检查

```powershell
npm ci --ignore-scripts --prefix ui
npm ci --ignore-scripts --prefix runtime
npm test --prefix ui
npm run build --prefix ui
```

Node 24.14.1 验证通过。React 19.3.1、Vite 8.3.5 等依赖均固定精确版本，完整解析见 `package-lock.json`。版本与兼容性依据为 npm registry 的包元数据、[React 官方构建指南](https://react.dev/learn/build-a-react-app-from-scratch)和 [Vite 官方指南](https://vite.dev/guide/)。jsdom 29.0.1 与当前 Node 版本兼容；测试环境依赖不打入应用包。

产物为 `ui/dist/index.html` 与 `ui/dist/assets/`。完整目录打包到 Android 资产，由受信任的 appassets HTTPS origin 提供；路径相对，无应用内 HTTP 服务。直接使用 `file://` 可能触发浏览器 ES module 跨源限制。页面 CSP 只允许同源脚本和样式，禁止网络连接；模型请求由运行宿主执行。构建不包含 source map、测试 fixture 或开发诊断控件。

## 原生接线

原生先提供 `window.DurableNative.postMessage(requestJSON)`，再加载页面；回调为 `window.__durableReceive(envelope)`，可接受对象或 JSON 字符串。普通请求及返回的 envelope 不得携带 Key 或 SDK 对象。协议版本不匹配会显示可识别的连接错误。

凭据保存／移除使用独立 `window.DurableNative.writeCredential(requestJSON)`，参数为 `model-protocol.ts` 的 `CredentialWriteRequest`；回执仍通过 `__durableReceive`，内容只有 `CredentialInfo` 或安全错误。缺少窄接口时明确失败，不降级到 `postMessage`。密码输入不进入 React state、controller snapshot 或 localStorage；提交、离开页面和 pagehide 时清空，不回显已有 Key。即使写入错误反射了提交值，公开错误提示也不会显示它。客户端待确认记录不保存写入参数。

“模型与连接”从导航进入，空配置也可添加连接。页面说明聊天、附件与工具结果可能发送到云端，目录模型不等于已通过远端验收。“新会话默认模型”与“当前会话模型”有独立的明确应用按钮；创建连接不会自动保存 Key、选择默认值或改写既有会话。更改目的地需要新连接；停用后仍展示旧定义。配置写入携带读取到的 `expectedVersion`，凭据写入携带独立的 `expectedGeneration`；拒绝或未知结果不会自动重试。相同连接表单的重试保留创建 UUID，修改定义则换用新 UUID。

每次重新连接生成新的 `connectionId`，只接受当前代次的回执和订阅。快照按订阅身份、会话身份、单调 revision 校验；较旧的回执／事件不能覆盖当前状态。初次订阅回执晚于推送时也不会回退。断开只取消 UI 订阅，不请求停止 Agent。页面重建恢复选中的会话并读取当前快照，不重发输入。

“项目与工作区”从导航或会话详情进入。新会话直接使用共同默认工作区；项目名称、工作区名称及路径读取共享目录，页面不复制每会话项目定义。用户可添加工作区记录、创建项目、改名、明确选择当前会话项目或修改工作区目录。填写路径不创建目录、不授权文件访问；界面独立显示 `available`、`unverified`、`missing`、`revoked`、`environment-changed`、`ambiguous` 的真实位置状态及原因，不把配置成功显示为文件环境已验证。位置未核验不禁用聊天。

所有项目写入经同一应用 Interface，携带新 `operationId` 和读取到的目录版本；忙时错误直接呈现，不在 UI 排队。条件解除后的刷新不会再次发出修改；再次点击才形成新操作。丢失写入回执时保留原方法、完整参数与期望版本，暂停其他项目写入，提供“核验这次修改”沿用原身份。已确认的写入即使后续视图读取失败也仍显示已保存。成功后重新读取会话摘要与可信原生草稿上下文，后续发送采用当前关联；历史发送的 binding/receipt 不由页面改写。

启动时并行查询 Agent 状态与独立的原生 `input.list`；处于 `opening`／`configuring` 时每秒检查一次，最多 30 次，并合并尚未返回的查询。`ready` 之后列表和聊天使用显式动作及推送。配置未就绪时不能新建会话；已有原生登记及可信 submissionContext 的会话仍可明确保存发送意图，SDK 接纳等待运行宿主就绪。

本地 UI preferences 只存选中会话 ID 与未收到确认的创建 ID。创建重试沿用后者，收到成功回执才清除。草稿正文与附件只经原生 `input.*` 保存，不写 localStorage。原生目录中的已知会话在 Agent JS 未启动、失败或无响应时仍可打开、编辑与保存；没有已登记身份时不能虚构会话。历史与执行状态等待 Agent 连接，不把恢复的草稿显示为已发送内容。

`DraftCoordinator` 维护每会话的本地 editEpoch、已确认 revision 与单调 stateVersion。最后一次编辑后 250 ms 发起保存，连续编辑最长 1 s；一次最多一个写入，后续编辑合并。界面显示“待保存”直到收到 native COMMIT 回执，空间不足或版本冲突保留本地内容。普通失败可沿用相同 operationId 重试保存；冲突提供保留本地内容并重试或恢复已保存版本的明确选项。恢复读取期间发生的新编辑也不会被旧读回执覆盖。超出 100000 字符的粘贴仍完整保留在当前界面，显示预算错误并要求主动缩短；没有 maxlength 静默截断。未收到保存回执的编辑不承诺进程被终止后仍能恢复。

切换会话先 flush，再按最新导航意图切换；晚到的旧导航不会抢回页面。发送设置短暂保存屏障，flush 点击发送时的 editEpoch 后调用 `input.freeze`；后续键入是独立草稿。随后读取原生控制版本并以新 actionId 提交 `input.createSend`，只有原生意图 COMMIT 确认之后才调用 `send {intentId}`。后者不传正文、token、base64、URI 或路径。同正文再次明确发送使用新身份；重试则保留原 action、固定内容、会话关联、位置与控制代次，不读取当前草稿代替旧输入。

原生意图提交结果未知时保留完整创建参数，仅显式重试同操作；SDK 接纳未知时先调用只读 `sendStatus`，再由明确的重试动作沿用相同 intent。SDK 已接纳但原生 ACK 未落盘时提供“补齐本机发送确认”，仍调用相同 intent 的 send 查回既有 receipt，不重新提交 SDK 输入。只有 accepted 且 native delivery acknowledged 才不再调用 send；状态查询本身不伪装成 ACK 写入。发送状态展示待投递、未确认、已接纳、排队、已放入消息记录与输入结算，明确区分模型是否读取、会话仍运行和外部操作完成。

原生 ACK 事务按 frozen revision 与内容身份清理对应旧草稿；UI 不再单独发 input.clear。UI 以 editEpoch 保留后续编辑，只有已核实的原生清理引起正在保存的新编辑 CAS 冲突时才安全改用该新基线保存。初始草稿读取晚于 ACK 时依 stateVersion 丢弃旧快照。UNKNOWN 不自动重发，不释放固定内容 pin。打开／重连只查原生意图目录、控制屏障和 SDK 状态；发送／重试／停止后的自动状态检查每秒一次、最长 60 s，已发出的查询仍受单请求超时限制，到期可手动刷新。

停止先通过独立原生 `input.stop` 提交屏障和 pendingAbort，不等待 Agent JS；界面区分停止已保存与运行宿主中断已确认。随后只针对该 stopId 请求 SDK 中断，未确认时保留原生事实。后来的停止能拦下仍等控制读取的旧 UI 发送；新一轮工作必须明确新发送。已有接纳 receipt 的迟到 ACK 可补记，但不能解除停止屏障。忙时仍可明确发送 follow-up，停止按钮不受发送请求等待或 JS 不可用锁住。

附件菜单仅提供系统图片／文件选择。选择器请求允许 180 s，未知结果保留操作身份，不自动打开第二选择器。选择之后可自动发起本地准备，UI 明示此时不向云端发送。附件分别展示原件访问状态与本地准备状态，以及实际采用的完整范围、尺寸和转换说明；原件不可用不等于已准备材料丢失。未完成、不支持或预算不足的附件不能作为完整正文发送。发起准备请求时立即显示“正在请求本地准备”，不乐观改写原生准备状态；同时启动每 500 ms 一次的 `input.inspect`，只读已提交的本地状态，不重新读取来源。检查最多 180 次／90 s（已发出的单次检查最多再等 1.5 s），连续 3 次检查失败则停止。准备请求回执的 20 s 超时不会取消独立状态检查，晚到的 ready 仍可显示；到期或检查失败后明确提示手动刷新。原件访问状态标为最近核验结果，显式“刷新附件状态”使用 `input.read` 重新核验来源。准备请求未确认时禁用同一附件的重复准备按钮，文字编辑和移除附件仍可用。作者 revision 不因准备状态变化而增加，UI 依 stateVersion 拒绝过期 read/prepare 回执。所有材料字节都留在原生／运行宿主边界。

历史消息只因协议的持久历史结果标记为“已保存”；纯图片历史即使 text 为空也显示附件类型、大小和摘要，不载入图片原始字节；流式进度单独显示“生成中 · 尚未保存”。不把 `storedSeq: null`、一次流式事件或界面渲染作为本机已收到耐久收据的证明。

已保存的长消息超过 4000 个 UTF-16 单元时默认折叠，只挂载最多 1000 单元的开头预览，并明确显示“长消息已折叠”和展开按钮。预览边界不切断代理对，控制字符以可见符号标示；原始文本完整保留在 controller，展开后原样显示在有限高度的滚动区域。没有隐藏的全文 DOM 副本。该显示规则减少大历史重建的排版负担，不改变 Interface 返回的历史。

## 设备验收定位

| DOM 定位 | 意义 |
| --- | --- |
| `[data-testid="application"]` / `data-status` | 当前启动状态 |
| `[data-testid="create-conversation"]` | 当前页面的新建按钮 |
| `[data-testid="conversation-item"]` / `data-conversation-id` | 首页真实会话行 |
| `[data-testid="message-input"]` | 当前会话原生草稿输入框，保存／发送等待期间仍可编辑 |
| `[data-testid="draft-status"]` / `data-state` | loading／pending／saved／failed／conflict，不代表 SDK 接纳 |
| `[data-testid="add-attachment"]` | 图片／文件紧凑菜单；菜单项有中文可访问名称 |
| `[data-testid="draft-attachment"]` / `data-selection-id` | 附件草稿选择身份 |
| `[data-testid="attachment-source"]` / `attachment-preparation` / `data-state` | 最近核验的原件访问与已提交材料准备的独立状态 |
| `[data-testid="attachment-request"]` | 仅表示准备请求正在等待回执，不冒充 durable preparing |
| `[data-testid="history-attachment"]` | 持久历史中的图片元数据，不含 base64 |
| `[data-testid="send-message"]` | 发送按钮 |
| `[data-testid="stop-generation"]` | 处理中或等待中的停止按钮 |
| `[data-testid="submission-item"]` / `data-intent-id` / `data-stage` | 独立发送身份与真实接纳／排队／放置／结算状态 |
| `[data-testid="retry-submission"]` | 核验同一次发送，或为既有 SDK receipt 补齐原生确认 |
| `[data-testid="refresh-submissions"]` | 只读刷新原生及 SDK 发送状态 |
| `[data-testid="stop-status"]` | 原生停止保存与运行宿主中断确认的独立提示 |
| `[data-testid="history-message"]` / `data-message-id` | 已持久的历史消息 |
| `[data-testid="conversation-status"]` / `data-phase` | 当前会话状态 |
| `[data-testid="toggle-long-message"]` / `aria-expanded` | 展开／收起长消息；所属 article 的 `data-message-id` 标识消息 |
| `[data-testid="message-text"]` | 已保存消息的当前可见文本；展开后为完整原文 |
| `[data-testid="open-model-settings"]` | 导航中的模型设置入口 |
| `[data-testid="connection-name"]` / `connection-protocol` / `connection-endpoint` / `connection-model-id` | 新连接表单；模型 ID 只在兼容协议下出现 |
| `[data-testid="add-connection"]` | 提交新连接定义 |
| `[data-testid="connection-card"]` / `data-connection-id` | 保留的连接定义与凭据元数据 |
| `[data-testid="credential-input"]` / `credential-save` / `credential-remove` | 卡片内密码输入与窄写入动作 |
| `[data-testid="credential-status"]` / `data-state` | 公开凭据状态，无 Key |
| `[data-testid="default-model"]` / `default-model-apply` | 新会话默认选择及应用按钮 |
| `[data-testid="conversation-model"]` / `conversation-model-apply` | 当前会话独立选择及应用按钮 |
| `[data-testid="connection-toggle"]` / `refresh-models` | 连接启停及公开状态刷新 |
| `[data-testid="open-project-settings"]` / `detail-project-settings` | 导航／会话详情中的项目入口 |
| `[data-testid="current-project"]` / `current-workspace` / `current-workspace-path` | 当前会话共享项目名称及配置目录 |
| `[data-testid="current-position"]` / `data-state` | 当前真实位置状态及原因，不代表目录永久授权 |
| `[data-testid="conversation-project"]` / `conversation-project-apply` | 项目选择及显式应用；空值表示默认工作区 |
| `[data-testid="project-name"]` / `project-workspace` / `project-create` | 新项目表单；工作区选项 value 为稳定 ID |
| `[data-testid="project-card"]` / `data-project-id` / `project-rename` / `project-rename-apply` | 共享项目改名 |
| `[data-testid="workspace-name"]` / `workspace-path` / `workspace-create` | 新工作区记录表单 |
| `[data-testid="workspace-card"]` / `data-workspace-id` / `workspace-path-edit` / `workspace-update` | 共享目录修改，原生运行状态决定能否生效 |
| `[data-testid="refresh-projects"]` / `retry-project-change` | 只读刷新／使用原操作身份核验未知结果 |

菜单、详情、重连和分页还具有中文可访问名称，可使用标准按钮角色定位。用户输入应触发 DOM `input`／`change` 事件，避免只修改 React 管理的 DOM value。

模型下拉项的 DOM value 为 `JSON.stringify([connectionId, modelId])`。设备测试应按连接卡片的真实 ID 定位；凭据正文不能写入测试日志或 DOM 快照。

58 个公共边界测试使用真实 UI client、controller 和 React。`application-real.test.mjs` 将 React DOM 经公开消息协议接到真实 Application、SDK 与 SQLite，覆盖实际扩展登记后按钮可用、新建／发送、关闭核心后重开同一历史，且模型请求不增加；另一个真实核心用例在 SDK 接纳后丢失原生 ACK，继续编辑新草稿，再显式补确认，验证 2 次同 intent send 只有 1 次模型请求，新草稿保留，而同正文新动作产生第 2 次输入。`models-real.test.mjs` 进一步从空配置经 DOM 添加真实模型定义、窄接口保存合成 Key、设置默认值、完成受控模型聊天，再重开 SQLite；设置查询解密次数为零，发送时才解析凭据，保存的中文／emoji 原文完整。原生草稿／发送／凭据边界和模型传输受控，不把桌面 InputPlatform 或内存凭据 fixture 当成 Android SQLite／SAF／加密验收；真实核心测试均通过原生 intent 接入真实 SDK。

`npm test` 会先构建运行核心，避免拿旧 dist 进行接线验证。其余测试只模拟外部原生消息传输，覆盖回执关联、旧代次／旧 revision 丢弃、取消订阅不停止、页面重建不重发、配置等待、分页与停止、创建回执丢失后重试、浏览器无宿主、进度与已保存消息区别、长消息折叠与原文展开，以及凭据窄写入／移除、版本回执、拒绝后清空密码且不反射秘密。这些桌面测试不替代 Android IPC、Keystore、CE 或设备验收；对应证据由各票集成验收记录。


T06 的公共输入测试覆盖 commit 前待保存、250 ms／1 s、单写合并、丢 ACK 的稳定操作身份、版本冲突显式恢复、旧准备回执、发送／清空期间 ABA、点击发送时的固定边界、选择超时不自动重开、超限正文不截断、恢复读取期间继续编辑、原生离线恢复与切换 flush、保存失败阻断发送、未知接纳保留 pin 且重连不重发，以及附件状态／纯图片历史显示。追加覆盖选择取消后新操作、从读取的 durable operationId 解决选择回执丢失、慢准备请求前后独立状态检查、请求超时后的晚到 ready、90 s／连续失败上限、手动来源刷新和准备中编辑／移除可用。实际 Android 进程重建、存储故障、SAF 访问和材料恢复由 T06 主实现设备套件验证。

T08 追加公开 UI 测试覆盖共享目录／项目的真实表单、未核验位置提示、忙时拒绝后无延迟应用、显式新动作、回执丢失时原参数与操作身份、确认后读取失败的独立状态。`projects-real.test.mjs` 使用真实 Application、SDK 和 SQLite：native pending intent 在 UI idle 时阻止改绑；旧输入结算后只读刷新不修改，明确重试才成功；新输入采用新的 association 与 binding，改名保持绑定，重开保留共享名称、原 receipt 与历史且没有额外模型请求。原生 fence/草稿边界使用 InputPlatform，Android 的独立原生存储与实际工具环境由 ProjectApplicationTest 及主实现套件验证。
