# T05：模型设置与原生凭据验收

本目录区分生产设置链路、真实云端通信、受控故障、实际进程终止及平台密钥行为。SDK 固定为 Pi 1.5.0；Android 使用已验收的 Javet Node i18n 6.0.3 / Node 26.13.0，SQLite 3.54.0。具体实现契约见 [MODELS.md](../../../runtime/MODELS.md)。

## 支持范围

| Provider / 接口 | 端点与模型 | 实测范围 |
| --- | --- | --- |
| MiMo 中国 Token Plan / OpenAI Completions | `https://token-plan-cn.xiaomimimo.com/v1`，`mimo-v2.6-flash` | Android 设置页面创建连接，密文胶囊直接导入原生 vault，请求时解密并注入 `api-key`；真实聊天后重开，配置与完整消息 ID/原文保持、额外请求 0。 |
| OpenAI-compatible 手工模型 | 受控 HTTP 端点 | 真实 Pi Provider/parser、重试、deferred、compaction、目的地及凭据边界；没有把任意兼容服务宣称为已验收。产品输入仍要求 HTTPS。 |
| SDK MiMo 目录中的其他模型 | 仅目录解析 | 未完成本票逐模型云端验收。MiMo Completions 未声明支持 deferred；deferred 验证来自明确标注的受控 Provider。 |

设备为 Galaxy S23（Android 16/API 36，ARM64，4 KB 页）及 API 36 x86_64 的 16 KB 模拟器。S23 处于首次解锁后再次锁屏：实际 DOM 控件、原生 IPC、密钥与模型链路结果有效，不能冒充物理解锁后的可见交互验收。模拟器设置页另有实际可见截图。未新增、移除或修改真实手机锁屏凭据。

## 验证层次

- 桌面 `npm test --prefix runtime`：[97/97](t05-final-runtime-test.log)。其中共享模型策略 13 项，真正子进程关闭/强制终止与恢复 9 项，其余为已接受基础的回归。测试私有临时目录修正后另重跑同一 13 项，生产请求逻辑未改变。运行时使用真实 SDK 和 SQLite；只有模型端点、故障时刻及凭据平台适配器受控。
- UI：[16/16](t05-final-ui-test.log)，包括实际 React → Application → ModelConnections → SDK/SQLite。设置查询解密次数 0；发送才解析凭据；完整中文/emoji 和重开历史不变。
- Android vault：模拟器和 S23 各 11/11。实际 AES-256、不可导出；模拟器安全等级 0，S23 等级 1（TEE）。均不要求每次认证。S23 `userUnlocked=true`、`deviceLocked=true`、`keyguardLocked=true` 时实际 resolve 成功。
- 实际模拟器重启：`RUNNING_LOCKED` 时返回 `waiting-first-unlock`，没有取得/创建 CE 路径，也未解密秘密；首次解锁后 `RUNNING_UNLOCKED`，诊断 CE 目录此前不存在。测试完成后恢复原有无 PIN 状态。
- 最终第三候选：模拟器 [3/3、18.273 秒](t05-emu16k-third-model-instrumentation.log)，S23 [3/3、15.083 秒](t05-s23-third-model-instrumentation.log)，均无跳过。包括同一 [13 项策略清单](t05-policy-cases.json) 在实际 Android Node/SQLite 上运行、真实 MiMo 一次请求后新宿主重开零重放、真实 React 窄凭据写入与 generation 1→2 后下一请求使用 2。首轮两台各 2/2；第二候选各 2/3 的临时目录失败保留在目录中，不计作通过。
- 真实 MiMo 无效合成 Key：[模拟器](t05-emu16k-third-real-auth-failure.json)、[S23](t05-s23-third-real-auth-failure.json) 均经实际设置、原生 vault 和公开 UI 返回明确 401/failed；不是 Mock 错误。模拟器 [最终错误界面](t05-emu16k-third-real-auth-failure.png) 可见。当前服务端英文 JSON 的中文说明与操作引导留给 T15 体验收尾，未因此篡改本票实测结果。

