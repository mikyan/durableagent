# T13 Data Saver evidence

Implementation: [runtime/DATA_SAVER.md](../../../runtime/DATA_SAVER.md). This is a
policy over controlled capabilities, not a firewall, arbitrary-code sandbox or
promise of zero bytes after a network transition. The real SDK remains the
scheduler. Android supplies current network facts and native cancellation;
authenticated Termux receipts supply external process evidence.

This report records separate runs, including failures. It is not a claim that
all rows ran as one suite or on one APK. T17 physical/OEM coverage is not supplied
by these emulator results.

## Environments and artifacts

Native slices and integrated tests used Android 16/API36 x86_64 **4 KiB**
emulators. The actual execution environment was the existing paired official
Termux installation with its nonempty durable ledger. No app/Termux data was
cleared. Root coordinated network overrides and restored the original
`AndroidWifi;none` state. Some platform override commands returned255 despite
the query showing the requested state; the recorded query, not exit status,
established the actual network condition.

The guarded three-module executor update verified old managed scopes and exact
process identity, then preserved96 execution records,5 cancellation tombstones,
pairing, executor identity and ledger epoch. It retained the T10 file helper and
transport. Final modules are runnerBE8B68EC… / helper13467B5D… /
transportC20F4EF5…, setupBCCDFE9D…; [artifact metadata](artifacts.json) and
[independent APK inspection](final-apk-inspection.json) contain complete hashes.

| Candidate / scope | App SHA256 | Test SHA256 |
| --- | --- | --- |
| SDK-first | `d01cb7adb6bef4f6ed76ed90966464ab5b11e761fe7c8091ffa8aa1a5f191781` | `6264fd6ef04885f91bff9f0e5211d8c227625c44288e3ce82ca600b3438cd843` |
| SDK-second / orphan and ACK repair | `0ba39359794213df91781ca29b1e8f547224834688ffa1e83c7ab99731d8d4aa` | `f3730b3d678c734047c6f5d3a5a791ff584b6c8a90e2dc48355918ed9de202a3` |
| Review fixes / native and SDK/MiMo | `b945aaf6c9700732945de12247f8ebe95d185942c8273fe7eca0dd28b269825c` | `cd232a8d5739da4c3a1a3c0d8a4304d3470d10652499da3258eb722158a463c7` |
| Second review fixes / host and build only, device pending | `d92fad39bf074264db081089906aac44a7ee566e39367b5b0caa1673930297cc` | `dea2ffac355c6a5ee1fbbf29197eb80509cbf8a7927293d3af37ebb5d92484fa` |
| Native UI lease fix / public input and actual React | `c5ddd4356cc07bca0a65302508584124209f6d52d3c9b046a6a1d0d2120222de` | `e51e1a1fc6a98def231e36a713d6b21ed74cd7454aec366f6195c23400690a99` |
| Explicit native dispatch projection / native, full SDK and real MiMo | `fedf063ccde1492599b24bb8a489f80f5486f7b9a286a66272446e9a79aa0849` | `1819107ddbb005626d31808a9f55bf0d3bb09e1ab69038ad5c1cd422759c5574` |
| Nonblocking native bridge configuration / build passed, device pending | `0ae3793028954e3934419bd163c2d6da569d5c41f54e4a99e82c6d13b072f907` | `2727f470bb0cd415328ebdb41b68e2806aef6ea88c062047a9d749db1ae6f8bd` |

The reviewed app matched70 runtime entries and11 UI resources. Both Javet native
libraries match the pinned i18n6.0.3 AAR and satisfy ZIP/ELF16KiB alignment; all
four Pi packages remain1.5.0. That packaging check does not turn the4KiB device
runs into16KiB execution evidence. [Source hashes](source-hashes.json) describe
the reviewed snapshot; later test-only UI additions have their own artifact
identity and do not change the app.

## Current facts, fixed grants and native fences

