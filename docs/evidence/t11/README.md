# T11 durable stop and generation fencing evidence

Implementation: [runtime/STOP.md](../../../runtime/STOP.md). The SDK remains the
conversation/task scheduler. Native SQLite owns the durable stop and final
effect-admission fence; the paired Termux executor supplies process evidence.
This is a scoped development gate, not the T17 physical-device matrix or T12
automatic background recovery.

## Artifacts and environments

| Candidate | App SHA256 | Test SHA256 |
| --- | --- | --- |
| Full01 | `e5e1e8a7261c983a34d067940da46b3f1355e70d1ddda41502a42a68173d750d` | `49c3545e77269b70511557f8f4de3b20d1b087ad63fdc695323c86a8ca2d3e7e` |
| Notification diagnostic, error category only | `596a72c94fe01d32aafdb97445be160ef8315e2441bc0d504b2ace72ca898505` | same Full01 test |
| Second-stop RED | same Full01 app | `6b1eb46f8ca50d3855f16b6998810f54751a955287ffcff69f62f44ca362c0d5` |
| Full02 coalescing / admission acquisition fix | `f452d0272a39cbd9834627dfef64992b087902a94a606b85f67e0814140f4ee9` | `b676f370082a93a177c54d9d74db095187f1b7f388a46e87f256f92608031800` |
| Final narrow lint annotation | `3ddbae2cf26a8034c95351211fbd80843fb3eb87cb2430667fb95fb40c96c6ae` | same Full02 test |

Early native slices used Android 16/API 36, x86_64, **16 KiB pages**. Full01's
24-method batch and later busy, migration and second-stop tests used a separate
fresh Android 16/API 36 x86_64 emulator with **4 KiB pages** (fingerprint
`google/sdk_gphone64_x86_64/emu64xa:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`).
Cross-environment results are not described as the same-device RED/GREEN pair.
Actual Termux and MiMo tests used Android 16/API
36, x86_64, **4 KiB pages**, the existing paired production executor and dedicated
synthetic work. No existing app/Termux data was cleared, daemon replaced, or
unrelated process killed. Samsung/Xiaomi and pre-unlock stopping remain outside
these results.

All four Pi packages remain 1.5.0 and the Javet Node i18n dependency remains pinned.
The final lint-only annotation does not change runtime behavior. The test APK
is byte-identical to Full02. Device results below retain their actual artifact
identities rather than being relabelled as runs on the final annotation APK.

[Final independent APK inspection](final-apk-inspection.json) matched **58 runtime
entries, 11 UI resources and 165 source files**. Both native libraries match the
pinned i18n AAR and satisfy ZIP/ELF 16 KiB alignment; the bundled executor setup
also matches. Comparing Full02 with the final inspected sources found only the
documented `NativeStopService.kt` annotation/comment change. The owner's smaller
[source freeze](source-hashes.json) lists 156 files in its explicitly selected
source directories; [artifact metadata](artifacts.json) records that scope.

## Actual device results

[Full01 native/SDK batch](t11-full01-native.log): **23/24 passed**, zero skipped,
40.717 seconds. Passing methods include shared actual SDK/SQLite abort scopes,
three busy-owner cases, legacy submission/stop crash windows, native effect
identity and unknown evidence, and retention migration regressions. The one
failed v6 hold fixture lacked a model capability before freezing its test input.
With that test-only prerequisite corrected, the identical Full01 app passed the
v6 case in the [second-stop RED batch](t11-second-stop-red02-device.log).

The three busy-owner scenarios use a real 15-second JavaScript loop, native stop,
an immediately saved explicit new input, and actual owner PID replacement. They
keep the original **9-second** rebuild deadline and **1.6-second** writer hold.
Full01 recorded native acknowledgements of **135/32/85 ms**, replacement plus
new-input processing of **4558/5995/4307 ms**, and different owner PIDs. The old
submission remained `unanswered`; the one post-reopen model request belonged to
the already-saved **new explicit generation**, not old replay. Bootstrap was
observed in `opening` before the injected loop. A later unsent draft remained
unchanged. Missing read-only Binder observations can be retried within the
original deadline; mutation requests are never replayed by that observer.

[Full02 actual notification](t11-full02-notification.log): **1/1 passed**, zero
skipped, 19.779 seconds. An actual immutable notification action was delivered
after UI destruction while Node was busy. Target execution `1ac5b4f0…` ended
`stopped`, exit -15, `scopeConfirmed=true`. Execution `a32559f9…` in another
conversation was still running and had no cancellation request at that point.
The runtime PID changed **25388 → 25544**. The explicit generation-2 verifier
`9842b615…` completed with exit 0, found the delayed-effect file absent, and the
later draft was preserved. Repeating the old notification after this new input
did not stop generation 2. The recorded 9037 ms spans the whole scenario after
notification delivery, not merely native acknowledgement or the rebuild deadline.
The unrelated fixture was subsequently stopped by a separate explicit cleanup.