永久失效使用外部 Cipher 边界的明确故障注入，证明分类、公开状态及原密文保留；不宣称物理硬件发生了永久失效。实际别名丢失、密文损坏、版本不兼容、OS 跨进程锁、专用竞争进程死亡后重获锁均由原生测试覆盖。备份政策保持原状，本票不替代 T16 的备份/恢复实验。

## 恢复与秘密审计

桌面恢复服务器在父进程中记录真实 HTTP 入站，跨子进程生命周期累计；不是重启即归零的子进程计数。相同“已发 A、当前选择改 B”设置下：正常 close 后恢复 A 并解析当前凭据；实际强制终止后允许的重试新 prepare B。一次原始输入及其 ID 保持。deferred 进程终止后只恢复原 A/handle；轮转或停用则明确失败，超过已启用重试退避窗口仍无新 start。已选 compaction 的重试和正常重开仍保持 A，即便当前会话已选 B。

所有持有 generation/compaction/deferred 的检查点窗口扫描实际 DB 与未关闭 WAL，覆盖 K1、K2 和轮转值，关闭后再扫描；有故意植入合成秘密的阳性对照。共享策略另覆盖解码后的错误/SSE/工具参数属性名泄漏、公开 watch、在途 K1 轮转到 K2、鉴权选项注入、环境凭据撤销回退、真实 HTTP 307/308 跨目的地及同源改路径跳转（目标入站 0），以及最终 admission 两个异步窗口。

原生写入只经过窄操作，公开查询没有解密。实际私有 Key 审计由设备协调者在内存中执行，只发布统计，未把 Key 或手机序列号复制进本目录。最终 [模拟器审计](t05-emu16k-third-bounded-credential-audit.json) 扫描 22,946,533 字节应用数据与 119,670 字节 UID 日志；[S23 审计](t05-s23-third-bounded-credential-audit.json) 为 14,588,186 与 272,682 字节，UTF-8/UTF-16LE/UTF-16BE 均无精确私有 Key，阳性对照成功。范围排除不可变运行时包，不声称堆内存或闪存取证。中断的大包扫描不作验收证据。

## 开发过程中保留的失败

1. 原生观察到 Cipher 永久失效后，元数据最初仍显示 configured；真实设备 RED 后改为按密文精确修订缓存安全观察状态，11 项 GREEN。
2. 原始字节过滤不能识别 JSON Unicode 转义的 Key；实际公开投影和 WAL 阳性后加入协议解码后的事件过滤。
3. 解码后工具参数的属性名也能携带 Key；补属性名过滤及真实 parser/SQLite 回归，并保留普通嵌套工具 metadata。
4. deferred 兼容性初检后、最终 fetch 前的轮转，以及最后 metadata 等待期间停用，原先仍可发送；最终 admission 再核对固定 generation 与同步配置状态后为 0。
5. 字节过滤安全前缀可能拆开 UTF-16 代理对；真实 React/SQLite 完整 `你好🌍` 断言捕获并修复。
6. 共享策略首次移到 Android 时，测试临时目录出现 `EACCES`，首个 case 尚未创建模型数据库即失败；设置 `TMPDIR` 未修正嵌入式 Node 的默认目录。改为显式传入应用私有测试根目录，桌面保留其默认值；不把此夹具问题隐去或误报为策略已通过。

这些失败是实现迭代证据，不计作最终通过。没有把受控 Provider 或桌面布局结果写成真实 MiMo/Android 平台验收。

## 工单逐项映射

