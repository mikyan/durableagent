# T07 evidence: reliable native intent → SDK admission

This ticket uses the fixed SDK 1.5.0, actual Android native SQLite and the accepted Javet i18n/Node/SDK SQLite host. [Interface and authority details](../../../runtime/SUBMISSIONS.md) describe the contract. Implementation base is integration `721b27d`; the T07 owner commit contains the final source and evidence.

## Final artifacts and checks

Final app and test artifacts:

- App APK SHA-256: `09f6e531c284a72a72033b2cac6f985400c24b7a7fea3e1f7a9680f2e9e706ea`.
- Initial test APK SHA-256: `17d4714291ebca1369ca212b1093ea5ded1da6e9e6f52e87d76f0bfa0c59238e`. Observer-only correction test APK: `10df909218fbc042d5c7b5f512c21aebe3073950e8825f829d862cb14f9cc7dc`; the app APK is unchanged.
- Runtime: 118/118 tests pass. The location replay case was subsequently strengthened to change actual persisted workspace configuration via the public SDK Session API, reopen, and verify the original binding; its targeted rerun passes. The final 13 shared submission cases run on Android as well.
- UI: 53/53 tests across 15 files, TypeScript and Vite build pass. These include actual Application/SDK/SQLite integration and the lost final-response repair.
- Android assemble/debug-test/lint succeeds. Lint reports zero errors and seven existing warnings: one debug exported receiver, three pinned test dependency updates, one app icon reserved for T15, and two intended JavaScript-enabled WebViews.

On the Android 16 / API 36 / 16 KiB x86_64 emulator, the initial full candidate ran 38 tests in 61.813 s: **36 passed, 2 failed, none skipped**. Both failures were the React admission cases: their direct native observer reads encountered `INPUT_STORAGE_BUSY` during a concurrent short transaction. Native input/submission/migration tests, all six combined native/SDK interruption windows and the 13 shared SDK policies passed. The failure log is retained. The test-only correction retries just `listSends`, `inspect` and `readSend` for at most two seconds on that exact code, records counts, and immediately fails other codes; no write or send is replayed. The [two-case rerun](t07-emu16k-ui-retry-candidate.log) passes **2/2, none skipped**, in 18.146 s with test APK `10df9092…` and the unchanged app. Real MiMo records one busy `readSend` retry; the controlled case records none. These are text-only observations with no preparation jobs (`inspect` can perform recovery maintenance in other contexts). All 38 distinct tests have passing results across these two runs; this is not represented as one uninterrupted 38/38 run.

The real MiMo run obtains the original reply, deliberately leaves native confirmation absent, edits a new draft, then reconciles the same intent. The original receipt/submission is retained and request count stays at one. An explicit second action with the same body has a different intent/submission and raises the count to two. Activity recreation adds zero requests and preserves all four history entries. The newer draft is retained at the old ACK boundary. Both real and controlled tests exercise actual React double-click suppression.

The [selected input regression](t07-emu16k-input-regression-candidate.log) passes 2/2 in 10.032 s on the unchanged app. It runs all five actual-SDK input policies and the real MiMo frozen PNG plus complete UTF-8/BOM attachment branches through the new intent entry point. PNG challenge `628X` and text challenge `HW93GB5V` are returned exactly after the original sources change; fixed hashes match serialized provider input. Each branch has one explicit request and zero on reopen.

The independent [actual UI PID-loss run](t07-emu16k-ui-process-candidate.json) passed on the unchanged app: UI PID 22669 → 22805, host PID 22761 unchanged, one intent and original receipt/history preserved, newer draft text and revision 3 exact. It has no additional observer service binding. Its [restored screen](t07-emu16k-ui-process-candidate-after.png) was visually checked. Exact model-request counts are tested separately by instrumentation; the script does not claim them.

[Artifact inspection](t07-final-apk-inspection.json) verifies 30 runtime entries and six UI resources against source/build output, four Pi packages at 1.5.0, and the pinned Javet i18n native bytes plus ZIP/ELF 16 KiB alignment. The final JSON was refreshed for test APK `10df9092…` and its exact source manifest. The app and its bundled assets remain unchanged by the [independently reviewed observer-only correction](t07-observer-retry-review.md); only `SubmissionApplicationTest.kt` changed among the previously reviewed source files. Earlier native-only results below do not stand in for the combined SDK/UI candidate.

## Credential and public evidence audits

