# 运行时候选交叉复核

日期：2026-11-03。仅做只读研究。本轮只写本文，没有修改另外 3 份报告。

复核对象：`android-js-runtimes.md`、`pi-android-reference-projects.md`、`pi-sdk-android-contracts.md`。使用简化技术中文。源码事实、推论和待测项分开表达。

## 1. 主要结论

**“Javet Android Node 先验证，独立 Hermes 后验证”可以保留为有条件的实验顺序。不能把它写成已经证明的架构优劣排序。**

没有发现所查 Javet 构建关闭 `node:sqlite`。不能以这个未经证实的理由降低其排序。真正新增的风险是模块加载：Javet 的 V8 模块入口不等于 Node 的 ESM loader。上游测试明确记录了失败路径。[1–5]

应用拥有的 Node 子进程必须保留在最终比较中。不能仅因已有 JNI AAR，就规定它只能在其他方案全部失败后考虑。它可能减少 Javet 特有的 loader 和 JNI 生命周期适配，但会增加原生执行打包、进程监督和 IPC 成本。此项是推论，不是选型。

## 2. Javet 构建：SQLite 没有被禁用

检查 `6.0.3` 固定提交 `5d51b4eb0bfd4869436c906ce0748b325f445959`。另检查发布标签 `5.0.11`。[1–3]

| 构建 | 实际配置及补丁 |
|---|---|
| `6.0.3` / Node `26.13.0` | workflow 执行 `patch_node_build.ts --os android`。随后使用 API `24` 交叉编译。补丁增加 `--with-intl=none` 或 `full-icu`，以及 `--v8-enable-temporal-support`。没有增加 `--without-sqlite`、`--without-ssl` 或 `--no-browser-globals` |
| `5.0.11` / Node `24.19.0` | workflow 应用 Android patch 文件。配置增加 `--enable-static --with-intl=none`。i18n 变体改成 `full-icu`。所查补丁没有关闭 SQLite |

2 个版本的 `JavetNode.cmake` 都把 `sqlite`、`openssl`、`node`、`uv` 等库加入链接列表。2 个 Node 版本的 `configure_sqlite()` 都使用 `not options.without_sqlite` 设置 `node_use_sqlite`。[2、3]

**源码结论：**这条构建链保留 SQLite。`--openssl-no-asm` 不是关闭 TLS。非 i18n 变体裁剪 Intl，也不是关闭 Node 模块系统。交叉编译关闭 Node snapshot/code cache，不等于删除 SQLite 或 ESM。[1–3]

**限制：**本轮没有检查 AAR 内部，也没有执行 `require('node:sqlite')`。发布物是否与构建链一致仍须验证。必须测试真实 `DatabaseSync`、SDK 迁移和事务，而不是只测试模块名存在。

另须纠正概念：`node:sqlite` 是 SDK 的 Node SQLite Adapter 依赖，不是 portable Harness 的绝对依赖。即使某构建缺失它，也可以评估合格的 `SqliteDatabase` Adapter。不能删除 `STRICT` 或 JSON 约束来绕过兼容问题。

## 3. ESM：比原报告的笼统提醒更具体

源码和测试共同给出以下区别：[4、5]

- `NodeRuntimeOptions.builtInModuleResolution` 默认是 `false`。
- 默认模块实例化进入 Javet 的 `JavetModuleResolveCallback`。
- `JavetBuiltInModuleResolver` 只处理 `node:`，通过 Node `require` 取得对象，再建立 V8 模块。它不是完整 npm package resolver。
- 开启 `builtInModuleResolution` 会转到 Node 的 `ModuleWrap` resolver。
- 但是，Javet 编译的模块没有自动注册为 Node 的 `ModuleWrap`。
- `TestV8Module` 对这类实例化明确使用 `assertThrows`。部分 Node 内建模块测试也接受异常，不能把测试存在当成成功证据。
- 同一测试文件把普通 Javet script 的动态 `import()` 验为 rejected Promise。
- `TestNodeRuntime.testDynamicImport()` 另用 `node:vm` 和 `USE_MAIN_CONTEXT_DEFAULT_LOADER` 测试 Node loader 路径。

