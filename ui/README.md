# 会话与模型设置 UI（T04／T05）

React 页面只使用 `runtime/src/application-protocol.ts`、`model-protocol.ts` 中的数据协议及共享扩展描述符，登记 ID 不由 UI 与核心分别硬编码。独立 UI 扩展入口为 `src/extensions/conversation.tsx` 和 `src/extensions/models.tsx`；运行宿主的 Agent 入口不进入此构建。页面不持有 SDK、数据库或通用原生调用能力，也没有示例会话或模型传输。API Key 仅经下述原生窄写入接口提交，公开查询不返回 Key。

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

启动时只查询状态；处于 `opening`／`configuring` 时每秒检查一次，最多 30 次，并合并尚未返回的查询。`ready` 之后列表和聊天使用显式动作及推送。用户可重新连接；配置未就绪时不能创建或发送。

本地 UI preferences 只存选中会话 ID 与未收到确认的创建 ID。创建重试沿用后者，收到成功回执才清除。输入草稿只在本页面内存中按会话隔离；此切片不宣称草稿持久化或未知发送结果的自动恢复（T06／T07 承接）。发送未收到确认时保留文本并提示先重新连接查看状态，不自动重发。

历史消息只因协议的持久历史结果标记为“已保存”；流式进度单独显示“生成中 · 尚未保存”。不把 `storedSeq: null`、一次流式事件或界面渲染作为本机已收到耐久收据的证明。

已保存的长消息超过 4000 个 UTF-16 单元时默认折叠，只挂载最多 1000 单元的开头预览，并明确显示“长消息已折叠”和展开按钮。预览边界不切断代理对，控制字符以可见符号标示；原始文本完整保留在 controller，展开后原样显示在有限高度的滚动区域。没有隐藏的全文 DOM 副本。该显示规则减少大历史重建的排版负担，不改变 Interface 返回的历史。

## 设备验收定位

| DOM 定位 | 意义 |
| --- | --- |
| `[data-testid="application"]` / `data-status` | 当前启动状态 |
| `[data-testid="create-conversation"]` | 当前页面的新建按钮 |
| `[data-testid="conversation-item"]` / `data-conversation-id` | 首页真实会话行 |
| `[data-testid="message-input"]` | 当前会话输入框 |
| `[data-testid="send-message"]` | 发送按钮 |
| `[data-testid="stop-generation"]` | 处理中或等待中的停止按钮 |
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

菜单、详情、重连和分页还具有中文可访问名称，可使用标准按钮角色定位。用户输入应触发 DOM `input`／`change` 事件，避免只修改 React 管理的 DOM value。

模型下拉项的 DOM value 为 `JSON.stringify([connectionId, modelId])`。设备测试应按连接卡片的真实 ID 定位；凭据正文不能写入测试日志或 DOM 快照。

16 个公共边界测试使用真实 UI client、controller 和 React。`application-real.test.mjs` 将 React DOM 经公开消息协议接到真实 Application、SDK 与 SQLite，覆盖实际扩展登记后按钮可用、新建／发送、关闭核心后重开同一历史，且模型请求不增加。`models-real.test.mjs` 进一步从空配置经 DOM 添加真实模型定义、窄接口保存合成 Key、设置默认值、完成受控模型聊天，再重开 SQLite；设置查询解密次数为零，发送时才解析凭据，保存的中文／emoji 原文完整。平台凭据边界和模型传输受控，不把桌面内存凭据 fixture 当成 Android 加密验收。

`npm test` 会先构建运行核心，避免拿旧 dist 进行接线验证。其余测试只模拟外部原生消息传输，覆盖回执关联、旧代次／旧 revision 丢弃、取消订阅不停止、页面重建不重发、配置等待、分页与停止、创建回执丢失后重试、浏览器无宿主、进度与已保存消息区别、长消息折叠与原文展开，以及凭据窄写入／移除、版本回执、拒绝后清空密码且不反射秘密。这些桌面测试不替代 Android IPC、Keystore、CE 或设备验收；对应证据由各票集成验收记录。