The native SQLite slices cover configuration CAS/reopen, fixed prepared final
digests, grants scoped to one network period, policy-storage loss, user-stop
priority, durable interruption and public projection ordering. Each retained
RED has a corresponding bounded implementation change. Representative final
runs are [period regression6/6](t13-period-green01-device.log),
[storage-loss regression4/4](t13-storage-loss-green01-device.log),
[final execution fence](t13-final-fence-green01-device.log), and
[65-operation paged sweep](t13-sweep-green01-device.log). The sweep's controlled
external boundary proves pagination/unknown-row fairness, not a real process kill.

[Actual Android callbacks](t13-network-green01-device.log) observed known
unmetered→metered→unmetered facts without a JavaScript owner. The
[event record](t13-network-green01-events.log) and
[root actions](t13-network-green01-root-actions.log) preserve the transitions.
The82.102-second test duration includes operator coordination and is **not** a
network detection latency. Public Javet settings persisted into a fresh SDK
owner with zero requests in the [public settings test](t13-public-green01-device.log).

## Actual controlled local work and network cutover

[Temporary real Termux capability tests](t13-python-local03-termux.log) passed5/5
in2.741s. A269-byte original was updated once; changing both source paths after
admission did not change captured executing bytes. Same-ID reopening, exact
child-scope cancellation and durable network-policy no-start behavior were
observed in that dedicated temporary ledger.

The [actual metered product local test](t13-local-product-second-device.log)
passed1/1 in37.909s: three controlled local operations completed with **zero
temporary grants**, while the original unknown command retained the same
`accepted_not_started` identity. The complete controlled-model flow made nine
requests. Native proof came from an authenticated bounded `list(limit1)` reply;
the preceding failed attempt used `ping`, whose transport reply did not contain
the required capability proof. No fabricated proof or fallback was introduced.

[Actual download cutover03](t13-cutover-actual03/instrumentation.log) passed1/1
in42.134s. Android's restricted-network fact was followed by confirmed
`network_policy` cancellation of the original child scope in **368ms**, while
the real JavaScript loop remained busy. One original model request and one
execution remained; returning to unmetered did not replay them. Explicit user
stop subsequently settled the waiting SDK invocation. The
[transition record](t13-cutover-actual03/events.json) links the execution UUID to
the [synthetic HTTP server](t13-cutover-actual03/server.log): one GET,
256000 bytes written by the host. These are not claimed to be received bytes or
zero bytes after transition.

Cutover01 confirmed a real scope stop in660ms, but failed because a native
response completed during the busy loop was discarded by a deadline check before
polling; the SDK generated a second model request. The channel now polls the
same operation first without replaying `begin` or extending a still-pending
operation's deadline. [Retained observation](t13-cutover-actual01-retained-observation.log).
Cutover02 retained one model/execution but failed the expected stop: Android's
network change itself aborted the socket, and the test shell's generic `wait`
hid the child's error. The corrected dedicated child catches that abort and
waits boundedly without another GET; the parent waits its exact PID. Production
`completed` semantics were not changed. [Retained observation](t13-cutover-actual02-retained-observation.log).

## Real models and selected originals

The earlier [real MiMo execution flow](t13-execution-second-real-mimo-device.log)
passed1/1 in18.325s on an actually metered network. It made three real HTTP
requests: the original tool waited after request1, the exact grant allowed its
completion/follow-up, and a new same-content execution waited after request3.
User stop confirmed that new execution never started and invalidated its grant;
global Data Saver remained enabled.

Native Provider slices proved that metadata selection can wait before contacting
the Provider, a read has its own grant and fixed private snapshot, and a write
has an independent plan/grant. The selected URI came from a real retained system
picker grant. The [write/sweep pair](t13-provider-write-first-device.log) passed2/2
in3.222s; an independent original-file read confirmed the new bytes. Provider
operations are never sent to the Termux command canceller. Snapshot reopening is
a cached observation, not a new Provider read.

The [earlier reviewed SDK flow](t13-provider-review-sdk-device.log) passed1/1
in43.442s on B945. Read and conditional write required distinct
grants, a controlled local file operation continued while the Provider write
waited, six controlled-model requests completed, and a fresh SDK owner restored
the same history with zero added requests.