The final [device byte audit](t07-emu16k-credential-audit.json) finds no actual private validation credential in 52,366,848 application-data archive bytes or 11,723,270 retained application-UID log bytes. It scans UTF-8, UTF-16LE and UTF-16BE byte patterns at every offset, with offset-0/1 positive controls and complete tar-transfer verification. Immutable extracted runtime bundles are excluded; this is not heap or flash forensics. No audit script or credential is committed.

The [pre-commit public-files audit](t07-public-audit.json) scanned 387 files and found no exact private credential or device serial. That count precedes copying the two safe audit JSON files; the root performs a further final commit audit. It must not be represented as the later file count.

## Earlier failures and corrections

- Native intent tracer: first native-only candidate passes 1/1 on both the 16 KB emulator and Galaxy S23.
- Second native-only pair: 10/11 pass on each device. The deliberate corrupt-control regression fails because an existing malformed control row was returned as if usable. The row is now validated and retained on failure; no fabricated default control state is substituted.
- Third native-only app `decd21c7b9edb246a6133ee25476104367804080835676e4f50c1ec6ca8df6b0`, with unchanged second test APK `3a258c79b8b8c8f5d34163268a499963c4e3fd2f37f9f7f33183f28d00ccaf54`: 11/11 pass on both devices, including all six native intent/ACK/stop PID-death barriers. Emulator 3.958 s; S23 2.148 s. The later v2→v3 migration case is the twelfth native test and was not part of that pair.
- Independent dispatch probe: pausing or aborting immediately after stream creation initially allowed one actual Models call. Both cases now allow zero; the final synchronous check occurs after awaits.
- Independent ACK-edge probe: a native stop committed before or after native ACK initially allowed one Models request and left pending abort. Both now yield zero requests, unanswered input and a cleared verified abort barrier.
- Independent bounded concurrency probe: two dispatches initially performed 31 checks and admitted only one invocation. They now share one check and admit two. A real two-conversation SDK regression also passes.
- Lost final response after successful native ACK initially left the composer falsely showing old text as saved. Read-only status recovery now inspects the actual native draft without inventing a clear fact; later local edits remain protected. A known delayed ACK can still supply its proven CAS-clear fact even after a newer status projection. Pending native stop is displayed as a request until interruption is verified.

## Acceptance traceability

| Ticket criterion (verified within the platform scope below) | Observable test boundary |
| --- | --- |
| 1. Explicit action after flush; failed native save never submits | UI submission tests; native intent transaction failures; unsent reopen shared case |
| 2. Stable identity, input, target, queue and location | Native replay fingerprint, fixed-input checks, SDK receipt/binding/submission disagreement cases |
| 3. Same content, explicit new action | Shared SDK case and real React/MiMo two-action case |
| 4. Six cross-database interruption windows | `NativeSubmissionEndToEndTest` four native windows using real SDK receipts, plus `SubmissionApplicationTest` two actual SQL COMMIT owner-death windows |
| 5. Product creation before interrupted first send | Existing stable create Interface plus combined native/SDK first-send recovery and repeat create count |
| 6. Atomic map, binding and SDK input | Callback rollback, actual SQL COMMIT before/after errors, physical SDK process-death cases; native confirmation remains a separate transaction |
| 7. Late ACK preserves later author/attachments | Native revision/ABA/representation tests, combined newer-draft interruption, UI late/final-lost ACK regressions |
| 8. Preparation, cancellation and native stop survive recovery | Native freeze/pins/control tests; old-generation and either-ACK-edge SDK stop cases; pending controls at reopen |
| 9. Changed position refuses; accepted replay returns old binding | Actual Session workspace mutation/reopen case and native context mismatch |
| 10. Queued/placed/settled vs whole conversation | Actual SDK afterRun barrier with first input done, second queued, live run still present; corresponding UI projections |
| 11. Unified admission and read-only recovery | Only `send({intentId})`; direct-text rejection; readonly status/list; actual React and UI process recovery |
| 12. Configuration/control/storage gates cover scheduling | Due retry held at startup, missing authority fail-closed, native stop races, abort signal gap and concurrent dispatch cases |

## Limits

Native-only ACK tests use synthetic receipts; they are reported separately from the combined tests. SDK input identity is unique across the tested interruption windows. A killed model request may be retried by the SDK; no exactly-once cloud billing or external effect guarantee is made. The Models invocation boundary precedes Provider work; T11 owns cancellation of an invocation already inside a Provider or external tool.

S23 was locked after first unlock for the completed native-only tests and later disconnected. The new full integration candidate, migration and UI/real-cloud tests are not claimed on S23 until actually run. Activity recreation may be explicitly omitted with `recreateActivity=false`, recorded as `activityRecreated:false`; that is not unlocked visual/lifecycle acceptance. T03/T17 device gates remain independent.
