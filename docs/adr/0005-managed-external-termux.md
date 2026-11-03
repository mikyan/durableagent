# 优先采用受管的独立官方 Termux

2026-11-03，用户确认优先采用“本应用 + 独立官方 Termux”两个 APK 的部署路线：主 Agent、Pi SDK 状态与恢复决定仍归本应用，Termux 仅提供完整命令与工具环境。
相比保留 `com.termux` 身份的融合 APK 或自有前缀仓库，本方案选择保留官方包生态、不自行维护整套包仓库，代价是首次初始化、跨 UID 文件与执行控制、双方升级和生命周期协调。
正常使用最多只在首次初始化要求人工操作，应用必须提供完整可复制命令与就绪检查；若普通启动与恢复仍反复依赖手工打开 Termux，则必须复审方案，不能降低该要求。

## 后果

- 不因此卸载、替换或清空用户现有 Termux，也不让两侧直接共享 SDK 数据库路径。
- 系统强行停止、权限撤销等阻塞必须单独识别并显示，不承诺绕过 Android 限制。
- 本决定不锁定官方发行渠道／版本、本应用包名、`targetSdk`、通信协议或生产 JavaScript 运行时，也不是安装或编写验证工程的授权。

取舍依据：[打包路线](../research/termux-packaging-options.md)、[完整环境先例](../research/termux-integration-reference-projects.md)、[Aether 补充研究](../research/aether-synthesis.md)。
