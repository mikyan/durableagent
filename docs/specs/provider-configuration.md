# SDK Provider 与登录入口

2026-11-06，用户要求补全当前 Pi AI 的全部 Provider 入口、二级 Token／OAuth 配置，并明确此次开发不新增或运行 Provider 测试。此项后续授权扩展 T05 原先仅 API Key 的范围；不改写历史验收记录。

模型页目录读取固定 Pi AI 1.5.0 的 `builtinProviders()`，展示其聊天模型、API Key 配置及 OAuth 登录方式。目录入口不自动创建连接或发起登录。新连接保留 SDK Provider 的实际 API 与模型元数据；既有 MiMo 和 OpenAI 兼容连接继续按原定义解析。连接身份不随默认模型或会话选择变化。

二级配置使用 SDK 登录交互，支持文本、秘密、选项和手动授权码。所有登录动作与答案走专用原生通道；启动、回答、取消和打开 SDK 授权页面均来自用户操作，普通 Agent 模型设置工具无法发起登录。登录状态只在宿主内存保留，UI 只接收提示、授权页面和状态，不接收访问令牌或刷新令牌。

登录和请求期 OAuth 刷新复用 SDK 实现。凭据存入现有 Android Keystore 保护的私有密文库，刷新采用每连接原生 OS 锁并检查凭据代次。SDK 会被耐久保存的外层请求选项继续使用非秘密标记，真实鉴权仅在私有 Provider 调用中解析。账号、认证种类或目的地配置改变时保留旧连接，要求新建连接；旧 deferred 响应遇到凭据代次变化不盲目恢复。

模型目录是 SDK 支持范围，不等于账号权限或设备实测结果。Google、Vertex、Bedrock 使用 SDK 自带传输；其余 Provider 保留 SDK API，并在支持的 fetch 边界检查 HTTPS 目的地、禁止跳转和清理反射的凭据。调用前检查输入预算和连接状态，输出保持 SDK 错误并过滤凭据。依赖外部账号权限、AWS profile、ADC／服务账号文件或设备浏览器回调的方式，仍受实际 Android 环境约束；缺失时显示认证或请求错误，不伪装已可用。

本次验证范围仅 TypeScript 类型检查、UI 构建与 Android Kotlin 编译；未发起各 Provider 登录或模型调用，不新增或运行 Provider 测试，不宣称全部 Provider 已实测。
