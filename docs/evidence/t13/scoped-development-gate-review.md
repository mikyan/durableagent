# T13 scoped development gate review

2026-11-04: **pass for the recorded T13 development scope**. Independent review
of owner `57e5963194672512614ea9b641f5b24cb961122b` against integration
`b06bfc746e46b5ab59a5f4b4960df44f187316bc`; merged without conflict as
`2ab45ed380b098d89d70a32b5389caee4c25e3ab`. This is not whole-product acceptance,
the final all-ticket code review, or T17 physical/OEM acceptance. GitHub remains
the execution-status authority; root owns publication and the issue update.

Read AGENTS, tracker/domain rules, glossary, parent spec, dependency index,
[T13](../../specs/v1/tickets/13-data-saver.md), ADR 0006, the referenced SDK
execution/replay research, and [implementation contract](../../../runtime/DATA_SAVER.md).
Fetched current GitHub [#14](https://github.com/mikyan/durableagent/issues/14),
[#1](https://github.com/mikyan/durableagent/issues/1), accepted dependencies
[#10](https://github.com/mikyan/durableagent/issues/10) and
[#12](https://github.com/mikyan/durableagent/issues/12), and #14/#1 comments
(none). The issue was still awaiting this gate when read. This scoped review
does not claim the final code-review skill's two parallel reviews.

## Standards and source review

No actionable documented-standard violation or remaining code blocker found
within the reviewed scope. The real SDK retains scheduling and same-call replay;
native policy supplies current Android facts and independent cancellation;
authenticated Termux and original-file receipts supply external-effect evidence.
The implementation neither writes private SDK tables nor adds a general approval
queue. Unknown shell, mutable paths and generic Providers do not acquire a local
exemption through names or declarations. Fixed local capabilities bind the actual
captured runner/helper bytes, final arguments and environment.

Reviewed final native policy registration/grants/dispatch, current-fact refresh,
bounded cancellation sweep, Provider observation leases, original-file read/write
recovery, writer eligibility, and visible single-operation grants. The native
start boundary rechecks the stop fence and current policy; grants bind the fixed
execution, prepared digest and network period. Policy-interrupted work remains
the original pending SDK invocation instead of triggering a fresh model/tool
attempt. A known undispatched operation can wait outside writer occupancy;
uncertain effects retain their claims and are not treated as safe to repeat.

The [second runtime review](second-review-fixes-review.md) retains independent
unchanged reproductions for pre-admission BUSY and fixed snapshot-page BUSY,
plus after-dispatch, multi-page and durable-stop checks. Inspected the resulting
source: write re-entry requires a matching current accepted-not-started receipt
and explicit undispatched policy; cached read retries retain their original
identity/offset and recheck control without reopening the Provider. The native
known-v1 absent dispatch field is projected as false by its owner; malformed
values still fail and the strict runtime evidence gate remains intact.

The [native review](native-fixes-review.md) identified construction-time monitor
contention. The final per-instance volatile wait setting removes only that
configuration lock. Its value is sampled once before lease acquisition; the
action, transaction, COMMIT and response are not retried. The final
[follow-up review](native-ui-configuration-review.md) and actual same-test
RED/GREEN close this concern within bridge-construction scope, not all Activity
lifecycle latency. User-stop routing and the default fail-fast store remain.

## Artifact and evidence checks

- Owner and integration were clean at their pinned input commits. Final owner
  `57e5963` adds evidence only over production source `0c17bc9`. Independently
  verified **371/371 frozen source/generated files** in the owner checkout and
  **157/157 retained evidence hashes**, then rechecked all 157 after merge.
  The merge Git tree exactly equals the owner tree. The integration checkout
  lacks 66 generated files and originally had 16 source files differing only by
  CRLF/LF; there were no other differences. Five existing Python files were
  normalized to their exact committed LF bytes under the new `.gitattributes`
  rule, with no Git diff. The remaining 11 differences are source line endings;
  the frozen artifact hashes were not rewritten to describe another checkout.
- Independently hashed the final frozen APKs: app
  `0ae3793028954e3934419bd163c2d6da569d5c41f54e4a99e82c6d13b072f907`, test
  `2727f470bb0cd415328ebdb41b68e2806aef6ea88c062047a9d749db1ae6f8bd`.
  Compared FEDF and 0AE source manifests: exactly `NativeInputStore.kt` and two
  Android test files differ. Runtime, bundled UI and executor/setup bytes are
  unchanged. Root's [0AE APK inspection](native-ui-config-apk-inspection.json)
  records 70 runtime entries, 11 UI resources, 213 app source entries, pinned
  Javet i18n 6.0.3, Pi 1.5.0, and ZIP/ELF 16 KiB alignment. Packaging alignment
  is not 16 KiB device execution evidence.
- Read retained host **245/245 runtime**, **88/88 UI**, dual APK/build and lint
  success. Final 0AE lint has zero errors and 12 existing warnings. These host
  results precede the narrowly reviewed native configuration delta; no claim is
  made that the entire matrix reran on the final APK.
- FEDF+1819 alone owns the final [full SDK original-file pass](t13-fed-final-sdk-device.log),
  **1/1, 11.962 s**, six controlled requests, independent read/write grants,
  eligible local work during the wait, and fresh owner zero added requests.
  Its [real MiMo pass](t13-fed-final-real-device.log), **1/1, 24.901 s**, made four
  actual requests and did not reopen the consumed credential capsule. Root's
  [independent original read](fed-independent-original-read.json) confirms the
  44-byte result and digest. These are not described as 0AE device runs.
- Direct 0AE evidence is the [same 497E native tests](t13-ui-config-green01-device.log),
  **2/2, 8.932 s**, and [actual React09](t13-react-grant09-device.log),
  **1/1, 19.688 s** with test2727. Construction took 1 ms while the old read was
  still waiting; one freeze request/response completed in 200 ms, and an
  unreleased lease failed visibly in 1048 ms with no send, SDK owner or model.
  React09 records one trusted enabled pointerdown/up/click to the first identity,
  its completion, a different next identity waiting, global policy still enabled,
  three controlled requests and explicit UI stop. This reviewer inspected both
  actual PNGs: current identities, scope and buttons are visible; the next row's
  top label is clipped, so its waiting state additionally relies on DOM/native
  evidence. The earlier completed row is visible below it.
- [Actual download03](t13-cutover-actual03/instrumentation.log) retains **1/1,
  42.134 s**, a native confirmed scope stop 368 ms after the restricted fact while
  JS was busy, one original execution/request, and no replay on network return.
  One GET and 256000 host-written bytes are not received-byte or zero-flow claims.
  Actual metered local work and real-model exemption have separate recorded runs.
- No ADB, credential, model call or remote mutation was performed by this
  reviewer, and no broad tests were repeated without a new concern. Root reports
  the final owner public-file/history audit passed across 1001 files and 364
  objects, using exact UTF-8/UTF-16LE/UTF-16BE checks with positive controls and
  zero actual-key/private-serial matches. The final integration audit and
  publication remain root-owned; this is not heap or flash forensics.

## Acceptance and limits

The [eleven-criterion mapping](README.md#t13-criterion-mapping) has reviewed
development evidence for all criteria: public configuration/current facts,
model/local exemptions, conservative unknowns, final and replay paths, visible
fixed grants, invalidation, running cutover, distinct stop/no replay, repeated
facts/reopen/storage loss, visible reasons, and the required combined matrix.
The mapping correctly separates host controlled-boundary tests, native slices,
actual network/process behavior, actual Provider writes and real-model requests.

Original failures remain failures. In particular, initial React02's cause remains
unresolved; later cold-daemon/fixture/storage failures are not retroactive root
causes for it. UI07's stale next-row frame is not visual proof; UI08's disabled
button and fixture admission gap remain retained. C5DD's missing dispatch-field
failure is closed only by its same-test native projection regression and FEDF
SDK/MiMo reruns. Cutover01's extra continuation and Cutover02's natural socket
exit retain their original failed outcomes. Native ACK/lease fault slices are
not presented as actual process-kill evidence.

Scope remains Android 16/API36 x86_64 **4 KiB emulators**, the fixed controlled
executor and tested Provider. No new Samsung, Xiaomi or tablet execution claim
is made. T12 recovery, T15 complete Console experience, T17 target-device/OEM
conditions and final all-ticket review remain open. This is a controlled-tool
policy, not a firewall, arbitrary-code sandbox, permanent keepalive, zero-byte
cutover guarantee or general exactly-once execution promise.

Standards: **0 actionable findings**. Spec: **0 unresolved findings in scope**.