因此，不能声称“开启开关即可运行 Pi 的 ESM 包”。也不能反向声称“Javet Node 完全没有动态 import”。必须固定入口和 loader 路径。

SDK 验证必须覆盖静态导入、lazy Provider 的 `import()`、`import.meta`、package `exports`、相对路径及 Node 内建模块。可比较 Node loader 引导和打包产物；不能重新实现 Provider 协议。

**排序影响：**如果启动真实 SDK 需要大量维护自定义 resolver，Javet 的低适配成本假设就不成立。此时必须重新比较独立 Hermes和应用拥有的 Node 子进程，而不是直接把 Hermes 认定为胜出。

## 4. Hermes 与 Moose：证据支持到哪里

Moose 的实际代码支持“Pi 可移植入口可以通过平台 Adapter 接入”。它不能证明“独立 Hermes 宿主已完成”。它使用 RN/Expo 的网络、SQLite、随机数和生命周期。它只注册 OpenAI、Anthropic 和 Codex，并强制 Codex 使用 SSE。打包器明确排除 Google 和 AWS SDK。[6]

因此，Moose 不能消除 SDK 审计中的 Google fetch 注入限制、Bedrock Node 依赖或 WebSocket headers 问题。其 RN `0.88.0` 也不能认证运行时报告固定的 RN `0.82.1` Hermes AAR。

新增源码检查：固定 Hermes 修订 `265ef62ff3eb7289d17e366664ac0da82303e101` 只在启用 microtask queue 时安装 `WeakRef`。`Proxy` 也受运行配置控制。Chord 实际使用这 2 项。宿主必须启用并验证它们，不能用保持强引用的假 `WeakRef` 代替。[7]

`drainMicrotasks()` 还负责清理 kept objects，且当前排空过程无界。因此，“引擎可调用”不等于异步调度、GC 和取消契约已满足。[7]

**判断：**Hermes 作为第 2 个验证候选合理。但它目前没有“平台适配量小于 Javet”的证据。参考项目不能替代独立运行宿主的验收。

## 5. 是否必须先决定 Termux 和设备 ABI

**研究和小范围验证不必等待全部部署决定。最终具体运行时选择必须明确适用条件。**

- **ABI 是直接门槛。**所查 Javet Node workflow 只有 `arm64-v8a` 和 `x86_64`。若目标包括仅支持 32 位的设备，这个现成发布路线不能直接覆盖。[1]
- **Termux 部署不是 JavaScript 核心能力的逻辑前提。**SDK 的存储、模型和执行 Seam 可以先审计。外部 Termux 仍只负责命令，不决定应用必须使用哪个引擎。
- **完整集成成本依赖部署。**双 APK、融合身份或自有环境会改变 UID、文件路径、执行桥和维护成本。最终比较必须纳入这些条件。
- **Node 子进程使执行身份和打包方式更关键。**它必须属于本应用。直接执行的二进制须匹配 Android 的实际 ABI、链接和系统调用条件；Android/Bionic 构建是候选，不是所有应用自有 Node 路线的唯一前提。后续 [Aether 研究](aether-runtime-reference.md)还找到应用私有 PRoot／Alpine 中运行 Node 的实现路径，不能把它误写成 Bionic Node 或外部 Termux 托管。不能借外部 Termux 的 Node 承载主 Agent。可写目录执行限制与执行进程所属应用的 `targetSdk` 有关，不能只看 Termux 的 target。[8]
- **JNI 嵌入与可执行文件启动不是同一机制。**不能把高 target 下的 `execve()` 限制直接推成“Javet 不能运行”。也不能据此断言任何自有 Node 子进程都可以运行。

运行时报告把自维护 Node 放在第 4 顺位，是维护成本偏好，不是源码证明的排除顺序。应在具体部署和 ABI 明确后，比较同一验收闭环的总代价。

