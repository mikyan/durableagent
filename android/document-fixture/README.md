# 原文件 Provider 夹具

独立包 dev.durableagent.documentsfixture 只保存专用合成 original.bin，不访问产品数据或用户文件。实际 DocumentsProvider 由系统文件选择器授予调用方 URI 权限；测试控制 receiver 只接受产品及两个固定验证安装的目标包。

NativeDocumentTest.actualSystemPickerRetainsOriginalCapabilityAndBinaryBytesAcrossReopen 使用公开 document.select 界面、真实系统选择器及原生原文件 Interface。根代理安装三个冻结 APK，并以 -e systemPicker true 运行测试；出现 picker-waiting 后，在系统选择器进入“DurableAgent 原文件测试”，选择 original.bin。普通执行不会自动选择任何文档，默认此交互用例跳过，不能把跳过计作通过。

Provider 自有控制读取是独立原件观察入口，二进制期望包含 NUL 与非 UTF-8 字节。初始 RED 候选仅有可观察的未实现原文件能力；后续设备结果及修复范围单独记录，构建成功不表示此行为已通过。
# Shared original fixture

`ControlReceiver` accepts an ordered broadcast with `operation=create-shared`
and an allowlisted `targetPackage`. It creates a new UUID-specific directory
under Downloads through the primary-volume MediaStore Downloads collection,
writes the known nine binary bytes, publishes the row and verifies its recorded
owner and actual location. The reply contains `shared.mediaUri`, `shared.path`,
`shared.relativePath`, `shared.owner` and `shared.documentUri`. An unconfirmed
owner or location is a fixture failure, not a fabricated path.

This follows Android's documented access to app-owned Downloads items and
primary-volume insertion. The actual device result remains separate from that
API basis. [Android shared storage documentation](https://developer.android.com/training/data-storage/shared/media).

`operation=read` independently reads the currently selected synthetic backend
and returns exact base64 plus `writeOpens`. `hold-readback` arms a gate after a
real document write FD opens; subsequent document readback waits for `release`
or a 30-second cleanup bound. The independent control reader does not pass
through that gate. `reset` returns the document fixture to its private original
and clears fixture state; it leaves previously created shared evidence files in
place. `replace` is only supported for the private retained-reader trace.

Root can run the existing real picker test with `systemPicker=true` and
`sharedOriginal=true` to create this shared original and acquire a genuine
persisted document grant. The final evidence includes the actual shared
location. Subsequent native tests may register that same capability in their
own isolated namespace using the already held platform grant.

The exposed path is an observation by the synthetic file's creating owner for
a controlled Termux same-object test. The production document module never
converts a user document URI into a shell pathname. Termux must independently
read the recorded path with its normal granted shared-storage access before
any cross-entry claim is made. No broad cleanup or existing user-file mutation
is performed by this fixture.