| 条目 | 实现和通过证据 |
| --- | --- |
| 1：实际设置、目录、真实聊天与支持矩阵 | 真实 React → native vault → SDK → MiMo；最终两台 3/3 和上方限定矩阵。 |
| 2：云端数据说明 | 模型页明确列出聊天、附件、工具结果；UI 测试及 [设备设置页](t05-emu16k-first-settings-top.png)。没有新增审批队列。 |
| 3：默认与当前会话独立 | 共享策略首项及真实 UI/SQLite 用例；新建保存显式 ref，当前 configure 不改默认/其他会话。 |
| 4：prepare、在途、retry、close、deferred、compaction | [9 项实际恢复矩阵](t05-recovery-test-results.md)；实际父 HTTP 服务器跨真实子进程累计与持有响应，固定 SDK 负责调度。 |
| 5：不可变身份及旧定义保留 | 配置共享策略、不同端点/Key 的 A/B 恢复矩阵、禁用状态仍保留定义；新连接无凭据。 |
| 6：最终端点及旧响应边界 | Android 同一共享策略中的实际 HTTP 重定向、覆盖拒绝、未知账号/最终 generation 比较；deferred crash 轮转与停用无替代请求。不可恢复形状使用同一固定非重试错误边界；MiMo 没有虚构 deferred 能力。 |
| 7：Keystore / CE / 首次解锁 / 后续锁屏 | [模拟器 vault 11 项](t05-vault-emu16k-green-instrumentation.log)、[S23 11 项](t05-vault-s23-green-instrumentation.log)、[真实重启未解锁](t05-emulator-preunlock.txt) 与 [首次解锁及恢复原状态](t05-emulator-postunlock.txt)。 |
| 8：失败分类与保留数据 | 原生 11 项及观察状态 RED→GREEN；缺别名/坏密文/未来格式不重置旧记录，UI 给出保留连接和显式重配路径。永久失效为声明的外部 Cipher 注入。 |
| 9：秘密不入公开/持久通道 | Android 13 项的 escaped JSON/SSE/属性名、在途旧 Key、公开 watch、DB/活 WAL，恢复矩阵 checkpoints/compaction、原生加密文件、真实 Key bounded audit。 |
| 10：耐久配置与同步投影一致、启动屏障 | 共享策略 COMMIT 失败、提交后 publication 失败、版本冲突；恢复矩阵到期工作在配置屏障前 0 请求；原有未知文档版本拒绝仍在 97 项回归内。 |
| 11：轮转/撤销/停用/在途并发 | 最终设备 generation 1→2 下一请求；共享策略撤销不走 ambient、两个异步 admission 窗口、已发请求继续；deferred 轮转/禁用保持原 handle 或明确失败。没有撤回已发请求/零重复计费承诺。 |

## 产物与复现

最终第三候选 app SHA256：`FBE33AFD009C0ECCD5FE667516C776568DE5D508F4715665C3CFC51AA8650D12`；androidTest：`3B75E36C7F06F5A9FC560B10E10AAFB73184228FFFC8D5EAEC06F6ADA46BFD38`。原生 vault 独立 GREEN app：`61184224D6A67D71882B5F92638F50D8EB12D37256514DD242AF25C7C08AB122`，test：`E309679A74F0F36771E24743EC1070FFAE69962CD4CD88EF551E2BF2DB73C9B5`；该 vault 生产代码随后保持不变。

[构建与 lint](t05-final-build-lint.log) 成功，0 errors / 4 warnings：两个已知可信 WebView JavaScript、debug-only 首次解锁诊断 receiver 的公开调用、T15 待补的应用图标。修正测试目录后的 [第三候选重打包](t05-third-build.log) 成功，未改变原生代码。[独立 APK 检查](t05-third-apk-inspection.json) 确认 20 个运行时条目及 6 个 UI 资源与工作树逐字相同、4 个 Pi 包均为 1.5.0、两个 native 库与固定 AAR 字节相同且 ELF/ZIP 都符合 16 KB 对齐；SDK `zipalign -c -P 16 4` 通过。固定 i18n native 库来源继续采用 T01 已验收版本。

复现入口、API、窄凭据链路、测试域和限制见 [runtime/MODELS.md](../../../runtime/MODELS.md)。APK 与私有原始运行数据不进入 Git；本目录仅包含整理后的日志、公开结果和截图。根任务负责 GitHub 状态及集成合并。
