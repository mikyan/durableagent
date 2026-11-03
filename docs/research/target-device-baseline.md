# 目标设备公开资料基线

访问及判断日期：**2026-11-03**。范围：Xiaomi 15、Samsung Galaxy S23、计划中的 **Xiaomi Pad 9（按用户提供的名称）**。

> 后续用户确认：两部手机均运行 **Android 16**。这是用户提供的设备信息，不是本轮直接检测结果；下文厂商规格与地区更新记录不覆盖该信息。具体 ROM、ABI、页面大小和权限状态仍待实测。

## 结论先行

- 小米及三星一手资料确认两部手机的芯片型号；这些资料支持继续调查 `arm64-v8a` 运行时候选，**不构成设备兼容性通过结论**。
- 本次未取得可直接核验两款芯片指令集位宽的高通正文，不能把“预期是 ARM64”写成已完成的一手架构核验。芯片型号、Android ABI、具体运行时可用性是三个不同层次。
- Galaxy S23 的首发系统和至少一个地区的后续升级已有官方证据。Xiaomi 15 官方规格列出 HyperOS 2，但本次取得的正文没有明确 Android 底层版本；不能仅靠 HyperOS 版本数字补出 Android 版本。
- 未确认准确型号 Xiaomi Pad 9 的官方规格。**这不等于证明该型号不存在**。不借用 Pad 7、Pad 8 或任何 Pro 型号的数据。
- 用户已报告两部手机均为 Android 16；本轮未直接检测其 ABI、具体 ROM 或系统配置。计划购买的平板没有实际系统记录。

## 一、已确认事实

### 1. Xiaomi 15

| 项目 | 官方资料所能确认的内容 |
| --- | --- |
| 芯片 | Snapdragon 8 Elite Mobile Platform，3 nm；2 个 Prime 核心，最高 4.32 GHz；6 个 Performance 核心，最高 3.53 GHz。[1] |
| CPU 名称 | 官方产品介绍明确写出 Oryon CPU。[2] 名称本身不等于手机公开了 `SUPPORTED_ABIS`。 |
| 原始产品系统基线 | 产品规格页的 Operating System 为 **Xiaomi HyperOS 2**。[1] 这是产品资料基线，不是用户手机当前状态，也不能证明所有后续生产批次的预装版本。 |
| Android 数字版本 | 已读取的产品规格及介绍正文未明确 Android 15；本次不将“Android 15 首发”列为已核实事实。[1][2] |
| 后续更新 | 访问日官方 HyperOS 页面显示 **HyperOS 4**，Xiaomi 15 位于“Starting from mid-November 2026”批次。[3] 相对于 2026-11-03，这是未来发布计划，不是现已可下载或用户已安装的证明。 |

**可用更新的边界：**本次未取得 Xiaomi 15 特定地区／ROM 分支的已发布 OTA 版本记录，因此不宣称 HyperOS 4 已可用，也不把该计划当作 Android 底层版本证据。现有 HyperOS 3 升级情况及其底层版本仍未在本次核验中确认。

### 2. Samsung Galaxy S23

官方 Samsung Mobile Press 的 **Galaxy S23** 页面内嵌规格数据明确列出：[4]

- AP：**Snapdragon 8 Gen 2 Mobile Platform for Galaxy**。
- OS：**Android 13 / One UI 5.1**，作为原始产品／首发规格基线。

提取方式是读取 HTTPS 返回的 HTML 中内嵌文本数据；没有执行网页脚本。虽然规格表部分未出现在简单去标签后的页面正文中，但原始响应包含上述字段。

三星 `SM-S911B/EUX` 官方更新入口链接到英语更新记录。[5][6] 访问时可见：

| 发布日期 | 官方版本记录 | 能支持的结论 |
| --- | --- | --- |
| 2025-10-02 | `S911BXXU8EYI5`，Android 16，One UI 8.0 | 该型号／地区已有此系统的正式更新记录。 |
| 2026-05-21 | `S911BXXU9FZDP`，Android 16，One UI 8.5 | 不应把 One UI 每次变化都当作 Android 大版本变化。 |
| 2026-10-19 | `S911BXXUAGZIF`，Android 17，One UI 9；安全补丁 2026-10-05 | 截至访问日，该分支已有更新至 Android 17 的官方发布记录。 |

**地区与安装状态限制：**这些是 `SM-S911B/EUX` 的公开记录，不是用户手机的型号、地区或固件识别结果。三星页面也明确提示变化依型号、国家和服务提供商而异。[6] 因而不能直接宣称用户的 S23 已运行 Android 17，或所有 S23 分支同时收到该更新。

### 3. 计划中的 Xiaomi Pad 9

本次检查的准确型号候选规格地址：

- 全球站 `https://www.mi.com/global/product/xiaomi-pad-9/specs/`：HTTP 200，但页面标题为“404 - Xiaomi Global”，正文表示页面不可达。[7]
- 中国站 `https://www.mi.com/cn/product/xiaomi-pad-9/specs/`：HTTP 200，但正文显示“页面不见了”。[8]
- 官方全球平板目录入口也已检查，但返回的静态正文没有可核验的准确型号规格。[9]

