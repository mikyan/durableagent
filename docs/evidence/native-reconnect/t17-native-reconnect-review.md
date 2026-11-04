# T17 native reconnect: bounded independent review

Reviewer: /root/t12_complete/native_reconnect_review. This review read source, frozen artifacts, manifests and existing logs only. It did not execute tests, access ADB, access credentials, or edit product source.

Conclusion: no remaining confirmed blocker in the explicit native reconnect repair. The fixed Android regression establishes that, in a warm emulator run, the rendered reconnect action reopens a failed native owner after an actual conflicting OS lease is released, without changing the retained conversation identity, losing its unsent draft, or submitting input. A healthy reconnect keeps the same native owner. This is a bounded repair review, not final T17 acceptance.

Source pin: HEAD 2942502b49b881322faf21226533b2c5b00a4394 plus six modified production files and the unchanged untracked HostReconnectApplicationTest.kt. The seven current file hashes below were independently recomputed and match both the frozen snapshot and source-hashes.json. Frozen directory: D:/durableagent-validation/t17-native-reconnect-green01. The manifest inventories 423 files; this review independently compared the seven files in scope, not all 423.

| Reviewed file | SHA-256 |
| --- | --- |
| `android/app/src/main/java/dev/durableagent/probe/AgentActivity.kt` | `80c0f4b10f57eab8de7713ed1217c8b0f82e58c962a7b6b07986c53c6e5831e3` |
| `android/app/src/main/java/dev/durableagent/probe/ApplicationClient.kt` | `a2bc1a6e1f8fb3b90024306a3a1b688259a0732ac819b215e4ec44d140afff62` |
| `android/app/src/main/java/dev/durableagent/probe/ApplicationService.kt` | `a1b6abccc3a744929afe2709597f6dbea913290f9c9f72ce0de90ee2077d898a` |
| `runtime/src/application-protocol.ts` | `c71328596950e95ef26c4511be6409a9cfdf9843fa1e959961fe00503cb9b014` |
| `ui/src/controller.ts` | `2d836be97569343df20207b64a4717bff7be186f195b0f1e7530ac0cdd5b85f3` |
| `ui/src/extensions/conversation.tsx` | `b4a36173d6d2f9cc1d4302fbe33c3608f543bad97e9a8926697f73f6b6ca53a6` |
| `android/app/src/androidTest/java/dev/durableagent/probe/HostReconnectApplicationTest.kt` | `ffd46f3a2b120381b2640c81c349c7aabb573bf1f67143d1228fa784461230ed` |

Artifact pins (independently recomputed):

- Candidate app.apk: `dd7dd5ca97c130ff4ef95b59ae53c95910999d35c3664f6bee99f7490e6e5e5a`.
- Fixed test.apk: `7feb882175f1eed0e25e31370ac5dfd6972bbcddeacc6f2eaf107ed9635ace65`. The red01 and green01 APK bytes have the same digest; the red01 saved test source also matches the fixed test source digest above.
- Baseline app E7CF: `e7cf5a6ddff4bc435f513fc727e2ac1f12b93801aefb6570fb8e4457b650bfc0`, as recorded in t12-final-ui01-root-inspection.json and the owner/root run provenance; this reviewer did not reinstall it.

The native path is explicit: AgentActivity.kt:78 intercepts host.reconnect only for the bundled page with a native client. ApplicationClient.kt:45 wraps the correlated request with its constructor-selected mode/run. ApplicationService.kt:220 validates the request, runs on the existing owner queue, rejects closing and other-domain active owners, restores inputNamespace before open, and only opens when node is absent. The normal open path still performs pending-stop recovery, first-unlock enforcement through NativeInputStore, and StorageDomainLease acquisition. Non-null healthy, opening and retained read-only nodes are not replaced. A failed open returns the retained failure reason.

The UI changes separate initial connect from explicit reconnect. controller.ts:46-57 refreshes host state after the correlated native acknowledgement, uses the existing epoch to discard stale responses, and refreshes native input/draft state independently. The button does not create, freeze, retry or send a submission. App has a periodic status poll while opening; that can issue before acknowledgement returns, but the Kotlin main-thread/Messenger/owner queue places message 62 before later status requests. No new confirmed ordering defect was found. Read-only-owner preservation and closing/domain rejection were statically inspected; the Android regression directly covers failed-owner reopen and healthy-owner retention, not every rejection branch.

Fixed regression: HostReconnectApplicationTest#renderedReconnectReopensFailedNativeOwnerAfterActualLeaseClearsWithoutResetOrSend. The test first creates retained empty history and a native unsent draft, closes the owner, acquires the actual OS domain lease in the fixture actor, and observes the rendered storage-owned failure. A click while that lease is held must leave the lease and database bytes intact. It then releases the lease and clicks the same rendered reconnect action. After readiness it verifies original SDK conversation identity, one conversation, empty history, the same draft revision/text, zero send intents and zero model requests. A settings reconnect must retain the ready instance and PID.

Observed logs, read independently:

- RED: unchanged E7CF product plus fixed 7FEB test fails after 17.588 seconds at test line 54, exactly the released-lock rendered-reconnect readiness assertion. Reaching that assertion means the preceding actual-held-lease and retained-database guards passed.
- First candidate attempt: DD7D product plus the same 7FEB test fails after 9.885 seconds at line 42 with Native status timeout during initial fixture readiness. This happens before the lease conflict and reconnect feature assertions. The failure remains retained and is not counted as a feature GREEN or proof that cold startup is repaired.
- Warm candidate GREEN: same DD7D/7FEB pair passes 1/1 in 11.407 seconds. Evidence run 5ad08bd2-e754-4307-ad49-13195915ef77 has SDK conversation 5. The failed state has domainOwned=false/nativeOwners=0; reopened has domainOwned=true/nativeOwners=1. Evidence records sameOwnerAfterHealthyReconnect=true, draftRetained=true, sends=0 and modelRequests=0. The test performs no LLM call.
- Existing focused UI log reports 3 files / 8 tests passed in 507 ms. The existing build/lint log reports BUILD SUCCESSFUL in 30 seconds. This reviewer read those results and did not rerun them.

| Existing evidence log under %TEMP%/durableagent-implementation | SHA-256 |
| --- | --- |
| `t17-native-reconnect-red01-device.log` | `99315fc733d4c57b3b8723dd5d1cff8cd3d58211f100078cd282f52055dac104` |
| `t17-native-reconnect-green01-device.log` | `168f81003676d5878feb77d1555ed972a2ab0a39f99b0b387ae393545b949b5d` |
| `t17-native-reconnect-green02-warm-device.log` | `ed1b94ac6014940bad2f1a24bfa6877a276d653ca8970f4930107ddc3ef24c45` |
| `t17-native-reconnect-ui01.log` | `4b54167adba2e58a950e150d13becb0a24e1550111e0b7b62834d498ab226f5c` |
| `t17-native-reconnect-green-build02.log` | `a262b1a19e0984da0f24bd2bf5039f22f89305d968cd0bbe19d4003c941aeb16` |

Limits: the initial physical Galaxy S23 storage-lock cause is still unknown. This controlled emulator regression demonstrates and repairs the missing explicit retry path; it does not diagnose that original lock, prove post-update cold-start reliability, or resolve the separate intermittent MiMo01 recovery timeout. No extra native retry, reset, owner replacement, input resend, credential operation or device action was performed by this review.