## 6. 阻断项与必要验证

现在没有理由因“SQLite 被裁剪”更换第 1 个实验候选。也没有证据批准生产选型。

后续获准时，必须验证：实际 AAR 模块清单；正确 Node loader 路径；SDK SQLite 迁移及崩溃恢复；Provider 增量流和取消；JNI 关闭及重建；Hermes 微任务与 `WeakRef`；目标 ABI 和全部 SO 的 16 KB 兼容。

若保留 Node 子进程，还必须验证合法打包与启动、应用身份、进程监督和停止恢复。所有路线都必须使用既有执行核验契约。

本轮没有下载二进制、运行上游代码、安装包、使用设备、凭据或共享浏览器。

## 一手来源

1. Javet `6.0.3`：[Android Node workflow](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/.github/workflows/android_node_build.yml)、[完整 patch 程序](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/scripts/deno/patch_node_build.ts)、[链接库列表](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/cpp/cmake/JavetNode.cmake)。
2. Javet `5.0.11`：[workflow](https://github.com/caoccao/Javet/blob/5.0.11/.github/workflows/android_node_build.yml)、[android_configure.py.patch](https://github.com/caoccao/Javet/blob/5.0.11/scripts/patches/android/node/android_configure.py.patch)、[configure.py.patch](https://github.com/caoccao/Javet/blob/5.0.11/scripts/patches/android/node/configure.py.patch)、[链接库列表](https://github.com/caoccao/Javet/blob/5.0.11/cpp/cmake/JavetNode.cmake)。
3. Node：[v26.13.0 configure.py](https://github.com/nodejs/node/blob/v26.13.0/configure.py)、[v26.13.0 node.gyp](https://github.com/nodejs/node/blob/v26.13.0/node.gyp)、[v24.19.0 configure.py](https://github.com/nodejs/node/blob/v24.19.0/configure.py)。重点为 `configure_sqlite`、`configure_openssl` 和交叉编译条件。
4. Javet `6.0.3`：[NodeRuntimeOptions](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/src/main/java/com/caoccao/javet/interop/options/NodeRuntimeOptions.java)、[模块实例化](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/cpp/jni/javet_jni_module.cpp)、[内建模块 wrapper](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/src/main/java/com/caoccao/javet/interop/callback/JavetBuiltInModuleResolver.java)、[Node 引导代码](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/cpp/jni/javet_node.h)。
5. Javet 测试：[TestV8Module](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/src/test/java/com/caoccao/javet/values/reference/TestV8Module.java)、[TestNodeRuntime](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/src/test/java/com/caoccao/javet/interop/TestNodeRuntime.java)。本轮只阅读，没有执行。
6. Moose 固定源码：[providers.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/runtime/providers.ts)、[bundle-runtime.mjs](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/scripts/bundle-runtime.mjs)、[polyfills.ts](https://github.com/sugarforever/moose/blob/a48d170309f8587c733a232f6d4fd12c7cc3d6c5/src/platform/polyfills.ts)。进程拓扑依据已交叉检查的 `pi-android-reference-projects.md`。
7. Hermes 固定源码：[GlobalObject.cpp](https://github.com/facebook/hermes/blob/265ef62ff3eb7289d17e366664ac0da82303e101/lib/VM/JSLib/GlobalObject.cpp)、[hermes.cpp](https://github.com/facebook/hermes/blob/265ef62ff3eb7289d17e366664ac0da82303e101/API/hermes/hermes.cpp)。SDK 依赖依据 `pi-sdk-android-contracts.md` 及其中固定 Chord 源码。
8. [Android 官方可写目录执行限制](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)；[Node v22.19.0 嵌入示例](https://github.com/nodejs/node/blob/v22.19.0/doc/api/embedding.md)区分内建 `require`、`createRequire()` 和 Node 事件循环。Android 文档为可变资源；研究日期见文首。
