# 使用 WebView 界面与 Kotlin 原生宿主

2026-11-03，为支持 timeline 这类可自带交互界面的扩展，以及聊天、Markdown、文件 diff 和手机／平板响应式布局，选择 WebView 承载正式页面，以 Kotlin 提供 Android 原生宿主，而不是将正式 UI 和扩展界面统一写成 Compose。
我们接受原生通信安全、键盘与文件选择适配、长列表和流式渲染验证等成本；Agent 的执行、恢复与权威持久化不依赖页面生命周期，原型代码也不因此直接成为生产实现。
本决策不引入完整桌面 Node/HTTP 后端，不选定具体 Web 框架、Agent JavaScript 运行时、应用进程划分或命令行执行环境。