The [reviewed actual MiMo flow](t13-provider-review-real-device.log) passed1/1
in33.321s with four real HTTP requests. The original text entered the model through
the actual `document_read` result, not through the prompt. Its digest then guarded
the separate `document_write`; an [independent Termux read](independent-original-read.json) matched the final44-byte
original and SHA256`c3ae3b2d50fd3ee45ed544c1ec8753b2913d1e47f9ca97ebf3b43ff06427eb50`.
This bounded validation uses real registered tools and fixed `tool_choice` in
the `execution-real` test mode. It is not evidence that an unconstrained product
model autonomously chooses a particular tool. No fresh real-host replay is
claimed after the single-use credential capsule was consumed.

After the dispatch-projection fix, the [full SDK rerun](t13-fed-final-sdk-device.log)
passed1/1 in11.962s on FEDF+1819. Read `a8ba4bfc-5778-451d-9744-f432b50e2269`
and write `fc1dfc2d-da4c-4573-90cc-ee43b3f96734` required independent grants;
controlled local work continued while the write waited. Six controlled-model
requests completed, and a fresh SDK owner added zero requests.
The [actual MiMo rerun](t13-fed-final-real-device.log) passed1/1 in24.901s on
the same artifacts with four actual HTTP requests. Its independent read and
write identities were `a7815d43-a998-44ca-812e-c05d45885b2b` and
`80462def-3da8-4ac5-b794-f66f0f40164a`. A separate
[normal Termux read](fed-independent-original-read.json) confirmed44 bytes,
SHA256`b397e91e86d8d947750bc651cf1b2d31f0687e0127f32804a1b000f86fc14343`,
and the exact new text. This real run did not reopen its consumed credential
capsule or claim an unconstrained model-choice test. Both runs restored the
recorded network override to `AndroidWifi;none`.

## Recovery defects and independent review fixes

- SDK-first failed before original I/O: staging advanced the native receipt to1,
  while a waiting loop retained prepare sequence0. A public file-list/recovery
  observation advanced the reservation and the old proof was correctly refused.
  The [public SDK RED](t13-provider-staged-sequence-red.log) and
  [GREEN](t13-provider-staged-sequence-green.log) retain the monotonic check and
  query the same current receipt. The original remained unchanged.
- Separate host regressions proved native-completed/policy-ACK-loss failures.
  Recovery now queries the same native operation and repairs only a matching
  confirmed original receipt. The [actual native ACK boundary](t13-provider-ack-green02-device.log)
  passed1/1 in3.634s after a real conditional write, injected policy-result commit
  failure and reopen. It did not write the original again.
- A dispatched observation without an OS owner incorrectly remained `granted`.
  The [native RED](t13-provider-orphan-red01-device.log) and
  [GREEN](t13-provider-orphan-green02-device.log) distinguish orphaned and live
  leases. This simulates the persisted dispatch boundary; it is not a PID-kill test.
- Independent review found the real `DATA_SAVER_BUSY` code was missing from SDK
  waiting, and a pre-admission `DOCUMENT_CHANNEL_BUSY` was treated as lost ACK.
  [Public host RED](t13-review-owner-host-inrepo-red.log) and
  [GREEN7/7](t13-review-owner-host-green.log) distinguish exact pre-admission
  retry from genuine response loss; the latter still performs only same-ID query.
- Independent review found that `closeRead` removed its reader before a policy
  gate, leaking the FD when that gate threw. It also found that original-content
  verification hid policy waiting as Provider unavailability. The
  [same-test native RED2/2](t13-provider-review-native-red01-device.log) and
  [GREEN2/2](t13-provider-review-native-green01-device.log),4.102s, prove FD closure
  on refusal and a distinct fixed verification grant. Matching bytes still do not
  confirm the original write's scope. The [UI regression](t13-verify-ui-green.log)
  checks that narrow resume action and unchanged uncertain write status.
- A second independent pass found that `DATA_SAVER_BUSY` returned from `start`
  could leave a proven pre-dispatch write querying forever. The
  [public SDK RED](t13-policy-start-inrepo-red.log) fails after10.216s. Recovery now
  checks both the matching current `accepted_not_started` receipt and explicit
  undispatched policy before retrying that same identity. An additional
  [after-dispatch RED](t13-policy-after-dispatch-red.log) caught an intermediate
  failure path; [GREEN9/9](t13-policy-after-dispatch-green.log) retains the original
  tool, one dispatch and no model continuation while its result is uncertain.
