# 最小会话 UI（T04）

React 页面只使用 `runtime/src/application-protocol.ts` 中的数据协议和共享扩展描述符 `CONVERSATION_EXTENSION`，登记 ID 不由 UI 与核心分别硬编码。独立 UI 扩展入口为 `src/extensions/conversation.tsx`；运行宿主的 Agent 入口不进入此构建。没有 SDK、数据库、凭据或通用原生调用接口，也没有示例会话或模型传输。

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

原生先提供 `window.DurableNative.postMessage(requestJSON)`，再加载页面；回调为 `window.__durableReceive(envelope)`，可接受对象或 JSON 字符串。调用者不能把凭据或 SDK 对象放进任何 envelope。协议版本不匹配会显示可识别的连接错误。

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

菜单、详情、重连和分页还具有中文可访问名称，可使用标准按钮角色定位。用户输入应触发 DOM `input`／`change` 事件，避免只修改 React 管理的 DOM value。

10 个公共边界测试使用真实 UI client、controller 和 React。其中 `application-real.test.mjs` 将 React DOM 经公开消息协议接到真实 Application、SDK 与 SQLite，覆盖实际扩展登记后按钮可用、新建／发送、关闭核心后重开同一历史，且模型请求不增加；仅模型传输受控。`npm test` 会先构建运行核心，避免拿旧 dist 进行接线验证。其余测试只模拟外部原生消息传输，覆盖回执关联、旧代次／旧 revision 丢弃、取消订阅不停止、页面重建不重发、配置等待、分页与停止、创建回执丢失后重试、浏览器无宿主、进度与已保存消息的区别，以及包含 9 万个控制字符的长消息折叠／原文展开／收起。这些桌面测试不替代 Android IPC 与设备验收；对应证据由 T04 集成验收记录。