Root separately inspected the actual persisted Termux receipts and original files
through its own read-only terminal probe after both Full02 scenarios:
[notification observations](original-effects-notification.json) and
[real MiMo observations](original-effects-real-mimo.json). The old delayed-effect
files were absent and the new-generation verifiers completed with exit 0. These
observations preserve the notification witness's later explicit cleanup as a
separate event from its uncancelled state at the target-stop assertion.

[Full02 real MiMo](t11-full02-real-mimo.log): **1/1 passed**, zero skipped,
42.384 seconds, following the earlier [Full01 live pass](t11-full01-real-mimo.log)
of 22.685 seconds. MiMo made one request that invoked an actual supervised Termux
command. Direct native stop produced a confirmed stopped scope; the old SDK
input became unanswered, and **zero old follow-up requests** occurred at the
observed boundary. A new explicit generation invoked a genuine model/tool
verification and completed with exit 0. **Three total HTTPS requests** were
observed: one old request and two new-generation requests. This does not promise
zero repeated provider billing after arbitrary process/network failures. The
Full02 reran this live flow after the service changes: original execution
`5c692a1e…` was scope-confirmed stopped; generation-2 verifier `3e26deba…`
completed with exit 0. The final annotation changes no service behavior.

The [same-namespace second-stop regression](t11-second-stop-green01-device.log)
passed **1/1 in 0.849 seconds**, using exactly the RED test APK on Full02. Both
native stop barriers remained pending while each synthetic SAF effect was
actually examined and retained as unknown. This proves that an active job no
longer drops the second request. It deliberately does **not** claim that the
native command worker can cancel a blocked document-provider write.

## Persistent facts and shared checks

- [Full runtime suite](t11-host-runtime-full.log): **183/183 passed**. The two new
  shared stop cases use real Pi Durable/SQLite and include a surviving owned
  background descendant and an ownerless fork inheriting the control owner.
  An abort callback is held; a fresh native generation is saved but cannot enter
  SDK admission until the complete old scope is terminal. Android runs these
  same two callbacks, not a mirrored implementation.
- [Full UI suite](t11-host-ui-full.log): **76/76 passed**, including honest
  SDK-pending/external-unknown/completed projections and explicit notification
  setup. The actual notification test validates the native system route; this
  ticket does not claim a new physical-phone visual acceptance.
- [Final build/lint](t11-final-build-lint.log) passed in 10 seconds, **zero errors,
  twelve warnings**: four intentional fixed Termux paths, one pinned mutual-TLS
  trust-manager check, three pinned dependency updates, two bundled WebView JS
  uses, one debug receiver and the T15 app icon. The pinned lint 31.13.2 detector
  reported a missing foreground-service type even though both merged/packaged
  manifest and actual service execution use `shortService`. A forced full lint
  rerun reproduced it. Only that check on `NativeStopService.onCreate` is
  suppressed with an explanatory comment; no other lint check or service type
  was changed. The manifest declaration and explicit runtime type remain.
- Native public interfaces reject late old-generation prepare/start, mismatched
  digest/namespace evidence, and stale evidence that would downgrade confirmed
  terminal facts. Sixty-five target effects cross the page boundary; an unknown
  first entry does not starve later entries or touch another product.
- Published native v6 upgrades to v7 preserve T16 text-only frozen holds and stop
  facts. An injected migration failure leaves version 6 intact. The new effect
  catalogue stays unverified until SDK intent inventory finishes, including when
  the executor is unavailable. The unpublished v5 development fixture is not
  silently treated as a known released layout.
- Real separate-process native stop commit windows are included in the retained
  Full01 regression batch. T07 identity/ACK and T09 authenticated process scope
  contracts remain intact. The service never uses command similarity, a broad
  Termux kill, or `Harness.close()` as evidence of a user stop.

## Earlier failures and their resolution

Every listed log is retained with a SHA256 in [retained-log-hashes.json](retained-log-hashes.json).
These are scoped runs, not a fabricated combined all-green test batch.