- Fixed snapshot pages also encountered real `DATA_SAVER_BUSY` from the native
  policy authority. The [public SDK RED](t13-policy-read-snapshot-red.log) returned
  a tool error instead of the fixed content. [GREEN10/10](t13-policy-read-snapshot-green.log)
  retries only the cached page at its original offset after control checks, never
  reopens the Provider, and verifies the complete snapshot digest. Both unchanged
  external review repros now pass. These are real SDK/SQLite with controlled
  native boundary failures, not Android lock-contention or actual-network tests.
- C5DD's [full SDK rerun failed in8.619s](t13-c5-final-sdk-device.log). Its native
  v1 Provider rows omitted the dispatch flag before startup, while the stricter
  runtime gate required explicit false. The host boundary fixtures supplied
  false and did not detect this production contract mismatch. A
  [closed, no-Harness observer](t13-c5-final-sdk-retained.log) retained the one
  staged/accepted-not-started write; the [independent original read](t13-c5-final-sdk-original-after.json)
  confirmed no original change. That failed input is not reopened or resent.
  The [native projection RED](t13-provider-projection-red01-device.log) failed
  in0.221s with expected false/actual absent. FEDF now projects the known native
  v1 absent-field default explicitly, preserves true, and refuses malformed
  values. The stored format and strict runtime gate are unchanged. The
  [exact same BB5 test GREEN](t13-provider-projection-green01-device.log)
  passed1/1 in0.286s on FEDF; it checks false across registration/reopen/grant
  and true after durable dispatch/reopen. The full SDK and real MiMo reruns
  above then passed on FEDF+1819.

SDK-second's first integrated run had completed the write and six requests before
a **test-only** error read history `entries` instead of `items`. Its next run
reached the fresh owner but expected a metrics key before any model request;
the key is created on the first request. Correcting only those observations gave
[controlled1/1,23.858s](t13-provider-history-fixture03-device.log) and
[real MiMo1/1,21.354s](t13-provider-real02-device.log) on the unchanged app.
Both original failed logs remain here; they are not relabelled as product passes.

## Checks and remaining acceptance work

Prior reviewed-source host checks: [runtime242/242](t13-review-final-runtime.log),
[UI88/88](t13-review-final-ui.log), TypeScript/Vite/dual APK build and
[Android lint](t13-review-final-lint.log) passed. Lint has zero errors and12 known
warnings covering pinned dependencies, app icon, fixed Termux paths, debug
receiver, bundled WebView JavaScript and explicit TLS trust handling.

After the second review fixes, [runtime245/245](t13-policy-final-runtime.log),
[UI88/88](t13-policy-final-ui.log), and the
[dual APK plus lint build](t13-policy-final-android-build.log) pass. Lint remains
zero errors and12 warnings. D92 was superseded by C5DD before its own device run;
it is not claimed as device-tested. C5DD contains the same reviewed runtime fixes
and the native UI acquisition change below. Earlier device passes remain scoped
to their frozen APKs.

The [actual credential audit](t13-provider-review-real-credential-audit.json)
searches raw UTF-8/UTF-16LE/UTF-16BE sequences at every byte offset, with positive
controls and verified transfer completion. It excludes immutable extracted
runtime bundles and does not claim heap or flash forensics. No actual credential
was found in the scoped app data or retained application logs. Raw credentials,
UID log dumps and private hardware serials are not copied into this report.

Actual React visible single-grant validation now passes on C5DD; the earlier
Wire-driven tests are still not presented as button or physical-touch evidence.
FEDF's final Provider SDK/MiMo regression has passed. Its
[APK inspection](native-projection-apk-inspection.json) verifies70 runtime
entries,11 UI resources,213 source entries and unchanged aligned native/setup
artifacts. The [latest exact-credential audit](t13-fed-final-credential-audit.json)
found no credential in50,906,624 bytes of scoped app data or337,088 bytes of
retained application logs, with positive controls and verified tar completion.
The native construction-time lock GREEN, corrected enabled-control UI follow-up,
public-file audit and owner integration handoff remain pending.
T13 is not marked accepted here.

