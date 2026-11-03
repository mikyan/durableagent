# DurableAgent

面向 Android 手机和平板的个人本地 Agent。以会话为中心，在本应用内运行 Pi Durable / Pi AI，由独立官方 Termux 提供完整命令行环境，目标是在可恢复中断后自动续跑。

当前已进入按工单实现与设备验证阶段；实现进度以 GitHub 和工单索引为准，已完成验证的证据保存在 `docs/evidence/`。首版尚未完成全部验收，验证 APK 不是正式发布版本。现有原型 HTML 仍是已确认交互方向的一次性设计参考。

- [首版 spec](docs/specs/v1/spec.md)：产品行为、数据所有者、Interface、失败语义与测试。
- [工单与依赖](docs/specs/v1/README.md)：纵向交付顺序与 GitHub issue 索引。
- [需求](docs/requirements-v1.md)、[术语](GLOSSARY.md)、[技术设计](docs/technical-design.md)、[架构决定](docs/adr/)。
- [界面原型](docs/prototypes/README.md)、[研究证据](docs/research/README.md)。
- [Android 构建与验证](android/README.md)、[运行核心](runtime/README.md)、[原生草稿与固定输入](runtime/INPUTS.md)。

首版基线：Android 16 起、ARM64；本应用以 compileSdk / targetSdk 36 验证；Pi Durable / Pi AI 固定 1.5.0。当前验证运行时为 Javet Android Node i18n 6.0.3，实际通过范围见各工单的设备证据；研究或单项通过不替代整体验收。

项目源码、设计和 issue 统一保存在本仓库。公开仓库不包含模型凭据、设备数据或用户原文件。
