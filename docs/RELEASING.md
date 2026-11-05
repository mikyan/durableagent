# CI 与 GitHub Release

`ci.yml` 在主分支、PR、手动运行和 Release 复用调用时执行：Runtime 的真实 SDK／SQLite 主机测试、UI 测试及构建、Linux 执行端与安装器合同、Android Debug／Release 编译与 lint，以及设备测试 APK 编译。主机合同不代替 Termux、真实 LLM 或 OEM 实测。CI 不访问模型凭据。

`release.yml` 由 `v主版本.次版本.修订号` tag 或指定已有 tag 的手动运行触发。它验证 tag 位于 `main` 的历史中、版本与提交中的发布说明一致，对同一提交执行 CI；然后生成非调试 APK、验证 16 KB ZIP 对齐、用 Release 密钥签名并核对公开证书。相同签名 APK 在全新 Android 16／x86_64／4 KB 模拟器中正常打开产品界面，启动证据成功后才发布 GitHub Release。

发布附件为 APK、`SHA256SUMS.txt` 和 `release-metadata.json`，后者记录源码提交、构建链接、版本、ABI、签名证书及 APK 摘要。启动日志、XML 和截图保留为 Actions artifact 14 天。已公开 Release 不被重跑覆盖；失败留下的草稿可以由同一 tag 重跑完成。

## 版本发布

1. 修改 `android/version.properties`：`VERSION_NAME` 与 tag 对应；`VERSION_CODE` 必须比已发行包增大；`RELEASE_CHANNEL` 为 `prerelease` 或 `stable`。
2. 添加 `docs/releases/v版本.md`，说明行为变化、安装要求、真实验证范围及已知问题。Release 中的链接使用公开绝对 URL。
3. 合入主分支并确认 CI 通过。
4. 在目标提交创建并推送 tag，例如 `git tag -a v0.1.0 -m "DurableAgent v0.1.0"`、`git push origin v0.1.0`。
5. 在 Actions 查看 Release workflow，核对发布页及下载文件摘要。

首个包为 `v0.1.0` 预发布，versionCode 2。APK 同时包含 ARM64 和用于模拟器验证的 x86_64；产品支持承诺仍为 Android 16 起、ARM64。完整 T17 验收未完成时，不把构建成功、启动通过或公开预发布称为整体验收通过。

## 签名

仓库的四个 Actions Secrets：

| Secret | 内容 |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | JKS 文件的 Base64 |
| `ANDROID_RELEASE_STORE_PASSWORD` | keystore 密码 |
| `ANDROID_RELEASE_KEY_PASSWORD` | 私钥密码 |
| `ANDROID_RELEASE_KEY_ALIAS` | 签名 alias |

私钥和密码不进入 Git；只在 CI 签名步骤注入，临时 keystore 在该步骤结束时删除。Gradle、npm、PR 检查和模拟器不接收这些秘密。公开证书 SHA-256 固定于 `android/release-signing-certificate.sha256`，变更签名必须单独评估已有安装的升级兼容性，不自动换新 key。

首个 Release 使用独立签名，不能覆盖同 applicationId 的既有 Debug 签名安装。不要为测试 Release 删除用户或既有验证数据；使用空白设备／独立模拟器。未来更新保留同一签名及递增的 versionCode。

在下载目录运行 `sha256sum -c SHA256SUMS.txt` 核对附件；Android SDK 的 `apksigner verify --print-certs durableagent-v版本.apk` 应显示与仓库公开摘要一致的签名。