The first actual React attempt02 failed before any durable intent; its original
cause remains unresolved. Diagnostic04 subsequently did create an intent, but
its cold-retained emulator had no running paired Termux daemon and no execution
receipt; this is a different failure. After the normal public connect path
restored the same paired executor, attempt05 failed because the fixture treated
a section refresh error as a failed send while its actual send item was still
`saving`. That fixture also polled the native input store every40ms during the
send and could itself compete for the lease. Its failure is retained, not called
a product pass or a proven completed send failure.

Test-only diagnostic06 removes that native polling and observes the original DOM
send item until admission or a settled failure. It does not retry or send again,
and retains the actual pointer/viewport/same-identity grant assertions. Its
test APK is `b272deac44f68dd1d46a10a27b95939f95b8c2e65417168fedff4a60fe71efb0`;
the [actual06 run](t13-react-grant06-device.log) failed in98.406s. It reached the
first waiting operation, physically granted it and observed its completion, but
the second explicit send failed before a new intent with `INPUT_STORAGE_BUSY`.
This run no longer has the earlier diagnostic native polling. The diagnostic
stage label was stale on the
second send; the failing assertion and active UI observation identify the later
stage. All preceding runs remain retained and are not reopened or resent to make
a later test pass.

The [same-test actual input RED](t13-ui-lease-red01-device.log) failed in5.898s:
the one public WebView `input.freeze` returned early while a real OS input lease
was held for150ms. The native bridge now allows its worker to wait up to1s before
entering a metadata action. It never retries an action, transaction, COMMIT or
response. The [same E51 test GREEN](t13-ui-lease-green01-device.log) on C5DD passed
1/1 in5.779s: one freeze request/response completed in227ms after lease release;
an unreleased lease returned `INPUT_STORAGE_BUSY` in1016ms. It retained the draft,
created zero send intents, and opened no SDK owner or model request.

The unchanged clean UI case then passed [actual07,1/1 in13.401s](t13-react-grant07-device.log).
It physically touched the visible fixed-operation grant, confirmed completion
of that identity, then explicitly sent again. The new identity waited without
inheriting the grant; global Data Saver stayed enabled, and explicit UI stop
settled that second operation. Three controlled-model requests were observed.
These are not three real MiMo requests. Actual network overrides were restored.
The retained07 `next-waiting` PNG still showed an older compositor frame despite
the matching current DOM assertion; it is not visual proof of that next row.
The later test waits for the platform WebView visual-state callback and native
frame callbacks before capture. [Actual08](t13-react-grant08-device.log) on
FEDF+1819 failed in97.128s before the first grant completed. Inspection of its
[actual waiting screenshot](t13-react-grant08-waiting.png) showed a disabled
grant button. The fixture checked visibility and hit-testing but omitted enabled
state; the native operation could already be prepared while the UI snapshot had
not caught up. This identifies a fixture admission gap, not a proven product
grant-handler defect or proof that the pointer reached the button. The original
operation stayed undispatched with no grant or error; it is not reopened or resent.
The follow-up requires the exact operation's button to be enabled, connected,
visible and hit-testable before capture and one pointer injection, with a visual
barrier after scrolling and passive trusted pointer/click diagnostics. It does
not inject a second click or repeat the send. Its actual result remains pending.
The new [APK inspection](native-ui-lease-apk-inspection.json) verifies70 runtime
entries,11 UI resources, pinned native libraries/16KiB alignment and unchanged
three-module setup; it does not assert16KiB execution.

The [second independent fix review](second-review-fixes-review.md) passes the
two runtime fixes, including separate multi-page snapshot contention and durable
stop checks. A [separate native review](native-fixes-review.md) finds no defect
in the dispatch projection and confirms pre-action-only lease waiting, while
identifying a construction-time monitor contention risk. Its targeted actual
Android [RED](t13-ui-config-red01-device.log) on FEDF plus test497E failed1/1
in3.797s: new `NativeInputBridge` construction on the main thread blocked behind
another native read's actual OS-lease wait. The minimal follow-up makes the
per-instance setting volatile and assigns it without the global monitor. The
default zero, validation range, one-second UI action wait and once-sampled
deadline are unchanged. This proves only bridge construction, not full Activity
recreation or all lifecycle latency. A [scoped source review](native-ui-configuration-review.md)
found no source blocker; exact same-test GREEN is pending.

