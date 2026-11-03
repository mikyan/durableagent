# Termux 打包、前缀与包源兼容性

核验：2026-11-03。仅用命令行 HTTP 读取上游文档、源码；未安装、执行下载程序或访问设备。`master` 与 Wiki 可变，实施前必须固定版本。

## 结论先行

**最少改变官方包生态的路线，是保留真正的 `com.termux` 环境及官方目录。完整 Termux 不等于合并成单 APK。** 独立 Agent APK 配合现有 Termux 可以保留官方包源；自动启动与运行管理另行验证。不默认用户同意替换现有 Termux。若必须使用自有应用 ID、独立私有目录并原生执行，必须承担自有前缀的包重建与仓库维护。[1][2]

已确认的 WebView + Kotlin、TypeScript + React + Vite、独立运行宿主进程、Pi Durable／Pi AI 均不决定 APK 身份。本文不选择 JavaScript 运行时，不引入完整桌面 Node/HTTP 后端。

## 已知事实

- **官方前缀**：官方仓库针对 `com.termux` 构建；rootfs 为 `/data/data/com.termux/files`，`$PREFIX` 为 `/data/data/com.termux/files/usr`，默认 home 为 `/data/data/com.termux/files/home`。程序、库和脚本含构建期路径。官方文档要求主用户 `0`；工作资料、次用户及其他安装位置不能直接假定兼容。构建系统允许自定义 ID，但这不是官方二进制仓库支持其他 ID。[1][2]
- **改名的边界**：只改显示名称不改变前缀；改 `applicationId` 后，将官方包解压到新私有目录、设置 `$PREFIX` 或复制 `bootstrap` 均不够。上游明确要求重新编译，不支持混用不同 ID／前缀的包。[1][3]
- **自有仓库**：统一修改应用常量、构建属性、路径和必要的插件引用；按目标 ABI 重建 `bootstrap`、所提供的全部包及依赖闭包。维护 APT 索引、源地址、信任密钥、更新和回归测试。只重建 `bootstrap` 不会获得官方仓库后续兼容性；要接近官方包覆盖面，就必须持续维护相应包集合。[1][3][4]
- **同 ID 不可并存**：自有 `com.termux` APK 不是第二个独立应用。兼容签名的安装属于更新；不同签名通常安装失败。不能把卸载现有 Termux 当作默认前提。[3][5]
- **两套签名必须区分**：APT 通过 `termux-keyring` 的 GPG 密钥信任包源；这不是 Android APK 签名。自签 APK 本身不要求重签官方命令包，但必须保持路径和执行兼容。官方 Android 附加 APK 则使用 `sharedUserId=com.termux`，必须与主 APK 同签名。F-Droid 与 GitHub 签名不同；GitHub 使用公开测试密钥，不宜把它当作个人应用的可信身份。独立 Agent 通过授权 API 交互，不等同于加入共享 UID。[3][4][6]
- **当前 SDK**：`termux/termux-app` 的 `master` 为 `targetSdkVersion=28`、`compileSdkVersion=36`、`minSdkVersion=21`。这是该分支事实，不是所有渠道的统一值；上游明确将 Play 版本列为独立实验仓库。[3][7]

## 兼容层与未证明事项

`termux-exec` 可通过系统链接器处理较新 target 的执行限制，并将执行入口的 `/bin/*`、`/usr/bin/*` 映射到 Termux 前缀。**它不是整个文件系统的前缀重定位器**，不能据此认定官方包可直接迁移到自有 ID。直接系统调用、静态 ELF 等还有覆盖限制；执行许可与硬编码路径是两个问题。[8][9]

`PRoot` 的路径转换已有上游实现；当前 `proot-distro` 也描述了 Termux 类型容器。但“自有 APK 内映射官方前缀，长期无修改使用整个官方仓库”在本项目尚未验证。这条路线需要兼容层，不是官方原生支持；必须验证包安装／升级、子进程、库加载、嵌套跟踪和性能。上游明确记录 `ptrace` 开销及不支持嵌套等限制。[10]

上游的 Dynamic Variables 方案旨在逐包去除路径硬编码，先覆盖 bootstrap 和常用包；不能把方案目标当作整个仓库已经可重定位的证明。[11] 保留完整 Termux 也不保证任意 Linux 二进制、内核功能或需要 root 的包可运行。

## 一手来源

1. [Building packages：Build Command Config](https://github.com/termux/termux-packages/wiki/Building-packages#build-command-config)；[当前构建属性与官方仓库前缀](https://github.com/termux/termux-packages/blob/master/scripts/properties.sh)。
2. [Termux 文件系统布局](https://github.com/termux/termux-packages/wiki/Termux-file-system-layout)。
3. [Termux README：Installation、Forking、Google Play](https://github.com/termux/termux-app/blob/master/README.md)；[TermuxConstants 的改名说明](https://github.com/termux/termux-app/blob/master/termux-shared/src/main/java/com/termux/shared/termux/TermuxConstants.java)。
4. [Bootstrap 构建说明](https://github.com/termux/termux-packages/wiki/For-maintainers#bootstraps)；[APT 源配置](https://github.com/termux/termux-packages/blob/master/packages/apt/build.sh)；[termux-keyring](https://github.com/termux/termux-packages/blob/master/packages/termux-keyring/build.sh)。
5. [Android：application ID 与更新证书](https://developer.android.com/build/configure-app-module#set-application-id)。
6. [Termux RUN_COMMAND：权限与外部调用授权](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent#setup-instructions)。此处仅用于区分身份模型，不据此宣称自动启动已通过验收。
7. [termux-app 当前 gradle.properties](https://github.com/termux/termux-app/blob/master/gradle.properties)。
8. [termux-exec 技术说明](https://github.com/termux/termux-exec/blob/master/site/pages/en/projects/docs/technical/index.md)。
9. [Android 10：可写应用目录执行限制](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)。
10. [Termux proot-distro：实现、环境变量、限制](https://github.com/termux/proot-distro/blob/master/README.md)。
11. [Termux：Dynamic Variables 设计目标](https://termux.dev/en/posts/general/2024/11/11/termux-selected-for-nlnet-ngi-mobifree-grant.html#dynamic-variables)。