**确认范围：**本次没有找到可用的准确型号官方规格证据。这是本次检索和静态页面可见性的限制，不是全站穷尽检索，也不是“尚未发布”或“不存在”的断言。芯片、CPU 架构、首发 Android、后续更新计划全部保留为未知；待准确型号的官方规格可核实时继续研究；如用户所指涉及不同地区或型号变体，再确认对应关系。无需为当前运行时研究先决定购买型号。

## 二、推论：对 `arm64-v8a` 候选意味着什么

1. Android 官方 NDK 文档规定：`arm64-v8a` 对应 AArch64，为 64 位 ARM CPU 的 Android ABI。[10] 这是 ABI 的正式定义，不是这三台设备的检测结果。
2. 两款手机的旗舰骁龙型号提供了优先调查 ARM64 候选的依据；**“预计适用”仍是推论**。本次没有成功取得高通产品资料中的位宽／指令集正文，也没有设备 ABI 列表，不能标记为“已确认支持”。
3. 不应把具体 ARM 指令集版本、32 位兼容能力、进程位宽或页面大小从芯片商品名直接推导出来。
4. 即使随后确认设备列出 `arm64-v8a`，也只能确认 ABI 层面的候选匹配；不能因此认定任意 aarch64 Linux 二进制、Android 原生库或某个运行时发行包都可以执行。
5. Xiaomi Pad 9 暂不能计入“已知 ARM64 目标设备”集合。

## 三、仍须设备及系统核验的事项（本次未执行）

- **身份与系统：**准确型号、地区／ROM 分支、实际 Android 版本、API level、构建号、安全补丁日期、HyperOS／One UI 版本。
- **ABI：**检查 `Build.SUPPORTED_ABIS` 与 `Build.SUPPORTED_64_BIT_ABIS` 是否含 `arm64-v8a`；核对实际宿主进程位宽。Android 将这些字段定义为设备支持的 ABI 列表。[11]
- **运行时系统要求：**逐项核对候选构建的最低 API、Android/Bionic 与动态链接器依赖、打包方式，以及应用沙箱／可执行文件位置／子进程限制。这里仅列验证要求，没有给出已验证结论。
- **内存页面：**取得设备真实页面大小，再核对 ELF 与打包对齐。Android 官方说明原生代码在 16 KB 页面设备上有额外要求；不能从 Android 版本或 ARM64 标签直接假定页面大小。[12]

上述检查清单不是授权执行这些检查。本次没有连接或访问设备，没有进行安装、运行测试、性能测试或购买建议。

## 四、证据限制与访问方式

仅使用命令行 HTTPS 读取官方网页及文档响应。没有读取凭据、使用共享浏览器、安装软件、下载可执行文件或执行上游代码；临时响应仅在管道／内存中处理。只写入本 Markdown 文件。

高通官方产品页及产品简介 PDF 尝试返回 HTTP 403 或非资料正文，未取得可引用的架构内容：[13][14]。这些失败不证明产品不支持 ARM64；它们只限制本次证据完整性。三星主站部分页面也返回 403，因此使用成功读取的官方 Mobile Press 与官方固件更新记录。未以媒体报道或设备数据库补齐缺失事实。

## 来源

以下 URL 均于 **2026-11-03** 访问；动态页面今后可能变化。

1. Xiaomi 15 全球官方规格：https://www.mi.com/global/product/xiaomi-15/specs/
2. Xiaomi 15 全球官方介绍：https://www.mi.com/global/product/xiaomi-15/
3. 小米官方 HyperOS 页面及发布计划：https://www.mi.com/global/hyperos
4. Samsung Mobile Press，Galaxy S23 官方产品资料（含内嵌规格）：https://www.samsungmobilepress.com/media-assets/galaxy-s23
5. 三星 `SM-S911B/EUX` 官方更新入口：https://doc.samsungmobile.com/SM-S911B/EUX/doc.html
6. 该入口指向的英语更新记录：https://doc.samsungmobile.com/SM-S911B/025800230221/eng.html
7. 小米全球站 Pad 9 候选规格地址（错误页）：https://www.mi.com/global/product/xiaomi-pad-9/specs/
8. 小米中国站 Pad 9 候选规格地址（错误页）：https://www.mi.com/cn/product/xiaomi-pad-9/specs/
9. 小米全球平板目录：https://www.mi.com/global/product-list/tablets/tablet/
10. Android NDK，Android ABIs：https://developer.android.com/ndk/guides/abis
11. Android `Build` ABI 字段：https://developer.android.com/reference/android/os/Build#SUPPORTED_ABIS
12. Android 页面大小要求：https://developer.android.com/guide/practices/page-sizes
13. 高通 Snapdragon 8 Elite 官方产品页（未取得正文）：https://www.qualcomm.com/products/mobile/snapdragon/smartphones/snapdragon-8-elite-mobile-platform
14. 高通 Snapdragon 8 Gen 2 官方产品页（未取得正文）：https://www.qualcomm.com/products/mobile/snapdragon/smartphones/snapdragon-8-gen-2-mobile-platform