[0AE build](t13-ui-config-green-build.log) passed dual APK and lint with0 errors
and12 existing warnings. Its [371-source frozen manifest](native-ui-config-source-hashes.json)
differs from FEDF in exactly three source files: the two-line production setting
change, the new native construction test, and the enabled-control pointer test.
Runtime, bundled UI and executor/setup bytes are unchanged; FEDF's full SDK and
MiMo results are not relabelled as runs of0AE. None of these source reviews is a
whole-ticket acceptance claim. Root's independent
[0AE APK inspection](native-ui-config-apk-inspection.json) matches70 runtime,
11 UI and213 application source entries, pinned aligned native libraries and the
unchanged three-module executor/setup. Device GREEN and UI09 remain pending.

## T13 criterion mapping

The numbers follow the eleven criteria in the [ticket](../../specs/v1/tickets/13-data-saver.md).
These are separate development evidence slices, not a single final-device matrix.

| Criterion | Implementation and observed evidence | Limit |
| --- | --- | --- |
| 1. Public setting and current network facts | Public Javet setting/reopen with zero requests; actual Android callback transitions; native unknown/current-fact and lost-policy regressions | No remembered Wi-Fi shortcut; callbacks measured on API36 emulator |
| 2. Models and controlled local work continue | Actual metered local files/fixed Bash with zero grants; FEDF SDK local work while Provider write waits; real MiMo flows | Model requests are exempt only through the configured model module |
| 3. Unknown commands remain unknown | Native capability-proof tests and actual unknown Bash waiting; temporary real executor5/5 verifies fixed helper bytes despite path mutation | Authenticated controlled capability, not arbitrary-code or hostile-Termux isolation |
| 4. Final arguments, environment, nested calls and safe replay | Real SDK direct/nested beforeTool+prepare mutation tests; native final fence; same prepared execution restored after SDK host death; fixed Provider snapshot reopen | Host replay tests use controlled native boundaries; actual execution evidence is reported separately |
| 5. Single-operation visible grant | Actual React07 pointer grant completes first identity; second explicit input waits; global setting remains enabled |07 next-row PNG has stale pixels;08 targeted disabled control; enabled-control follow-up pending |
| 6. Stable grant identity and invalidation | Native period/reopen6/6, changed final digest refusal, stale grant RED→GREEN, real MiMo next identity waits then user stop invalidates it | Grant covers one immutable operation and one network period |
| 7. Native cutover while JS is busy | Actual download03 confirms managed child cancellation368ms after restricted observation; one GET/256000 server-written bytes; local and model flows separately pass | One measured emulator transition, not zero traffic or latency guarantee |
| 8. Distinct stop reason and no blind replay | Actual `network_policy` cancellation retains one tool/execution after return to unmetered; user stop then settles it; explicit undispatched evidence controls same-ID recovery | Interrupted or uncertain external effects are not automatically restarted |
| 9. Repeated facts, restart, stop fence and policy loss | Native period/current-fact tests; public setting fresh owner; host pending-tool recovery; native missing-policy4/4 and final fence;65-row sweep fairness | No claim of OEM lifecycle coverage; storage loss is conservative |
| 10. Specific visible reasons | React policy tests and actual grant07 flow; separate original-verification observation UI regression | No general approval queue; uncertain write stays uncertain after matching read |
| 11. Required validation matrix and scope | Real model, actual local files, actual download/child cutover, unknown Bash, real SDK safe replay, native fences, actual Provider read/write and independent original read | Controlled-tool policy on API36/4KiB emulator; T17 physical/OEM conditions remain |

[Evidence hashes](evidence-hashes.json) cover copied logs and safe JSON. APKs,
full source snapshots and test fixtures remain separately frozen outside Git.
This directory disables Git text conversion to preserve hashed tool-emitted
bytes; raw log whitespace remains part of the evidence.
[Reproduction instructions](REPRODUCE.md) give exact selectors, preconditions,
same-test RED/GREEN artifact identities and separate host/device scope.
