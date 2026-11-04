# 原文件 Provider 夹具

独立包 dev.durableagent.documentsfixture 只保存专用合成 original.bin，不访问产品数据或用户文件。实际 DocumentsProvider 由系统文件选择器授予调用方 URI 权限；测试控制 receiver 只接受产品及两个固定验证安装的目标包。

NativeDocumentTest.actualSystemPickerRetainsOriginalCapabilityAndBinaryBytesAcrossReopen 使用公开 document.select 界面、真实系统选择器及原生原文件 Interface。根代理安装三个冻结 APK，并以 -e systemPicker true 运行测试；出现 picker-waiting 后，在系统选择器进入“DurableAgent 原文件测试”，选择 original.bin。普通执行不会自动选择任何文档，默认此交互用例跳过，不能把跳过计作通过。

Provider 自有控制读取是独立原件观察入口，二进制期望包含 NUL 与非 UTF-8 字节。初始 RED 候选仅有可观察的未实现原文件能力；后续设备结果及修复范围单独记录，构建成功不表示此行为已通过。