| Run | Observation / resolution |
| --- | --- |
| Native RED01 / RED02 | RED01 seed lacked `model`, before the target boundary. RED02 reached the expected missing-native-catalogue failure. |
| Native GREEN01 / GREEN02 | Old test APK required the no-argument `stoppedEffects()` JVM ABI. Restoring the overload gave GREEN02 on the same test. |
| Native RED03 / GREEN03 | Wrong digest evidence was initially accepted; identity validation now rejects it, preserves unknown, and rejects terminal downgrade. |
| Native RED04 / GREEN04 | Zero of 65 target effects were visited before sweep implementation; same test then passed across pages with unrelated work untouched. |
| Busy RED01 / RED02 | RED01 timed out before cold readiness. RED02 reached real JS busy/native commit and failed the original 9-second reconstruction bound. |
| Busy GREEN01 / GREEN02 | First actually rebuilt but lost a read-only Binder reply. Second actually failed to rebuild; it is not labelled an observer-only failure. |
| Busy diagnostic / identity01 | Rebuild succeeded but the test incorrectly expected zero model requests. Public receipt/history proved the one request was the explicitly saved new generation; the identity assertion passed. |
| Upgrade RED / GREEN | An empty newly-added catalogue falsely implied external completion. Migration now starts it unverified; the actual same-device test passed. |
| Held-writer RED / first GREEN | First control acquisition exhausted 1 second; later replacement exposed native startup contention and one uncertain fresh intent. Both failures retained. |
| Lease GREEN / native lease fixtures | Trusted host acquisition waits before entering the action, without replaying a transaction. Both busy cases passed; a flawed same-process-monitor lease fixture was corrected to hold the real OS lease independently, then passed. |
| Bootstrap RED / Full01 | The old watchdog required `ready`, so opening JS could stall it. Full01 watches actual JS progress during bootstrap and passed the original test/deadline. |
| Full01 notification | Durable stop was not observed; the dedicated delayed file actually appeared and the command completed uncancelled. The original admission error category was discarded, so its exact cause is **unknown**. |
| Notification diagnostic | Target was truly stopped and the other scope untouched, then a single readiness read timed out after PID replacement. No admission error was observed in this round. Short read-only polling within the same 90-second total budget passed in Full02; this does not prove the first failure's cause. |
| Second-stop RED / GREEN | The active namespace dropped a later stop after its initial sweep. Request-version coalescing and atomic exit/handoff now examine it; unknown effects do not cause endless self-retries. |

The notification intake now waits up to 1500 ms **before** entering its native
action and records a safe error category if admission fails. Neither this wait
nor a missing response is permission to retry a partially committed mutation or
invent a new action identity. User-visible failure says the result is unconfirmed.

## Scope limitations and security checks

[Final Full02 root credential audit](t11-full02-credential-audit.json) scanned
**16,694,272 app-data bytes and 273,238 UID-log bytes** for the actual key. The
earlier [Full01 audit](t11-full01-credential-audit.json) is also retained. Scans
examined actual app data
and UID logs for the live key in UTF-8/UTF-16LE/UTF-16BE at every byte offset, with
six positive controls; both reported zero matches. Root retains the key and runs all
later final artifact/public-file audits. No raw UID/system logs or private key
material are published here.

The service is bounded, user-requested control work, not a persistent recovery
scheduler. Unverifiable file/process outcomes remain visible as unresolved.
Actual T10 file coordination may serialize arbitrary commands sharing an
environment; its combined test must use an independent external fixture scope
or provably disjoint eligible scopes for the untouched witness, without bypassing
that production queue. Physical OEM, pre-unlock, network-policy and all-app
background lifecycle conclusions remain with T12/T17 as specified.

## Ticket traceability

| T11 criterion | Evidence / boundary |
| --- | --- |
| 1. New input waits for the complete old abort scope | Shared two SDK cases and three actual busy/bootstrap/writer cases; old unanswered, saved new intent admitted once after scope confirmation. |
| 2. UI/native entry independent of JS/UI lifetime | Actual notification after UI destruction during 15-second JS busy; same native control authority, actual owner replacement. |
| 3. Durable stop precedes acknowledgement | T07 native transaction-failure and real stop PID-death regressions in Full01; observer never converts a lost response into success. |
| 4. Old identities cannot start work | Native prepare/start fence, late-evidence identity tests, T07 admission/dispatch gates, old-notification replay after generation 2, live old-follow-up count zero. |
| 5. SDK public abort covers related background descendants | Shared real SDK owned descendant and inherited ownerless fork cases; abort hooks held before new admission. |
| 6. Readiness gate and unresponsive JS | Startup gating regressions, real opening/ready busy loops, native independent cancellation and own-host-only reconstruction. |
| 7. Actual external scope evidence | Actual Termux stopped/scopeConfirmed and original file absence; unknown synthetic file effects retained, never declared cancelled. |
| 8. Idempotence and unrelated isolation | Repeated actual PendingIntent, old notification after new explicit input, other real command running uncancelled at target stop, stale evidence cannot downgrade proof. |
| 9. Reopen does not revive old work | Native stop before/after-commit PID windows, actual owner reconstruction, shared persisted sleeping descendants, T07 readiness/retry/abort regressions and unavailable-control tests. Live and deterministic transport coverage remain distinct; no OEM/network-policy universality is claimed. |
| 10. Pending old input stays stopped; later draft remains authored | Persisted cancelled intent regressions; actual old unanswered receipt, later draft text preserved and not submitted. |
| 11. Explicit new generation and external uncertainty are separate | Actual generation-2 verifier; matching external proof before completion, retained unknown catalogue/effect facts, T09 location/effect occupancy preserved. T10's later file-domain coordination remains a separate integration. |
